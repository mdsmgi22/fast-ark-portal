// FILE PATH: ./app/api/submit-application/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { dbPayload, rejectedId } = await request.json();

    if (!dbPayload || !dbPayload.email || !dbPayload.mobile || !dbPayload.name) {
      return NextResponse.json(
        { success: false, error: '[ERR-VAL-400] Incomplete application payload.' },
        { status: 400 }
      );
    }

    const safePayload = {
      ...dbPayload,
      email: String(dbPayload.email).trim().toLowerCase(),
      status: 'Pending',
      reject_reason: null,
    };

    if (rejectedId) {
      // Strictly verify the target row is currently 'Rejected' before overwriting
      const { data: updated, error } = await supabaseAdmin
        .from('pending_applications')
        .update(safePayload)
        .eq('id', rejectedId)
        .eq('status', 'Rejected')
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!updated) {
        return NextResponse.json(
          {
            success: false,
            error: '[ERR-LCK-116] Overwrite Blocked: Target record is not in a Rejected state.',
          },
          { status: 409 }
        );
      }
    } else {
      const { error } = await supabaseAdmin
        .from('pending_applications')
        .insert([safePayload]);

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            {
              success: false,
              error: '[ERR-DUP-205] Database Block: A record with this identity already exists in the database.',
            },
            { status: 409 }
          );
        }
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: '[ERR-SYS-500] Could not commit application record. Please try again.' },
      { status: 500 }
    );
  }
}