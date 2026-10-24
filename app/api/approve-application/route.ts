// FILE PATH: ./app/api/approve-application/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    // =========================================================================
    // 1. CRITICAL SECURITY GATE: Verify the Staff Member Triggering This API
    // =========================================================================
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: '[ERR-SEC-401] Unauthorized: Missing authentication token.' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user: requestingUser },
      error: verifyError,
    } = await supabaseAdmin.auth.getUser(token);

    if (verifyError || !requestingUser) {
      return NextResponse.json(
        { success: false, error: '[ERR-SEC-401] Unauthorized: Invalid or expired session.' },
        { status: 401 }
      );
    }

    // Verify Active Back-Office Staff Clearance (Admin / Manager / Staff)
    const { data: staffCheck } = await supabaseAdmin
      .from('back_office_staff')
      .select('id, email, role, status')
      .ilike('email', requestingUser.email || '')
      .maybeSingle();

    const safeStaffRole = String(staffCheck?.role || '').trim().toLowerCase();
    if (
      !staffCheck ||
      staffCheck.status !== 'Active' ||
      !['admin', 'manager', 'staff'].includes(safeStaffRole)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: '[ERR-SEC-403] Forbidden: Active Onboarding/Admin clearance required.',
        },
        { status: 403 }
      );
    }

    // =========================================================================
    // 2. DATA EXTRACTION & VALIDATION
    // =========================================================================
    const { appId, applicantName, applicantEmail, locationId, mobile, role } =
      await request.json();

    if (!appId || !applicantEmail || !locationId || !role) {
      return NextResponse.json(
        { success: false, error: '[ERR-VAL-400] Missing required application data.' },
        { status: 400 }
      );
    }

    const { data: loc, error: locError } = await supabaseAdmin
      .from('locations')
      .select('center_name, center_code')
      .eq('id', locationId)
      .single();

    if (locError || !loc) {
      return NextResponse.json(
        { success: false, error: '[ERR-REL-203] Invalid Location ID assigned.' },
        { status: 400 }
      );
    }

    const cleanEmail = String(applicantEmail).trim().toLowerCase();
    const tempPassword = `FA@${Math.random().toString(36).slice(-6)}${new Date().getFullYear()}`;

    // =========================================================================
    // 3. TRIGGER COLLISION FIX: ATOMIC STATE GUARD
    // =========================================================================
    const { data: updatedQueue, error: updateError } = await supabaseAdmin
      .from('pending_applications')
      .update({ status: 'Approved', mapped_center_id: locationId })
      .eq('id', appId)
      .eq('status', 'Pending')
      .select()
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return NextResponse.json(
          {
            success: false,
            error:
              '[ERR-LCK-116] Double Approval Prevented: This application has already been processed by another manager.',
          },
          { status: 409 }
        );
      }
      throw new Error(`Failed to update pending queue: ${updateError.message}`);
    }

    // =========================================================================
    // 4. AUTOMATED USER PROVISIONING (SMART RECOVERY ENGINE)
    // =========================================================================
    let authUserId = null;

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          name: applicantName,
          role: role,
          center_id: locationId,
          mobile: mobile || null,
        },
      });

    if (authError) {
      const errStr = authError.message.toLowerCase();
      if (
        errStr.includes('already') ||
        errStr.includes('registered') ||
        errStr.includes('exists')
      ) {
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: 100,
          });
          if (!listData?.users || listData.users.length === 0) break;

          const existingUser = listData.users.find(
            (u) => u.email?.toLowerCase() === cleanEmail
          );
          if (existingUser) {
            authUserId = existingUser.id;
            await supabaseAdmin.auth.admin.updateUserById(authUserId, {
              password: tempPassword,
              user_metadata: {
                name: applicantName,
                role: role,
                center_id: locationId,
                mobile: mobile || null,
              },
            });
            hasMore = false;
          } else {
            page++;
          }
        }

        if (!authUserId) {
          await supabaseAdmin
            .from('pending_applications')
            .update({ status: 'Pending' })
            .eq('id', appId);
          throw new Error(
            `Ghost Auth Recovery Failed: Could not locate the existing auth user for ${cleanEmail}`
          );
        }
      } else {
        await supabaseAdmin
          .from('pending_applications')
          .update({ status: 'Pending' })
          .eq('id', appId);
        throw new Error(`Auth Creation Failed: ${authError.message}`);
      }
    } else {
      authUserId = authData.user?.id;
    }

    // =========================================================================
    // 5. SAFELY ENFORCE PROFILE DATA & AUTO-FLIP AADHAAR ROLE
    // =========================================================================
    const isAadhaarRole = String(role || '')
      .toUpperCase()
      .includes('AADHAAR');
    const roleMeta = updatedQueue?.role_metadata || {};

    const partnerProfilePayload: any = {
      application_id: appId,
      auth_id: authUserId,
      partner_name: applicantName,
      email: cleanEmail,
      mobile: mobile,
      role: role,
      role_aadhaar: isAadhaarRole,
      aadhaar_operator_id: roleMeta.aadhaar_operator_id || null,
      aadhaar_station_id: roleMeta.aadhaar_station_id || null,
      center_id: locationId,
      status: 'Active',
      tc_accepted: false,
    };

    const { error: insertError } = await supabaseAdmin
      .from('active_partners')
      .insert([partnerProfilePayload]);

    if (insertError) {
      if (
        insertError.code === '23505' ||
        insertError.message.includes('unique_partner_email')
      ) {
        const { error: updateProfileError } = await supabaseAdmin
          .from('active_partners')
          .update({
            application_id: appId,
            auth_id: authUserId,
            status: 'Active',
            role: role,
            role_aadhaar: isAadhaarRole,
            aadhaar_operator_id: roleMeta.aadhaar_operator_id || null,
            aadhaar_station_id: roleMeta.aadhaar_station_id || null,
            center_id: locationId,
          })
          .eq('email', cleanEmail);

        if (updateProfileError)
          throw new Error(`Profile Sync Failed: ${updateProfileError.message}`);
      } else {
        throw new Error(`Profile Creation Failed: ${insertError.message}`);
      }
    }

    if (isAadhaarRole) {
      await supabaseAdmin
        .from('locations')
        .update({ role_aadhaar: true })
        .eq('id', locationId);
    }

    // =========================================================================
    // 6. COMMUNICATION DISPATCH & IMMUTABLE AUDIT LOG
    // =========================================================================
    try {
      await resend.emails.send({
        from: 'Fast Ark Onboarding <updates@fastark.in>',
        to: cleanEmail,
        subject: 'Fast Ark Account Created - Credentials Enclosed 🚀',
        html: `
          <h2>Welcome to Fast Ark, ${applicantName}!</h2>
          <p>Your application for the <b>${role}</b> role at <b>[${loc.center_code || 'CENTER'}] ${loc.center_name}</b> has been approved.</p>
          <div style="background: #f1f5f9; padding: 15px; border-radius: 5px;">
            <p><b>Login Portal:</b> <a href="https://fastark.org/partner/login">https://fastark.org/partner/login</a></p>
            <p><b>Email:</b> ${cleanEmail}</p>
            <p><b>Temporary Password:</b> ${tempPassword}</p>
          </div>
          <p>You will be required to accept the mandatory commercial terms upon your first login.</p>
        `,
      });

      await resend.emails.send({
        from: 'Fast Ark System <updates@fastark.in>',
        to: 'ENQUIRY@FASTARK.in',
        subject: `✅ NEW APPROVAL: ${applicantName}`,
        text: `The application for ${applicantName} has been APPROVED by ${requestingUser.email} for the role of ${role} and mapped to [${loc.center_code || 'NO-CODE'}] ${loc.center_name}. The welcome email has been dispatched.`,
      });
    } catch (mailErr: any) {
      console.warn('Approval email dispatch warning:', mailErr.message);
    }

    try {
      await supabaseAdmin.from('system_audit_logs').insert([
        {
          actor_id: requestingUser.id,
          actor_email: requestingUser.email,
          actor_role: staffCheck.role,
          module: 'API_APPROVE_APPLICATION',
          action_code: 'APPLICATION_APPROVED',
          reference_id: String(appId),
          metadata: {
            applicant_name: applicantName,
            applicant_email: cleanEmail,
            role: role,
            location_id: locationId,
            center_code: loc.center_code,
          },
        },
      ]);
    } catch (_) {}

    return NextResponse.json({
      success: true,
      message: 'Partner successfully provisioned and queue updated.',
    });
  } catch (error: any) {
    console.error('Approve Application API Error:', error);

    try {
      await supabaseAdmin.from('system_audit_logs').insert([
        {
          actor_email: 'SYSTEM',
          actor_role: 'API',
          module: 'API_APPROVE_APPLICATION',
          action_code: 'ERR-APP-500',
          metadata: { raw_error: String(error?.message || error) },
        },
      ]);
    } catch (_) {}

    return NextResponse.json(
      {
        success: false,
        error:
          '[ERR-APP-500] System error while provisioning partner account. Please verify application status.',
      },
      { status: 500 }
    );
  }
}