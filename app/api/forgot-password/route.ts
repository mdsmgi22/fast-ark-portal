import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

    const targetEmail = email.trim().toLowerCase();

    // =========================================================================
    // 1. THE FIX: Strict Environment Variable Validation
    // =========================================================================
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // If Next.js fails to load the key from .env.local, trap the error immediately.
    if (!supabaseUrl || !serviceKey) {
      console.error("❌ CRITICAL SERVER ERROR: SUPABASE_SERVICE_ROLE_KEY is missing or undefined in the server environment.");
      return NextResponse.json({ 
        success: false, 
        error: "Server Configuration Error: The backend API key is missing. Please ensure SUPABASE_SERVICE_ROLE_KEY is correctly saved in your .env.local file and restart your terminal." 
      }, { status: 500 });
    }

    // 2. Initialize Admin Client safely
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // 3. STRICT DATABASE VERIFICATION
    const [staffRes, partnerRes] = await Promise.all([
      supabaseAdmin.from("back_office_staff").select("status").eq("email", targetEmail).maybeSingle(),
      supabaseAdmin.from("active_partners").select("status").eq("email", targetEmail).maybeSingle()
    ]);

    const staffData = staffRes.data;
    const partnerData = partnerRes.data;

    // Rule A: Identity must exist in our corporate directories
    if (!staffData && !partnerData) {
      return NextResponse.json({ 
        success: false, 
        error: "Access Denied: This email is not registered in the corporate or partner directory." 
      }, { status: 403 });
    }

    // Rule B: Identity must be currently Active (No suspensions)
    if ((staffData && staffData.status !== "Active") || (partnerData && partnerData.status !== "Active")) {
      return NextResponse.json({ 
        success: false, 
        error: "Account Deactivated: Your clearance has been revoked. Password recovery is disabled." 
      }, { status: 403 });
    }

    // 4. DISPATCH RECOVERY EMAIL
    // Dynamically grab the origin URL to construct the reset link
    const origin = request.headers.get('origin') || 'https://fastark.in';
    const redirectUrl = `${origin}/update-password`;

    const { error: authError } = await supabaseAdmin.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: redirectUrl,
    });

    if (authError) throw authError;

    // 5. ENTERPRISE SECURITY TELEMETRY (Immutable Audit Log)
    await supabaseAdmin.from('staff_activity_logs').insert([{
      staff_id: 'SYSTEM',
      staff_email: targetEmail,
      action_type: 'SECURITY_AUDIT',
      module: 'AUTHENTICATION',
      target_id: 'PASSWORD_RESET_REQUEST',
      details: `Verified account status and dispatched password recovery link to ${targetEmail}.`
    }]);

    return NextResponse.json({ 
      success: true, 
      message: "✅ Password reset link has been securely dispatched to your email address." 
    });

  } catch (error: any) {
    console.error("Forgot Password API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}