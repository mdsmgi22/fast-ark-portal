import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    const { dbPayload, rejectedId } = await request.json();

    if (rejectedId) {
      // Securely overwrite the previously rejected record
      const { error } = await supabaseAdmin.from('pending_applications').update(dbPayload).eq('id', rejectedId);
      if (error) throw error;
    } else {
      // Insert a brand new applicant
      const { error } = await supabaseAdmin.from('pending_applications').insert([dbPayload]);
      if (error) {
        if (error.code === '23505') {
           return NextResponse.json({ success: false, error: 'Database Block: A record with this identity already exists securely in the database.' }, { status: 409 });
        }
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}