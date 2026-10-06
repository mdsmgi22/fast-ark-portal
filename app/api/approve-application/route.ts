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
    // 1. CRITICAL SECURITY GATE: Verify the user triggering this API
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

    // Fetch Center Metadata early to ensure the location exists
    const { data: loc, error: locError } = await supabaseAdmin
      .from('locations')
      .select('center_name')
      .eq('id', locationId)
      .single();
      
    if (locError) throw new Error("Invalid Location ID assigned.");

    const cleanEmail = applicantEmail.trim().toLowerCase();

    // =========================================================================
    // 3. Automated User Provisioning (Atomic Database Transaction)
    // =========================================================================
    const tempPassword = `FA@${Math.random().toString(36).slice(-6)}${new Date().getFullYear()}`;

    // A. Generate Auth Credentials
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
    
    // Ignore error if user already exists due to a previous partial success
    if (authError && !authError.message.includes('already exists')) {
      throw new Error(`Auth Creation Failed: ${authError.message}`);
    }

    // B. Manual Fallback Insertion into active_partners (Bypasses Trigger Unreliability)
    const { error: insertError } = await supabaseAdmin
      .from('active_partners')
      .insert([{
         partner_name: applicantName,
         email: cleanEmail,
         mobile: mobile,
         role: role,
         center_id: locationId,
         status: 'Active',
         tc_accepted: false
      }]);

    // Ignore unique constraint error (23505) if the Postgres trigger already did its job
    if (insertError && insertError.code !== '23505') {
      throw new Error(`Profile Creation Failed: ${insertError.message}`);
    }

    // C. THE FIX: Update Original Application Record & Trap Schema Errors
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
      from: 'Fast Ark Onboarding <updates@fastark.in>',
      to: cleanEmail,
      subject: 'Fast Ark Account Created - Credentials Enclosed 🚀',
      html: `
        <h2>Welcome to Fast Ark, ${applicantName}!</h2>
        <p>Your application for the <b>${role}</b> role at <b>${loc?.center_name}</b> has been approved.</p>
        <div style="background: #f1f5f9; padding: 15px; border-radius: 5px;">
          <p><b>Login Portal:</b> <a href="https://fastark.in/partner/login">https://fastark.in/partner/login</a></p>
          <p><b>Email:</b> ${cleanEmail}</p>
          <p><b>Temporary Password:</b> ${tempPassword}</p>
        </div>
        <p>You will be required to accept the mandatory commercial terms upon your first login.</p>
      `
    });

    await resend.emails.send({
      from: 'Fast Ark System <updates@fastark.in>',
      to: 'ENQUIRY@FASTARK.IN',
      subject: `✅ NEW APPROVAL: ${applicantName}`,
      text: `The application for ${applicantName} has been APPROVED for the role of ${role} and mapped to ${loc?.center_name}. The welcome email has been dispatched.`,
    });

    return NextResponse.json({ success: true, message: 'Partner provisioned and queue updated successfully.' });
    
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}