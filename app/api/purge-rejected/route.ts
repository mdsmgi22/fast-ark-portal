import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // =========================================================================
    // 1. CRITICAL SECURITY GATE: Verify Bearer Token & Super Admin Role
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
      .ilike('email', requestingUser.email || '')
      .maybeSingle();

    if (adminError || !adminCheck || !['Admin', 'Manager'].includes(adminCheck.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden: Admin or Manager clearance required.' }, { status: 403 });
    }

    // =========================================================================
    // 2. Target Extraction & Complete Profile Purge
    // =========================================================================
    const { auth_id, partner_id } = await request.json();

    if (!auth_id || !partner_id) {
      return NextResponse.json({ success: false, error: 'Missing target IDs' }, { status: 400 });
    }

    // Delete the user from the Supabase Auth Vault so the email is freed
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(auth_id);
    if (authError) throw new Error(`Auth Deletion Failed: ${authError.message}`);

    // Delete their footprint from active_partners
    const { error: dbError } = await supabaseAdmin
      .from('active_partners')
      .delete()
      .eq('id', partner_id);
    if (dbError) throw new Error(`Database Record Deletion Failed: ${dbError.message}`);

    // Log the purge in the immutable audit trail
    await supabaseAdmin.from('staff_activity_logs').insert([{
      staff_id: requestingUser.id,
      staff_email: requestingUser.email,
      action_type: 'PURGE_REJECTED',
      module: 'ONBOARDING',
      target_id: partner_id,
      details: `Purged rejected partner profile (${partner_id}) and Auth ID (${auth_id}).`
    }]);

    return NextResponse.json({ 
      success: true, 
      message: "Rejected profile purged completely. The email address is now available for a fresh registration." 
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}