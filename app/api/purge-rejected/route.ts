import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { auth_id, partner_id } = await request.json();

    if (!auth_id || !partner_id) {
      return NextResponse.json({ success: false, error: 'Missing target IDs' }, { status: 400 });
    }

    // 1. CRITICAL: Delete the user from the Supabase Auth Vault.
    // This permanently frees up the email address so they can register again.
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(auth_id);
    if (authError) throw new Error(`Auth Deletion Failed: ${authError.message}`);

    // 2. Delete their footprint from your public tables
    const { error: dbError } = await supabaseAdmin
      .from('active_partners')
      .delete()
      .eq('id', partner_id);
    if (dbError) throw new Error(`Database Record Deletion Failed: ${dbError.message}`);

    return NextResponse.json({ 
      success: true, 
      message: "Rejected profile purged completely. The email address is now available for a fresh registration." 
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}