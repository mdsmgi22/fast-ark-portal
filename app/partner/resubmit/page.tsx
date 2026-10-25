// FILE PATH: ./app/partner/resubmit/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { supabase } from "../../lib/supabase";
import { reportAndMaskError, logSystemTelemetry } from "../../lib/errorCodes";

// Prevents pdf-lib StandardFonts (WinAnsi) from throwing encoding errors on special characters
const sanitizePdfText = (val: string): string =>
  String(val || "").replace(/[^\x20-\x7E]/g, " ");

export default function ResubmitApplication() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [partnerDetails, setPartnerDetails] = useState<any>(null);
  const [pendingApp, setPendingApp] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Editable correction fields
  const [form, setForm] = useState({
    partner_name: "",
    mobile: "",
    pan_number: "",
    center_name: "",
    requested_role: "OCSC",
    applicant_remarks: "",
  });
  const [correctedFile, setCorrectedFile] = useState<File | null>(null);

  useEffect(() => {
    verifyRejectedStatus();
  }, []);

  const verifyRejectedStatus = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/partner/login");
        return;
      }

      const cleanEmail = (session.user.email || "").trim().toLowerCase();

      // 1. Fetch Partner Profile (by auth_id or case-insensitive email)
      const { data: pData } = await supabase
        .from("active_partners")
        .select("*, locations(center_name, center_code)")
        .or(`auth_id.eq.${session.user.id},email.ilike.${cleanEmail}`)
        .maybeSingle();

      // 2. Fetch Linked Pending Application Record (by application_id or email)
      let appQuery = supabase
        .from("pending_applications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);

      if (pData?.application_id) {
        appQuery = supabase
          .from("pending_applications")
          .select("*")
          .eq("id", pData.application_id)
          .limit(1);
      } else if (cleanEmail) {
        appQuery = supabase
          .from("pending_applications")
          .select("*")
          .ilike("email", cleanEmail)
          .order("created_at", { ascending: false })
          .limit(1);
      }

      const { data: appRows } = await appQuery;
      const matchedApp = appRows && appRows.length > 0 ? appRows[0] : null;

      // Security Gate: Only 'Rejected' profiles/applications can access this page
      const isPartnerRejected = pData?.status === "Rejected";
      const isAppRejected = matchedApp?.status === "Rejected";

      if (!pData && !matchedApp) {
        router.push("/partner/login");
        return;
      }

      if (!isPartnerRejected && !isAppRejected) {
        router.push(
          pData?.status === "Active" ? "/partner/dashboard" : "/partner/login"
        );
        return;
      }

      setPartnerDetails(pData);
      setPendingApp(matchedApp);

      setForm({
        partner_name: pData?.partner_name || matchedApp?.name || "",
        mobile: pData?.mobile || matchedApp?.mobile || "",
        pan_number: matchedApp?.pan_number || "",
        center_name:
          matchedApp?.center_name ||
          pData?.locations?.center_name ||
          "",
        requested_role:
          matchedApp?.requested_role || pData?.role || "OCSC",
        applicant_remarks: "",
      });
    } catch (err: any) {
      console.error("Resubmit verification error:", err.message);
      router.push("/partner/login");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("File size must be under 5MB.");
      e.target.value = "";
      return;
    }
    setCorrectedFile(file);
  };

  const buildWatermarkedKycPdf = async (
    file: File,
    applicantName: string,
    email: string
  ): Promise<Uint8Array> => {
    const pdfDoc = await PDFDocument.create();
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const timestamp = sanitizePdfText(
      new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    );
    const stampText = sanitizePdfText(
      `RESUBMITTED KYC | APP: ${applicantName.toUpperCase()} | EMAIL: ${email} | TIME: ${timestamp}`
    ).slice(0, 115);

    const arrayBuffer = await file.arrayBuffer();
    const mime = (file.type || "").toLowerCase();
    const nameLower = (file.name || "").toLowerCase();

    const isPdf = mime.includes("pdf") || nameLower.endsWith(".pdf");
    const isPng = mime.includes("png") || nameLower.endsWith(".png");
    const isJpg =
      mime.includes("jpg") ||
      mime.includes("jpeg") ||
      nameLower.endsWith(".jpg") ||
      nameLower.endsWith(".jpeg");

    if (isPdf) {
      const loadedPdf = await PDFDocument.load(arrayBuffer, {
        ignoreEncryption: true,
      });
      const copiedPages = await pdfDoc.copyPages(
        loadedPdf,
        loadedPdf.getPageIndices()
      );
      copiedPages.forEach((page) => {
        pdfDoc.addPage(page);
        const { width } = page.getSize();
        page.drawRectangle({
          x: 0,
          y: 0,
          width,
          height: 20,
          color: rgb(0, 0, 0),
        });
        page.drawText(stampText, {
          x: 10,
          y: 6,
          size: 7,
          font: boldFont,
          color: rgb(1, 1, 1),
        });
      });
    } else if (isPng || isJpg) {
      const img = isPng
        ? await pdfDoc.embedPng(arrayBuffer)
        : await pdfDoc.embedJpg(arrayBuffer);
      let { width, height } = img;
      const maxWidth = 595.28;
      if (width > maxWidth) {
        const ratio = maxWidth / width;
        width = maxWidth;
        height = height * ratio;
      }
      const page = pdfDoc.addPage([width, height + 25]);
      page.drawImage(img, { x: 0, y: 25, width, height });
      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height: 25,
        color: rgb(0, 0, 0),
      });
      page.drawText(stampText, {
        x: 10,
        y: 8,
        size: 7,
        font: boldFont,
        color: rgb(1, 1, 1),
      });
    } else {
      throw new Error(
        "Unsupported file format. Please upload a PDF, JPG, or PNG file."
      );
    }

    return await pdfDoc.save();
  };

  const handleResubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.partner_name.trim() || form.mobile.trim().length !== 10) {
      return alert(
        "Please provide your valid Full Name and 10-digit Mobile Number."
      );
    }
    if (!form.center_name.trim()) {
      return alert("Please specify your Requested Center Name / Location.");
    }

    setIsSubmitting(true);

    try {
      const targetEmail = (
        partnerDetails?.email ||
        pendingApp?.email ||
        ""
      )
        .trim()
        .toLowerCase();

      // 1. Optional: Upload Corrected KYC Document & Bind Path
      let updatedKycPdfPath =
        pendingApp?.role_metadata?.kyc_pdf_path || null;

      if (correctedFile) {
        const pdfBytes = await buildWatermarkedKycPdf(
          correctedFile,
          form.partner_name.trim(),
          targetEmail
        );
        const safeName = form.partner_name
          .trim()
          .replace(/[^a-zA-Z0-9]/g, "_");
        const pdfFileName = `${safeName}_${Date.now()}_KYC.pdf`;

        const { error: uploadErr } = await supabase.storage
          .from("application_documents")
          .upload(pdfFileName, pdfBytes, {
            contentType: "application/pdf",
          });

        if (uploadErr) throw uploadErr;
        updatedKycPdfPath = pdfFileName;
      }

      const updatedMetadata = {
        ...(pendingApp?.role_metadata || {}),
        ...(updatedKycPdfPath ? { kyc_pdf_path: updatedKycPdfPath } : {}),
        resubmitted_at: new Date().toISOString(),
        applicant_resubmit_remarks:
          form.applicant_remarks.trim().toUpperCase() || null,
      };

      // 2. Synchronize pending_applications so Admin Onboarding Queue sees the resubmission
      if (pendingApp?.id) {
        const { error: appUpdateErr } = await supabase
          .from("pending_applications")
          .update({
            name: form.partner_name.trim().toUpperCase(),
            mobile: form.mobile.trim(),
            pan_number: form.pan_number.trim().toUpperCase() || null,
            center_name: form.center_name.trim(),
            requested_role: form.requested_role,
            role_metadata: updatedMetadata,
            status: "Pending",
            reject_reason: null,
          })
          .eq("id", pendingApp.id);

        if (appUpdateErr) throw appUpdateErr;
      } else if (targetEmail) {
        // Fallback: Check if a pending_applications row exists by email, otherwise insert one
        const { data: existingByEmail } = await supabase
          .from("pending_applications")
          .select("id")
          .ilike("email", targetEmail)
          .limit(1)
          .maybeSingle();

        if (existingByEmail?.id) {
          const { error: emailAppErr } = await supabase
            .from("pending_applications")
            .update({
              name: form.partner_name.trim().toUpperCase(),
              mobile: form.mobile.trim(),
              pan_number: form.pan_number.trim().toUpperCase() || null,
              center_name: form.center_name.trim(),
              requested_role: form.requested_role,
              role_metadata: updatedMetadata,
              status: "Pending",
              reject_reason: null,
            })
            .eq("id", existingByEmail.id);
          if (emailAppErr) throw emailAppErr;
        } else {
          const { error: insertAppErr } = await supabase
            .from("pending_applications")
            .insert([
              {
                name: form.partner_name.trim().toUpperCase(),
                email: targetEmail,
                mobile: form.mobile.trim(),
                pan_number: form.pan_number.trim().toUpperCase() || null,
                center_name: form.center_name.trim(),
                requested_role: form.requested_role,
                role_metadata: updatedMetadata,
                terms_accepted: true,
                status: "Pending",
                reject_reason: null,
              },
            ]);
          if (insertAppErr) throw insertAppErr;
        }
      }

      // 3. Synchronize active_partners status back to 'Pending'
      if (partnerDetails?.id) {
        const { error: partUpdateErr } = await supabase
          .from("active_partners")
          .update({
            partner_name: form.partner_name.trim().toUpperCase(),
            mobile: form.mobile.trim(),
            role: form.requested_role,
            status: "Pending",
            ...(updatedKycPdfPath
              ? { compliance_docs_url: updatedKycPdfPath }
              : {}),
          })
          .eq("id", partnerDetails.id);

        if (partUpdateErr) throw partUpdateErr;
      }

      await logSystemTelemetry({
        actorId: partnerDetails?.id || pendingApp?.id,
        actorEmail: targetEmail,
        actorRole: form.requested_role,
        module: "PARTNER_RESUBMIT",
        actionCode: "APPLICATION_RESUBMITTED",
        referenceId: pendingApp?.id || partnerDetails?.id,
        metadata: {
          center_name: form.center_name.trim(),
          uploaded_new_kyc: Boolean(correctedFile),
          remarks: form.applicant_remarks.trim().toUpperCase() || null,
        },
      });

      alert(
        "✅ Application successfully updated and resubmitted to the Fast Ark Onboarding Queue for corporate review."
      );

      // 4. Clean Session Teardown & Redirect
      localStorage.removeItem("fapl_session_token");
      localStorage.removeItem("fapl_last_active_ts");
      await supabase.auth.signOut();
      router.push("/partner/login");
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_RESUBMIT", {
        id: partnerDetails?.id,
        email: partnerDetails?.email || pendingApp?.email,
      });
      alert(safeMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  const displayReason =
    partnerDetails?.rejection_reason ||
    pendingApp?.reject_reason ||
    "Invalid documents or missing mandatory operational information. Please verify your submitted details and attach corrected KYC documents.";

  const displayEmail =
    partnerDetails?.email || pendingApp?.email || "Registered Email";

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="max-w-2xl w-full bg-white p-6 md:p-8 rounded-2xl shadow-xl border border-red-200 space-y-6">
        <div className="text-center border-b border-slate-100 pb-5">
          <span className="text-5xl">⚠️</span>
          <h1 className="text-2xl font-black text-slate-900 mt-3 uppercase tracking-widest">
            Application Requires Correction
          </h1>
          <p className="text-slate-500 font-bold text-xs mt-1">
            Review the corporate audit remarks below, update your details or KYC
            documents, and resubmit to the onboarding queue.
          </p>
        </div>

        {/* CORPORATE REJECTION REMARKS */}
        <div className="bg-red-50 border-2 border-red-200 p-5 rounded-xl">
          <p className="text-[10px] font-black uppercase tracking-widest text-red-800 mb-1.5">
            Corporate Onboarding Remarks
          </p>
          <p className="font-black text-red-950 text-sm leading-relaxed">
            {displayReason}
          </p>
        </div>

        {/* RESUBMISSION FORM */}
        <form onSubmit={handleResubmit} className="space-y-4 text-xs">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <p className="font-bold text-slate-600">
              Registered Email:{" "}
              <span className="text-slate-950 font-black">{displayEmail}</span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                Applicant Full Name *
              </label>
              <input
                type="text"
                required
                maxLength={45}
                value={form.partner_name}
                onChange={(e) =>
                  setForm({
                    ...form,
                    partner_name: e.target.value
                      .replace(/[^A-Za-z\s]/g, "")
                      .toUpperCase(),
                  })
                }
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black text-slate-900 uppercase outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                Primary Mobile (10 Digits) *
              </label>
              <input
                type="tel"
                required
                maxLength={10}
                value={form.mobile}
                onChange={(e) =>
                  setForm({
                    ...form,
                    mobile: e.target.value.replace(/\D/g, ""),
                  })
                }
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black text-slate-900 outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                Requested Operational Role *
              </label>
              <select
                value={form.requested_role}
                onChange={(e) =>
                  setForm({ ...form, requested_role: e.target.value })
                }
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black text-slate-900 bg-white outline-none focus:border-blue-600"
              >
                <option value="OCSC">OCSC</option>
                <option value="AADHAAR CENTER">AADHAAR CENTER</option>
                <option value="CM (CONSUMER MOBILITY)">
                  CM (CONSUMER MOBILITY)
                </option>
                <option value="PARTNER">PARTNER</option>
                <option value="IRCTC AGENT">IRCTC AGENT</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                Requested Center Name / Location *
              </label>
              <input
                type="text"
                required
                value={form.center_name}
                onChange={(e) =>
                  setForm({
                    ...form,
                    center_name: e.target.value.toUpperCase(),
                  })
                }
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black text-slate-900 uppercase outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="p-4 bg-blue-50/50 border-2 border-dashed border-blue-300 rounded-xl space-y-2">
            <label className="block text-[10px] font-black uppercase text-blue-800 tracking-wider">
              Upload Corrected KYC Document (PDF / JPG / PNG — Max 5MB)
            </label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
              onChange={handleFileChange}
              className="w-full bg-white border border-slate-300 p-2 rounded-lg text-xs font-bold cursor-pointer"
            />
            {correctedFile && (
              <p className="text-[11px] font-black text-emerald-700">
                ✅ Attached for Watermarking: {correctedFile.name}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              Correction Note for Onboarding Admin (Optional)
            </label>
            <input
              type="text"
              placeholder="E.G., UPLOADED CLEAR PAN CARD & UPDATED CENTER NAME..."
              value={form.applicant_remarks}
              onChange={(e) =>
                setForm({
                  ...form,
                  applicant_remarks: e.target.value.toUpperCase(),
                })
              }
              className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold text-slate-900 uppercase outline-none focus:border-blue-600"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-200">
            <Link
              href="/apply"
              className="w-full sm:w-1/3 text-center bg-slate-100 hover:bg-slate-200 text-slate-700 font-black py-3.5 rounded-xl uppercase tracking-widest text-xs transition"
            >
              Full Re-Apply Form
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-2/3 bg-slate-900 text-white font-black py-3.5 rounded-xl shadow-md hover:bg-blue-600 transition disabled:opacity-50 uppercase tracking-widest text-xs"
            >
              {isSubmitting
                ? "Synchronizing & Resubmitting..."
                : "Resubmit Application for Review"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}