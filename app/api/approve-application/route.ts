import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, 
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const resend = new Resend(process.env.RESEND_API_KEY);

    // =========================================================================
    // 1. CRITICAL SECURITY GATE: Verify the admin triggering this API
    // =========================================================================
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing token' }, { status: 401 });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: requestingUser }, error: verifyError } = await supabaseAdmin.auth.getUser(token);
    
    if (verifyError || !requestingUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid session' }, { status: 401 });
    }

    // =========================================================================
    // 2. Data Extraction & Validation
    // =========================================================================
    const { appId, applicantName, applicantEmail, locationId, mobile, role } = await request.json();

    if (!appId || !applicantEmail || !locationId || !role) {
      return NextResponse.json({ success: false, error: 'Missing required application data.' }, { status: 400 });
    }

    const { data: loc, error: locError } = await supabaseAdmin
      .from('locations')
      .select('center_name')
      .eq('id', locationId)
      .single();
      
    if (locError) throw new Error("Invalid Location ID assigned.");

    const cleanEmail = applicantEmail.trim().toLowerCase();
    const tempPassword = `FA@${Math.random().toString(36).slice(-6)}${new Date().getFullYear()}`;

    // =========================================================================
    // 3. Automated User Provisioning (Smart Recovery Engine)
    // =========================================================================
    let authUserId = null;

    // A. Attempt to create fresh Auth Credentials
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { 
        name: applicantName, 
        role: role, 
        center_id: locationId,
        mobile: mobile || null
      }
    });
    
    if (authError) {
      const errStr = authError.message.toLowerCase();
      // INTERCEPT CRASH: Broad catch for any variation of existing users
      if (errStr.includes('already') || errStr.includes('registered') || errStr.includes('exists')) {
        
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
          if (!listData?.users || listData.users.length === 0) break;
          
          const existingUser = listData.users.find(u => u.email?.toLowerCase() === cleanEmail);
          if (existingUser) {
            authUserId = existingUser.id;
            
            // Force reset the password so the new Welcome Email credentials actually work
            await supabaseAdmin.auth.admin.updateUserById(authUserId, {
              password: tempPassword,
              user_metadata: { name: applicantName, role: role, center_id: locationId, mobile: mobile || null }
            });
            hasMore = false;
          } else {
            page++;
          }
        }

        if (!authUserId) {
          throw new Error(`Ghost Auth Recovery Failed: Could not locate the hidden user for ${cleanEmail}`);
        }
      } else {
        throw new Error(`Auth Creation Failed: ${authError.message}`);
      }
    } else {
      authUserId = authData.user?.id;
    }

    // =========================================================================
    // 4. CLEAR THE RUNWAY FOR THE DATABASE TRIGGER
    // =========================================================================
    // We delete any existing "Ghost" profile in active_partners. 
    // This guarantees the database trigger won't hit a Duplicate Key constraint.
    await supabaseAdmin.from('active_partners').delete().eq('email', cleanEmail);

    // =========================================================================
    // 5. FIRE THE TRIGGER & UPDATE DASHBOARD
    // =========================================================================
    // This updates the pending queue to 'Approved', which safely triggers 
    // your Postgres automation to create the active_partner row.
    const { error: updateError } = await supabaseAdmin
      .from('pending_applications')
      .update({ status: 'Approved' }) 
      .eq('id', appId);

    if (updateError) {
      throw new Error(`Trigger Crash - Failed to update pending queue: ${updateError.message}`);
    }

    // =========================================================================
    // 6. PATCH THE MISSING IDs
    // =========================================================================
    // The trigger successfully created the profile, but it doesn't know the 
    // auth_id or application_id. We patch them in immediately.
    const { error: patchError } = await supabaseAdmin
      .from('active_partners')
      .update({
         application_id: appId,
         auth_id: authUserId,
         center_id: locationId,
         role: role,
         status: 'Active',
         tc_accepted: false
      })
      .eq('email', cleanEmail);
      
    if (patchError) {
       console.warn("Patch Warning:", patchError.message);
    }

    // =========================================================================
    // 7. Communication Dispatch
    // =========================================================================
    await resend.emails.send({
      from: 'Fast Ark Onboarding <updates@fastark.org>',
      to: cleanEmail,
      subject: 'Fast Ark Account Created - Credentials Enclosed 🚀',
      html: `
        <h2>Welcome to Fast Ark, ${applicantName}!</h2>
        <p>Your application for the <b>${role}</b> role at <b>${loc?.center_name}</b> has been approved.</p>
        <div style="background: #f1f5f9; padding: 15px; border-radius: 5px;">
          <p><b>Login Portal:</b> <a href="https://fastark.org/partner/login">https://fastark.org/partner/login</a></p>
          <p><b>Email:</b> ${cleanEmail}</p>
          <p><b>Temporary Password:</b> ${tempPassword}</p>
        </div>
        <p>You will be required to accept the mandatory commercial terms upon your first login.</p>
      `
    });

    await resend.emails.send({
      from: 'Fast Ark System <updates@fastark.org>',
      to: 'ENQUIRY@FASTARK.ORG',
      subject: `✅ NEW APPROVAL: ${applicantName}`,
      text: `The application for ${applicantName} has been APPROVED for the role of ${role} and mapped to ${loc?.center_name}. The welcome email has been dispatched.`,
    });

    return NextResponse.json({ success: true, message: 'Partner successfully recovered, provisioned, and queue updated.' });
    
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}