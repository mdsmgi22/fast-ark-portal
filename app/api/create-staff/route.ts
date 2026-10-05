import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Define strict enterprise limits (Upgraded Manager to 5)
const ROLE_LIMITS: Record<string, number> = {
  'Manager': 5,
  'Accountant': 3,
  'Staff': 11,
  'Admin': 2 
};

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const resend = new Resend(process.env.RESEND_API_KEY);

    // =========================================================================
    // 1. CRITICAL SECURITY GATE
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

    const tempPassword = `FastArk@${Math.floor(100000 + Math.random() * 900000)}`;

    // =========================================================================
    // 3. ARCHITECTURAL FIX: 2-STEP BYPASS WITH AUTH_ID BINDING
    // =========================================================================
    
    // STEP A: Create the Auth User WITHOUT metadata to bypass the legacy trigger.
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: tempPassword,
      email_confirm: true
    });

    if (authError) throw new Error(`Auth Creation Failed: ${authError.message}`);
    const newUserId = authData.user.id;

    // STEP B: Manually inject the user into the database WITH their auth_id.
    // This CRITICAL step ensures Row Level Security (RLS) allows them to log in.
    const { error: dbError } = await supabaseAdmin.from('back_office_staff').insert([{
      auth_id: newUserId, 
      email: email.trim().toLowerCase(),
      name: name,
      role: role,
      mobile: mobile || null,
      status: 'Active'
    }]);

    if (dbError) {
      // Rollback Auth if DB insertion fails to prevent orphaned ghost accounts
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw new Error(`Database record creation failed: ${dbError.message}`);
    }

    // STEP C: Safely update user_metadata now that the database is mapped.
    await supabaseAdmin.auth.admin.updateUserById(newUserId, {
      user_metadata: {
        name: name,
        role: role,
        mobile: mobile || null,
        must_change_password: true
      }
    });

    // =========================================================================
    // 4. Secure Credential Dispatch via Resend
    // =========================================================================
    const senderEmail = 'updates@fastark.in';

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