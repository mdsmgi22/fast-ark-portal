// FILE PATH: ./app/api/purge-rejected/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // =========================================================================
    // 1. CRITICAL SECURITY GATE: Verify Bearer Token & Active Admin/Manager Role
    // =========================================================================
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Missing token" },
        { status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: requestingUser },
      error: verifyError,
    } = await supabaseAdmin.auth.getUser(token);

    if (verifyError || !requestingUser) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Invalid session" },
        { status: 401 }
      );
    }

    const { data: adminCheck, error: adminError } = await supabaseAdmin
      .from("back_office_staff")
      .select("id, role, status")
      .ilike("email", (requestingUser.email || "").trim())
      .maybeSingle();

    const safeRole = String(adminCheck?.role || "")
      .trim()
      .toLowerCase();

    if (
      adminError ||
      !adminCheck ||
      adminCheck.status !== "Active" ||
      !["admin", "manager"].includes(safeRole)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Active Admin or Manager clearance required.",
        },
        { status: 403 }
      );
    }

    // =========================================================================
    // 2. Target Extraction & Complete Profile Purge (Fault-Tolerant Auth Wipe)
    // =========================================================================
    const { auth_id, partner_id } = await request.json();

    if (!partner_id) {
      return NextResponse.json(
        { success: false, error: "Missing target partner_id" },
        { status: 400 }
      );
    }

    if (auth_id) {
      const { error: authError } =
        await supabaseAdmin.auth.admin.deleteUser(auth_id);
      if (
        authError &&
        !authError.message.toLowerCase().includes("not found")
      ) {
        console.warn("Auth deletion warning during purge:", authError.message);
      }
    }

    const { error: dbError } = await supabaseAdmin
      .from("active_partners")
      .delete()
      .eq("id", partner_id);
    if (dbError)
      throw new Error(`Database Record Deletion Failed: ${dbError.message}`);

    await Promise.allSettled([
      supabaseAdmin.from("staff_activity_logs").insert([
        {
          staff_id: requestingUser.id,
          staff_email: requestingUser.email,
          action_type: "PURGE_REJECTED",
          module: "ONBOARDING",
          target_id: String(partner_id),
          details: `Purged rejected partner profile (${partner_id}) and Auth ID (${
            auth_id || "N/A"
          }).`,
        },
      ]),
      supabaseAdmin.from("system_audit_logs").insert([
        {
          actor_id: requestingUser.id,
          actor_email: requestingUser.email,
          actor_role: adminCheck.role,
          module: "API_PURGE_REJECTED",
          action_code: "REJECTED_PARTNER_PURGED",
          reference_id: String(partner_id),
          metadata: { auth_id: auth_id || null },
        },
      ]),
    ]);

    return NextResponse.json({
      success: true,
      message:
        "Rejected profile purged completely. The email address is now available for a fresh registration.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}