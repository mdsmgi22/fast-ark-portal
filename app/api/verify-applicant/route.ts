import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const payload = await request.json();

    // 1. Parallel Lookups bypass the buggy .or() string parser
    const lookups = [
      supabaseAdmin.from('pending_applications').select('id, status').eq('email', payload.email),
      supabaseAdmin.from('pending_applications').select('id, status').eq('mobile', payload.mobile),
      supabaseAdmin.from('pending_applications').select('id, status').eq('gov_id_number', payload.gov_id_number)
    ];
    
    if (payload.alt_mobile) {
      lookups.push(supabaseAdmin.from('pending_applications').select('id, status').eq('alt_mobile', payload.alt_mobile));
      lookups.push(supabaseAdmin.from('pending_applications').select('id, status').eq('mobile', payload.alt_mobile));
    }
    
    if (payload.pan_number) {
      lookups.push(supabaseAdmin.from('pending_applications').select('id, status').eq('pan_number', payload.pan_number));
    }

    const results = await Promise.all(lookups);
    let allMatchedRecords: any[] = [];

    for (const res of results) {
      // Safely ignore missing column errors if the DB schema hasn't fully updated
      if (res.error && res.error.code !== '42703') {
        throw new Error("Database lookup failed.");
      }
      if (res.data && res.data.length > 0) {
        allMatchedRecords = [...allMatchedRecords, ...res.data];
      }
    }

    if (allMatchedRecords.length > 0) {
      // If ANY record is NOT 'Rejected', block it
      const hasActiveCollision = allMatchedRecords.some((r: any) => r.status !== 'Rejected');
      if (hasActiveCollision) {
        return NextResponse.json({ 
          success: false, 
          error: 'Database Block: A record with this Identity (Email/Mobile/ID) is already registered and under process.' 
        }, { status: 409 });
      }
      
      // If ALL collisions are 'Rejected', return the ID to overwrite
      return NextResponse.json({ success: true, rejectedId: allMatchedRecords[0].id });
    }

    return NextResponse.json({ success: true, rejectedId: null });
  } catch (error: any) {
     return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}