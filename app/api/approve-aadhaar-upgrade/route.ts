// FILE PATH: ./app/api/approve-aadhaar-upgrade/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 1. Verify Admin / Back-Office Staff Session Token & Role Clearance
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

    const { data: staffCheck } = await supabaseAdmin
      .from("back_office_staff")
      .select("id, email, role, status")
      .ilike("email", (requestingUser.email || "").trim())
      .maybeSingle();

    const safeRole = String(staffCheck?.role || "")
      .trim()
      .toLowerCase();
    if (
      !staffCheck ||
      staffCheck.status !== "Active" ||
      !["admin", "manager", "staff"].includes(safeRole)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Active Admin/Operations clearance required.",
        },
        { status: 403 }
      );
    }

    // 2. Extract Payload
    const {
      requestId,
      partnerId,
      centerId,
      operatorId,
      stationId,
      nseitCertNo,
    } = await request.json();

    if (!partnerId || !centerId || !operatorId || !stationId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required fields: Partner, Center, Operator ID, or Station ID.",
        },
        { status: 400 }
      );
    }

    const cleanOpId = String(operatorId).trim().toUpperCase();
    const cleanStnId = String(stationId).trim();
    const cleanNseit = String(nseitCertNo || "VERIFIED")
      .trim()
      .toUpperCase();

    if (cleanStnId.length !== 5) {
      return NextResponse.json(
        {
          success: false,
          error: "UIDAI Station ID must be exactly 5 digits.",
        },
        { status: 400 }
      );
    }

    // 3. Fetch Target Center, Partner Info & Upgrade Request Compliance PDF
    const [locRes, partRes, reqRes] = await Promise.all([
      supabaseAdmin
        .from("locations")
        .select("id, center_name, center_code, dist, state")
        .eq("id", Number(centerId))
        .single(),
      supabaseAdmin
        .from("active_partners")
        .select("id, partner_name, email, mobile, compliance_docs_url")
        .eq("id", partnerId)
        .single(),
      requestId
        ? supabaseAdmin
            .from("partner_upgrade_requests")
            .select("id, compliance_pdf_url")
            .eq("id", requestId)
            .maybeSingle()
        : supabaseAdmin
            .from("partner_upgrade_requests")
            .select("id, compliance_pdf_url")
            .eq("partner_id", partnerId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);

    if (locRes.error || !locRes.data) {
      throw new Error("Selected Center ID was not found in Infrastructure.");
    }
    if (partRes.error || !partRes.data) {
      throw new Error("Partner profile was not found.");
    }

    const loc = locRes.data;
    const partner = partRes.data;
    const upgradePdfPath = reqRes.data?.compliance_pdf_url || null;

    // 4. Enable Aadhaar Seva Kendra Role on the Physical Location
    const { error: locUpdateErr } = await supabaseAdmin
      .from("locations")
      .update({ role_aadhaar: true })
      .eq("id", loc.id);
    if (locUpdateErr)
      throw new Error(
        `Failed to enable Aadhaar Center: ${locUpdateErr.message}`
      );

    // 5. Bind Partner Profile to Aadhaar Role, Center, Operator ID, Station ID & Compliance PDF
    const partnerUpdatePayload: Record<string, any> = {
      center_id: loc.id,
      role_aadhaar: true,
      aadhaar_operator_id: cleanOpId,
      aadhaar_station_id: cleanStnId,
    };

    if (!partner.compliance_docs_url && upgradePdfPath) {
      partnerUpdatePayload.compliance_docs_url = upgradePdfPath;
    }

    const { error: partUpdateErr } = await supabaseAdmin
      .from("active_partners")
      .update(partnerUpdatePayload)
      .eq("id", partner.id);
    if (partUpdateErr)
      throw new Error(
        `Failed to bind Partner credentials: ${partUpdateErr.message}`
      );

    // 6. Update partner_upgrade_requests Row(s)
    if (requestId) {
      await supabaseAdmin
        .from("partner_upgrade_requests")
        .update({
          status: "Approved",
          center_id: loc.id,
          requested_operator_id: cleanOpId,
          requested_station_id: cleanStnId,
          nseit_cert_no: cleanNseit,
          reject_reason: null,
        })
        .eq("id", requestId);
    } else {
      await supabaseAdmin
        .from("partner_upgrade_requests")
        .update({
          status: "Approved",
          center_id: loc.id,
          requested_operator_id: cleanOpId,
          requested_station_id: cleanStnId,
        })
        .eq("partner_id", partner.id)
        .eq("status", "Pending");
    }

    // 7. Insert In-App Notification & Staff Audit Log
    await Promise.all([
      supabaseAdmin.from("partner_messages").insert([
        {
          partner_id: partner.id,
          subject: `🆔 Aadhaar Seva Kendra Approved — Station ${cleanStnId}`,
          body: `Congratulations ${partner.partner_name}! Your Aadhaar Seva Kendra credentials have been verified and APPROVED by Corporate Admin.\n\n• Mapped Center: [${loc.center_code || "NO-CODE"}] ${loc.center_name} (${loc.dist}, ${loc.state})\n• UIDAI Operator ID: ${cleanOpId}\n• UIDAI Station ID: ${cleanStnId}\n• NSEIT Cert No: ${cleanNseit}\n\nYour Aadhaar Portal is now unlocked for daily CSV/HTML report uploads and instant QR settlements.`,
        },
      ]),
      supabaseAdmin.from("staff_activity_logs").insert([
        {
          staff_id: requestingUser.id,
          staff_email: requestingUser.email,
          action_type: "AADHAAR_APPROVAL",
          module: "AADHAAR_HUB",
          target_id: partner.id,
          details: `Approved & Bound Aadhaar Operator ${partner.partner_name} to Center [${loc.center_code}] ${loc.center_name} (Op: ${cleanOpId}, Stn: ${cleanStnId}).`,
        },
      ]),
    ]);

    // 8. Dispatch Confirmation Emails via Resend
    let emailWarning = null;
    try {
      const cleanEmail = partner.email.trim().toLowerCase();

      await resend.emails.send({
        from: "Fast Ark Aadhaar Command <updates@fastark.in>",
        to: cleanEmail,
        subject: `✅ Approved: Fast Ark Aadhaar Seva Kendra Credentials (Station ${cleanStnId})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <div style="background-color: #0f172a; padding: 20px; border-radius: 8px; text-align: center; border-bottom: 4px solid #f59e0b;">
              <h1 style="color: #ffffff; margin: 0; font-size: 22px;">FAST ARK PRIVATE LIMITED</h1>
              <p style="color: #fbbf24; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin: 6px 0 0 0; font-weight: bold;">
                Aadhaar Seva Kendra Operations Hub
              </p>
            </div>

            <h2 style="color: #0f172a; margin-top: 24px;">Dear ${partner.partner_name},</h2>
            <p style="color: #334155; font-size: 14px; line-height: 1.6;">
              Your Aadhaar Operator credentials and compliance documents have been verified and <strong>APPROVED</strong> by the Fast Ark Back-Office. Your Aadhaar Seva Kendra dashboard is now unlocked.
            </p>

            <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 6px 0; font-size: 14px; color: #0f172a;"><strong>Mapped Aadhaar Center:</strong> [${loc.center_code || "NO-CODE"}] ${loc.center_name} (${loc.dist}, ${loc.state})</p>
              <p style="margin: 6px 0; font-size: 14px; color: #0f172a;"><strong>UIDAI Operator ID:</strong> <span style="color: #2563eb; font-weight: bold;">${cleanOpId}</span></p>
              <p style="margin: 6px 0; font-size: 14px; color: #0f172a;"><strong>UIDAI Station ID:</strong> <span style="color: #d97706; font-weight: bold;">${cleanStnId}</span></p>
              <p style="margin: 6px 0; font-size: 14px; color: #0f172a;"><strong>NSEIT Certificate No:</strong> ${cleanNseit}</p>
            </div>

            <p style="color: #475569; font-size: 13px; line-height: 1.6;">
              <strong>Mandatory Daily SOP:</strong> Please log in to <a href="https://fastark.org/partner/aadhaar" style="color: #2563eb; font-weight: bold;">https://fastark.org/partner/aadhaar</a> at the close of business every day to upload your matching UIDAI Daily <code>.CSV</code> and <code>.HTML</code> reports and remit the collected cash via the Instant UPI QR to avoid the automated ₹100/day late settlement penalty.
            </p>

            <p style="color: #64748b; font-size: 12px; margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
              Best Regards,<br/>
              <strong>Fast Ark Aadhaar Command Center</strong>
            </p>
          </div>
        `,
      });

      await resend.emails.send({
        from: "Fast Ark System <updates@fastark.in>",
        to: "ENQUIRY@FASTARK.IN",
        subject: `🆔 AADHAAR OPERATOR APPROVED: ${partner.partner_name} (${cleanOpId} / ${cleanStnId})`,
        text: `Aadhaar Operator credentials approved by ${requestingUser.email}.\n\nPartner: ${partner.partner_name} (${cleanEmail})\nCenter: [${loc.center_code}] ${loc.center_name}\nOperator ID: ${cleanOpId}\nStation ID: ${cleanStnId}\nNSEIT Cert No: ${cleanNseit}`,
      });
    } catch (mailErr: any) {
      console.warn("Email dispatch warning:", mailErr.message);
      emailWarning =
        "Approved in database, but email notification encountered a configuration warning.";
    }

    return NextResponse.json({
      success: true,
      message:
        emailWarning ||
        `Aadhaar Operator ${partner.partner_name} approved, mapped to [${loc.center_code}], and confirmation email dispatched!`,
    });
  } catch (error: any) {
    console.error("Approve Aadhaar Upgrade Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}