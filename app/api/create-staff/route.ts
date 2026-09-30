import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Initialize Supabase with Service Key for God-Mode IT Provisioning
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Define strict enterprise limits to prevent over-provisioning
const ROLE_LIMITS: Record<string, number> = {
  'Manager': 3,
  'Accountant': 3,
  'Staff': 11,
  'Admin': 2 // Safety threshold for Super Admins
};

export async function POST(request: Request) {
  try {
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

    // Verify the requester actually holds the 'Admin' role in the database
    const { data: adminCheck, error: adminError } = await supabaseAdmin
      .from('back_office_staff')
      .select('role')
      .eq('email', requestingUser.email)
      .single();

    if (adminError || adminCheck?.role !== 'Admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: Super Admin clearance required.' }, { status: 403 });
    }

    // =========================================================================
    // 2. Data Extraction & Quota Verification
    // =========================================================================
    const { name, email, role, mobile } = await request.json();

    if (!name || !email || !role) {
      return NextResponse.json({ success: false, error: 'Missing mandatory fields: Name, Email, or Role.' }, { status: 400 });
    }

    // Check if the role limit has been reached
    const maxLimit = ROLE_LIMITS[role];
    if (maxLimit) {
      const { count, error: countError } = await supabaseAdmin
        .from('back_office_staff')
        .select('*', { count: 'exact', head: true })
        .eq('role', role);

      if (!countError && count !== null && count >= maxLimit) {
        return NextResponse.json({ 
          success: false, 
          error: `Limit Reached: You have reached the maximum quota of ${maxLimit} for the ${role} role.` 
        }, { status: 400 });
      }
    }

    // =========================================================================
    // 3. Automated IT Provisioning (Auth Creation + Postgres Trigger)
    // =========================================================================
    
    // Generate a secure, recognizable temporary password
    const tempPassword = `FastArk@${Math.floor(100000 + Math.random() * 900000)}`;

    // The Supabase Postgres Trigger (on_auth_user_created) handles the table injection automatically.
    // By passing 'name', 'role', and 'mobile' into user_metadata, the database catches the data.
    // If the database trigger fails, this createUser request will automatically throw an error and rollback atomically.
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: tempPassword,
      email_confirm: true, // Bypass email verification requirement for internal staff
      user_metadata: { 
        name: name, 
        role: role,
        mobile: mobile || null
      }
    });

    if (authError) throw new Error(`Auth Creation Failed: ${authError.message}`);

    // =========================================================================
    // 4. Secure Credential Dispatch via Resend
    // =========================================================================
    
    const senderEmail = 'updates@fastark.in'; // Ensure this matches your verified Resend domain

    await resend.emails.send({
      from: `Fast Ark IT Systems <${senderEmail}>`,
      to: email,
      subject: `Action Required: Your Fast Ark ${role} Credentials`,
      text: `Dear ${name},\n\nYour internal Fast Ark Command Center account has been provisioned.\n\nAssigned Role: ${role}\nLogin Email: ${email}\nTemporary Password: ${tempPassword}\n\nSecurity Notice: Please log in immediately and update your password in your profile settings.\n\nBest Regards,\nFast Ark IT Administration`,
    });

    return NextResponse.json({ 
      success: true, 
      message: `Staff provisioned successfully. Credentials emailed to ${email}.` 
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}