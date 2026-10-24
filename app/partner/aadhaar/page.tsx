"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { QRCodeSVG } from "qrcode.react";
import Tesseract from "tesseract.js";
import AadhaarSidebar, { AadhaarMenuTab } from "../../components/aadhaar/AadhaarSidebar";
import {
  DatePresetMode,
  getDateRangeFromPreset,
  formatToDDMMYYYY,
  getISTDateString,
  parseAndValidateDualFiles,
  syncAadhaarLatePenalties,
  downloadAadhaarCSVReport,
  downloadAadhaarPDFReport,
} from "../../lib/aadhaarEngine";

export default function PartnerAadhaarPortal() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeMenu, setActiveMenu] = useState<AadhaarMenuTab>("overview");
  const [statusBanner, setStatusBanner] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Core Data States
  const [partner, setPartner] = useState<any>(null);
  const [latestUpgradeReq, setLatestUpgradeReq] = useState<any | null>(null);
  const [activeTariff, setActiveTariff] = useState<any>(null);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<any[]>([]);
  const [penalties, setPenalties] = useState<any[]>([]);
  const [centerUpi, setCenterUpi] = useState<string>("fastark@upi");

  // Daily Upload States (Menu 2)
  const [reportDate, setReportDate] = useState<string>(getISTDateString(0));
  const [isManualMode, setIsManualMode] = useState<boolean>(false);
  const [exemptionReason, setExemptionReason] = useState<string>("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [htmlFile, setHtmlFile] = useState<File | null>(null);
  const [parsedPreview, setParsedPreview] = useState<any | null>(null);
  const [parseError, setParseError] = useState<string>("");
  const [manualCounts, setManualCounts] = useState({ cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0 });
  const [confirmDailyCheck, setConfirmDailyCheck] = useState<boolean>(false);
  const [isSubmittingDaily, setIsSubmittingDaily] = useState<boolean>(false);

  // Instant Deposit & OCR Viewer States (Menu 3)
  const [depositForm, setDepositForm] = useState({
    amount: "",
    method: "UPI",
    utr: "",
    date: getISTDateString(0),
  });
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState<string | null>(null);
  const [isScanningSlip, setIsScanningSlip] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [ocrSummary, setOcrSummary] = useState<{
    platform: string | null;
    amount: number | null;
    utr: string | null;
  }>({ platform: null, amount: null, utr: null });
  const [confirmDepositCheck, setConfirmDepositCheck] = useState<boolean>(false);
  const [isSubmittingDeposit, setIsSubmittingDeposit] = useState<boolean>(false);

  // Weekly Reconciliation States (Menu 4)
  const [weekStart, setWeekStart] = useState<string>(getISTDateString(-5));
  const [weekEnd, setWeekEnd] = useState<string>(getISTDateString(0));
  const [weekCsv, setWeekCsv] = useState<File | null>(null);
  const [weekHtml, setWeekHtml] = useState<File | null>(null);
  const [weeklyPreview, setWeeklyPreview] = useState<any | null>(null);
  const [weeklyError, setWeeklyError] = useState<string>("");
  const [confirmWeeklyCheck, setConfirmWeeklyCheck] = useState<boolean>(false);
  const [isSubmittingWeekly, setIsSubmittingWeekly] = useState<boolean>(false);

  // 7-Option Date Preset + History & Download Filters (Global & Menu 5)
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [filterFromDate, setFilterFromDate] = useState<string>(() => getDateRangeFromPreset("current_month").start);
  const [filterToDate, setFilterToDate] = useState<string>(() => getDateRangeFromPreset("current_month").end);
  const [fileModeFilter, setFileModeFilter] = useState<"ALL" | "WITH_FILES" | "WITHOUT_FILES">("ALL");

  // Existing Partner Upgrade Form (Menu 6)
  const [upgradeForm, setUpgradeForm] = useState({ operator_id: "", station_id: "", nseit_no: "" });
  const [upgradePdf, setUpgradePdf] = useState<File | null>(null);
  const [isSubmittingUpgrade, setIsSubmittingUpgrade] = useState(false);

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

  useEffect(() => {
    initializeAadhaarPortal();
    return () => {
      if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
    };
  }, []);

  const initializeAadhaarPortal = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/partner/login");

      const { data: pData } = await supabase
        .from("active_partners")
        .select("*, locations(*)")
        .ilike("email", session.user.email || "")
        .maybeSingle();

      if (!pData) return router.push("/partner/login");
      setPartner(pData);

      // Fetch latest Upgrade Request status for this partner
      const { data: upgData } = await supabase
        .from("partner_upgrade_requests")
        .select("*")
        .eq("partner_id", pData.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setLatestUpgradeReq(upgData || null);

      if (pData.aadhaar_operator_id || pData.aadhaar_station_id) {
        setUpgradeForm((prev) => ({
          ...prev,
          operator_id: pData.aadhaar_operator_id || "",
          station_id: pData.aadhaar_station_id || "",
        }));
      } else if (upgData) {
        setUpgradeForm({
          operator_id: upgData.requested_operator_id || "",
          station_id: upgData.requested_station_id || "",
          nseit_no: upgData.nseit_cert_no || "",
        });
      }

      // STRICT AUTHORIZATION GATE CHECK:
      // Partner must have role_aadhaar = true, mapped Operator ID & Station ID, AND their Center must have role_aadhaar = true
      const authorized = Boolean(
        pData.role_aadhaar &&
          pData.aadhaar_operator_id &&
          pData.aadhaar_station_id &&
          pData.locations?.role_aadhaar
      );

      if (!authorized) {
        setActiveMenu("upgrade");
        setLoading(false);
        return;
      }

      // Sync ₹100/day late payment penalties for any unsettled past reports
      await syncAadhaarLatePenalties(supabase, pData.id);

      const [tariffRes, dailyRes, weeklyRes, penaltyRes, upiRes] = await Promise.all([
        supabase
          .from("aadhaar_tariff_history")
          .select("*")
          .lte("effective_from", reportDate)
          .or(`effective_to.is.null,effective_to.gte.${reportDate}`)
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("aadhaar_daily_reports")
          .select("*")
          .eq("partner_id", pData.id)
          .order("report_date", { ascending: false }),
        supabase
          .from("aadhaar_weekly_reports")
          .select("*")
          .eq("partner_id", pData.id)
          .order("end_date", { ascending: false }),
        supabase
          .from("aadhaar_penalty_logs")
          .select("*")
          .eq("partner_id", pData.id)
          .eq("is_settled", false),
        pData.center_id
          ? supabase
              .from("upi_ids")
              .select("upi_id")
              .eq("assigned_location_id", pData.center_id)
              .eq("is_active", true)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      setActiveTariff(
        tariffRes.data || {
          new_enrolment_fee: 0,
          mbu_free_fee: 0,
          mbu_chargeable_fee: 125,
          demographic_fee: 75,
          biometric_fee: 125,
          demo_min_threshold: 50,
          demo_max_threshold: 100,
          bio_min_threshold: 100,
          gst_percent: 18,
          daily_late_penalty: 100,
        }
      );

      const dList = dailyRes.data || [];
      const pList = penaltyRes.data || [];
      setDailyReports(dList);
      setWeeklyReports(weeklyRes.data || []);
      setPenalties(pList);
      if (upiRes.data?.upi_id) setCenterUpi(upiRes.data.upi_id);

      // Pre-fill Instant Deposit amount with Pending Cash + Unpaid Penalties
      const pendingCash = dList
        .filter((r: any) => r.deposit_status === "Pending Deposit")
        .reduce((sum: number, r: any) => sum + Number(r.total_cash_collected || 0), 0);
      const penSum = pList.reduce((sum: number, p: any) => sum + Number(p.penalty_amount || 0), 0);
      if (pendingCash + penSum > 0) {
        setDepositForm((prev) => ({ ...prev, amount: (pendingCash + penSum).toFixed(2) }));
      }
    } catch (err: any) {
      console.error("Aadhaar Init Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // Strict Authorization Boolean
  const isAadhaarAuthorized = Boolean(
    partner?.role_aadhaar &&
      partner?.aadhaar_operator_id &&
      partner?.aadhaar_station_id &&
      partner?.locations?.role_aadhaar
  );

  // Fetch date-specific UIDAI Tariff whenever Report Date changes
  useEffect(() => {
    const loadTariffForDate = async () => {
      if (!reportDate || !isAadhaarAuthorized) return;
      const { data } = await supabase
        .from("aadhaar_tariff_history")
        .select("*")
        .lte("effective_from", reportDate)
        .or(`effective_to.is.null,effective_to.gte.${reportDate}`)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setActiveTariff(data);
    };
    loadTariffForDate();
  }, [reportDate, isAadhaarAuthorized]);

  // Auto-trigger Dual File Validation when both CSV and HTML are selected
  useEffect(() => {
    const runDualValidation = async () => {
      if (!csvFile || !htmlFile || isManualMode || !isAadhaarAuthorized) return;
      setParseError("");
      setParsedPreview(null);
      setConfirmDailyCheck(false);

      try {
        const result = await parseAndValidateDualFiles(
          csvFile,
          htmlFile,
          "DAILY",
          { reportDate },
          partner?.aadhaar_operator_id || "",
          partner?.aadhaar_station_id || "",
          activeTariff
        );
        setParsedPreview(result);
      } catch (err: any) {
        setParseError(err.message);
      }
    };
    runDualValidation();
  }, [csvFile, htmlFile, reportDate, isManualMode, isAadhaarAuthorized]);

  // Calculate Manual Fallback Totals using Date-Locked Tariff
  const isZeroExemption = isManualMode && exemptionReason !== "" && exemptionReason !== "ECMP_CRASH_MANUAL";
  const manualCashTotal = isZeroExemption
    ? 0
    : manualCounts.cat3 * Number(activeTariff?.mbu_chargeable_fee || 125) +
      manualCounts.cat4 * Number(activeTariff?.demographic_fee || 75) +
      manualCounts.cat5 * Number(activeTariff?.biometric_fee || 125);
  const manualBaseTotal = Number((manualCashTotal / (1 + Number(activeTariff?.gst_percent || 18) / 100)).toFixed(2));
  const manualGstTotal = Number((manualCashTotal - manualBaseTotal).toFixed(2));

  // --- SUBMIT DAILY REPORT & AUTO-UNLOCK DEPOSIT ---
  const handleDailySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAadhaarAuthorized) {
      showBanner(
        "error",
        "Access Denied: Your Aadhaar credentials and Center mapping must be approved by Corporate Admin before uploading reports."
      );
      setActiveMenu("upgrade");
      return;
    }
    if (!confirmDailyCheck) {
      return showBanner("error", "Please check the mandatory confirmation box before submitting.");
    }

    const existing = dailyReports.find((r) => r.report_date === reportDate);
    if (existing) {
      return showBanner(
        "error",
        `Duplicate Blocked: A Daily Report for ${formatToDDMMYYYY(reportDate)} has already been submitted.`
      );
    }

    setIsSubmittingDaily(true);
    setStatusBanner(null);
    try {
      let csvPath = null;
      let htmlPath = null;

      if (!isManualMode) {
        if (!csvFile || !htmlFile || !parsedPreview) {
          throw new Error("Both matching CSV and HTML files are mandatory.");
        }
        const safeOp = (partner.aadhaar_operator_id || "OP").replace(/[^a-zA-Z0-9]/g, "_");
        csvPath = `DAILY_${safeOp}_${reportDate}_${Date.now()}.csv`;
        htmlPath = `DAILY_${safeOp}_${reportDate}_${Date.now()}.html`;

        const [up1, up2] = await Promise.all([
          supabase.storage.from("aadhaar-reports").upload(csvPath, csvFile),
          supabase.storage.from("aadhaar-reports").upload(htmlPath, htmlFile),
        ]);
        if (up1.error) throw up1.error;
        if (up2.error) throw up2.error;
      } else {
        if (!exemptionReason) throw new Error("Please select a valid reason from the dropdown.");
      }

      const finalCash = isManualMode ? manualCashTotal : parsedPreview.total_cash_collected;
      const payload = {
        partner_id: partner.id,
        center_id: partner.center_id,
        report_date: reportDate,
        operator_id: isManualMode ? partner.aadhaar_operator_id : parsedPreview.operator_id,
        station_id: isManualMode ? partner.aadhaar_station_id : parsedPreview.station_id,
        cat1_new_qty: isManualMode ? (isZeroExemption ? 0 : manualCounts.cat1) : parsedPreview.cat1_new_qty,
        cat2_mbu_free_qty: isManualMode ? (isZeroExemption ? 0 : manualCounts.cat2) : parsedPreview.cat2_mbu_free_qty,
        cat3_mbu_chargeable_qty: isManualMode
          ? isZeroExemption
            ? 0
            : manualCounts.cat3
          : parsedPreview.cat3_mbu_chargeable_qty,
        cat4_demographic_qty: isManualMode ? (isZeroExemption ? 0 : manualCounts.cat4) : parsedPreview.cat4_demographic_qty,
        cat5_biometric_qty: isManualMode ? (isZeroExemption ? 0 : manualCounts.cat5) : parsedPreview.cat5_biometric_qty,
        total_packets_qty: isManualMode
          ? isZeroExemption
            ? 0
            : manualCounts.cat1 + manualCounts.cat2 + manualCounts.cat3 + manualCounts.cat4 + manualCounts.cat5
          : parsedPreview.total_packets_qty,
        completed_qty: isManualMode ? 0 : parsedPreview.completed_qty,
        inprocess_qty: isManualMode ? 0 : parsedPreview.inprocess_qty,
        rejected_qty: isManualMode ? 0 : parsedPreview.rejected_qty,
        base_amount: isManualMode ? manualBaseTotal : parsedPreview.base_amount,
        gst_amount: isManualMode ? manualGstTotal : parsedPreview.gst_amount,
        total_cash_collected: finalCash,
        has_files: !isManualMode,
        csv_file_url: csvPath,
        html_file_url: htmlPath,
        exemption_reason: isManualMode ? exemptionReason : null,
        deposit_status: finalCash > 0 ? "Pending Deposit" : "Settled",
      };

      const { error } = await supabase.from("aadhaar_daily_reports").insert([payload]);
      if (error) throw error;

      await initializeAadhaarPortal();
      setCsvFile(null);
      setHtmlFile(null);
      setParsedPreview(null);
      setConfirmDailyCheck(false);

      if (finalCash > 0) {
        showBanner(
          "success",
          `✅ Daily Report for ${formatToDDMMYYYY(reportDate)} saved! Instant Deposit QR unlocked for ₹${finalCash.toLocaleString("en-IN")}.`
        );
        setActiveMenu("deposit");
      } else {
        showBanner(
          "success",
          `✅ Zero-Collection Daily Report for ${formatToDDMMYYYY(reportDate)} logged. No deposit required.`
        );
        setActiveMenu("overview");
      }
    } catch (err: any) {
      showBanner("error", "Submission Error: " + err.message);
    } finally {
      setIsSubmittingDaily(false);
    }
  };

  // --- MULTI-TEMPLATE OCR SLIP UPLOAD & LIVE PREVIEW ENGINE ---
  const handleSlipUploadOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSlipFile(file);
    if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
    setSlipPreviewUrl(URL.createObjectURL(file));
    setConfirmDepositCheck(false);

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      setOcrSummary({ platform: "PDF Receipt Attached", amount: null, utr: null });
      return;
    }

    setIsScanningSlip(true);
    setScanProgress(0);
    try {
      const worker = await Tesseract.createWorker("eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text" && m.progress) {
            setScanProgress(Math.round(m.progress * 100));
          }
        },
      });
      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();

      const raw = text.toLowerCase();
      let platform = "UPI / Bank Receipt";
      if (raw.includes("google pay") || raw.includes("gpay")) platform = "Google Pay";
      else if (raw.includes("phonepe")) platform = "PhonePe";
      else if (raw.includes("paytm")) platform = "Paytm";
      else if (raw.includes("challan") || raw.includes("cash deposit")) platform = "Bank Cash Slip";

      let extractedUtr = "";
      const labeledRef = text.match(
        /(?:upi\s*ref(?:\s*no|\s*id)?|utr(?:\s*no)?|txn(?:\s*id)?|transaction\s*id)[:\s#.-]*([A-Za-z0-9]{6,22})/i
      );
      if (labeledRef && labeledRef[1]) extractedUtr = labeledRef[1].trim();
      else {
        const utr12 = text.match(/\b\d{12}\b/);
        if (utr12) extractedUtr = utr12[0];
      }

      let extractedAmt: number | null = null;
      const amtMatch = text.match(/(?:[₹]|rs\.?|inr|amt|amount|paid)\s*[:\s]*([0-9,]+(?:\.[0-9]{2})?)/i);
      if (amtMatch && amtMatch[1]) {
        const parsed = parseFloat(amtMatch[1].replace(/,/g, ""));
        if (!isNaN(parsed) && parsed > 0 && parsed <= 1000000) extractedAmt = parsed;
      }

      setOcrSummary({
        platform,
        amount: extractedAmt,
        utr: extractedUtr || null,
      });

      if (extractedUtr) {
        setDepositForm((prev) => ({ ...prev, utr: extractedUtr }));
      }
    } catch (err) {
      console.error("OCR Error:", err);
    } finally {
      setIsScanningSlip(false);
    }
  };

  const handleInstantDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slipFile) return showBanner("error", "Please upload the payment screenshot / bank slip.");
    if (depositForm.utr.trim().length < 6)
      return showBanner("error", "Please enter a valid 12-digit UTR / Reference number.");
    if (!confirmDepositCheck) return showBanner("error", "Please check the verification box.");

    setIsSubmittingDeposit(true);
    try {
      const ext = slipFile.name.split(".").pop();
      const slipFileName = `aadhaar-slip-${partner.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("deposit-slips").upload(slipFileName, slipFile);
      if (upErr) throw upErr;

      const amt = parseFloat(depositForm.amount) || 0;
      const cleanUtr = depositForm.utr.trim().replace(/^AADHAAR_/i, "");
      const { data: depRow, error: depErr } = await supabase
        .from("partner_deposits")
        .insert([
          {
            partner_id: partner.id,
            center_id: partner.center_id,
            deposit_amount: amt,
            deposit_method: depositForm.method,
            reference_no: `AADHAAR_${cleanUtr}`,
            deposit_date: depositForm.date,
            deposit_slip_url: slipFileName,
            is_exempted: false,
            status: "Pending",
          },
        ])
        .select()
        .single();

      if (depErr) throw depErr;

      await supabase
        .from("aadhaar_daily_reports")
        .update({ deposit_status: "Deposit Submitted", deposit_id: depRow.id })
        .eq("partner_id", partner.id)
        .eq("deposit_status", "Pending Deposit");

      await supabase
        .from("aadhaar_penalty_logs")
        .update({ is_settled: true })
        .eq("partner_id", partner.id)
        .eq("is_settled", false);

      showBanner("success", "✅ Aadhaar Remittance submitted to Accounts! Your closing ledger is now clear.");
      setSlipFile(null);
      if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
      setSlipPreviewUrl(null);
      setOcrSummary({ platform: null, amount: null, utr: null });
      setConfirmDepositCheck(false);
      await initializeAadhaarPortal();
      setActiveMenu("overview");
    } catch (err: any) {
      showBanner("error", "Deposit Error: " + err.message);
    } finally {
      setIsSubmittingDeposit(false);
    }
  };

  // --- WEEKLY REPORT PARSER & RECONCILIATION ---
  useEffect(() => {
    const runWeeklyParse = async () => {
      if (!weekCsv || !weekHtml || !isAadhaarAuthorized) return;
      setWeeklyError("");
      setWeeklyPreview(null);
      try {
        const res = await parseAndValidateDualFiles(
          weekCsv,
          weekHtml,
          "WEEKLY",
          { startDate: weekStart, endDate: weekEnd },
          partner?.aadhaar_operator_id || "",
          partner?.aadhaar_station_id || "",
          activeTariff
        );
        setWeeklyPreview(res);
      } catch (err: any) {
        setWeeklyError(err.message);
      }
    };
    runWeeklyParse();
  }, [weekCsv, weekHtml, weekStart, weekEnd, isAadhaarAuthorized]);

  const handleWeeklySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weeklyPreview || !weekCsv || !weekHtml || !confirmWeeklyCheck || !isAadhaarAuthorized) return;
    setIsSubmittingWeekly(true);
    try {
      const safeOp = (partner.aadhaar_operator_id || "OP").replace(/[^a-zA-Z0-9]/g, "_");
      const csvPath = `WEEKLY_${safeOp}_${weekStart}_to_${weekEnd}_${Date.now()}.csv`;
      const htmlPath = `WEEKLY_${safeOp}_${weekStart}_to_${weekEnd}_${Date.now()}.html`;

      await Promise.all([
        supabase.storage.from("aadhaar-reports").upload(csvPath, weekCsv),
        supabase.storage.from("aadhaar-reports").upload(htmlPath, weekHtml),
      ]);

      let mismatchCount = 0;
      weeklyPreview.daily_breakdown.forEach((wb: any) => {
        const dMatch = dailyReports.find((dr) => dr.report_date === wb.date);
        if (!dMatch || dMatch.total_packets_qty !== wb.totalPkts) mismatchCount++;
      });

      const { error } = await supabase.from("aadhaar_weekly_reports").insert([
        {
          partner_id: partner.id,
          center_id: partner.center_id,
          start_date: weekStart,
          end_date: weekEnd,
          operator_id: weeklyPreview.operator_id,
          station_id: weeklyPreview.station_id,
          cat1_new_qty: weeklyPreview.cat1_new_qty,
          cat2_mbu_free_qty: weeklyPreview.cat2_mbu_free_qty,
          cat3_mbu_chargeable_qty: weeklyPreview.cat3_mbu_chargeable_qty,
          cat4_demographic_qty: weeklyPreview.cat4_demographic_qty,
          cat5_biometric_qty: weeklyPreview.cat5_biometric_qty,
          total_packets_qty: weeklyPreview.total_packets_qty,
          completed_qty: weeklyPreview.completed_qty,
          inprocess_qty: weeklyPreview.inprocess_qty,
          rejected_qty: weeklyPreview.rejected_qty,
          total_cash_collected: weeklyPreview.total_cash_collected,
          daily_breakdown_json: weeklyPreview.daily_breakdown,
          discrepancy_days_count: mismatchCount,
          reconciliation_status: mismatchCount === 0 ? "Matched" : "Discrepancy Flagged",
          csv_file_url: csvPath,
          html_file_url: htmlPath,
        },
      ]);
      if (error) throw error;

      showBanner("success", "✅ Weekly Report synced and cross-verified against Daily Reports!");
      setWeekCsv(null);
      setWeekHtml(null);
      setWeeklyPreview(null);
      await initializeAadhaarPortal();
      setActiveMenu("overview");
    } catch (err: any) {
      showBanner("error", "Weekly Sync Error: " + err.message);
    } finally {
      setIsSubmittingWeekly(false);
    }
  };

  // --- EXISTING PARTNER AADHAAR UPGRADE REQUEST ---
  const handleUpgradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (upgradeForm.station_id.trim().length !== 5) {
      return showBanner("error", "Validation Error: UIDAI Station ID must be exactly 5 digits.");
    }
    if (!upgradePdf)
      return showBanner(
        "error",
        "Please upload your merged Aadhaar Compliance PDF (NSEIT, LMS, EA Form, Police Verification)."
      );
    setIsSubmittingUpgrade(true);
    try {
      const path = `AADHAAR_UPGRADE_${partner.id}_${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from("application_documents").upload(path, upgradePdf);
      if (upErr) throw upErr;

      const { error } = await supabase.from("partner_upgrade_requests").insert([
        {
          partner_id: partner.id,
          center_id: partner.center_id,
          requested_operator_id: upgradeForm.operator_id.trim().toUpperCase(),
          requested_station_id: upgradeForm.station_id.trim(),
          nseit_cert_no: upgradeForm.nseit_no.trim().toUpperCase(),
          compliance_pdf_url: path,
          status: "Pending",
        },
      ]);
      if (error) throw error;
      showBanner(
        "success",
        "✅ Aadhaar Center Upgrade Request submitted! Your dashboard will unlock automatically once Corporate Admin maps your Aadhaar Center and approves your Station ID."
      );
      setUpgradePdf(null);
      await initializeAadhaarPortal();
    } catch (err: any) {
      showBanner("error", "Upgrade Error: " + err.message);
    } finally {
      setIsSubmittingUpgrade(false);
    }
  };

  const handleDownloadRawFile = async (path: string | null) => {
    if (!path) return showBanner("info", "File not available (Manual / Exemption entry).");
    const { data, error } = await supabase.storage.from("aadhaar-reports").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) return showBanner("error", "Error generating download link.");
    window.open(data.signedUrl, "_blank");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white font-black uppercase tracking-widest text-xs animate-pulse">
        Verifying Aadhaar Seva Kendra Clearance...
      </div>
    );
  }

  // Filtered Reports for Dashboard & History
  const filteredHistory = dailyReports.filter((r) => {
    const dMatch = r.report_date >= filterFromDate && r.report_date <= filterToDate;
    const mMatch =
      fileModeFilter === "ALL" ? true : fileModeFilter === "WITH_FILES" ? r.has_files === true : r.has_files === false;
    return dMatch && mMatch;
  });

  // Live 5-Category Aggregations
  const totals = filteredHistory.reduce(
    (acc, r) => {
      acc.cat1 += Number(r.cat1_new_qty || 0);
      acc.cat2 += Number(r.cat2_mbu_free_qty || 0);
      acc.cat3 += Number(r.cat3_mbu_chargeable_qty || 0);
      acc.cat4 += Number(r.cat4_demographic_qty || 0);
      acc.cat5 += Number(r.cat5_biometric_qty || 0);
      acc.pkts += Number(r.total_packets_qty || 0);
      acc.comp += Number(r.completed_qty || 0);
      acc.inproc += Number(r.inprocess_qty || 0);
      acc.rej += Number(r.rejected_qty || 0);
      acc.cash += Number(r.total_cash_collected || 0);
      return acc;
    },
    { cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0, pkts: 0, comp: 0, inproc: 0, rej: 0, cash: 0 }
  );

  const pendingReportCash = dailyReports
    .filter((r) => r.deposit_status === "Pending Deposit")
    .reduce((s, r) => s + Number(r.total_cash_collected || 0), 0);
  const unpaidPenaltyTotal = penalties.reduce((s, p) => s + Number(p.penalty_amount || 0), 0);
  const totalPayableNow = pendingReportCash + unpaidPenaltyTotal;

  const safeDepositAmount = (parseFloat(depositForm.amount) || 0).toFixed(2);
  const upiDeepLink = `upi://pay?pa=${centerUpi}&pn=${encodeURIComponent(
    "Fast Ark Aadhaar"
  )}&am=${safeDepositAmount}&cu=INR&tn=${encodeURIComponent(
    `Aadhaar_${partner?.aadhaar_station_id || partner?.center_id}`
  )}`;

  const isPdfSlip =
    slipFile?.type === "application/pdf" || (slipFile?.name || "").toLowerCase().endsWith(".pdf");

  // Force menu to "upgrade" if not authorized
  const effectiveMenu: AadhaarMenuTab = isAadhaarAuthorized ? activeMenu : "upgrade";

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row font-sans">
      {/* SIDEBAR + MOBILE TOP/BOTTOM NAVIGATION */}
      <AadhaarSidebar
        activeMenu={effectiveMenu}
        setActiveMenu={setActiveMenu}
        partner={partner}
        isAadhaarAuthorized={isAadhaarAuthorized}
        pendingReportCash={pendingReportCash}
        unpaidPenaltyTotal={unpaidPenaltyTotal}
        overdueDaysCount={penalties.length}
        onSignOut={async () => {
          await supabase.auth.signOut();
          router.push("/partner/login");
        }}
      />

      {/* RIGHT MAIN WORKSPACE */}
      <main className="flex-1 p-4 md:p-8 pb-24 lg:pb-8 overflow-y-auto space-y-6 max-w-[1400px]">
        {/* INLINE MOBILE-SAFE STATUS BANNER */}
        {statusBanner && (
          <div
            className={`p-4 rounded-xl border-2 flex items-center justify-between gap-4 font-bold text-xs shadow-sm ${
              statusBanner.type === "error"
                ? "bg-red-50 border-red-300 text-red-900"
                : statusBanner.type === "success"
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-blue-50 border-blue-300 text-blue-900"
            }`}
          >
            <span>{statusBanner.text}</span>
            <button onClick={() => setStatusBanner(null)} className="font-black text-base px-2">
              ✕
            </button>
          </div>
        )}

        {/* LATE PAYMENT PENALTY BANNER (ONLY FOR AUTHORIZED OPERATORS) */}
        {isAadhaarAuthorized && unpaidPenaltyTotal > 0 && (
          <div className="bg-red-600 text-white p-4 rounded-xl shadow-lg border-2 border-red-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-pulse">
            <div>
              <h3 className="font-black text-base uppercase tracking-widest flex items-center gap-2">
                <span>🚨</span> Late Payment Penalty Active (₹100 / Day)
              </h3>
              <p className="text-xs font-bold text-red-100 mt-1">
                You have {penalties.length} overdue day(s) of unsettled Aadhaar collections. ₹{unpaidPenaltyTotal} has
                been added to your closing ledger.
              </p>
            </div>
            <button
              onClick={() => setActiveMenu("deposit")}
              className="bg-white text-red-700 font-black px-5 py-2.5 rounded-lg text-xs uppercase tracking-widest shrink-0 shadow"
            >
              Settle ₹{totalPayableNow.toLocaleString("en-IN")} Now &rarr;
            </button>
          </div>
        )}

        {/* GLOBAL 7-PRESET DATE DROPDOWN + FILE MODE FILTER (VISIBLE ONLY WHEN AUTHORIZED) */}
        {isAadhaarAuthorized && (
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full xl:w-auto">
              <div>
                <label className="block text-[9px] font-black uppercase text-indigo-600 tracking-widest mb-1">
                  1. Date Preset
                </label>
                <select
                  value={datePreset}
                  onChange={(e) => handlePresetChange(e.target.value as DatePresetMode)}
                  className="w-full border-2 border-indigo-200 p-2 rounded-lg text-xs font-black text-indigo-950 bg-indigo-50 outline-none focus:border-indigo-600"
                >
                  <option value="today">Today ({formatToDDMMYYYY(getDateRangeFromPreset("today").start)})</option>
                  <option value="yesterday">
                    Yesterday ({formatToDDMMYYYY(getDateRangeFromPreset("yesterday").start)})
                  </option>
                  <option value="current_week">Current Week</option>
                  <option value="current_month">Current Month</option>
                  <option value="previous_month">Previous Month</option>
                  <option value="all">All Time</option>
                  <option value="custom">Custom Filter</option>
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">
                  From ({formatToDDMMYYYY(filterFromDate)})
                </label>
                <input
                  type="date"
                  value={filterFromDate}
                  onChange={(e) => {
                    setDatePreset("custom");
                    setFilterFromDate(e.target.value);
                  }}
                  className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold text-slate-800 outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">
                  To ({formatToDDMMYYYY(filterToDate)})
                </label>
                <input
                  type="date"
                  value={filterToDate}
                  onChange={(e) => {
                    setDatePreset("custom");
                    setFilterToDate(e.target.value);
                  }}
                  className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold text-slate-800 outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">
                  Report File Filter
                </label>
                <select
                  value={fileModeFilter}
                  onChange={(e) => setFileModeFilter(e.target.value as any)}
                  className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-black text-slate-800 bg-slate-50 outline-none focus:border-blue-600"
                >
                  <option value="ALL">📋 Both (With &amp; Without Files)</option>
                  <option value="WITH_FILES">✅ With CSV &amp; HTML Files Only</option>
                  <option value="WITHOUT_FILES">⚠️ Without Files (Manual / Exemption)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 w-full xl:w-auto">
              <button
                onClick={() =>
                  downloadAadhaarPDFReport(
                    filteredHistory,
                    fileModeFilter,
                    `${partner?.partner_name} (${partner?.aadhaar_station_id || "N/A"})`
                  )
                }
                className="flex-1 xl:flex-none bg-red-600 hover:bg-red-700 text-white font-black px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
              >
                📄 Download PDF
              </button>
              <button
                onClick={() => downloadAadhaarCSVReport(filteredHistory, fileModeFilter)}
                className="flex-1 xl:flex-none bg-slate-900 hover:bg-slate-800 text-white font-black px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
              >
                📊 Download CSV
              </button>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* VIEW 1: DASHBOARD & LIVE 5-CATEGORY COUNTS (AUTHORIZED ONLY)          */}
        {/* ===================================================================== */}
        {isAadhaarAuthorized && effectiveMenu === "overview" && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. New Enrolment</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat1}</p>
                <p className="text-[10px] font-bold text-emerald-600 mt-1">Free (₹0.00)</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-teal-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. MBU Free</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat2}</p>
                <p className="text-[10px] font-bold text-teal-600 mt-1">Mandatory Bio (₹0.00)</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-amber-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">3. MBU Chargeable</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat3}</p>
                <p className="text-[10px] font-bold text-amber-600 mt-1">
                  Rate: ₹{activeTariff?.mbu_chargeable_fee || 125}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-blue-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">4. Demographic</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat4}</p>
                <p className="text-[10px] font-bold text-blue-600 mt-1">
                  Rate: ₹{activeTariff?.demographic_fee || 75}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-purple-600 col-span-2 md:col-span-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">5. Biometric Update</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat5}</p>
                <p className="text-[10px] font-bold text-purple-600 mt-1">
                  Rate: ₹{activeTariff?.biometric_fee || 125}
                </p>
              </div>
            </div>

            <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total Packets Logged</p>
                <p className="text-3xl font-black text-white mt-1">{totals.pkts}</p>
                <p className="text-[10px] text-emerald-400 font-bold mt-1">
                  ✅ {totals.comp} Completed | ⏳ {totals.inproc} InProcess
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-red-400 tracking-widest">Rejected Packets</p>
                <p className="text-3xl font-black text-red-400 mt-1">{totals.rej}</p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">Quality Audit Metric</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Gross Cash Collected</p>
                <p className="text-3xl font-black text-white mt-1">₹{totals.cash.toLocaleString("en-IN")}</p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">Inclusive of 18% GST</p>
              </div>
              <div className="flex flex-col justify-center col-span-2 md:col-span-1">
                <button
                  onClick={() => setActiveMenu("daily")}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-lg transition"
                >
                  📤 Upload Today&apos;s Report &rarr;
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* VIEW 2: DAILY REPORT UPLOAD (AUTHORIZED ONLY)                         */}
        {/* ===================================================================== */}
        {isAadhaarAuthorized && effectiveMenu === "daily" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6 animate-in fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-4 gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">Daily Aadhaar Report Submission</h2>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  Select date (DD/MM/YYYY) and upload matching UIDAI .CSV and .HTML status files.
                </p>
              </div>
              <label className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={isManualMode}
                  onChange={(e) => {
                    setIsManualMode(e.target.checked);
                    setParsedPreview(null);
                    setParseError("");
                  }}
                  className="w-4 h-4 accent-amber-600"
                />
                <span className="text-xs font-black text-amber-900 uppercase tracking-wider">
                  Files Not Available (Manual / Exemption)
                </span>
              </label>
            </div>

            <form onSubmit={handleDailySubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-widest mb-1">
                    1. Select Report Date *
                  </label>
                  <input
                    type="date"
                    required
                    max={getISTDateString(0)}
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-bold text-sm bg-white outline-none focus:border-blue-600"
                  />
                </div>
                <div className="flex flex-col justify-center bg-white p-3 rounded-lg border border-slate-200">
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">
                    Selected Date (Indian Format)
                  </span>
                  <span className="text-2xl font-black text-blue-700 mt-0.5">{formatToDDMMYYYY(reportDate)}</span>
                </div>
                <div className="flex flex-col justify-center bg-white p-3 rounded-lg border border-slate-200">
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">
                    Active UIDAI Tariff ({formatToDDMMYYYY(reportDate)})
                  </span>
                  <span className="text-xs font-black text-slate-800 mt-1">
                    Demo: ₹{activeTariff?.demographic_fee || 75} | Bio/MBU: ₹{activeTariff?.biometric_fee || 125}
                  </span>
                </div>
              </div>

              {!isManualMode ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border-2 border-dashed border-blue-300 bg-blue-50/50 rounded-xl p-5 text-center relative">
                    <input
                      type="file"
                      accept=".csv,text/csv,application/vnd.ms-excel,text/plain"
                      onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="text-3xl mb-1">📊</div>
                    <p className="font-black text-slate-800 text-sm">
                      {csvFile ? `✅ ${csvFile.name}` : "Upload UIDAI Daily .CSV File *"}
                    </p>
                    <p className="text-[10px] font-bold text-slate-500 mt-1">Contains 20-column packet telemetry</p>
                  </div>

                  <div className="border-2 border-dashed border-indigo-300 bg-indigo-50/50 rounded-xl p-5 text-center relative">
                    <input
                      type="file"
                      accept=".html,.htm,text/html"
                      onChange={(e) => setHtmlFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="text-3xl mb-1">🌐</div>
                    <p className="font-black text-slate-800 text-sm">
                      {htmlFile ? `✅ ${htmlFile.name}` : "Upload UIDAI Daily .HTML File *"}
                    </p>
                    <p className="text-[10px] font-bold text-slate-500 mt-1">
                      Verifies Station ID, Operator ID &amp; Date
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-50 p-5 rounded-xl border border-amber-200 space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-amber-800 tracking-widest mb-1">
                      Select Reason for Missing CSV / HTML Files *
                    </label>
                    <select
                      required
                      value={exemptionReason}
                      onChange={(e) => setExemptionReason(e.target.value)}
                      className="w-full border-2 border-amber-300 p-3 rounded-lg font-bold text-sm bg-white text-slate-800 outline-none"
                    >
                      <option value="" disabled>
                        -- Choose Exemption / Manual Reason --
                      </option>
                      <option value="CENTER_HOLIDAY">1. Center Holiday / Sunday Closed (0 Enrolments)</option>
                      <option value="OPERATOR_LEAVE">2. Operator on Leave / Absent (0 Enrolments)</option>
                      <option value="SERVER_L1_DOWN">3. UIDAI Server / L1 Device Down (0 Enrolments)</option>
                      <option value="POWER_NETWORK_OUTAGE">4. Electricity / Network Outage (0 Enrolments)</option>
                      <option value="ECMP_CRASH_MANUAL">5. ECMP Client Crash — Enter Packet Counts Manually</option>
                    </select>
                  </div>

                  {exemptionReason === "ECMP_CRASH_MANUAL" && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-600">1. New (₹0)</label>
                        <input
                          type="number"
                          min="0"
                          value={manualCounts.cat1}
                          onChange={(e) => setManualCounts({ ...manualCounts, cat1: parseInt(e.target.value) || 0 })}
                          className="w-full border p-2 rounded font-bold bg-white mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-600">2. MBU Free (₹0)</label>
                        <input
                          type="number"
                          min="0"
                          value={manualCounts.cat2}
                          onChange={(e) => setManualCounts({ ...manualCounts, cat2: parseInt(e.target.value) || 0 })}
                          className="w-full border p-2 rounded font-bold bg-white mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase text-amber-800">
                          3. MBU Paid (₹{activeTariff?.mbu_chargeable_fee || 125})
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={manualCounts.cat3}
                          onChange={(e) => setManualCounts({ ...manualCounts, cat3: parseInt(e.target.value) || 0 })}
                          className="w-full border p-2 rounded font-bold bg-white mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase text-blue-800">
                          4. Demo (₹{activeTariff?.demographic_fee || 75})
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={manualCounts.cat4}
                          onChange={(e) => setManualCounts({ ...manualCounts, cat4: parseInt(e.target.value) || 0 })}
                          className="w-full border p-2 rounded font-bold bg-white mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase text-purple-800">
                          5. Bio (₹{activeTariff?.biometric_fee || 125})
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={manualCounts.cat5}
                          onChange={(e) => setManualCounts({ ...manualCounts, cat5: parseInt(e.target.value) || 0 })}
                          className="w-full border p-2 rounded font-bold bg-white mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {parseError && (
                <div className="p-4 bg-red-50 border-2 border-red-300 rounded-xl text-red-800 text-xs font-black">
                  ❌ VALIDATION BLOCKED: {parseError}
                </div>
              )}

              {(parsedPreview || (isManualMode && exemptionReason)) && (
                <div className="bg-slate-900 text-white p-5 rounded-xl space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                      ✅ 5-Category Verification Summary ({formatToDDMMYYYY(reportDate)})
                    </span>
                    <span className="text-xs font-bold text-slate-300">
                      Operator: {isManualMode ? partner?.aadhaar_operator_id : parsedPreview?.operator_id} | Station:{" "}
                      {isManualMode ? partner?.aadhaar_station_id : parsedPreview?.station_id}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <p className="text-[9px] text-slate-400 uppercase font-bold">1. New (₹0)</p>
                      <p className="text-xl font-black">
                        {isManualMode ? (isZeroExemption ? 0 : manualCounts.cat1) : parsedPreview.cat1_new_qty}
                      </p>
                    </div>
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <p className="text-[9px] text-slate-400 uppercase font-bold">2. MBU Free</p>
                      <p className="text-xl font-black">
                        {isManualMode ? (isZeroExemption ? 0 : manualCounts.cat2) : parsedPreview.cat2_mbu_free_qty}
                      </p>
                    </div>
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <p className="text-[9px] text-amber-400 uppercase font-bold">3. MBU Paid</p>
                      <p className="text-xl font-black text-amber-400">
                        {isManualMode
                          ? isZeroExemption
                            ? 0
                            : manualCounts.cat3
                          : parsedPreview.cat3_mbu_chargeable_qty}
                      </p>
                    </div>
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <p className="text-[9px] text-blue-400 uppercase font-bold">4. Demographic</p>
                      <p className="text-xl font-black text-blue-400">
                        {isManualMode ? (isZeroExemption ? 0 : manualCounts.cat4) : parsedPreview.cat4_demographic_qty}
                      </p>
                    </div>
                    <div className="bg-slate-800 p-3 rounded-lg">
                      <p className="text-[9px] text-purple-400 uppercase font-bold">5. Biometric</p>
                      <p className="text-xl font-black text-purple-400">
                        {isManualMode ? (isZeroExemption ? 0 : manualCounts.cat5) : parsedPreview.cat5_biometric_qty}
                      </p>
                    </div>
                    <div className="bg-emerald-950 border border-emerald-700 p-3 rounded-lg">
                      <p className="text-[9px] text-emerald-300 uppercase font-black">Cash Collected</p>
                      <p className="text-xl font-black text-white">
                        ₹
                        {(isManualMode ? manualCashTotal : parsedPreview.total_cash_collected).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>

                  <label className="flex items-center gap-3 bg-slate-800 p-3.5 rounded-lg border border-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      required
                      checked={confirmDailyCheck}
                      onChange={(e) => setConfirmDailyCheck(e.target.checked)}
                      className="w-5 h-5 accent-emerald-500"
                    />
                    <span className="text-xs font-bold text-slate-200">
                      I verify that the 5-category counts and{" "}
                      <strong className="text-emerald-400">
                        ₹{(isManualMode ? manualCashTotal : parsedPreview.total_cash_collected).toLocaleString("en-IN")}
                      </strong>{" "}
                      collected amount for <strong>{formatToDDMMYYYY(reportDate)}</strong> are accurate.
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSubmittingDaily || !confirmDailyCheck}
                    className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-widest text-sm rounded-xl shadow-lg disabled:opacity-40 transition"
                  >
                    {isSubmittingDaily ? "Committing Report..." : "Submit Daily Report & Unlock Deposit QR \u2192"}
                  </button>
                </div>
              )}
            </form>
          </div>
        )}

        {/* ===================================================================== */}
        {/* VIEW 3: INSTANT DEPOSIT (AUTHORIZED ONLY)                             */}
        {/* ===================================================================== */}
        {isAadhaarAuthorized && effectiveMenu === "deposit" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in items-start">
            <div className="space-y-6">
              <div className="bg-slate-900 text-white rounded-2xl p-6 flex flex-col items-center justify-center text-center border border-slate-800 shadow-xl">
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mb-3">
                  Instant Closing Settlement
                </span>
                <h2 className="text-2xl font-black">Scan or Tap to Pay Aadhaar Cash</h2>
                <p className="text-xs text-slate-400 font-bold mt-1 mb-5">
                  Routing to Center UPI: <span className="text-white">{centerUpi}</span>
                </p>

                <div className="bg-white p-4 rounded-2xl shadow-lg mb-4">
                  <QRCodeSVG value={upiDeepLink} size={190} level="M" />
                </div>

                <p className="text-3xl font-black text-emerald-400">
                  ₹{(parseFloat(depositForm.amount) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-1">
                  Includes Report Cash (₹{pendingReportCash}) + Late Penalties (₹{unpaidPenaltyTotal})
                </p>

                {(parseFloat(depositForm.amount) || 0) > 0 && (
                  <a
                    href={upiDeepLink}
                    className="mt-5 w-full max-w-xs py-3.5 px-5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                  >
                    <span>📲</span> Tap to Pay via UPI App (GPay / PhonePe)
                  </a>
                )}
              </div>

              {slipPreviewUrl && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-3.5 bg-slate-900 text-white flex justify-between items-center">
                    <span className="text-xs font-black uppercase tracking-widest">📄 Uploaded Receipt Preview</span>
                    <a
                      href={slipPreviewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase px-3 py-1 rounded"
                    >
                      Open Full Screen ↗
                    </a>
                  </div>
                  <div className="p-4 bg-slate-50 flex justify-center">
                    {isPdfSlip ? (
                      <iframe
                        src={`${slipPreviewUrl}#toolbar=0`}
                        className="w-full h-96 rounded-xl border border-slate-300 bg-white"
                        title="Aadhaar Deposit PDF Preview"
                      />
                    ) : (
                      <img
                        src={slipPreviewUrl}
                        alt="Uploaded Aadhaar Payment Slip"
                        className="max-h-96 w-auto object-contain rounded-xl border border-slate-200 shadow bg-white"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
              <h3 className="font-black text-lg text-slate-900 border-b pb-3 mb-4">
                Upload Payment Receipt / Slip
              </h3>
              <form onSubmit={handleInstantDepositSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Amount Remitted (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={depositForm.amount}
                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                    className="w-full border-2 border-slate-200 p-3 rounded-lg font-black text-lg text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Upload UPI Screenshot / Bank Slip (Auto-OCR) *
                  </label>
                  <input
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    required
                    onChange={handleSlipUploadOCR}
                    className="w-full border-2 border-dashed border-slate-300 p-3 rounded-lg text-xs font-bold bg-slate-50 cursor-pointer"
                  />
                  {isScanningSlip && (
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-center">
                      <p className="text-[10px] font-black text-blue-700 uppercase animate-pulse">
                        🔍 Scanning Slip Locally ({scanProgress}%)...
                      </p>
                    </div>
                  )}
                </div>

                {!isScanningSlip && slipFile && ocrSummary.platform && (
                  <div className="bg-slate-900 text-white rounded-xl p-4 space-y-2 border border-slate-800">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                        OCR Audit &amp; Capture
                      </span>
                      <span className="text-[10px] font-black bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded border border-blue-700">
                        {ocrSummary.platform}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-800 p-2 rounded">
                        <p className="text-[9px] text-slate-400 uppercase">Scanned Amount</p>
                        <p className="font-bold text-emerald-400">
                          {ocrSummary.amount ? `₹${ocrSummary.amount.toLocaleString("en-IN")}` : "Verify Manually"}
                        </p>
                      </div>
                      <div className="bg-slate-800 p-2 rounded">
                        <p className="text-[9px] text-slate-400 uppercase">Scanned UTR</p>
                        <p className="font-bold text-slate-200 truncate">{ocrSummary.utr || "Verify Manually"}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                      Payment Mode
                    </label>
                    <select
                      value={depositForm.method}
                      onChange={(e) => setDepositForm({ ...depositForm, method: e.target.value })}
                      className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold text-xs"
                    >
                      <option value="UPI">UPI QR / App</option>
                      <option value="Cash Deposit">Bank Cash Slip</option>
                      <option value="IMPS">IMPS / NEFT</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                      UTR / Reference No *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="12-digit UTR"
                      value={depositForm.utr}
                      onChange={(e) => setDepositForm({ ...depositForm, utr: e.target.value })}
                      className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black text-xs"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2.5 bg-blue-50 p-3 rounded-lg border border-blue-200 cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={confirmDepositCheck}
                    onChange={(e) => setConfirmDepositCheck(e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-xs font-bold text-blue-900">
                    I confirm the UTR and amount match the uploaded payment receipt preview.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmittingDeposit || isScanningSlip || !confirmDepositCheck}
                  className="w-full py-4 bg-slate-900 hover:bg-blue-600 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-md disabled:opacity-40 transition"
                >
                  {isSubmittingDeposit ? "Submitting Remittance..." : "Submit Deposit & Clear Ledger"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* VIEW 4: WEEKLY REPORT RECONCILIATION (AUTHORIZED ONLY)                */}
        {/* ===================================================================== */}
        {isAadhaarAuthorized && effectiveMenu === "weekly" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6 animate-in fade-in">
            <div>
              <h2 className="text-xl font-black text-slate-900">Weekly UIDAI Report Reconciliation</h2>
              <p className="text-xs font-bold text-slate-500 mt-0.5">
                Upload the Weekly .CSV and .HTML files to automatically match every day against your Daily Reports.
              </p>
            </div>

            <form onSubmit={handleWeeklySubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                    Week Start Date ({formatToDDMMYYYY(weekStart)})
                  </label>
                  <input
                    type="date"
                    required
                    value={weekStart}
                    onChange={(e) => setWeekStart(e.target.value)}
                    className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-bold text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                    Week End Date ({formatToDDMMYYYY(weekEnd)})
                  </label>
                  <input
                    type="date"
                    required
                    value={weekEnd}
                    onChange={(e) => setWeekEnd(e.target.value)}
                    className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-bold text-xs bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border-2 border-dashed border-blue-300 bg-blue-50/50 rounded-xl p-5 text-center relative">
                  <input
                    type="file"
                    accept=".csv,text/csv,application/vnd.ms-excel,text/plain"
                    onChange={(e) => setWeekCsv(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <p className="font-black text-slate-800 text-sm">
                    {weekCsv ? `✅ ${weekCsv.name}` : "Upload Weekly .CSV File *"}
                  </p>
                </div>
                <div className="border-2 border-dashed border-indigo-300 bg-indigo-50/50 rounded-xl p-5 text-center relative">
                  <input
                    type="file"
                    accept=".html,.htm,text/html"
                    onChange={(e) => setWeekHtml(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <p className="font-black text-slate-800 text-sm">
                    {weekHtml ? `✅ ${weekHtml.name}` : "Upload Weekly .HTML File *"}
                  </p>
                </div>
              </div>

              {weeklyError && (
                <div className="p-4 bg-red-50 border-2 border-red-300 rounded-xl text-red-800 text-xs font-black">
                  ❌ WEEKLY VALIDATION ERROR: {weeklyError}
                </div>
              )}

              {weeklyPreview && (
                <div className="space-y-4">
                  <h3 className="font-black text-xs uppercase tracking-widest text-slate-600">
                    Day-by-Day Weekly vs. Daily Matching Matrix
                  </h3>
                  <div className="overflow-x-auto border rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-white text-[10px] uppercase">
                        <tr>
                          <th className="p-3">Date (DD/MM/YYYY)</th>
                          <th className="p-3 text-center">Weekly File Packets</th>
                          <th className="p-3 text-center">Daily Report Logged</th>
                          <th className="p-3 text-center">Rejected in Weekly</th>
                          <th className="p-3 text-right">Weekly Cash</th>
                          <th className="p-3 text-right">Match Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {weeklyPreview.daily_breakdown.map((wb: any) => {
                          const dMatch = dailyReports.find((dr) => dr.report_date === wb.date);
                          const isMatched = dMatch && dMatch.total_packets_qty === wb.totalPkts;
                          return (
                            <tr key={wb.date} className="hover:bg-slate-50">
                              <td className="p-3 font-black">{formatToDDMMYYYY(wb.date)}</td>
                              <td className="p-3 text-center font-bold">{wb.totalPkts}</td>
                              <td className="p-3 text-center font-bold">
                                {dMatch ? dMatch.total_packets_qty : "MISSING"}
                              </td>
                              <td className="p-3 text-center font-bold text-red-600">{wb.rejected}</td>
                              <td className="p-3 text-right font-black">₹{wb.totalCash.toLocaleString("en-IN")}</td>
                              <td className="p-3 text-right">
                                {isMatched ? (
                                  <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded text-[10px] font-black uppercase">
                                    ✅ Matched
                                  </span>
                                ) : (
                                  <span className="bg-red-100 text-red-800 px-2.5 py-1 rounded text-[10px] font-black uppercase">
                                    🚨 Mismatch / Missing Daily
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <label className="flex items-center gap-2.5 bg-slate-100 p-3 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      required
                      checked={confirmWeeklyCheck}
                      onChange={(e) => setConfirmWeeklyCheck(e.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-xs font-bold text-slate-800">
                      I confirm the weekly reconciliation matrix ({weeklyPreview.total_packets_qty} packets, ₹
                      {weeklyPreview.total_cash_collected.toLocaleString("en-IN")}).
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSubmittingWeekly || !confirmWeeklyCheck}
                    className="w-full py-4 bg-slate-900 hover:bg-blue-600 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg"
                  >
                    {isSubmittingWeekly ? "Syncing Weekly Report..." : "Submit Weekly Reconciliation"}
                  </button>
                </div>
              )}
            </form>
          </div>
        )}

        {/* ===================================================================== */}
        {/* VIEW 5: REPORTS & DOWNLOADS (AUTHORIZED ONLY)                         */}
        {/* ===================================================================== */}
        {isAadhaarAuthorized && effectiveMenu === "history" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest">
                Aadhaar Report Ledger ({filteredHistory.length} Records)
              </h3>
              <span className="text-[10px] font-bold text-amber-400 uppercase">
                Preset: {datePreset.toUpperCase()} | Mode: {fileModeFilter}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                  <tr>
                    <th className="p-3.5">Date (DD/MM/YYYY)</th>
                    <th className="p-3.5">Mode</th>
                    <th className="p-3.5 text-center">New</th>
                    <th className="p-3.5 text-center">MBU Free</th>
                    <th className="p-3.5 text-center">MBU Paid</th>
                    <th className="p-3.5 text-center">Demo</th>
                    <th className="p-3.5 text-center">Bio</th>
                    <th className="p-3.5 text-center">Total Pkts</th>
                    <th className="p-3.5 text-right">Cash (₹)</th>
                    <th className="p-3.5 text-center">Raw Files</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredHistory.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-black text-slate-900">{formatToDDMMYYYY(r.report_date)}</td>
                      <td className="p-3.5">
                        {r.has_files ? (
                          <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                            With CSV+HTML
                          </span>
                        ) : (
                          <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                            Without Files ({r.exemption_reason})
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center font-bold">{r.cat1_new_qty}</td>
                      <td className="p-3.5 text-center font-bold">{r.cat2_mbu_free_qty}</td>
                      <td className="p-3.5 text-center font-bold">{r.cat3_mbu_chargeable_qty}</td>
                      <td className="p-3.5 text-center font-bold">{r.cat4_demographic_qty}</td>
                      <td className="p-3.5 text-center font-bold">{r.cat5_biometric_qty}</td>
                      <td className="p-3.5 text-center font-black">{r.total_packets_qty}</td>
                      <td className="p-3.5 text-right font-black text-slate-900">
                        ₹{Number(r.total_cash_collected).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center">
                        {r.has_files ? (
                          <div className="flex justify-center gap-1.5">
                            <button
                              onClick={() => handleDownloadRawFile(r.csv_file_url)}
                              className="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                            >
                              CSV
                            </button>
                            <button
                              onClick={() => handleDownloadRawFile(r.html_file_url)}
                              className="bg-indigo-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                            >
                              HTML
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-bold">No Files</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredHistory.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-10 text-center text-slate-400 font-bold">
                        No reports match the selected date range and file mode filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* VIEW 6: CREDENTIALS & CORPORATE APPROVAL WALL                         */}
        {/* ===================================================================== */}
        {effectiveMenu === "upgrade" && (
          <div className="space-y-6 max-w-3xl animate-in fade-in">
            {/* CORPORATE CLEARANCE CHECKLIST CARD */}
            <div className="bg-slate-900 text-white rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 block">
                    Corporate Security Gate
                  </span>
                  <h2 className="text-xl font-black mt-0.5">
                    {isAadhaarAuthorized
                      ? "✅ Aadhaar Seva Kendra Access Active"
                      : "🔒 Aadhaar Portal Locked — Admin Approval Required"}
                  </h2>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                    isAadhaarAuthorized
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-red-500/20 text-red-300 border border-red-500/40"
                  }`}
                >
                  {isAadhaarAuthorized ? "Authorized" : "Approval Pending"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
                  <p className="text-[9px] font-black uppercase text-slate-400">1. Assigned Center Status</p>
                  <p className="font-black text-white mt-1">
                    [{partner?.locations?.center_code || "NO-CODE"}] {partner?.locations?.center_name || "Unassigned"}
                  </p>
                  <p
                    className={`text-[10px] font-black mt-1 ${
                      partner?.locations?.role_aadhaar ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {partner?.locations?.role_aadhaar
                      ? "✅ Mapped as Aadhaar Center"
                      : "⏳ Awaiting Admin Center Mapping"}
                  </p>
                </div>

                <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
                  <p className="text-[9px] font-black uppercase text-slate-400">2. Operator Role Binding</p>
                  <p className="font-black text-white mt-1">
                    {partner?.role_aadhaar ? "Aadhaar Role Bound" : "Not Bound Yet"}
                  </p>
                  <p
                    className={`text-[10px] font-black mt-1 ${
                      partner?.role_aadhaar ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {partner?.role_aadhaar ? "✅ Approved by Admin" : "🔒 Requires Admin Approval"}
                  </p>
                </div>

                <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
                  <p className="text-[9px] font-black uppercase text-slate-400">3. UIDAI Operator &amp; Station ID</p>
                  <p className="font-black text-white mt-1">
                    {partner?.aadhaar_operator_id || "NO-ID"} / {partner?.aadhaar_station_id || "NO-STN"}
                  </p>
                  <p
                    className={`text-[10px] font-black mt-1 ${
                      partner?.aadhaar_operator_id && partner?.aadhaar_station_id
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }`}
                  >
                    {partner?.aadhaar_operator_id && partner?.aadhaar_station_id
                      ? "✅ Bound to Profile"
                      : "⏳ Submit Credentials Below"}
                  </p>
                </div>
              </div>
            </div>

            {/* IF UPGRADE REQUEST IS CURRENTLY PENDING ADMIN APPROVAL */}
            {!isAadhaarAuthorized && latestUpgradeReq?.status === "Pending" ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">⏳</span>
                  <div>
                    <h3 className="font-black text-amber-950 text-lg uppercase tracking-wide">
                      Upgrade Request Under Corporate Review
                    </h3>
                    <p className="text-xs font-bold text-amber-800 mt-0.5">
                      Submitted on {formatToDDMMYYYY(latestUpgradeReq.created_at)}. Your dashboard and file upload menus
                      will unlock automatically as soon as the Admin approves your request and maps your Aadhaar Center.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-xl border border-amber-200 text-xs">
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Requested Operator ID</span>
                    <span className="font-black text-slate-900 text-sm">
                      {latestUpgradeReq.requested_operator_id}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Requested Station ID</span>
                    <span className="font-black text-amber-700 text-sm">
                      {latestUpgradeReq.requested_station_id}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">NSEIT Certificate No</span>
                    <span className="font-black text-slate-900 text-sm">{latestUpgradeReq.nseit_cert_no}</span>
                  </div>
                </div>
              </div>
            ) : (
              /* UPGRADE REQUEST FORM (FOR NEW REQUESTS, REJECTED REQUESTS, OR CREDENTIAL UPDATES) */
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                {latestUpgradeReq?.status === "Rejected" && (
                  <div className="mb-6 p-4 bg-red-50 border-2 border-red-200 rounded-xl">
                    <p className="text-[10px] font-black uppercase text-red-700 tracking-widest">
                      ❌ Previous Request Declined by Admin
                    </p>
                    <p className="text-xs font-bold text-red-900 mt-1">
                      Reason: {latestUpgradeReq.reject_reason || "Please verify your credentials and re-upload."}
                    </p>
                  </div>
                )}

                <h2 className="text-xl font-black text-slate-900 mb-1">
                  {isAadhaarAuthorized
                    ? "Request Station ID / Operator ID Update"
                    : "Submit Aadhaar Operator Credentials for Admin Approval"}
                </h2>
                <p className="text-xs font-bold text-slate-500 mb-6">
                  {isAadhaarAuthorized
                    ? "Need to update your UIDAI Station ID or Operator ID? Submit a verified request below."
                    : "Existing partners must submit their UIDAI Operator ID, 5-digit Station ID, and NSEIT Compliance PDF. You will gain access to upload reports only after Admin approval."}
                </p>

                <form onSubmit={handleUpgradeSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      UIDAI Operator ID (e.g., MYS_FAAFREEN) *
                    </label>
                    <input
                      type="text"
                      required
                      value={upgradeForm.operator_id}
                      onChange={(e) => setUpgradeForm({ ...upgradeForm, operator_id: e.target.value.toUpperCase() })}
                      className="w-full border-2 p-3 rounded-lg font-bold text-sm uppercase outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      UIDAI Station ID (5 Digits, e.g., 21505) *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={5}
                      value={upgradeForm.station_id}
                      onChange={(e) =>
                        setUpgradeForm({ ...upgradeForm, station_id: e.target.value.replace(/\D/g, "") })
                      }
                      className="w-full border-2 p-3 rounded-lg font-bold text-sm outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      NSEIT Certificate Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={upgradeForm.nseit_no}
                      onChange={(e) => setUpgradeForm({ ...upgradeForm, nseit_no: e.target.value.toUpperCase() })}
                      className="w-full border-2 p-3 rounded-lg font-bold text-sm uppercase outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      Merged Compliance PDF (NSEIT, LMS, Police Verification, EA Form) *
                    </label>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      required
                      onChange={(e) => setUpgradePdf(e.target.files?.[0] || null)}
                      className="w-full border-2 border-dashed p-3 rounded-lg text-xs font-bold bg-slate-50 cursor-pointer"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmittingUpgrade}
                    className="w-full py-4 bg-slate-900 hover:bg-blue-600 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow transition"
                  >
                    {isSubmittingUpgrade ? "Submitting..." : "Submit Aadhaar Credentials for Approval"}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}