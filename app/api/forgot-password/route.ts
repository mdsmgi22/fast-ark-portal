import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

    const targetEmail = email.trim().toLowerCase();

    // =========================================================================
    // 1. Strict Environment Variable Validation
    // =========================================================================
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendKey = process.env.RESEND_API_KEY;

    if (!supabaseUrl || !serviceKey || !resendKey) {
      console.error("❌ CRITICAL SERVER ERROR: Environment variables missing.");
      return NextResponse.json({ 
        success: false, 
        error: "Server Configuration Error: The backend API keys are missing." 
      }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const resend = new Resend(resendKey);

    // =========================================================================
    // 2. STRICT DATABASE VERIFICATION (Bulletproof Clearance Check)
    // =========================================================================
    const [staffRes, partnerRes] = await Promise.all([
      supabaseAdmin.from("back_office_staff").select("status, name").eq("email", targetEmail).maybeSingle(),
      supabaseAdmin.from("active_partners").select("status, partner_name").eq("email", targetEmail).maybeSingle()
    ]);

    const staffData = staffRes.data;
    const partnerData = partnerRes.data;

    let isAuthorized = false;
    let userName = "User";

    // Deterministic status verification based on profile type
    if (staffData) {
      if (staffData.status === "Active") {
        isAuthorized = true;
        userName = staffData.name;
      }
    } else if (partnerData) {
      if (partnerData.status === "Active") {
        isAuthorized = true;
        userName = partnerData.partner_name;
      }
    }

    if (!staffData && !partnerData) {
      return NextResponse.json({ 
        success: false, 
        error: "Access Denied: This email is not registered in the corporate or partner directory." 
      }, { status: 403 });
    }

    if (!isAuthorized) {
      return NextResponse.json({ 
        success: false, 
        error: "Account Deactivated: Your clearance has been revoked. Password recovery is disabled." 
      }, { status: 403 });
    }

    // =====================================================================
    // 3. SILENT LINK GENERATION (Bypasses Supabase default email)
    // =====================================================================
    const origin = request.headers.get('origin') || 'https://fastark.in';
    const redirectUrl = `${origin}/update-password`;

    // Generate the raw cryptographic link securely in the background
    const { data: linkData, error: authError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: targetEmail,
      options: { redirectTo: redirectUrl },
    });

    if (authError) throw authError;

    const secureActionLink = linkData.properties.action_link;

    // =====================================================================
    // 4. CUSTOM RESEND DISPATCH (Hides the raw URL in a branded button)
    // =====================================================================
    await resend.emails.send({
      from: 'Fast Ark Security <updates@fastark.in>',
      to: targetEmail,
      subject: 'Fast Ark - Authorized Password Recovery',
      html: `
        <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #0f172a; margin: 0;">FAST ARK</h1>
            <p style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Command Center Security</p>
          </div>
          
          <h2 style="color: #1e293b; border-top: 1px solid #f1f5f9; padding-top: 20px;">Password Reset Request</h2>
          <p style="color: #475569; font-size: 15px; line-height: 1.6;">
            Dear ${userName},<br><br>
            A request has been made to reset the password for your official Fast Ark portal account associated with this email address.
          </p>
          
          <div style="text-align: center; margin: 35px 0;">
            <a href="${secureActionLink}" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">Securely Reset Password</a>
          </div>
          
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin-top: 30px;">
            <p style="color: #64748b; font-size: 12px; margin: 0; line-height: 1.5;">
              <strong>Security Notice:</strong> If you did not initiate this request, your account is safe. Please ignore this email or forward it to your Fast Ark administrator if you suspect unauthorized activity. This secure link will expire automatically.
            </p>
          </div>
        </div>
      `
    });

    // =====================================================================
    // 5. ENTERPRISE SECURITY TELEMETRY (Immutable Audit Log)
    // =====================================================================
    await supabaseAdmin.from('staff_activity_logs').insert([{
      staff_id: 'SYSTEM',
      staff_email: targetEmail,
      action_type: 'SECURITY_AUDIT',
      module: 'AUTHENTICATION',
      target_id: 'PASSWORD_RESET_REQUEST',
      details: `Generated silent reset token and dispatched custom HTML recovery link via Resend to ${targetEmail}.`
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