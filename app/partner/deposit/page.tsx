// FILE PATH: ./app/partner/deposit/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { QRCodeSVG } from "qrcode.react";
import { scanPaymentReceiptOCR } from "../../lib/ocrEngine";
import {
  reportAndMaskError,
  logSystemTelemetry,
  generateSystemReferenceCode,
} from "../../lib/errorCodes";
import {
  DatePresetMode,
  getDateRangeFromPreset,
  formatToDDMMYYYY,
  getISTDateString,
} from "../../lib/aadhaarEngine";

const getLocalDateString = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
};

export default function PartnerDepositPage() {
  const router = useRouter();
  const [partner, setPartner] = useState<any>(null);
  const [centerUpi, setCenterUpi] = useState<string>("fastark@upi");
  const [loading, setLoading] = useState(true);
  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Desktop Split-Pane & Mobile 3-Tab Switcher ("form" | "viewer" | "ledger")
  const [rightPanel, setRightPanel] = useState<"ledger" | "viewer">("ledger");
  const [mobileTab, setMobileTab] = useState<"form" | "viewer" | "ledger">("form");

  // Data States
  const [deposits, setDeposits] = useState<any[]>([]);
  const [salesList, setSalesList] = useState<any[]>([]);
  const [matchedRows, setMatchedRows] = useState<Set<string>>(new Set());

  // 7-Option Date Preset Filter (Week / Month / Custom)
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [filterFromDate, setFilterFromDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").start
  );
  const [filterToDate, setFilterToDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").end
  );

  // Submission Form State (Includes Unique UTR, Transaction ID & Auto Reference Code)
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    deposit_amount: "",
    deposit_method: "UPI",
    utr_number: "",
    transaction_id: "",
    reference_code: generateSystemReferenceCode(
      "FA-DEP",
      getLocalDateString(new Date())
    ),
    deposit_date: getLocalDateString(new Date()),
  });

  // Slip, Exemption, Preset & OCR States
  const [slipTypePreset, setSlipTypePreset] = useState("auto");
  const [slipImage, setSlipImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  // Scanned Extracted Snapshot for Audit
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);
  const [ocrRawAmount, setOcrRawAmount] = useState<number | null>(null);
  const [ocrRawRef, setOcrRawRef] = useState<string | null>(null);
  const [ocrRawTxnId, setOcrRawTxnId] = useState<string | null>(null);
  const [ocrRawDate, setOcrRawDate] = useState<string | null>(null);
  const [isUserVerified, setIsUserVerified] = useState(false);

  const [isExempted, setIsExempted] = useState(false);
  const [exemptionCategory, setExemptionCategory] = useState("");
  const [otherExemptionText, setOtherExemptionText] = useState("");

  // Edit / Correction States
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  useEffect(() => {
    initializePortal();
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [router]);

  const showBanner = (type: "success" | "error" | "info", text: string) => {
    setStatusBanner({ type, text });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFilterFromDate(range.start);
      setFilterToDate(range.end);
    }
  };

  const initializePortal = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/partner/login");

      const { data: partnerData, error: partnerError } = await supabase
        .from("active_partners")
        .select(
          "id, center_id, partner_name, email, role, locations(center_name, center_code)"
        )
        .ilike("email", session.user.email || "")
        .maybeSingle();

      if (partnerError || !partnerData)
        throw new Error("Partner profile not found.");
      setPartner(partnerData);

      const [depRes, salesRes] = await Promise.all([
        supabase
          .from("partner_deposits")
          .select("*")
          .eq("partner_id", partnerData.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("daily_sales_reports")
          .select("*")
          .eq("partner_id", partnerData.id)
          .order("report_date", { ascending: false }),
      ]);

      const telecomDeps = (depRes.data || []).filter(
        (d: any) =>
          d.deposit_stream !== "AADHAAR" &&
          !String(d.reference_no || "")
            .toUpperCase()
            .startsWith("AADHAAR_")
      );

      setDeposits(telecomDeps);
      setSalesList(salesRes.data || []);

      if (partnerData.center_id) {
        const { data: upiData } = await supabase
          .from("upi_ids")
          .select("upi_id")
          .eq("assigned_location_id", partnerData.center_id)
          .eq("is_active", true)
          .maybeSingle();

        if (upiData && upiData.upi_id) {
          setCenterUpi(upiData.upi_id);
        }
      }
    } catch (err: any) {
      await reportAndMaskError(err, "PARTNER_DEPOSIT_INIT");
    } finally {
      setLoading(false);
    }
  };

  // --- ENHANCED CANVAS OCR ENGINE ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSlipImage(file);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(URL.createObjectURL(file));

    setRightPanel("viewer");
    setIsScanning(true);
    setScanProgress(0);
    setIsExempted(false);
    setIsUserVerified(false);
    setDetectedPlatform(null);
    setOcrRawAmount(null);
    setOcrRawRef(null);
    setOcrRawTxnId(null);
    setOcrRawDate(null);

    try {
      if (
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
      ) {
        setDetectedPlatform("PDF Receipt Attached");
        setIsScanning(false);
        return;
      }

      const ocrResult = await scanPaymentReceiptOCR(
        file,
        slipTypePreset,
        (pct) => setScanProgress(pct)
      );

      setDetectedPlatform(ocrResult.platform);
      setOcrRawAmount(ocrResult.amount);
      setOcrRawRef(ocrResult.utr);
      setOcrRawTxnId(ocrResult.transactionId);
      setOcrRawDate(ocrResult.date);

      const nextDate = ocrResult.date || form.deposit_date;
      setForm((prev) => ({
        ...prev,
        deposit_amount:
          ocrResult.amount !== null
            ? ocrResult.amount.toString()
            : prev.deposit_amount,
        utr_number: ocrResult.utr ? ocrResult.utr : prev.utr_number,
        transaction_id: ocrResult.transactionId
          ? ocrResult.transactionId
          : ocrResult.utr || prev.transaction_id,
        deposit_method: ocrResult.method || prev.deposit_method,
        deposit_date: nextDate,
        reference_code: generateSystemReferenceCode("FA-DEP", nextDate),
      }));
    } catch (err) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_DEPOSIT_OCR", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("info", safeMsg);
    } finally {
      setIsScanning(false);
    }
  };

  // --- SECURE DOCUMENT VIEWER ---
  const handleViewSecureSlip = async (path: string) => {
    if (path.startsWith("http")) {
      window.open(path, "_blank");
      return;
    }

    const { data, error } = await supabase.storage
      .from("deposit-slips")
      .createSignedUrl(path, 60);

    if (error || !data) {
      return showBanner(
        "error",
        "[ERR-VLT-301] Unable to open document from the vault."
      );
    }

    window.open(data.signedUrl, "_blank");
  };

  // --- SUBMIT NEW DEPOSIT (WITH UNIQUE UTR, TRANSACTION ID & REFERENCE CODE) ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isExempted && slipImage && !isUserVerified) {
      return showBanner(
        "error",
        "⚠️ Please review all auto-scanned fields and check the confirmation box before submitting."
      );
    }

    const amt = parseFloat(form.deposit_amount);
    if (isNaN(amt) || amt <= 0)
      return showBanner("error", "Deposit Amount must be greater than zero.");

    const cleanUtr = form.utr_number.trim().replace(/\s+/g, "").toUpperCase();
    const cleanTxnId = (form.transaction_id || cleanUtr).trim().toUpperCase();
    const finalRefCode =
      form.reference_code ||
      generateSystemReferenceCode("FA-DEP", form.deposit_date);

    if (cleanUtr.length < 4)
      return showBanner(
        "error",
        "Please provide a valid Unique UTR Number (minimum 4 characters)."
      );
    if (cleanTxnId.length < 4)
      return showBanner(
        "error",
        "Please provide a valid Transaction / Scroll ID (minimum 4 characters)."
      );
    if (!isExempted && !slipImage)
      return showBanner(
        "error",
        "Please upload the deposit slip, or declare an exemption."
      );
    if (isExempted && !exemptionCategory)
      return showBanner(
        "error",
        "You must select a reason for not uploading a slip."
      );
    if (
      isExempted &&
      exemptionCategory === "Other" &&
      otherExemptionText.trim().length < 4
    ) {
      return showBanner(
        "error",
        "You must provide detailed remarks for 'Other' missing slips."
      );
    }

    setIsSubmitting(true);
    setStatusBanner(null);
    try {
      // Pre-flight global duplicate UTR check across both Telecom and Aadhaar
      const { data: dupCheck } = await supabase
        .from("partner_deposits")
        .select("id, reference_code")
        .or(
          `utr_number.eq.${cleanUtr},reference_no.eq.${cleanUtr},reference_no.eq.AADHAAR_${cleanUtr}`
        )
        .limit(1)
        .maybeSingle();

      if (dupCheck) {
        setIsSubmitting(false);
        return showBanner(
          "error",
          `[ERR-DUP-205] Fraud Prevention Block: UTR '${cleanUtr}' has already been submitted under Reference Code ${
            dupCheck.reference_code || "EXISTING"
          }.`
        );
      }

      let finalSlipUrl = null;
      if (!isExempted && slipImage) {
        const fileExt = slipImage.name.split(".").pop();
        const fileName = `slip-${partner.id}-${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("deposit-slips")
          .upload(fileName, slipImage);
        if (uploadError) throw uploadError;

        finalSlipUrl = fileName;
      }

      const finalExemptionReason = isExempted
        ? exemptionCategory === "Other"
          ? `OTHER: ${otherExemptionText}`
          : exemptionCategory
        : null;

      const basePayload: any = {
        partner_id: partner.id,
        center_id: partner.center_id,
        deposit_amount: amt,
        deposit_method: form.deposit_method,
        reference_no: cleanUtr,
        deposit_date: form.deposit_date,
        deposit_slip_url: finalSlipUrl,
        is_exempted: isExempted,
        exemption_reason: finalExemptionReason,
        status: "Pending",
      };

      const { error: richErr } = await supabase.from("partner_deposits").insert([
        {
          ...basePayload,
          deposit_stream: "TELECOM",
          utr_number: cleanUtr,
          transaction_id: cleanTxnId,
          reference_code: finalRefCode,
        },
      ]);

      if (richErr && richErr.code === "42703") {
        const { error: fbErr } = await supabase
          .from("partner_deposits")
          .insert([basePayload]);
        if (fbErr) throw fbErr;
      } else if (richErr) {
        throw richErr;
      }

      await logSystemTelemetry({
        actorId: partner.id,
        actorEmail: partner.email,
        module: "PARTNER_TELECOM_DEPOSIT",
        actionCode: "DEPOSIT_SUBMITTED",
        referenceId: finalRefCode,
        metadata: {
          amount: amt,
          method: form.deposit_method,
          utr_number: cleanUtr,
          transaction_id: cleanTxnId,
          reference_code: finalRefCode,
        },
      });

      const todayStr = getLocalDateString(new Date());
      setForm({
        deposit_amount: "",
        deposit_method: "UPI",
        utr_number: "",
        transaction_id: "",
        reference_code: generateSystemReferenceCode("FA-DEP", todayStr),
        deposit_date: todayStr,
      });
      setSlipImage(null);
      setImagePreview(null);
      setOcrRawAmount(null);
      setOcrRawRef(null);
      setOcrRawTxnId(null);
      setOcrRawDate(null);
      setDetectedPlatform(null);
      setIsUserVerified(false);
      setIsExempted(false);
      setExemptionCategory("");
      setOtherExemptionText("");

      setRightPanel("ledger");
      setMobileTab("ledger");
      showBanner(
        "success",
        `✅ Deposit of ₹${amt.toLocaleString(
          "en-IN"
        )} recorded! Reference Code: ${finalRefCode} | UTR: ${cleanUtr}`
      );
      initializePortal();
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_DEPOSIT_SUBMIT", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("error", safeMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT / CORRECTION ENGINE (WITH DUPLICATE UTR GUARD) ---
  const startEditing = (dep: any) => {
    setEditingId(dep.id);
    setEditForm({
      deposit_amount: dep.deposit_amount,
      utr_number: dep.utr_number || dep.reference_no || "",
      transaction_id: dep.transaction_id || dep.reference_no || "",
      deposit_method: dep.deposit_method,
    });
  };

  const handleEditSubmit = async (id: string) => {
    const cleanUtr = String(editForm.utr_number || "")
      .trim()
      .toUpperCase();
    const cleanTxn = String(editForm.transaction_id || cleanUtr)
      .trim()
      .toUpperCase();
    const amt = parseFloat(editForm.deposit_amount);

    if (isNaN(amt) || amt <= 0)
      return showBanner("error", "Amount must be greater than zero.");
    if (cleanUtr.length < 4)
      return showBanner("error", "Valid Unique UTR is required.");
    if (!confirm("Update this pending deposit record?")) return;

    setIsSubmitting(true);
    try {
      const { error: richErr } = await supabase
        .from("partner_deposits")
        .update({
          deposit_amount: amt,
          reference_no: cleanUtr,
          utr_number: cleanUtr,
          transaction_id: cleanTxn,
          deposit_method: editForm.deposit_method,
        })
        .eq("id", id);

      if (richErr && richErr.code === "42703") {
        const { error: fbErr } = await supabase
          .from("partner_deposits")
          .update({
            deposit_amount: amt,
            reference_no: cleanUtr,
            deposit_method: editForm.deposit_method,
          })
          .eq("id", id);
        if (fbErr) throw fbErr;
      } else if (richErr) {
        throw richErr;
      }

      await logSystemTelemetry({
        actorId: partner?.id,
        actorEmail: partner?.email,
        module: "PARTNER_TELECOM_DEPOSIT",
        actionCode: "PENDING_DEPOSIT_EDITED",
        referenceId: id,
        metadata: { amount: amt, utr: cleanUtr, transaction_id: cleanTxn },
      });

      showBanner("success", "✅ Pending deposit record updated.");
      setEditingId(null);
      initializePortal();
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_DEPOSIT_EDIT", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("error", safeMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMatch = (id: string) => {
    setMatchedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  // Filtered Sales & Deposits by Selected Week / Month / Custom Date Range
  const filteredDeposits = useMemo(() => {
    return deposits.filter((d) => {
      const dt = (d.deposit_date || d.created_at || "").split("T")[0];
      return dt >= filterFromDate && dt <= filterToDate;
    });
  }, [deposits, filterFromDate, filterToDate]);

  const filteredSales = useMemo(() => {
    return salesList.filter((s) => {
      const dt = (s.report_date || "").split("T")[0];
      return dt >= filterFromDate && dt <= filterToDate;
    });
  }, [salesList, filterFromDate, filterToDate]);

  // REQUIREMENT #4: Total Collection Deducted from Deposit = Balance Payable
  const reconciliationMetrics = useMemo(() => {
    const calcSaleRow = (s: any) =>
      Number(s.cbp_landline_amt || 0) +
      Number(s.cbp_gsm_amt || 0) +
      Number(s.ctop_recharge_amt || 0) +
      Number(s.sim_replacement_amt || 0) +
      Number(s.sim_fancy_amt || 0) +
      Number(s.sim_postpaid_amt || 0) +
      Number(s.other_amt || 0) +
      Number(s.frc_amt || 0) +
      Number(s.mnp_amt || 0) +
      Number(s.pb_cbp_amt || 0) +
      Number(s.pb_ctop_amt || 0) +
      Number(s.pb_frc_amt || 0) +
      Number(s.pb_mnp_amt || 0) +
      Number(s.pb_other_amt || 0);

    const lifetimeCollection = salesList.reduce(
      (sum, s) => sum + calcSaleRow(s),
      0
    );
    const lifetimeDeposited = deposits
      .filter((d) => d.status !== "Discrepancy")
      .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);
    const lifetimePayable = Math.max(0, lifetimeCollection - lifetimeDeposited);

    const periodCollection = filteredSales.reduce(
      (sum, s) => sum + calcSaleRow(s),
      0
    );
    const periodDeposited = filteredDeposits
      .filter((d) => d.status !== "Discrepancy")
      .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);

    return {
      lifetimeCollection,
      lifetimeDeposited,
      lifetimePayable,
      periodCollection,
      periodDeposited,
    };
  }, [salesList, deposits, filteredSales, filteredDeposits]);

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );

  // QR & Mobile Deep-Link Engine (NPCI Compliant)
  const userEnteredValue = parseFloat(form.deposit_amount) || 0;
  const safeAmount = userEnteredValue.toFixed(2);
  const safeName = encodeURIComponent("Fast Ark");
  const rawNote = `Rolling_${partner?.center_id}`;
  const safeNote = encodeURIComponent(rawNote.substring(0, 48));
  const upiString = `upi://pay?pa=${centerUpi}&pn=${safeName}&am=${safeAmount}&cu=INR&tn=${safeNote}`;

  const isPdfPreview =
    slipImage?.type === "application/pdf" ||
    (slipImage?.name || "").toLowerCase().endsWith(".pdf");

  const numInputClass =
    "w-full border-2 border-slate-200 p-3 rounded-lg outline-none focus:border-blue-500 font-black text-slate-800 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="min-h-screen bg-slate-100 p-3 sm:p-6 md:p-8 pb-24 lg:pb-10 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-5">
        {/* HEADER */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <Link
              href="/partner/dashboard"
              className="text-blue-600 font-black text-xs uppercase tracking-widest mb-1 hover:underline inline-block"
            >
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 flex items-center gap-2.5">
              <span>💳</span> Deposit of Sales &amp; Cash Collection
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm font-bold mt-1">
              Submit bank slips with Unique UTR, Transaction ID &amp; Auto
              Reference Code.
            </p>
          </div>
          <div className="bg-blue-50 border border-blue-200 px-4 py-2.5 rounded-xl text-left md:text-right shadow-sm w-full md:w-auto">
            <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest">
              Active Center [{partner?.locations?.center_code || "CENTER"}]
            </p>
            <p className="font-black text-slate-900">
              {partner?.locations?.center_name}
            </p>
          </div>
        </div>

        {statusBanner && (
          <div
            className={`p-4 rounded-xl border-2 font-bold text-xs flex justify-between items-center shadow-sm ${
              statusBanner.type === "error"
                ? "bg-red-50 border-red-300 text-red-900"
                : statusBanner.type === "success"
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-blue-50 border-blue-300 text-blue-900"
            }`}
          >
            <span>{statusBanner.text}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="font-black text-base px-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* REQUIREMENT #4: COLLECTION DEDUCTED FROM DEPOSIT = BALANCE PAYABLE BANNER */}
        <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-xl border border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-800/90 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">
              1. Total Cash Collection
            </p>
            <p className="text-xl sm:text-2xl font-black text-white mt-1">
              ₹
              {reconciliationMetrics.lifetimeCollection.toLocaleString(
                "en-IN",
                { minimumFractionDigits: 2 }
              )}
            </p>
            <p className="text-[10px] text-slate-400 font-bold mt-1">
              Period: ₹
              {reconciliationMetrics.periodCollection.toLocaleString("en-IN")}
            </p>
          </div>

          <div className="bg-slate-800/90 p-3.5 rounded-xl border border-slate-700">
            <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">
              2. Less: Total Deposited
            </p>
            <p className="text-xl sm:text-2xl font-black text-emerald-400 mt-1">
              - ₹
              {reconciliationMetrics.lifetimeDeposited.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
              })}
            </p>
            <p className="text-[10px] text-slate-400 font-bold mt-1">
              Period: ₹
              {reconciliationMetrics.periodDeposited.toLocaleString("en-IN")}
            </p>
          </div>

          <div
            className={`p-3.5 rounded-xl border-2 ${
              reconciliationMetrics.lifetimePayable > 0
                ? "bg-red-950/80 border-red-500"
                : "bg-emerald-950/80 border-emerald-500"
            }`}
          >
            <p className="text-[10px] font-black uppercase text-amber-300 tracking-widest">
              3. Remaining Balance Payable
            </p>
            <p className="text-2xl sm:text-3xl font-black text-white mt-1">
              ₹
              {reconciliationMetrics.lifetimePayable.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
              })}
            </p>
            <p className="text-[10px] text-slate-300 font-bold mt-1">
              Total Collection - Total Deposit
            </p>
          </div>

          <div className="bg-slate-800/90 p-3.5 rounded-xl border border-slate-700 flex flex-col justify-between">
            <div>
              <p className="text-[10px] font-black uppercase text-indigo-300 tracking-widest">
                4. Next Auto Reference Code
              </p>
              <p className="font-mono font-black text-sm text-indigo-300 mt-1">
                {form.reference_code}
              </p>
            </div>
            {reconciliationMetrics.lifetimePayable > 0 && (
              <button
                type="button"
                onClick={() => {
                  setForm((prev) => ({
                    ...prev,
                    deposit_amount:
                      reconciliationMetrics.lifetimePayable.toFixed(2),
                  }));
                  setMobileTab("form");
                }}
                className="mt-2 w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-1.5 px-3 rounded-lg text-[10px] uppercase tracking-wider transition"
              >
                ⚡ Fill Payable (₹{reconciliationMetrics.lifetimePayable})
              </button>
            )}
          </div>
        </div>

        {/* MOBILE 3-TAB SWITCHER (VISIBLE ON PHONES / TABLETS < LG) */}
        <div className="lg:hidden bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => setMobileTab("form")}
            className={`py-2.5 rounded-lg font-black text-xs uppercase tracking-wider transition ${
              mobileTab === "form"
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 bg-slate-50"
            }`}
          >
            💳 1. Deposit
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("viewer")}
            className={`py-2.5 rounded-lg font-black text-xs uppercase tracking-wider transition ${
              mobileTab === "viewer"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-600 bg-slate-50"
            }`}
          >
            📄 2. Slip ({slipImage ? "1" : "0"})
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("ledger")}
            className={`py-2.5 rounded-lg font-black text-xs uppercase tracking-wider transition ${
              mobileTab === "ledger"
                ? "bg-emerald-600 text-white shadow"
                : "text-slate-600 bg-slate-50"
            }`}
          >
            📖 3. Ledger ({filteredDeposits.length})
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* LEFT: SUBMISSION FORM (Responsive on Mobile, Sticky on Desktop) */}
          <div
            className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto ${
              mobileTab === "form" ? "block" : "hidden lg:block"
            }`}
          >
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-5">
              <h2 className="font-black text-base sm:text-lg text-slate-800">
                Record New Remittance
              </h2>
              <span className="font-mono text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 rounded">
                {form.reference_code}
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* SLIP FORMAT SELECTOR */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                  Receipt Format Preset
                </label>
                <select
                  value={slipTypePreset}
                  onChange={(e) => setSlipTypePreset(e.target.value)}
                  className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none focus:border-blue-500 font-bold text-xs bg-slate-50 text-slate-700"
                >
                  <option value="auto">⚡ Auto-Detect Receipt Format</option>
                  <option value="gpay">Google Pay (UPI)</option>
                  <option value="phonepe">PhonePe (UPI)</option>
                  <option value="paytm">Paytm (UPI)</option>
                  <option value="cash_slip">Bank Branch Cash Slip</option>
                  <option value="neft_imps">NEFT / RTGS / IMPS Receipt</option>
                </select>
              </div>

              {/* SLIP UPLOAD & EXEMPTION */}
              <div className="space-y-3 pt-1 border-t border-slate-100">
                <label className="flex items-center gap-3 cursor-pointer bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    className="w-5 h-5 accent-amber-600"
                    checked={isExempted}
                    onChange={(e) => {
                      setIsExempted(e.target.checked);
                      setSlipImage(null);
                      setImagePreview(null);
                      setOcrRawAmount(null);
                      setOcrRawRef(null);
                      setOcrRawTxnId(null);
                      setOcrRawDate(null);
                      setDetectedPlatform(null);
                      setIsUserVerified(false);
                      setExemptionCategory("");
                      setOtherExemptionText("");
                      setRightPanel("ledger");
                    }}
                  />
                  <span className="font-bold text-xs text-slate-700">
                    No deposit slip available (Request Exemption)
                  </span>
                </label>

                {!isExempted ? (
                  <div className="border-2 border-dashed border-blue-300 rounded-xl p-5 text-center bg-blue-50/40 relative transition-all hover:bg-blue-50">
                    <input
                      type="file"
                      accept="image/*,application/pdf,.pdf"
                      onChange={handleImageUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    {!imagePreview ? (
                      <div>
                        <div className="text-3xl mb-1">📸</div>
                        <p className="font-black text-slate-800 text-sm">
                          Upload Slip or Screenshot
                        </p>
                        <p className="text-[11px] font-bold text-slate-500 mt-1">
                          GPay, PhonePe, Paytm, or Bank Cash Receipt (Image /
                          PDF)
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <div className="text-3xl mb-1">✅</div>
                        <p className="font-black text-emerald-700 text-xs truncate max-w-full">
                          {slipImage?.name || "Document Attached"}
                        </p>
                        <p className="text-[10px] font-bold text-blue-600 bg-blue-100 px-3 py-1 rounded-full mt-2">
                          Tap to change file
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="animate-in fade-in bg-amber-50 p-4 rounded-xl border border-amber-200 space-y-3">
                    <div>
                      <label className="text-[9px] text-amber-800 font-black uppercase tracking-widest block mb-1">
                        Reason for Missing Slip *
                      </label>
                      <select
                        required
                        value={exemptionCategory}
                        onChange={(e) => {
                          setExemptionCategory(e.target.value);
                          setOtherExemptionText("");
                        }}
                        className="w-full bg-white border-2 border-amber-200 text-slate-800 font-bold text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
                      >
                        <option value="" disabled>
                          -- Select Reason --
                        </option>
                        <option value="Missing">Missing / Lost Slip</option>
                        <option value="Not downloaded">
                          Not Downloaded / App Error
                        </option>
                        <option value="Other">Other (Specify Below)</option>
                      </select>
                    </div>

                    {exemptionCategory === "Other" && (
                      <div>
                        <label className="text-[9px] text-amber-800 font-black uppercase tracking-widest block mb-1">
                          Detailed Reason *
                        </label>
                        <input
                          required
                          type="text"
                          placeholder="TYPE REASON HERE..."
                          value={otherExemptionText}
                          onChange={(e) =>
                            setOtherExemptionText(e.target.value.toUpperCase())
                          }
                          className="w-full bg-white border-2 border-amber-200 text-slate-800 font-black uppercase tracking-wider text-xs rounded-lg p-2.5 outline-none focus:border-amber-500"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* OCR PROGRESS */}
              {isScanning && !isExempted && (
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-200 text-center space-y-2">
                  <div className="flex items-center justify-center gap-2 text-blue-700 font-black text-xs uppercase tracking-wider">
                    <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    Pre-processing &amp; Scanning Slip ({scanProgress}%)
                  </div>
                  <div className="w-full bg-blue-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-200"
                      style={{ width: `${scanProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* OCR EXTRACTION SUMMARY & MANDATORY VERIFICATION GATE */}
              {!isScanning && !isExempted && slipImage && detectedPlatform && (
                <div className="bg-slate-900 text-white rounded-xl p-4 space-y-3 border-2 border-slate-800">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                      Enhanced OCR Capture
                    </span>
                    <span className="text-[10px] font-black bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded border border-blue-700">
                      {detectedPlatform}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-800/80 p-2 rounded">
                      <p className="text-[9px] text-slate-400 uppercase">
                        Scanned Amount
                      </p>
                      <p className="font-bold text-emerald-400">
                        {ocrRawAmount
                          ? `₹${ocrRawAmount.toLocaleString("en-IN")}`
                          : "Verify Below"}
                      </p>
                    </div>
                    <div className="bg-slate-800/80 p-2 rounded">
                      <p className="text-[9px] text-slate-400 uppercase">
                        Scanned Date
                      </p>
                      <p className="font-bold text-slate-200">
                        {ocrRawDate
                          ? formatToDDMMYYYY(ocrRawDate)
                          : "Verify Below"}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-800/80 p-2 rounded text-xs">
                    <p className="text-[9px] text-slate-400 uppercase">
                      Scanned UTR / Txn ID
                    </p>
                    <p className="font-bold text-slate-200 tracking-wider truncate">
                      {ocrRawRef || ocrRawTxnId || "Verify Manually Below"}
                    </p>
                  </div>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-blue-950/70 border border-blue-700/80 cursor-pointer hover:bg-blue-950 transition">
                    <input
                      type="checkbox"
                      required
                      checked={isUserVerified}
                      onChange={(e) => setIsUserVerified(e.target.checked)}
                      className="w-5 h-5 accent-blue-500 mt-0.5 cursor-pointer shrink-0"
                    />
                    <span className="text-xs font-bold text-blue-200 leading-tight">
                      I have cross-checked the Amount, Date, Unique UTR, and
                      Transaction ID against the uploaded receipt.
                    </span>
                  </label>
                </div>
              )}

              {/* INPUT FIELDS: AMOUNT, DATE, METHOD & 3 IDENTIFIERS */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                  1. Deposit Amount (₹) *
                </label>
                <input
                  required
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={form.deposit_amount}
                  onChange={(e) =>
                    setForm({ ...form, deposit_amount: e.target.value })
                  }
                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                  className={numInputClass}
                  placeholder="0.00"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                    2. Deposit Date *
                  </label>
                  <input
                    required
                    type="date"
                    max={getISTDateString(0)}
                    value={form.deposit_date}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        deposit_date: e.target.value,
                        reference_code: generateSystemReferenceCode(
                          "FA-DEP",
                          e.target.value
                        ),
                      })
                    }
                    className="w-full border-2 border-slate-200 p-3 rounded-lg outline-none focus:border-blue-500 font-bold text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                    3. Deposit Method *
                  </label>
                  <select
                    required
                    value={form.deposit_method}
                    onChange={(e) =>
                      setForm({ ...form, deposit_method: e.target.value })
                    }
                    className="w-full border-2 border-slate-200 p-3 rounded-lg outline-none focus:border-blue-500 font-bold text-xs bg-white"
                  >
                    <option value="UPI">UPI</option>
                    <option value="NEFT/RTGS">NEFT/RTGS</option>
                    <option value="IMPS">IMPS</option>
                    <option value="Cash Deposit">Bank Cash Deposit</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-blue-700 uppercase tracking-widest block mb-1.5">
                  4. Unique UTR Number (12-Digit UPI / Bank RRN) *
                </label>
                <input
                  required
                  type="text"
                  value={form.utr_number}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      utr_number: e.target.value.toUpperCase(),
                    })
                  }
                  className="w-full border-2 border-blue-200 bg-blue-50/30 p-3 rounded-lg outline-none focus:border-blue-600 font-black text-xs uppercase tracking-wider"
                  placeholder="e.g. 412345678901"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
                    5. Transaction / Journal ID *
                  </label>
                  <input
                    required
                    type="text"
                    value={form.transaction_id}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        transaction_id: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none focus:border-blue-500 font-bold text-xs uppercase"
                    placeholder="Txn / Scroll / Challan ID"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1.5">
                    6. Reference Code (Auto)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.reference_code}
                    className="w-full border-2 border-indigo-200 bg-indigo-50 p-2.5 rounded-lg font-mono font-black text-xs text-indigo-900 cursor-not-allowed"
                  />
                </div>
              </div>

              {/* QR CODE GENERATOR + MOBILE TAP-TO-PAY DEEP LINK */}
              {form.deposit_method === "UPI" && userEnteredValue > 0 && (
                <div className="bg-slate-900 rounded-xl p-5 text-center border-2 border-slate-800 shadow-inner flex flex-col items-center animate-in fade-in mt-2">
                  <p className="text-blue-400 font-black uppercase tracking-widest text-xs mb-3">
                    Scan or Tap to Pay via UPI
                  </p>
                  <div className="bg-white p-3 rounded-xl shadow-lg mb-3">
                    <QRCodeSVG value={upiString} size={145} level="M" />
                  </div>
                  <p className="text-white font-bold text-sm">
                    Fast Ark Pvt Ltd
                  </p>
                  <p className="text-slate-400 text-[10px] uppercase tracking-widest mt-0.5">
                    Routing to: {centerUpi}
                  </p>
                  <p className="text-emerald-400 font-black text-lg mt-1">
                    ₹
                    {userEnteredValue.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                  <a
                    href={upiString}
                    className="mt-3 w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[11px] uppercase tracking-widest rounded-lg shadow-md transition flex items-center justify-center gap-2"
                  >
                    <span>📲</span> Tap to Pay via UPI App (GPay / PhonePe)
                  </a>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  isScanning ||
                  (!isExempted && slipImage !== null && !isUserVerified)
                }
                className="w-full bg-slate-900 hover:bg-blue-600 text-white font-black py-4 rounded-xl shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed tracking-widest uppercase text-xs"
              >
                {isSubmitting
                  ? "Submitting to Ledger..."
                  : !isExempted && slipImage && !isUserVerified
                  ? "Check Verification Box Above"
                  : `Submit Remittance (${form.reference_code})`}
              </button>
            </form>
          </div>

          {/* RIGHT: DYNAMIC SPLIT PANE (Viewer OR Filtered Ledger) */}
          <div
            className={`lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] ${
              mobileTab === "viewer" || mobileTab === "ledger"
                ? "block"
                : "hidden lg:flex"
            }`}
          >
            {/* DYNAMIC HEADER TABS + WEEK / MONTH / CUSTOM FILTER BAR */}
            <div className="p-4 bg-slate-900 border-b border-slate-800 text-white rounded-t-2xl space-y-3 shrink-0">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <h3 className="font-black tracking-widest uppercase text-xs sm:text-sm">
                    Remittance Verification &amp; Ledger History
                  </h3>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                    Filter by Week / Month / Custom Date Range ({filteredDeposits.length}{" "}
                    Records)
                  </p>
                </div>
                <div className="hidden lg:flex bg-slate-800 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setRightPanel("viewer")}
                    className={`px-4 py-2 rounded text-xs font-black uppercase tracking-widest transition ${
                      rightPanel === "viewer"
                        ? "bg-blue-600 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    📄 Document Viewer
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPanel("ledger")}
                    className={`px-4 py-2 rounded text-xs font-black uppercase tracking-widest transition ${
                      rightPanel === "ledger"
                        ? "bg-blue-600 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    📖 Ledger History ({filteredDeposits.length})
                  </button>
                </div>
              </div>

              {/* REQUIREMENT #3: WEEK / MONTH / CUSTOM FILTER BAR FOR PARTNER DEPOSITS */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs">
                <div>
                  <label className="text-[9px] font-black uppercase text-indigo-400 block mb-1">
                    Period Filter (Week / Month / Custom)
                  </label>
                  <select
                    value={datePreset}
                    onChange={(e) =>
                      handlePresetChange(e.target.value as DatePresetMode)
                    }
                    className="w-full bg-slate-800 border border-slate-700 text-white font-black text-xs p-2 rounded-lg outline-none"
                  >
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="current_week">Current Week</option>
                    <option value="current_month">Current Month</option>
                    <option value="previous_month">Previous Month</option>
                    <option value="all">All Time</option>
                    <option value="custom">Custom Range</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">
                    From ({formatToDDMMYYYY(filterFromDate)})
                  </label>
                  <input
                    type="date"
                    value={filterFromDate}
                    onChange={(e) => {
                      setDatePreset("custom");
                      setFilterFromDate(e.target.value);
                    }}
                    className="w-full bg-slate-800 border border-slate-700 text-white font-bold text-xs p-2 rounded-lg outline-none"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">
                    To ({formatToDDMMYYYY(filterToDate)})
                  </label>
                  <input
                    type="date"
                    value={filterToDate}
                    onChange={(e) => {
                      setDatePreset("custom");
                      setFilterToDate(e.target.value);
                    }}
                    className="w-full bg-slate-800 border border-slate-700 text-white font-bold text-xs p-2 rounded-lg outline-none"
                  />
                </div>
              </div>
            </div>

            {/* PANEL CONTENT AREA */}
            <div className="flex-1 overflow-y-auto bg-slate-50">
              {rightPanel === "viewer" || mobileTab === "viewer" ? (
                <div className="p-5 flex flex-col items-center justify-start min-h-full">
                  {imagePreview ? (
                    <div className="w-full flex flex-col items-center space-y-3">
                      <div className="w-full flex justify-between items-center bg-slate-900 text-white px-4 py-2.5 rounded-lg">
                        <span className="text-xs font-black truncate">
                          {slipImage?.name || "Uploaded Receipt"}
                        </span>
                        <a
                          href={imagePreview}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded shadow shrink-0"
                        >
                          Open Full Screen ↗
                        </a>
                      </div>

                      {isPdfPreview ? (
                        <iframe
                          src={`${imagePreview}#toolbar=0`}
                          className="w-full h-[500px] rounded-xl shadow-lg border border-slate-300 bg-white"
                          title="PDF Receipt Preview"
                        />
                      ) : (
                        <img
                          src={imagePreview}
                          alt="High Resolution Slip"
                          className="w-full max-w-3xl h-auto object-contain shadow-lg rounded-xl border border-slate-200 bg-white"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-400 h-64">
                      <span className="text-5xl mb-4 opacity-50">📄</span>
                      <p className="font-black tracking-widest uppercase text-sm">
                        No Document Uploaded
                      </p>
                      <p className="text-xs font-bold mt-2 text-slate-500">
                        Upload an image or PDF slip to inspect it here.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* MOBILE CARD FEED (VISIBLE ON PHONES < MD) */}
                  <div className="md:hidden divide-y divide-slate-200">
                    {filteredDeposits.length === 0 ? (
                      <div className="p-10 text-center text-slate-400 font-bold bg-white">
                        No remittance records found in this date filter.
                      </div>
                    ) : (
                      filteredDeposits.map((dep) => {
                        const cleanUtr =
                          dep.utr_number || dep.reference_no || "N/A";
                        const cleanTxn = dep.transaction_id || cleanUtr;
                        const refCode =
                          dep.reference_code ||
                          `FA-DEP-${String(dep.id || "")
                            .slice(0, 6)
                            .toUpperCase()}`;

                        return (
                          <div
                            key={dep.id}
                            className="p-4 bg-white space-y-2.5"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="font-mono text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded">
                                  {refCode}
                                </span>
                                <p className="font-black text-slate-900 text-sm mt-1">
                                  {formatToDDMMYYYY(
                                    (
                                      dep.deposit_date ||
                                      dep.created_at ||
                                      ""
                                    ).split("T")[0]
                                  )}
                                </p>
                              </div>
                              <div className="text-right">
                                <p
                                  className={`text-lg font-black ${
                                    dep.status === "Discrepancy"
                                      ? "text-slate-400 line-through"
                                      : "text-emerald-700"
                                  }`}
                                >
                                  ₹
                                  {Number(dep.deposit_amount).toLocaleString(
                                    "en-IN"
                                  )}
                                </p>
                                <span
                                  className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border inline-block mt-1 ${
                                    dep.status === "Verified"
                                      ? "bg-green-100 text-green-700 border-green-200"
                                      : dep.status === "Discrepancy"
                                      ? "bg-red-100 text-red-700 border-red-200"
                                      : "bg-amber-100 text-amber-700 border-amber-200"
                                  }`}
                                >
                                  {dep.status}
                                </span>
                              </div>
                            </div>

                            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-slate-400 font-bold">
                                  Method:
                                </span>
                                <span className="font-black text-blue-600">
                                  {dep.deposit_method}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400 font-bold">
                                  Unique UTR:
                                </span>
                                <span className="font-black text-slate-800">
                                  {cleanUtr}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400 font-bold">
                                  Txn ID:
                                </span>
                                <span className="font-bold text-slate-600">
                                  {cleanTxn}
                                </span>
                              </div>
                            </div>

                            <div className="flex justify-between items-center pt-1">
                              {dep.deposit_slip_url ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleViewSecureSlip(dep.deposit_slip_url)
                                  }
                                  className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200"
                                >
                                  📎 View Slip
                                </button>
                              ) : (
                                <span className="text-[10px] font-bold text-amber-600 uppercase">
                                  ⚠️ Exempted
                                </span>
                              )}

                              {(dep.status === "Pending" ||
                                dep.status === "Pending Verification") && (
                                <button
                                  type="button"
                                  onClick={() => startEditing(dep)}
                                  className="text-xs font-black text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200"
                                >
                                  ✏️ Edit
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* DESKTOP TABLE (VISIBLE ON MD+ SCREENS) */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="bg-slate-100 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="p-3.5 font-black text-center">
                            Match ✅
                          </th>
                          <th className="p-3.5 font-black">
                            Date &amp; Ref Code
                          </th>
                          <th className="p-3.5 font-black text-right">
                            Amount (₹)
                          </th>
                          <th className="p-3.5 font-black">
                            Method, Unique UTR &amp; Txn ID
                          </th>
                          <th className="p-3.5 font-black text-center">
                            Scan Proof
                          </th>
                          <th className="p-3.5 font-black text-center">
                            Status
                          </th>
                          <th className="p-3.5 font-black text-right">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {filteredDeposits.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="p-12 text-center text-slate-400 font-bold bg-white"
                            >
                              No remittance records found in this date range.
                            </td>
                          </tr>
                        ) : (
                          filteredDeposits.map((dep) => {
                            const isEditing = editingId === dep.id;
                            const isMatched = matchedRows.has(dep.id);
                            const cleanUtr =
                              dep.utr_number || dep.reference_no || "N/A";
                            const cleanTxn = dep.transaction_id || cleanUtr;
                            const refCode =
                              dep.reference_code ||
                              `FA-DEP-${String(dep.id || "")
                                .slice(0, 6)
                                .toUpperCase()}`;

                            return (
                              <tr
                                key={dep.id}
                                className={`transition bg-white ${
                                  isEditing
                                    ? "bg-amber-50/30"
                                    : isMatched
                                    ? "bg-green-50/50"
                                    : "hover:bg-slate-50"
                                }`}
                              >
                                <td className="p-3.5 text-center border-r border-slate-100">
                                  <input
                                    type="checkbox"
                                    checked={isMatched}
                                    onChange={() => toggleMatch(dep.id)}
                                    className="w-4 h-4 accent-green-600 cursor-pointer rounded"
                                  />
                                </td>

                                <td className="p-3.5">
                                  <p
                                    className={`font-black ${
                                      isMatched
                                        ? "text-green-800"
                                        : "text-slate-900"
                                    }`}
                                  >
                                    {formatToDDMMYYYY(
                                      (
                                        dep.deposit_date ||
                                        dep.created_at ||
                                        ""
                                      ).split("T")[0]
                                    )}
                                  </p>
                                  <span className="font-mono text-[10px] font-black text-indigo-700">
                                    {refCode}
                                  </span>
                                </td>

                                <td className="p-3.5 text-right">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={editForm.deposit_amount}
                                      onChange={(e) =>
                                        setEditForm({
                                          ...editForm,
                                          deposit_amount: e.target.value,
                                        })
                                      }
                                      onWheel={(e) =>
                                        (e.target as HTMLInputElement).blur()
                                      }
                                      className="w-24 border border-amber-300 p-1.5 rounded outline-none font-black text-right text-xs bg-white"
                                    />
                                  ) : (
                                    <p
                                      className={`text-base font-black ${
                                        dep.status === "Discrepancy"
                                          ? "text-slate-400 line-through"
                                          : "text-slate-800"
                                      }`}
                                    >
                                      ₹
                                      {Number(
                                        dep.deposit_amount
                                      ).toLocaleString("en-IN")}
                                    </p>
                                  )}
                                </td>

                                <td className="p-3.5">
                                  {isEditing ? (
                                    <div className="flex flex-col gap-1">
                                      <select
                                        value={editForm.deposit_method}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            deposit_method: e.target.value,
                                          })
                                        }
                                        className="border border-amber-300 p-1 rounded outline-none font-bold text-[10px] uppercase bg-white"
                                      >
                                        <option value="UPI">UPI</option>
                                        <option value="NEFT/RTGS">
                                          NEFT/RTGS
                                        </option>
                                        <option value="IMPS">IMPS</option>
                                        <option value="Cash Deposit">
                                          Cash Deposit
                                        </option>
                                        <option value="Cheque">Cheque</option>
                                      </select>
                                      <input
                                        type="text"
                                        placeholder="Unique UTR"
                                        value={editForm.utr_number}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            utr_number: e.target.value,
                                          })
                                        }
                                        className="border border-amber-300 p-1 rounded outline-none font-bold text-xs bg-white"
                                      />
                                      <input
                                        type="text"
                                        placeholder="Transaction ID"
                                        value={editForm.transaction_id}
                                        onChange={(e) =>
                                          setEditForm({
                                            ...editForm,
                                            transaction_id: e.target.value,
                                          })
                                        }
                                        className="border border-amber-300 p-1 rounded outline-none font-bold text-xs bg-white"
                                      />
                                    </div>
                                  ) : (
                                    <>
                                      <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                                        {dep.deposit_method}
                                      </p>
                                      <p className="text-xs font-black text-slate-900 tracking-wider mt-0.5">
                                        UTR: {cleanUtr}
                                      </p>
                                      <p className="text-[10px] font-bold text-slate-500">
                                        Txn: {cleanTxn}
                                      </p>
                                    </>
                                  )}
                                </td>

                                <td className="p-3.5 text-center">
                                  {dep.is_exempted ? (
                                    <div
                                      className="flex flex-col items-center cursor-help"
                                      title={dep.exemption_reason}
                                    >
                                      <span className="text-lg">⚠️</span>
                                      <p className="text-[9px] text-amber-600 font-black uppercase mt-0.5">
                                        Exempted
                                      </p>
                                    </div>
                                  ) : dep.deposit_slip_url ? (
                                    <button
                                      onClick={() =>
                                        handleViewSecureSlip(
                                          dep.deposit_slip_url
                                        )
                                      }
                                      type="button"
                                      className="inline-flex flex-col items-center hover:opacity-70 transition"
                                    >
                                      <span className="text-lg">📎</span>
                                      <p className="text-[9px] text-blue-600 font-black uppercase mt-0.5">
                                        View Slip
                                      </p>
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-bold uppercase">
                                      N/A
                                    </span>
                                  )}
                                </td>

                                <td className="p-3.5 text-center">
                                  <span
                                    className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${
                                      dep.status === "Verified"
                                        ? "bg-green-100 text-green-700 border-green-200"
                                        : dep.status === "Discrepancy"
                                        ? "bg-red-100 text-red-700 border-red-200"
                                        : "bg-amber-100 text-amber-700 border-amber-200"
                                    }`}
                                  >
                                    {dep.status}
                                  </span>
                                  {dep.status === "Discrepancy" &&
                                    dep.rejection_reason && (
                                      <p
                                        className="text-[9px] text-red-600 font-bold mt-1 truncate max-w-[100px]"
                                        title={dep.rejection_reason}
                                      >
                                        {dep.rejection_reason}
                                      </p>
                                    )}
                                </td>

                                <td className="p-3.5 text-right">
                                  {dep.status === "Pending" ||
                                  dep.status === "Pending Verification" ? (
                                    isEditing ? (
                                      <div className="flex gap-1 justify-end">
                                        <button
                                          onClick={() =>
                                            handleEditSubmit(dep.id)
                                          }
                                          disabled={isSubmitting}
                                          className="bg-green-500 hover:bg-green-600 text-white font-black px-2 py-1 rounded text-[10px] uppercase shadow-sm"
                                        >
                                          Save
                                        </button>
                                        <button
                                          onClick={() => setEditingId(null)}
                                          className="bg-slate-300 hover:bg-slate-400 text-slate-800 font-black px-2 py-1 rounded text-[10px] uppercase shadow-sm"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => startEditing(dep)}
                                        className="bg-white hover:bg-amber-50 text-amber-600 border border-amber-200 hover:border-amber-400 font-black px-3 py-1.5 rounded text-[10px] uppercase tracking-widest shadow-sm transition"
                                      >
                                        ✏️ Edit
                                      </button>
                                    )
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-bold uppercase">
                                      Locked
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}