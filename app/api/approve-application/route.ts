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

        // If the loop finished but we still don't have an ID, throw a specific trace error
        if (!authUserId) {
          throw new Error(`Ghost Auth Recovery Failed: Could not locate the hidden user for ${cleanEmail}`);
        }
      } else {
        throw new Error(`Auth Creation Failed: ${authError.message}`);
      }
    } else {
      authUserId = authData.user?.id;
    }

    // B. Safely Insert or Reactivate Active Partner Profile
    const { error: insertError } = await supabaseAdmin
      .from('active_partners')
      .insert([{
         application_id: appId, // <-- ARCHITECTURAL FIX: Maps to dashboard
         auth_id: authUserId,
         partner_name: applicantName,
         email: cleanEmail,
         mobile: mobile,
         role: role,
         center_id: locationId,
         status: 'Active',
         tc_accepted: false
      }]);

    if (insertError) {
      if (insertError.code === '23505') {
        // If profile exists, force reactivation
        const { error: updateProfileError } = await supabaseAdmin.from('active_partners').update({
             application_id: appId, // <-- ARCHITECTURAL FIX: Re-maps ID on reactivation
             auth_id: authUserId,
             status: 'Active',
             role: role,
             center_id: locationId
        }).eq('email', cleanEmail);
        
        if (updateProfileError) throw new Error(`Profile Reactivation Failed: ${updateProfileError.message}`);
      } else {
        throw new Error(`Profile Creation Failed: ${insertError.message}`);
      }
    }

    // C. Update Original Application Record to 'Approved' so Dashboard updates
    const { error: updateError } = await supabaseAdmin
      .from('pending_applications')
      .update({ status: 'Approved' }) 
      .eq('id', appId);

    if (updateError) {
      throw new Error(`Failed to update pending queue: ${updateError.message}`);
    }

    // =========================================================================
    // 4. Communication Dispatch
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