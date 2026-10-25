// FILE PATH: ./app/components/aadhaar/PartnerAadhaarUpgradeModule.tsx
"use client";

import React, { useState } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { supabase } from "../../lib/supabase";
import { formatToDDMMYYYY } from "../../lib/aadhaarEngine";
import { reportAndMaskError, logSystemTelemetry } from "../../lib/errorCodes";

// Prevents pdf-lib StandardFonts (WinAnsi) from throwing encoding errors on special characters
const sanitizePdfText = (val: string): string =>
  String(val || "").replace(/[^\x20-\x7E]/g, " ");

const AADHAAR_DOC_PRESETS = [
  "NSEIT Certificate",
  "LMS Certificate",
  "Police Verification Certificate",
  "EA Request Form",
  "Marks Card (12th Pass)",
  "HOTO Letter Copy",
  "Annexure A & B",
  "L1 Readiness Document",
  "100 Rs BSNL Stamp Undertaking",
  "100 Rs Company Stamp Undertaking",
  "Bank Passbook / Cancel Cheque",
  "Other (Custom Document Name)",
];

interface DocSlot {
  id: string;
  presetName: string;
  customName: string;
  file: File | null;
}

interface UpgradeModuleProps {
  partner: any;
  latestUpgradeReq: any;
  isCredentialsLocked: boolean;
  upgradeForm: { operator_id: string; station_id: string; nseit_no: string };
  setUpgradeForm: React.Dispatch<
    React.SetStateAction<{
      operator_id: string;
      station_id: string;
      nseit_no: string;
    }>
  >;
  showBanner: (type: "success" | "error" | "info", text: string) => void;
  onRefreshPortal: () => Promise<void>;
}

export default function PartnerAadhaarUpgradeModule({
  partner,
  latestUpgradeReq,
  isCredentialsLocked,
  upgradeForm,
  setUpgradeForm,
  showBanner,
  onRefreshPortal,
}: UpgradeModuleProps) {
  const [isEditingPendingReq, setIsEditingPendingReq] =
    useState<boolean>(false);
  const [confirmUpgradeCheck, setConfirmUpgradeCheck] =
    useState<boolean>(false);
  const [docSlots, setDocSlots] = useState<DocSlot[]>([
    {
      id: "slot-1",
      presetName: "NSEIT Certificate",
      customName: "",
      file: null,
    },
    {
      id: "slot-2",
      presetName: "Police Verification Certificate",
      customName: "",
      file: null,
    },
    { id: "slot-3", presetName: "EA Request Form", customName: "", file: null },
  ]);
  const [mergedPdfPreviewUrl, setMergedPdfPreviewUrl] = useState<string | null>(
    null
  );
  const [mergedPdfBytesState, setMergedPdfBytesState] =
    useState<Uint8Array | null>(null);
  const [isMergingPdf, setIsMergingPdf] = useState<boolean>(false);
  const [isSubmittingUpgrade, setIsSubmittingUpgrade] =
    useState<boolean>(false);
  const [isDownloadingSubmittedPdf, setIsDownloadingSubmittedPdf] =
    useState<boolean>(false);

  const handleAddDocSlot = () => {
    if (isCredentialsLocked) return;
    if (docSlots.length >= 10)
      return showBanner(
        "info",
        "Maximum limit of 10 compliance documents reached."
      );
    const usedPresets = new Set(docSlots.map((s) => s.presetName));
    const nextPreset =
      AADHAAR_DOC_PRESETS.find((p) => !usedPresets.has(p)) ||
      "Other (Custom Document Name)";
    setDocSlots((prev) => [
      ...prev,
      {
        id: `slot-${Date.now()}-${prev.length + 1}`,
        presetName: nextPreset,
        customName: "",
        file: null,
      },
    ]);
    setMergedPdfBytesState(null);
    if (mergedPdfPreviewUrl) URL.revokeObjectURL(mergedPdfPreviewUrl);
    setMergedPdfPreviewUrl(null);
  };

  const handleRemoveDocSlot = (id: string) => {
    if (isCredentialsLocked || docSlots.length <= 1) return;
    setDocSlots((prev) => prev.filter((s) => s.id !== id));
    setMergedPdfBytesState(null);
    if (mergedPdfPreviewUrl) URL.revokeObjectURL(mergedPdfPreviewUrl);
    setMergedPdfPreviewUrl(null);
  };

  const handleSlotChange = (
    id: string,
    field: "presetName" | "customName" | "file",
    value: any
  ) => {
    if (isCredentialsLocked) return;
    if (field === "file" && value && value.size > 5 * 1024 * 1024) {
      return showBanner(
        "error",
        `File "${value.name}" exceeds the 5MB limit per document.`
      );
    }
    setDocSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
    setMergedPdfBytesState(null);
    if (mergedPdfPreviewUrl) URL.revokeObjectURL(mergedPdfPreviewUrl);
    setMergedPdfPreviewUrl(null);
  };

  const generateMergedCompliancePDF = async (): Promise<Uint8Array | null> => {
    const activeSlots = docSlots.filter((s) => s.file !== null);
    if (activeSlots.length === 0) {
      showBanner(
        "error",
        "Please attach at least 1 compliance document to generate the merged PDF."
      );
      return null;
    }

    for (const s of activeSlots) {
      if (
        s.presetName === "Other (Custom Document Name)" &&
        !s.customName.trim()
      ) {
        showBanner(
          "error",
          "Please type a Document Name for all 'Other' document slots."
        );
        return null;
      }
    }

    setIsMergingPdf(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const timestamp = sanitizePdfText(
        new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      );

      const a4W = 595.28;
      const a4H = 841.89;
      const cover = pdfDoc.addPage([a4W, a4H]);

      cover.drawRectangle({
        x: 0,
        y: 760,
        width: a4W,
        height: 82,
        color: rgb(0.06, 0.09, 0.16),
      });
      cover.drawText(
        sanitizePdfText(
          "FAST ARK PRIVATE LIMITED - AADHAAR OPERATOR COMPLIANCE DOSSIER"
        ),
        {
          x: 40,
          y: 805,
          size: 13,
          font: boldFont,
          color: rgb(1, 1, 1),
        }
      );
      cover.drawText(
        sanitizePdfText(
          `Generated: ${timestamp} IST   |   Total Attached Documents: ${activeSlots.length} / 10`
        ),
        {
          x: 40,
          y: 782,
          size: 9,
          font: font,
          color: rgb(0.95, 0.75, 0.2),
        }
      );

      let y = 720;
      const drawMetaRow = (label: string, val: string) => {
        cover.drawText(sanitizePdfText(label), {
          x: 45,
          y,
          size: 10,
          font: boldFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        cover.drawText(sanitizePdfText(val || "N/A"), {
          x: 220,
          y,
          size: 10,
          font: font,
          color: rgb(0, 0, 0),
        });
        y -= 22;
      };

      drawMetaRow("Partner / Associate Name:", partner?.partner_name || "");
      drawMetaRow("Registered Email:", partner?.email || "");
      drawMetaRow("Mobile Number:", partner?.mobile || "");
      drawMetaRow(
        "Mapped Center [Code]:",
        `[${partner?.locations?.center_code || "NO-CODE"}] ${
          partner?.locations?.center_name || "Unassigned"
        }`
      );
      drawMetaRow(
        "Requested UIDAI Operator ID:",
        upgradeForm.operator_id.trim().toUpperCase()
      );
      drawMetaRow(
        "Requested UIDAI Station ID:",
        upgradeForm.station_id.trim()
      );
      drawMetaRow(
        "NSEIT Certificate Number:",
        upgradeForm.nseit_no.trim().toUpperCase()
      );

      y -= 15;
      cover.drawText("ATTACHED COMPLIANCE DOCUMENTS INDEX", {
        x: 45,
        y,
        size: 11,
        font: boldFont,
        color: rgb(0.06, 0.09, 0.16),
      });
      y -= 8;
      cover.drawLine({
        start: { x: 45, y },
        end: { x: 550, y },
        thickness: 1,
        color: rgb(0.8, 0.8, 0.8),
      });
      y -= 20;

      activeSlots.forEach((slot, idx) => {
        const docLabel =
          slot.presetName === "Other (Custom Document Name)"
            ? slot.customName.trim().toUpperCase()
            : slot.presetName;
        cover.drawText(sanitizePdfText(`${idx + 1}. ${docLabel}`), {
          x: 55,
          y,
          size: 10,
          font: boldFont,
        });
        cover.drawText(
          sanitizePdfText(`File: ${slot.file?.name || ""}`).slice(0, 48),
          {
            x: 310,
            y,
            size: 9,
            font,
            color: rgb(0.35, 0.35, 0.35),
          }
        );
        y -= 20;
      });

      cover.drawRectangle({
        x: 0,
        y: 0,
        width: a4W,
        height: 22,
        color: rgb(0.06, 0.09, 0.16),
      });
      cover.drawText(
        sanitizePdfText(
          `VERIFIED BY PARTNER: ${partner?.partner_name?.toUpperCase()} | OP: ${upgradeForm.operator_id.toUpperCase()} | STN: ${
            upgradeForm.station_id
          } | ${timestamp}`
        ).slice(0, 115),
        { x: 15, y: 7, size: 7, font: boldFont, color: rgb(1, 1, 1) }
      );

      for (let i = 0; i < activeSlots.length; i++) {
        const slot = activeSlots[i];
        const file = slot.file!;
        const docTitle =
          slot.presetName === "Other (Custom Document Name)"
            ? slot.customName.trim().toUpperCase()
            : slot.presetName.toUpperCase();
        const stamp = sanitizePdfText(
          `DOC ${i + 1}/${
            activeSlots.length
          }: ${docTitle} | PARTNER: ${partner?.partner_name?.toUpperCase()} | OP: ${upgradeForm.operator_id.toUpperCase()} | STN: ${
            upgradeForm.station_id
          } | ${timestamp}`
        ).slice(0, 115);

        const arrayBuffer = await file.arrayBuffer();
        const lowerName = file.name.toLowerCase();
        const mime = (file.type || "").toLowerCase();

        const isPdf = mime.includes("pdf") || lowerName.endsWith(".pdf");
        const isPng = mime.includes("png") || lowerName.endsWith(".png");
        const isJpg =
          mime.includes("jpg") ||
          mime.includes("jpeg") ||
          lowerName.endsWith(".jpg") ||
          lowerName.endsWith(".jpeg");

        if (isPdf) {
          const srcPdf = await PDFDocument.load(arrayBuffer, {
            ignoreEncryption: true,
          });
          const copiedPages = await pdfDoc.copyPages(
            srcPdf,
            srcPdf.getPageIndices()
          );
          copiedPages.forEach((p) => {
            pdfDoc.addPage(p);
            const { width } = p.getSize();
            p.drawRectangle({
              x: 0,
              y: 0,
              width,
              height: 20,
              color: rgb(0, 0, 0),
            });
            p.drawText(stamp, {
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
          const maxW = 555;
          if (width > maxW) {
            const ratio = maxW / width;
            width = maxW;
            height = height * ratio;
          }
          const page = pdfDoc.addPage([595.28, Math.max(height + 70, 400)]);
          const pageH = page.getSize().height;
          page.drawText(sanitizePdfText(`DOCUMENT ${i + 1}: ${docTitle}`), {
            x: 20,
            y: pageH - 25,
            size: 10,
            font: boldFont,
            color: rgb(0.1, 0.1, 0.1),
          });
          page.drawImage(img, { x: 20, y: 30, width, height });
          page.drawRectangle({
            x: 0,
            y: 0,
            width: 595.28,
            height: 22,
            color: rgb(0, 0, 0),
          });
          page.drawText(stamp, {
            x: 10,
            y: 7,
            size: 7,
            font: boldFont,
            color: rgb(1, 1, 1),
          });
        } else {
          throw new Error(
            `Unsupported file format for "${file.name}". Please upload PDF, JPG, or PNG files.`
          );
        }
      }

      const finalBytes = await pdfDoc.save();
      setMergedPdfBytesState(finalBytes);
      if (mergedPdfPreviewUrl) URL.revokeObjectURL(mergedPdfPreviewUrl);
      const blob = new Blob([finalBytes as unknown as BlobPart], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      setMergedPdfPreviewUrl(url);
      return finalBytes;
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "AADHAAR_PDF_MERGER", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("error", safeMsg);
      return null;
    } finally {
      setIsMergingPdf(false);
    }
  };

  const handleDownloadLocalMergedPdf = async () => {
    let bytes = mergedPdfBytesState;
    if (!bytes) {
      bytes = await generateMergedCompliancePDF();
    }
    if (!bytes) return;
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: "application/pdf",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Aadhaar_Compliance_${
      upgradeForm.operator_id || "OP"
    }_${upgradeForm.station_id || "STN"}.pdf`;
    link.click();
  };

  const handleViewOrDownloadSubmittedPdf = async (
    path: string | null,
    action: "view" | "download"
  ) => {
    if (!path)
      return showBanner("error", "No compliance PDF found for this record.");
    setIsDownloadingSubmittedPdf(true);
    try {
      const { data, error } = await supabase.storage
        .from("application_documents")
        .createSignedUrl(path, 3600);
      if (error || !data?.signedUrl)
        throw error || new Error("Could not generate secure link.");

      if (action === "view") {
        window.open(data.signedUrl, "_blank");
      } else {
        const res = await fetch(data.signedUrl);
        const blob = await res.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `FastArk_Aadhaar_Compliance_${
          partner?.aadhaar_operator_id || upgradeForm.operator_id || "Partner"
        }.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(
        err,
        "AADHAAR_COMPLIANCE_DOWNLOAD",
        {
          id: partner?.id,
          email: partner?.email,
        }
      );
      showBanner("error", safeMsg);
    } finally {
      setIsDownloadingSubmittedPdf(false);
    }
  };

  const handleUpgradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCredentialsLocked) {
      return showBanner(
        "error",
        "Action Locked: Your Aadhaar credentials have already been approved by Corporate Admin and cannot be modified."
      );
    }
    if (!upgradeForm.operator_id.trim()) {
      return showBanner("error", "Please enter your UIDAI Operator ID.");
    }
    if (upgradeForm.station_id.trim().length !== 5) {
      return showBanner(
        "error",
        "Validation Error: UIDAI Station ID must be 5 digits."
      );
    }
    if (!upgradeForm.nseit_no.trim()) {
      return showBanner("error", "Please enter your NSEIT Certificate Number.");
    }
    if (!confirmUpgradeCheck) {
      return showBanner(
        "error",
        "Mandatory: Please check the verification box confirming that your credentials and documents are accurate."
      );
    }

    const hasNewFiles = docSlots.some((s) => s.file !== null);
    const isUpdatingExistingPending =
      isEditingPendingReq && latestUpgradeReq?.status === "Pending";

    if (!isUpdatingExistingPending && !hasNewFiles) {
      return showBanner(
        "error",
        "Please attach at least 1 compliance document in the document list below."
      );
    }

    setIsSubmittingUpgrade(true);
    try {
      let finalPdfPath = isUpdatingExistingPending
        ? latestUpgradeReq.compliance_pdf_url
        : null;

      if (hasNewFiles) {
        const pdfBytes =
          mergedPdfBytesState || (await generateMergedCompliancePDF());
        if (!pdfBytes) {
          setIsSubmittingUpgrade(false);
          return;
        }
        finalPdfPath = `AADHAAR_UPGRADE_${partner.id}_${Date.now()}.pdf`;
        const { error: upErr } = await supabase.storage
          .from("application_documents")
          .upload(finalPdfPath, pdfBytes, { contentType: "application/pdf" });
        if (upErr) throw upErr;
      }

      if (isUpdatingExistingPending) {
        const { error } = await supabase
          .from("partner_upgrade_requests")
          .update({
            requested_operator_id: upgradeForm.operator_id.trim().toUpperCase(),
            requested_station_id: upgradeForm.station_id.trim(),
            nseit_cert_no: upgradeForm.nseit_no.trim().toUpperCase(),
            compliance_pdf_url: finalPdfPath,
          })
          .eq("id", latestUpgradeReq.id);
        if (error) throw error;

        await logSystemTelemetry({
          actorId: partner.id,
          actorEmail: partner.email,
          module: "PARTNER_AADHAAR_UPGRADE",
          actionCode: "UPGRADE_REQ_UPDATED",
          referenceId: latestUpgradeReq.id,
        });

        showBanner(
          "success",
          "✅ Your pending Aadhaar Upgrade Request has been updated! Corporate Admin will review your corrected details."
        );
      } else {
        const { data: inserted, error } = await supabase
          .from("partner_upgrade_requests")
          .insert([
            {
              partner_id: partner.id,
              center_id: partner.center_id,
              requested_operator_id: upgradeForm.operator_id
                .trim()
                .toUpperCase(),
              requested_station_id: upgradeForm.station_id.trim(),
              nseit_cert_no: upgradeForm.nseit_no.trim().toUpperCase(),
              compliance_pdf_url: finalPdfPath,
              status: "Pending",
            },
          ])
          .select()
          .maybeSingle();
        if (error) throw error;

        await logSystemTelemetry({
          actorId: partner.id,
          actorEmail: partner.email,
          module: "PARTNER_AADHAAR_UPGRADE",
          actionCode: "UPGRADE_REQ_CREATED",
          referenceId: inserted?.id,
        });

        showBanner(
          "success",
          "✅ Aadhaar Center Upgrade Request & Merged PDF submitted! Your dashboard will unlock automatically once Corporate Admin approves your request."
        );
      }

      setIsEditingPendingReq(false);
      setConfirmUpgradeCheck(false);
      await onRefreshPortal();
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_AADHAAR_UPGRADE", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("error", safeMsg);
    } finally {
      setIsSubmittingUpgrade(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in">
      <div className="bg-slate-900 text-white rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 block">
              Corporate Security Gate
            </span>
            <h2 className="text-xl font-black mt-0.5">
              {isCredentialsLocked
                ? "✅ Aadhaar Credentials Approved & Permanently Locked"
                : "🔒 Aadhaar Portal Locked — Admin Approval Required"}
            </h2>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
              isCredentialsLocked
                ? "bg-emerald-500 text-slate-950"
                : "bg-red-500/20 text-red-300 border border-red-500/40"
            }`}
          >
            {isCredentialsLocked ? "🔒 Locked & Verified" : "Approval Pending"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[9px] font-black uppercase text-slate-400">
              1. Assigned Center Status
            </p>
            <p className="font-black text-white mt-1">
              [{partner?.locations?.center_code || "NO-CODE"}]{" "}
              {partner?.locations?.center_name || "Unassigned"}
            </p>
            <p
              className={`text-[10px] font-black mt-1 ${
                partner?.locations?.role_aadhaar
                  ? "text-emerald-400"
                  : "text-amber-400"
              }`}
            >
              {partner?.locations?.role_aadhaar
                ? "✅ Mapped as Aadhaar Center"
                : "⏳ Awaiting Admin Center Mapping"}
            </p>
          </div>

          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[9px] font-black uppercase text-slate-400">
              2. Operator Role Binding
            </p>
            <p className="font-black text-white mt-1">
              {partner?.role_aadhaar ? "Aadhaar Role Bound" : "Not Bound Yet"}
            </p>
            <p
              className={`text-[10px] font-black mt-1 ${
                partner?.role_aadhaar ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {partner?.role_aadhaar
                ? "✅ Approved by Admin"
                : "🔒 Requires Admin Approval"}
            </p>
          </div>

          <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[9px] font-black uppercase text-slate-400">
              3. UIDAI Operator &amp; Station ID
            </p>
            <p className="font-black text-white mt-1">
              {partner?.aadhaar_operator_id || "NO-ID"} /{" "}
              {partner?.aadhaar_station_id || "NO-STN"}
            </p>
            <p
              className={`text-[10px] font-black mt-1 ${
                partner?.aadhaar_operator_id && partner?.aadhaar_station_id
                  ? "text-emerald-400"
                  : "text-amber-400"
              }`}
            >
              {partner?.aadhaar_operator_id && partner?.aadhaar_station_id
                ? "✅ Bound & Locked"
                : "⏳ Submit Credentials Below"}
            </p>
          </div>
        </div>
      </div>

      {isCredentialsLocked ? (
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-start gap-3">
              <span className="text-3xl">🔒</span>
              <div>
                <h3 className="font-black text-emerald-950 text-lg uppercase tracking-wide">
                  Approved Aadhaar Credentials &amp; Compliance Dossier
                  (Read-Only)
                </h3>
                <p className="text-xs font-bold text-emerald-800 mt-0.5">
                  Your Aadhaar credentials and uploaded compliance documents
                  have been verified and locked by Corporate Admin. Editing or
                  re-uploading files is permanently disabled.
                </p>
              </div>
            </div>

            {(latestUpgradeReq?.compliance_pdf_url ||
              partner?.compliance_docs_url) && (
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isDownloadingSubmittedPdf}
                  onClick={() =>
                    handleViewOrDownloadSubmittedPdf(
                      latestUpgradeReq?.compliance_pdf_url ||
                        partner?.compliance_docs_url,
                      "view"
                    )
                  }
                  className="bg-slate-900 hover:bg-slate-800 text-white font-black px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                >
                  👁️ View Approved PDF
                </button>
                <button
                  type="button"
                  disabled={isDownloadingSubmittedPdf}
                  onClick={() =>
                    handleViewOrDownloadSubmittedPdf(
                      latestUpgradeReq?.compliance_pdf_url ||
                        partner?.compliance_docs_url,
                      "download"
                    )
                  }
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                >
                  📥 Download Approved PDF
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-xl border border-emerald-200 text-xs">
            <div>
              <span className="text-[9px] font-black uppercase text-slate-400 block">
                Approved UIDAI Operator ID
              </span>
              <span className="font-black text-slate-900 text-sm">
                {partner?.aadhaar_operator_id ||
                  latestUpgradeReq?.requested_operator_id ||
                  "VERIFIED"}
              </span>
            </div>
            <div>
              <span className="text-[9px] font-black uppercase text-slate-400 block">
                Approved UIDAI Station ID
              </span>
              <span className="font-black text-emerald-700 text-sm">
                {partner?.aadhaar_station_id ||
                  latestUpgradeReq?.requested_station_id ||
                  "VERIFIED"}
              </span>
            </div>
            <div>
              <span className="text-[9px] font-black uppercase text-slate-400 block">
                NSEIT Certificate No
              </span>
              <span className="font-black text-slate-900 text-sm">
                {latestUpgradeReq?.nseit_cert_no || "VERIFIED ON FILE"}
              </span>
            </div>
          </div>
        </div>
      ) : latestUpgradeReq?.status === "Pending" && !isEditingPendingReq ? (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-start gap-3">
              <span className="text-3xl">⏳</span>
              <div>
                <h3 className="font-black text-amber-950 text-lg uppercase tracking-wide">
                  Upgrade Request Under Corporate Review
                </h3>
                <p className="text-xs font-bold text-amber-800 mt-0.5">
                  Submitted on {formatToDDMMYYYY(latestUpgradeReq.created_at)}.
                  You may edit your request only while it is pending approval.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 shrink-0">
              {latestUpgradeReq.compliance_pdf_url && (
                <>
                  <button
                    type="button"
                    disabled={isDownloadingSubmittedPdf}
                    onClick={() =>
                      handleViewOrDownloadSubmittedPdf(
                        latestUpgradeReq.compliance_pdf_url,
                        "view"
                      )
                    }
                    className="bg-slate-900 hover:bg-slate-800 text-white font-black px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                  >
                    👁️ View Merged PDF
                  </button>
                  <button
                    type="button"
                    disabled={isDownloadingSubmittedPdf}
                    onClick={() =>
                      handleViewOrDownloadSubmittedPdf(
                        latestUpgradeReq.compliance_pdf_url,
                        "download"
                      )
                    }
                    className="bg-blue-600 hover:bg-blue-500 text-white font-black px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                  >
                    📥 Download PDF
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsEditingPendingReq(true);
                  setConfirmUpgradeCheck(false);
                }}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
              >
                ✏️ Edit Before Approval
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-xl border border-amber-200 text-xs">
            <div>
              <span className="text-[9px] font-black uppercase text-slate-400 block">
                Requested Operator ID
              </span>
              <span className="font-black text-slate-900 text-sm">
                {latestUpgradeReq.requested_operator_id}
              </span>
            </div>
            <div>
              <span className="text-[9px] font-black uppercase text-slate-400 block">
                Requested Station ID
              </span>
              <span className="font-black text-amber-700 text-sm">
                {latestUpgradeReq.requested_station_id}
              </span>
            </div>
            <div>
              <span className="text-[9px] font-black uppercase text-slate-400 block">
                NSEIT Certificate No
              </span>
              <span className="font-black text-slate-900 text-sm">
                {latestUpgradeReq.nseit_cert_no}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          {latestUpgradeReq?.status === "Rejected" && (
            <div className="p-4 bg-red-50 border-2 border-red-200 rounded-xl">
              <p className="text-[10px] font-black uppercase text-red-700 tracking-widest">
                ❌ Previous Request Declined by Admin
              </p>
              <p className="text-xs font-bold text-red-900 mt-1">
                Reason:{" "}
                {latestUpgradeReq.reject_reason ||
                  "Please verify your credentials and re-upload."}
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">
                {isEditingPendingReq
                  ? "✏️ Edit Pending Aadhaar Upgrade Request (Pre-Approval Only)"
                  : "Submit Aadhaar Operator Credentials & Documents (Up to 10)"}
              </h2>
              <p className="text-xs font-bold text-slate-500 mt-0.5">
                Add up to 10 named compliance documents below. All uploaded
                files are automatically merged into a single watermarked PDF.
              </p>
            </div>

            {isEditingPendingReq && (
              <button
                type="button"
                onClick={() => setIsEditingPendingReq(false)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-black px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <form onSubmit={handleUpgradeSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                  1. UIDAI Operator ID *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., MYS_FAAFREEN"
                  value={upgradeForm.operator_id}
                  onChange={(e) =>
                    setUpgradeForm({
                      ...upgradeForm,
                      operator_id: e.target.value.toUpperCase(),
                    })
                  }
                  className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-black text-sm uppercase bg-white outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                  2. UIDAI Station ID (5 Digits) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={5}
                  placeholder="e.g., 21505"
                  value={upgradeForm.station_id}
                  onChange={(e) =>
                    setUpgradeForm({
                      ...upgradeForm,
                      station_id: e.target.value.replace(/\D/g, ""),
                    })
                  }
                  className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-black text-sm bg-white outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                  3. NSEIT Certificate No *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Certificate Number"
                  value={upgradeForm.nseit_no}
                  onChange={(e) =>
                    setUpgradeForm({
                      ...upgradeForm,
                      nseit_no: e.target.value.toUpperCase(),
                    })
                  }
                  className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-black text-sm uppercase bg-white outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-800 tracking-wider">
                    4. Aadhaar Compliance Documents ({docSlots.length} / 10
                    Slots)
                  </label>
                  <p className="text-[11px] font-bold text-slate-500">
                    Select the document name and attach PDF, JPG, or PNG files
                    (Max 5MB each).
                  </p>
                </div>

                {docSlots.length < 10 && (
                  <button
                    type="button"
                    onClick={handleAddDocSlot}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition shrink-0"
                  >
                    ➕ Add Document ({docSlots.length}/10)
                  </button>
                )}
              </div>

              <div className="space-y-2.5">
                {docSlots.map((slot, index) => (
                  <div
                    key={slot.id}
                    className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-center"
                  >
                    <div className="md:col-span-5 space-y-1.5">
                      <label className="block text-[9px] font-black uppercase text-slate-400">
                        Document #{index + 1} Name *
                      </label>
                      <select
                        value={slot.presetName}
                        onChange={(e) =>
                          handleSlotChange(
                            slot.id,
                            "presetName",
                            e.target.value
                          )
                        }
                        className="w-full border border-slate-300 p-2 rounded-lg text-xs font-bold bg-white"
                      >
                        {AADHAAR_DOC_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {preset}
                          </option>
                        ))}
                      </select>
                      {slot.presetName === "Other (Custom Document Name)" && (
                        <input
                          type="text"
                          required={slot.file !== null}
                          placeholder="TYPE CUSTOM DOCUMENT NAME..."
                          value={slot.customName}
                          onChange={(e) =>
                            handleSlotChange(
                              slot.id,
                              "customName",
                              e.target.value.toUpperCase()
                            )
                          }
                          className="w-full border border-blue-300 p-2 rounded-lg text-xs font-black uppercase bg-white"
                        />
                      )}
                    </div>

                    <div className="md:col-span-6">
                      <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">
                        Attach File (.PDF, .JPG, .PNG){" "}
                        {slot.file ? `— ✅ ${slot.file.name}` : ""}
                      </label>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                        onChange={(e) =>
                          handleSlotChange(
                            slot.id,
                            "file",
                            e.target.files?.[0] || null
                          )
                        }
                        className="w-full bg-white border border-slate-300 p-1.5 rounded-lg text-xs font-bold cursor-pointer"
                      />
                    </div>

                    <div className="md:col-span-1 flex justify-end">
                      {docSlots.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveDocSlot(slot.id)}
                          className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-black text-sm border border-red-200"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {docSlots.some((s) => s.file !== null) && (
                <div className="p-4 bg-slate-900 text-white rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-amber-400">
                      📄 Single Merged PDF Compiler (
                      {docSlots.filter((s) => s.file !== null).length} File(s)
                      Ready)
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isMergingPdf}
                      onClick={generateMergedCompliancePDF}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-black px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow"
                    >
                      {isMergingPdf
                        ? "Merging PDF..."
                        : "🔄 Merge & Preview PDF"}
                    </button>
                    {mergedPdfPreviewUrl && (
                      <a
                        href={mergedPdfPreviewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-slate-700 hover:bg-slate-600 text-white font-black px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow"
                      >
                        👁️ Open Full Tab ↗
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={isMergingPdf}
                      onClick={handleDownloadLocalMergedPdf}
                      className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow"
                    >
                      📥 Download Merged PDF
                    </button>
                  </div>
                </div>
              )}

              {mergedPdfPreviewUrl && (
                <div className="border-2 border-slate-300 rounded-xl overflow-hidden bg-slate-800">
                  <iframe
                    src={`${mergedPdfPreviewUrl}#toolbar=0`}
                    className="w-full h-96 bg-white"
                    title="Merged Aadhaar Compliance PDF Preview"
                  />
                </div>
              )}
            </div>

            <label className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border-2 border-blue-200 cursor-pointer">
              <input
                type="checkbox"
                required
                checked={confirmUpgradeCheck}
                onChange={(e) => setConfirmUpgradeCheck(e.target.checked)}
                className="w-5 h-5 accent-blue-600 mt-0.5 shrink-0"
              />
              <span className="text-xs font-bold text-blue-950 leading-relaxed">
                I confirm that my UIDAI Operator ID (
                <strong>{upgradeForm.operator_id || "N/A"}</strong>), 5-digit
                Station ID (<strong>{upgradeForm.station_id || "N/A"}</strong>
                ), NSEIT Certificate Number (
                <strong>{upgradeForm.nseit_no || "N/A"}</strong>), and all
                attached compliance documents are accurate.
              </span>
            </label>

            <button
              type="submit"
              disabled={
                isSubmittingUpgrade || isMergingPdf || !confirmUpgradeCheck
              }
              className="w-full py-4 bg-slate-900 hover:bg-blue-600 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg disabled:opacity-40 transition"
            >
              {isSubmittingUpgrade
                ? "Merging Documents & Submitting..."
                : isEditingPendingReq
                ? "💾 Save Pre-Approval Corrections"
                : "Submit Aadhaar Credentials & Merged PDF for Approval"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}