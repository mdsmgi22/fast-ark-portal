// FILE PATH: ./app/api/reject-application/route.ts
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

    // 1. CRITICAL SECURITY GATE: Verify Token & Active Ops/Admin Role
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

    // 2. DATA EXTRACTION & VALIDATION
    const { appId, applicantName, applicantEmail, rejectReason } = await request.json();

    if (!appId || !applicantName || !applicantEmail || !rejectReason?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: '[ERR-VAL-400] Missing required application details or rejection reason.',
        },
        { status: 400 }
      );
    }

    const cleanEmail = String(applicantEmail).trim().toLowerCase();
    const cleanReason = String(rejectReason).trim();

    // 3. TRIGGER COLLISION FIX: ATOMIC STATE GUARD
    const { data: updatedQueue, error: updateError } = await supabaseAdmin
      .from('pending_applications')
      .update({ status: 'Rejected', reject_reason: cleanReason })
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
              '[ERR-LCK-116] Double Processing Prevented: This application was already processed by another manager.',
          },
          { status: 409 }
        );
      }
      throw new Error(`Queue update failed: ${updateError.message}`);
    }

    // 4. DOWNLOAD KYC FILES TO SERVER MEMORY (STRICT PREFIX MATCH)
    const safeName = String(applicantName).replace(/[^a-zA-Z0-9]/g, '_');
    const expectedPrefix = `${safeName}_`;

    const { data: files, error: searchError } = await supabaseAdmin.storage
      .from('application_documents')
      .list('', { search: safeName });

    if (searchError) throw searchError;

    const matchedApplicantFiles = (files || []).filter(
      (f) =>
        f.name.startsWith(expectedPrefix) ||
        (updatedQueue?.photo_path && f.name === updatedQueue.photo_path)
    );

    const attachments: { filename: string; content: Buffer }[] = [];
    const filesToDelete: string[] = [];

    for (const file of matchedApplicantFiles) {
      const { data: fileBlob } = await supabaseAdmin.storage
        .from('application_documents')
        .download(file.name);

      if (fileBlob) {
        const buffer = Buffer.from(await fileBlob.arrayBuffer());
        attachments.push({ filename: file.name, content: buffer });
        filesToDelete.push(file.name);
      }
    }

    // 5. COMMUNICATION DISPATCH (FAULT-TOLERANT)
    const senderEmail = 'updates@fastark.in';
    let emailWarning = '';

    try {
      await resend.emails.send({
        from: `Fast Ark Updates <${senderEmail}>`,
        to: cleanEmail,
        subject: 'Update on your Fast Ark Partner Application',
        text: `Dear ${applicantName},\n\nThank you for applying to Fast Ark.\n\nUnfortunately, we are unable to proceed with your application at this time.\n\nReason for decline:\n${cleanReason}\n\nBest Regards,\nFast Ark Back Office`,
      });

      await resend.emails.send({
        from: `Fast Ark System <${senderEmail}>`,
        to: 'ENQUIRY@FASTARK.IN',
        subject: `Declined Application Log: ${applicantName}`,
        text: `Application for ${applicantName} (${cleanEmail}) was declined by ${requestingUser.email}.\n\nReason: ${cleanReason}\n\nThe applicant's submitted KYC documents are attached to this email for your records. The files have been wiped from the database.`,
        attachments: attachments,
      });
    } catch (mailErr: any) {
      console.warn('Rejection email dispatch warning:', mailErr.message);
      emailWarning = ' (Note: Email notification encountered a delivery warning.)';
    }

    // 6. DATA PRIVACY WIPE
    if (filesToDelete.length > 0) {
      await supabaseAdmin.storage.from('application_documents').remove(filesToDelete);
    }

    // 7. THE KILL-SWITCH: Sever Ghost Access
    await supabaseAdmin
      .from('active_partners')
      .update({ status: 'Suspended' })
      .ilike('email', cleanEmail);

    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const { data: authData, error: authError } =
        await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });

      if (authError || !authData?.users || authData.users.length === 0) {
        hasMore = false;
        break;
      }

      const targetUser = authData.users.find(
        (u) => u.email?.toLowerCase() === cleanEmail
      );
      if (targetUser) {
        await supabaseAdmin.auth.admin.deleteUser(targetUser.id);
        hasMore = false;
      } else {
        page++;
      }
    }

    // 8. IMMUTABLE SERVER-SIDE AUDIT TELEMETRY
    try {
      await Promise.all([
        supabaseAdmin.from('staff_activity_logs').insert([
          {
            staff_id: requestingUser.id,
            staff_email: requestingUser.email,
            action_type: 'REJECTION',
            module: 'ONBOARDING',
            target_id: String(appId),
            details: `Rejected application for ${applicantName} (${cleanEmail}). Reason: ${cleanReason}. Wiped ${filesToDelete.length} KYC file(s).`,
          },
        ]),
        supabaseAdmin.from('system_audit_logs').insert([
          {
            actor_id: requestingUser.id,
            actor_email: requestingUser.email,
            actor_role: staffCheck.role,
            module: 'API_REJECT_APPLICATION',
            action_code: 'APPLICATION_REJECTED',
            reference_id: String(appId),
            metadata: {
              applicant_name: applicantName,
              applicant_email: cleanEmail,
              reject_reason: cleanReason,
              wiped_files_count: filesToDelete.length,
            },
          },
        ]),
      ]);
    } catch (_) {}

    return NextResponse.json({
      success: true,
      message: `Application rejected, ghost access severed, and KYC documents archived.${emailWarning}`,
    });
  } catch (error: any) {
    console.error('Reject Application API Error:', error);

    try {
      await supabaseAdmin.from('system_audit_logs').insert([
        {
          actor_email: 'SYSTEM',
          actor_role: 'API',
          module: 'API_REJECT_APPLICATION',
          action_code: 'ERR-REJ-500',
          metadata: { raw_error: String(error?.message || error) },
        },
      ]);
    } catch (_) {}

    return NextResponse.json(
      {
        success: false,
        error:
          '[ERR-REJ-500] System error while processing rejection. Please refresh and verify application status.',
      },
      { status: 500 }
    );
  }
}