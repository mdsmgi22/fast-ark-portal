// FILE PATH: ./app/api/verify-applicant/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const payload = await request.json();

    const cleanEmail = String(payload.email || '').trim().toLowerCase();
    const cleanMobile = String(payload.mobile || '').trim();
    const cleanAltMobile = String(payload.alt_mobile || '').trim();
    const cleanGovId = String(payload.gov_id_number || '').trim();
    const cleanPan = String(payload.pan_number || '').trim().toUpperCase();

    if (!cleanEmail || !cleanMobile || !cleanGovId) {
      return NextResponse.json(
        { success: false, error: '[ERR-VAL-400] Email, Mobile, and Gov ID are mandatory.' },
        { status: 400 }
      );
    }

    // 1. Check Active Partners & Back-Office Staff Directories First
    const [activePartnerMatch, staffMatch] = await Promise.all([
      supabaseAdmin
        .from('active_partners')
        .select('id, status')
        .or(`email.ilike.${cleanEmail},mobile.eq.${cleanMobile}`)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('back_office_staff')
        .select('id')
        .ilike('email', cleanEmail)
        .limit(1)
        .maybeSingle(),
    ]);

    if (staffMatch.data) {
      return NextResponse.json(
        {
          success: false,
          error:
            '[ERR-DUP-205] Identity Conflict: This email is registered to an internal corporate account.',
        },
        { status: 409 }
      );
    }

    if (activePartnerMatch.data && activePartnerMatch.data.status === 'Active') {
      return NextResponse.json(
        {
          success: false,
          error:
            '[ERR-DUP-205] Identity Conflict: An active partner profile with this Email or Mobile already exists.',
        },
        { status: 409 }
      );
    }

    // 2. Parallel Lookups in pending_applications
    const lookups = [
      supabaseAdmin.from('pending_applications').select('id, status').ilike('email', cleanEmail),
      supabaseAdmin.from('pending_applications').select('id, status').eq('mobile', cleanMobile),
      supabaseAdmin.from('pending_applications').select('id, status').eq('gov_id_number', cleanGovId),
    ];

    if (cleanAltMobile) {
      lookups.push(
        supabaseAdmin.from('pending_applications').select('id, status').eq('alt_mobile', cleanAltMobile)
      );
      lookups.push(
        supabaseAdmin.from('pending_applications').select('id, status').eq('mobile', cleanAltMobile)
      );
    }

    if (cleanPan) {
      lookups.push(
        supabaseAdmin.from('pending_applications').select('id, status').eq('pan_number', cleanPan)
      );
    }

    const results = await Promise.all(lookups);
    let allMatchedRecords: any[] = [];

    for (const res of results) {
      if (res.error && res.error.code !== '42703') {
        throw new Error('Database lookup failed.');
      }
      if (res.data && res.data.length > 0) {
        allMatchedRecords = [...allMatchedRecords, ...res.data];
      }
    }

    if (allMatchedRecords.length > 0) {
      const hasActiveCollision = allMatchedRecords.some((r: any) => r.status !== 'Rejected');
      if (hasActiveCollision) {
        return NextResponse.json(
          {
            success: false,
            error:
              '[ERR-DUP-205] Database Block: A record with this Identity (Email/Mobile/ID) is already registered and under process.',
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ success: true, rejectedId: allMatchedRecords[0].id });
    }

    return NextResponse.json({ success: true, rejectedId: null });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: '[ERR-SYS-500] Identity verification service unavailable.' },
      { status: 500 }
    );
  }
}