// FILE PATH: ./app/partner/aadhaar/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { QRCodeSVG } from "qrcode.react";
import AadhaarSidebar, { AadhaarMenuTab } from "../../components/aadhaar/AadhaarSidebar";
import PartnerAadhaarHistoryVault from "../../components/aadhaar/PartnerAadhaarHistoryVault";
import PartnerAadhaarUpgradeModule from "../../components/aadhaar/PartnerAadhaarUpgradeModule";
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
  parseAndValidateDualFiles,
  syncAadhaarLatePenalties,
  downloadAadhaarCSVReport,
  downloadAadhaarPDFReport,
} from "../../lib/aadhaarEngine";

const getMondayToSundayWindow = (dateStr: string): { monday: string; sunday: string } => {
  const base = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
  const day = base.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const mon = new Date(base);
  mon.setUTCDate(base.getUTCDate() + diffToMonday);

  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);

  return {
    monday: mon.toISOString().split("T")[0],
    sunday: sun.toISOString().split("T")[0],
  };
};

const noScrollNumClass =
  "w-full border-2 border-slate-200 p-2.5 rounded-lg font-black text-slate-900 bg-white outline-none focus:border-blue-600 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function PartnerAadhaarPortal() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeMenu, setActiveMenu] = useState<AadhaarMenuTab>("overview");
  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Core Data States
  const [partner, setPartner] = useState<any>(null);
  const [latestUpgradeReq, setLatestUpgradeReq] = useState<any | null>(null);
  const [activeTariff, setActiveTariff] = useState<any>(null);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<any[]>([]);
  const [aadhaarDeposits, setAadhaarDeposits] = useState<any[]>([]);
  const [penalties, setPenalties] = useState<any[]>([]);
  const [centerUpi, setCenterUpi] = useState<string>("fastark@upi");

  // Menu 2: Daily Report Upload States
  const [reportDate, setReportDate] = useState<string>(getISTDateString(0));
  const [isManualMode, setIsManualMode] = useState<boolean>(false);
  const [exemptionReason, setExemptionReason] = useState<string>("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [htmlFile, setHtmlFile] = useState<File | null>(null);
  const [parsedPreview, setParsedPreview] = useState<any | null>(null);
  const [parseError, setParseError] = useState<string>("");
  const [manualCounts, setManualCounts] = useState({
    cat1: 0,
    cat2: 0,
    cat3: 0,
    cat4: 0,
    cat5: 0,
  });
  const [confirmDailyCheck, setConfirmDailyCheck] = useState<boolean>(false);
  const [isSubmittingDaily, setIsSubmittingDaily] = useState<boolean>(false);

  // Correction Request State on Locked Daily Reports
  const [requestingCorrectionId, setRequestingCorrectionId] = useState<string | null>(null);
  const [correctionReasonText, setCorrectionReasonText] = useState<string>("");
  const [isSendingCorrectionReq, setIsSendingCorrectionReq] = useState<boolean>(false);

  // Menu 3: Separated Remittance Tracks + Unique UTR, Transaction ID & Reference Code
  const [remittanceTrack, setRemittanceTrack] = useState<"UPI_QR" | "BANK_TRANSFER">("UPI_QR");
  const [qrPayAmount, setQrPayAmount] = useState<string>("");
  const [depositForm, setDepositForm] = useState({
    amount: "",
    method: "UPI",
    utr: "",
    transaction_id: "",
    reference_code: generateSystemReferenceCode("FA-ADH", getISTDateString(0)),
    date: getISTDateString(0),
  });
  const [isSlipExempted, setIsSlipExempted] = useState<boolean>(false);
  const [slipExemptionCategory, setSlipExemptionCategory] = useState<string>("");
  const [slipExemptionOtherText, setSlipExemptionOtherText] = useState<string>("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState<string | null>(null);
  const [isScanningSlip, setIsScanningSlip] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [ocrSummary, setOcrSummary] = useState<{
    platform: string | null;
    amount: number | null;
    utr: string | null;
    transactionId: string | null;
    date: string | null;
  }>({ platform: null, amount: null, utr: null, transactionId: null, date: null });
  const [confirmDepositCheck, setConfirmDepositCheck] = useState<boolean>(false);
  const [isSubmittingDeposit, setIsSubmittingDeposit] = useState<boolean>(false);

  // Menu 4: Weekly Reconciliation States (Monday-to-Sunday)
  const [weekStart, setWeekStart] = useState<string>(
    () => getMondayToSundayWindow(getISTDateString(-7)).monday
  );
  const [weekEnd, setWeekEnd] = useState<string>(
    () => getMondayToSundayWindow(getISTDateString(-7)).sunday
  );
  const [weekCsv, setWeekCsv] = useState<File | null>(null);
  const [weekHtml, setWeekHtml] = useState<File | null>(null);
  const [weeklyPreview, setWeeklyPreview] = useState<any | null>(null);
  const [weeklyError, setWeeklyError] = useState<string>("");
  const [confirmWeeklyCheck, setConfirmWeeklyCheck] = useState<boolean>(false);
  const [isSubmittingWeekly, setIsSubmittingWeekly] = useState<boolean>(false);

  // Global & Menu 5: 7-Option Date Preset + Download Confirmation Gate
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [filterFromDate, setFilterFromDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").start
  );
  const [filterToDate, setFilterToDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").end
  );
  const [fileModeFilter, setFileModeFilter] = useState<"ALL" | "WITH_FILES" | "WITHOUT_FILES">(
    "ALL"
  );
  const [confirmDownloadCheck, setConfirmDownloadCheck] = useState<boolean>(false);

  // Menu 6: Credentials Form State
  const [upgradeForm, setUpgradeForm] = useState({
    operator_id: "",
    station_id: "",
    nseit_no: "",
  });

  const handleNumericWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handleNumericKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowUp", "ArrowDown", "e", "E", "+", "-"].includes(e.key)) {
      e.preventDefault();
    }
  };

  const showBanner = (type: "success" | "error" | "info", text: string) => {
    setStatusBanner({ type, text });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    setConfirmDownloadCheck(false);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFilterFromDate(range.start);
      setFilterToDate(range.end);
    }
  };

  const handleWeekDateSelection = (pickedDate: string) => {
    if (!pickedDate) return;
    const { monday, sunday } = getMondayToSundayWindow(pickedDate);
    setWeekStart(monday);
    setWeekEnd(sunday);
    setWeeklyPreview(null);
    setWeeklyError("");
    setConfirmWeeklyCheck(false);
  };

  const handleSwitchRemittanceTrack = (track: "UPI_QR" | "BANK_TRANSFER") => {
    setRemittanceTrack(track);
    setSlipFile(null);
    if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
    setSlipPreviewUrl(null);
    setIsSlipExempted(false);
    setSlipExemptionCategory("");
    setSlipExemptionOtherText("");
    setOcrSummary({
      platform: null,
      amount: null,
      utr: null,
      transactionId: null,
      date: null,
    });
    setConfirmDepositCheck(false);
    setDepositForm((prev) => ({
      ...prev,
      amount: "",
      utr: "",
      transaction_id: "",
      reference_code: generateSystemReferenceCode("FA-ADH", prev.date),
      method: track === "UPI_QR" ? "UPI" : "Cash Deposit",
    }));
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/partner/login");

      const { data: pData } = await supabase
        .from("active_partners")
        .select("*, locations(*)")
        .ilike("email", session.user.email || "")
        .maybeSingle();

      if (!pData) return router.push("/partner/login");
      setPartner(pData);

      const { data: upgData } = await supabase
        .from("partner_upgrade_requests")
        .select("*")
        .eq("partner_id", pData.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setLatestUpgradeReq(upgData || null);

      if (upgData) {
        setUpgradeForm({
          operator_id: upgData.requested_operator_id || pData.aadhaar_operator_id || "",
          station_id: upgData.requested_station_id || pData.aadhaar_station_id || "",
          nseit_no: upgData.nseit_cert_no || "",
        });
      } else if (pData.aadhaar_operator_id || pData.aadhaar_station_id) {
        setUpgradeForm((prev) => ({
          ...prev,
          operator_id: pData.aadhaar_operator_id || "",
          station_id: pData.aadhaar_station_id || "",
        }));
      }

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

      await syncAadhaarLatePenalties(supabase, pData.id);

      const [tariffRes, dailyRes, weeklyRes, depositsRes, penaltyRes, upiRes] =
        await Promise.all([
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
            .from("partner_deposits")
            .select("*")
            .eq("partner_id", pData.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("aadhaar_penalty_logs")
            .select("*")
            .eq("partner_id", pData.id)
            .eq("is_settled", false)
            .eq("is_waived", false),
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
      const allDeps = depositsRes.data || [];
      const aDeps = allDeps.filter(
        (d: any) =>
          d.deposit_stream === "AADHAAR" ||
          String(d.reference_no || "")
            .toUpperCase()
            .startsWith("AADHAAR_")
      );
      const pList = (penaltyRes.data || []).filter((p: any) => !p.is_waived);

      setDailyReports(dList);
      setWeeklyReports(weeklyRes.data || []);
      setAadhaarDeposits(aDeps);
      setPenalties(pList);
      if (upiRes.data?.upi_id) setCenterUpi(upiRes.data.upi_id);

      // REQUIREMENT #4: Total Collection minus Total Deposit = Balance Payable
      const totalCollected = dList.reduce(
        (sum: number, r: any) => sum + Number(r.total_cash_collected || 0),
        0
      );
      const totalDeposited = aDeps
        .filter((d: any) => d.status !== "Discrepancy")
        .reduce((sum: number, d: any) => sum + Number(d.deposit_amount || 0), 0);
      const penSum = pList.reduce(
        (sum: number, p: any) => sum + Number(p.penalty_amount || 0),
        0
      );

      const netPayable = Math.max(0, totalCollected + penSum - totalDeposited);
      if (netPayable > 0) {
        setQrPayAmount(netPayable.toFixed(2));
      } else {
        setQrPayAmount("");
      }
    } catch (err: any) {
      await reportAndMaskError(err, "PARTNER_AADHAAR_INIT");
    } finally {
      setLoading(false);
    }
  };

  const isAadhaarAuthorized = Boolean(
    partner?.role_aadhaar &&
      partner?.aadhaar_operator_id &&
      partner?.aadhaar_station_id &&
      partner?.locations?.role_aadhaar
  );

  const isCredentialsLocked = isAadhaarAuthorized || latestUpgradeReq?.status === "Approved";
  const existingDailyForSelectedDate = dailyReports.find((r) => r.report_date === reportDate);
  const existingWeeklyForSelectedWindow = weeklyReports.find(
    (w) => w.start_date === weekStart && w.end_date === weekEnd
  );

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

  useEffect(() => {
    const runDualValidation = async () => {
      if (
        !csvFile ||
        !htmlFile ||
        isManualMode ||
        !isAadhaarAuthorized ||
        existingDailyForSelectedDate
      )
        return;
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
        const safeErr = await reportAndMaskError(err, "PARTNER_DAILY_PARSE", {
          id: partner?.id,
          email: partner?.email,
        });
        setParseError(safeErr);
      }
    };
    runDualValidation();
  }, [
    csvFile,
    htmlFile,
    reportDate,
    isManualMode,
    isAadhaarAuthorized,
    existingDailyForSelectedDate,
  ]);

  const isZeroExemption =
    isManualMode && exemptionReason !== "" && exemptionReason !== "ECMP_CRASH_MANUAL";
  const manualCashTotal = isZeroExemption
    ? 0
    : manualCounts.cat3 * Number(activeTariff?.mbu_chargeable_fee || 125) +
      manualCounts.cat4 * Number(activeTariff?.demographic_fee || 75) +
      manualCounts.cat5 * Number(activeTariff?.biometric_fee || 125);
  const manualBaseTotal = Number(
    (manualCashTotal / (1 + Number(activeTariff?.gst_percent || 18) / 100)).toFixed(2)
  );
  const manualGstTotal = Number((manualCashTotal - manualBaseTotal).toFixed(2));

  const handleDailySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAadhaarAuthorized) {
      showBanner(
        "error",
        "[ERR-SEC-401] Your Aadhaar credentials and Center mapping must be approved by Corporate Admin before uploading reports."
      );
      setActiveMenu("upgrade");
      return;
    }
    if (existingDailyForSelectedDate) {
      return showBanner(
        "error",
        `[ERR-DUP-205] A Daily Report for ${formatToDDMMYYYY(
          reportDate
        )} has already been submitted and is locked.`
      );
    }
    if (!confirmDailyCheck) {
      return showBanner(
        "error",
        "Please check the mandatory confirmation box before submitting."
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
        cat1_new_qty: isManualMode
          ? isZeroExemption
            ? 0
            : manualCounts.cat1
          : parsedPreview.cat1_new_qty,
        cat2_mbu_free_qty: isManualMode
          ? isZeroExemption
            ? 0
            : manualCounts.cat2
          : parsedPreview.cat2_mbu_free_qty,
        cat3_mbu_chargeable_qty: isManualMode
          ? isZeroExemption
            ? 0
            : manualCounts.cat3
          : parsedPreview.cat3_mbu_chargeable_qty,
        cat4_demographic_qty: isManualMode
          ? isZeroExemption
            ? 0
            : manualCounts.cat4
          : parsedPreview.cat4_demographic_qty,
        cat5_biometric_qty: isManualMode
          ? isZeroExemption
            ? 0
            : manualCounts.cat5
          : parsedPreview.cat5_biometric_qty,
        total_packets_qty: isManualMode
          ? isZeroExemption
            ? 0
            : manualCounts.cat1 +
              manualCounts.cat2 +
              manualCounts.cat3 +
              manualCounts.cat4 +
              manualCounts.cat5
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

      const { data: insertedRow, error } = await supabase
        .from("aadhaar_daily_reports")
        .insert([payload])
        .select()
        .maybeSingle();
      if (error) throw error;

      await logSystemTelemetry({
        actorId: partner.id,
        actorEmail: partner.email,
        module: "PARTNER_AADHAAR_DAILY",
        actionCode: isManualMode ? "DAILY_MANUAL_SUBMIT" : "DAILY_FILE_SUBMIT",
        referenceId: insertedRow?.id || reportDate,
        metadata: {
          report_date: reportDate,
          station_id: payload.station_id,
          packets: payload.total_packets_qty,
          cash: finalCash,
          exemption: payload.exemption_reason,
        },
      });

      await initializeAadhaarPortal();
      setCsvFile(null);
      setHtmlFile(null);
      setParsedPreview(null);
      setConfirmDailyCheck(false);

      if (finalCash > 0) {
        showBanner(
          "success",
          `✅ Daily Report for ${formatToDDMMYYYY(
            reportDate
          )} saved! Instant Deposit QR unlocked for ₹${finalCash.toLocaleString("en-IN")}.`
        );
        setActiveMenu("deposit");
      } else {
        showBanner(
          "success",
          `✅ Zero-Collection Daily Report for ${formatToDDMMYYYY(
            reportDate
          )} logged. No deposit required.`
        );
        setActiveMenu("overview");
      }
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_AADHAAR_DAILY", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("error", safeMsg);
    } finally {
      setIsSubmittingDaily(false);
    }
  };

  const handleSendDailyCorrectionRequest = async (reportId: string) => {
    if (correctionReasonText.trim().length < 5) {
      return showBanner(
        "error",
        "Please enter a detailed reason (min 5 characters) for the Admin correction request."
      );
    }
    setIsSendingCorrectionReq(true);
    try {
      const { error } = await supabase
        .from("aadhaar_daily_reports")
        .update({
          edit_request_status: "Pending",
          edit_request_reason: correctionReasonText.trim(),
        })
        .eq("id", reportId);
      if (error) throw error;

      await logSystemTelemetry({
        actorId: partner.id,
        actorEmail: partner.email,
        module: "PARTNER_AADHAAR_DAILY",
        actionCode: "CORRECTION_REQUESTED",
        referenceId: reportId,
        metadata: { reason: correctionReasonText.trim() },
      });

      showBanner("success", "✅ Correction request sent to Back-Office Audit Hub.");
      setRequestingCorrectionId(null);
      setCorrectionReasonText("");
      await initializeAadhaarPortal();
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_AADHAAR_CORRECTION", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("error", safeMsg);
    } finally {
      setIsSendingCorrectionReq(false);
    }
  };

  // =========================================================================
  // UPGRADED OCR SLIP UPLOAD (USES `scanPaymentReceiptOCR` WITH CANVAS PRE-PROCESSOR)
  // =========================================================================
  const handleSlipUploadOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSlipFile(file);
    if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
    setSlipPreviewUrl(URL.createObjectURL(file));
    setConfirmDepositCheck(false);

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      setOcrSummary({
        platform: "PDF Receipt Attached",
        amount: null,
        utr: null,
        transactionId: null,
        date: null,
      });
      return;
    }

    setIsScanningSlip(true);
    setScanProgress(0);
    try {
      const ocrResult = await scanPaymentReceiptOCR(file, "auto", (pct) =>
        setScanProgress(pct)
      );

      setOcrSummary({
        platform: ocrResult.platform,
        amount: ocrResult.amount,
        utr: ocrResult.utr,
        transactionId: ocrResult.transactionId,
        date: ocrResult.date,
      });

      const effectiveDate = ocrResult.date || depositForm.date;
      setDepositForm((prev) => ({
        ...prev,
        amount: ocrResult.amount !== null ? String(ocrResult.amount) : prev.amount,
        utr: ocrResult.utr ? ocrResult.utr : prev.utr,
        transaction_id: ocrResult.transactionId
          ? ocrResult.transactionId
          : ocrResult.utr || prev.transaction_id,
        date: effectiveDate,
        reference_code: generateSystemReferenceCode("FA-ADH", effectiveDate),
        method:
          remittanceTrack === "UPI_QR"
            ? "UPI"
            : ocrResult.method === "UPI"
            ? prev.method
            : ocrResult.method,
      }));
    } catch (err) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_AADHAAR_OCR", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("info", safeMsg);
    } finally {
      setIsScanningSlip(false);
    }
  };

  // =========================================================================
  // SUBMIT INSTANT DEPOSIT (WITH UNIQUE UTR, TXN ID, REF CODE & DEDUCTION SYNC)
  // =========================================================================
  const handleInstantDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(depositForm.amount) || 0;
    if (amt <= 0)
      return showBanner(
        "error",
        "Collected / Remitted Amount must be greater than zero. Upload your receipt to auto-read via OCR or enter the receipt amount."
      );
    if (!depositForm.date) return showBanner("error", "Please select the Deposit Date.");

    const cleanUtr = depositForm.utr
      .trim()
      .replace(/^AADHAAR_/i, "")
      .replace(/\s+/g, "")
      .toUpperCase();
    const cleanTxnId = (depositForm.transaction_id || cleanUtr).trim().toUpperCase();
    const finalRefCode =
      depositForm.reference_code ||
      generateSystemReferenceCode("FA-ADH", depositForm.date);

    if (cleanUtr.length < 4)
      return showBanner(
        "error",
        "Please enter a valid Unique UTR / Reference Number (min 4 characters)."
      );

    if (!isSlipExempted && !slipFile) {
      return showBanner(
        "error",
        "Please upload the payment screenshot / bank slip, or select the Missing Slip Exemption option."
      );
    }
    if (isSlipExempted && !slipExemptionCategory) {
      return showBanner("error", "Please select a reason from the Missing Slip dropdown.");
    }
    if (
      isSlipExempted &&
      slipExemptionCategory === "Other" &&
      slipExemptionOtherText.trim().length < 4
    ) {
      return showBanner(
        "error",
        "Please type a detailed reason for 'Other' missing deposit slip."
      );
    }
    if (!confirmDepositCheck)
      return showBanner("error", "Please check the verification box before submitting.");

    setIsSubmittingDeposit(true);
    try {
      // Pre-flight duplicate UTR check across all deposits
      const { data: dupUtr } = await supabase
        .from("partner_deposits")
        .select("id, reference_code")
        .or(`utr_number.eq.${cleanUtr},reference_no.eq.${cleanUtr},reference_no.eq.AADHAAR_${cleanUtr}`)
        .limit(1)
        .maybeSingle();

      if (dupUtr) {
        setIsSubmittingDeposit(false);
        return showBanner(
          "error",
          `[ERR-DUP-205] Duplicate UTR Blocked: UTR '${cleanUtr}' has already been recorded under Reference Code ${
            dupUtr.reference_code || "EXISTING"
          }.`
        );
      }

      let slipFileName: string | null = null;
      if (!isSlipExempted && slipFile) {
        const ext = slipFile.name.split(".").pop();
        slipFileName = `aadhaar-slip-${partner.id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("deposit-slips")
          .upload(slipFileName, slipFile);
        if (upErr) throw upErr;
      }

      const finalExemptionReason = isSlipExempted
        ? slipExemptionCategory === "Other"
          ? `OTHER: ${slipExemptionOtherText.trim()}`
          : slipExemptionCategory
        : null;

      const baseDepositPayload: any = {
        partner_id: partner.id,
        center_id: partner.center_id,
        deposit_amount: amt,
        deposit_method: remittanceTrack === "UPI_QR" ? "UPI" : depositForm.method,
        reference_no: `AADHAAR_${cleanUtr}`,
        deposit_date: depositForm.date,
        deposit_slip_url: slipFileName,
        is_exempted: isSlipExempted,
        exemption_reason: finalExemptionReason,
        status: "Pending",
      };

      // Insert with the 3-Identifier columns (fallback gracefully if SQL migration hasn't run yet)
      let depRow: any = null;
      const { data: richRow, error: richErr } = await supabase
        .from("partner_deposits")
        .insert([
          {
            ...baseDepositPayload,
            deposit_stream: "AADHAAR",
            utr_number: cleanUtr,
            transaction_id: cleanTxnId,
            reference_code: finalRefCode,
          },
        ])
        .select()
        .single();

      if (richErr && richErr.code === "42703") {
        const { data: fallbackRow, error: fbErr } = await supabase
          .from("partner_deposits")
          .insert([baseDepositPayload])
          .select()
          .single();
        if (fbErr) throw fbErr;
        depRow = fallbackRow;
      } else if (richErr) {
        throw richErr;
      } else {
        depRow = richRow;
      }

      // FIFO Settlement Allocation: Only mark daily reports & penalties as settled up to the cumulative deposited amount
      const totalValidDepositedSoFar =
        aadhaarDeposits
          .filter((d) => d.status !== "Discrepancy")
          .reduce((s, d) => s + Number(d.deposit_amount || 0), 0) + amt;

      const chronologicalReports = [...dailyReports].sort((a, b) =>
        a.report_date.localeCompare(b.report_date)
      );

      let runningAllocated = 0;
      const reportIdsToMarkSubmitted: string[] = [];

      for (const rep of chronologicalReports) {
        const repCash = Number(rep.total_cash_collected || 0);
        if (repCash <= 0) continue;
        if (runningAllocated + repCash <= totalValidDepositedSoFar) {
          runningAllocated += repCash;
          if (rep.deposit_status === "Pending Deposit") {
            reportIdsToMarkSubmitted.push(rep.id);
          }
        } else {
          break;
        }
      }

      if (reportIdsToMarkSubmitted.length > 0) {
        await supabase
          .from("aadhaar_daily_reports")
          .update({ deposit_status: "Deposit Submitted", deposit_id: depRow.id })
          .in("id", reportIdsToMarkSubmitted);
      }

      // If remaining deposit covers active penalties, settle them and link settled_by_deposit_id
      const remainingAfterReports = totalValidDepositedSoFar - runningAllocated;
      const currentPenaltySum = penalties.reduce(
        (s, p) => s + Number(p.penalty_amount || 0),
        0
      );
      if (currentPenaltySum > 0 && remainingAfterReports >= currentPenaltySum) {
        await supabase
          .from("aadhaar_penalty_logs")
          .update({ is_settled: true, settled_by_deposit_id: depRow.id })
          .eq("partner_id", partner.id)
          .eq("is_settled", false);
      }

      await logSystemTelemetry({
        actorId: partner.id,
        actorEmail: partner.email,
        module: "PARTNER_AADHAAR_DEPOSIT",
        actionCode: "DEPOSIT_SUBMITTED",
        referenceId: finalRefCode,
        metadata: {
          amount: amt,
          utr: cleanUtr,
          transaction_id: cleanTxnId,
          reference_code: finalRefCode,
          method: baseDepositPayload.deposit_method,
        },
      });

      showBanner(
        "success",
        `✅ Remittance of ₹${amt.toLocaleString("en-IN")} recorded! Ref Code: ${finalRefCode} | UTR: ${cleanUtr}`
      );
      setSlipFile(null);
      if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
      setSlipPreviewUrl(null);
      setIsSlipExempted(false);
      setSlipExemptionCategory("");
      setSlipExemptionOtherText("");
      setOcrSummary({
        platform: null,
        amount: null,
        utr: null,
        transactionId: null,
        date: null,
      });
      setDepositForm((prev) => ({
        ...prev,
        amount: "",
        utr: "",
        transaction_id: "",
        reference_code: generateSystemReferenceCode("FA-ADH", getISTDateString(0)),
      }));
      setConfirmDepositCheck(false);
      await initializeAadhaarPortal();
      setActiveMenu("history");
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_AADHAAR_DEPOSIT", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("error", safeMsg);
    } finally {
      setIsSubmittingDeposit(false);
    }
  };

  useEffect(() => {
    const runWeeklyParse = async () => {
      if (
        !weekCsv ||
        !weekHtml ||
        !isAadhaarAuthorized ||
        existingWeeklyForSelectedWindow
      )
        return;
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
        const safeMsg = await reportAndMaskError(err, "PARTNER_WEEKLY_PARSE", {
          id: partner?.id,
          email: partner?.email,
        });
        setWeeklyError(safeMsg);
      }
    };
    runWeeklyParse();
  }, [
    weekCsv,
    weekHtml,
    weekStart,
    weekEnd,
    isAadhaarAuthorized,
    existingWeeklyForSelectedWindow,
  ]);

  const handleWeeklySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (existingWeeklyForSelectedWindow) {
      return showBanner(
        "error",
        `[ERR-DUP-205] Weekly Reconciliation for ${formatToDDMMYYYY(
          weekStart
        )} to ${formatToDDMMYYYY(weekEnd)} is already submitted.`
      );
    }
    if (!weeklyPreview || !weekCsv || !weekHtml || !confirmWeeklyCheck || !isAadhaarAuthorized)
      return;
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
          reconciliation_status:
            mismatchCount === 0 ? "Matched" : "Discrepancy Flagged",
          csv_file_url: csvPath,
          html_file_url: htmlPath,
        },
      ]);
      if (error) throw error;

      await logSystemTelemetry({
        actorId: partner.id,
        actorEmail: partner.email,
        module: "PARTNER_AADHAAR_WEEKLY",
        actionCode: "WEEKLY_REPORT_SUBMITTED",
        referenceId: `${weekStart}_${weekEnd}`,
        metadata: {
          packets: weeklyPreview.total_packets_qty,
          cash: weeklyPreview.total_cash_collected,
          mismatches: mismatchCount,
        },
      });

      showBanner(
        "success",
        "✅ Weekly Report synced and cross-verified against Daily Reports!"
      );
      setWeekCsv(null);
      setWeekHtml(null);
      setWeeklyPreview(null);
      await initializeAadhaarPortal();
      setActiveMenu("history");
    } catch (err: any) {
      const safeMsg = await reportAndMaskError(err, "PARTNER_AADHAAR_WEEKLY", {
        id: partner?.id,
        email: partner?.email,
      });
      showBanner("error", safeMsg);
    } finally {
      setIsSubmittingWeekly(false);
    }
  };

  const handleDownloadRawFile = async (path: string | null) => {
    if (!path)
      return showBanner("info", "File not available (Manual / Exemption entry).");
    const { data, error } = await supabase.storage
      .from("aadhaar-reports")
      .createSignedUrl(path, 120);
    if (error || !data?.signedUrl)
      return showBanner("error", "[ERR-VLT-301] Unable to generate download link.");
    window.open(data.signedUrl, "_blank");
  };

  const handleViewDepositSlip = async (path: string | null) => {
    if (!path) return showBanner("info", "No deposit slip attached (Exempted).");
    if (path.startsWith("http")) {
      window.open(path, "_blank");
      return;
    }
    const { data, error } = await supabase.storage
      .from("deposit-slips")
      .createSignedUrl(path, 120);
    if (error || !data?.signedUrl)
      return showBanner("error", "[ERR-VLT-301] Unable to open deposit slip.");
    window.open(data.signedUrl, "_blank");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white font-black uppercase tracking-widest text-xs animate-pulse">
        Verifying Aadhaar Seva Kendra Clearance...
      </div>
    );
  }

  const filteredHistory = dailyReports.filter((r) => {
    const dMatch = r.report_date >= filterFromDate && r.report_date <= filterToDate;
    const mMatch =
      fileModeFilter === "ALL"
        ? true
        : fileModeFilter === "WITH_FILES"
        ? r.has_files === true
        : r.has_files === false;
    return dMatch && mMatch;
  });

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
    {
      cat1: 0,
      cat2: 0,
      cat3: 0,
      cat4: 0,
      cat5: 0,
      pkts: 0,
      comp: 0,
      inproc: 0,
      rej: 0,
      cash: 0,
    }
  );

  // REQUIREMENT #4: Deduction Formula (Total Collection - Total Deposit = Remaining Balance Payable)
  const totalCollectionCash = dailyReports.reduce(
    (s, r) => s + Number(r.total_cash_collected || 0),
    0
  );
  const totalDepositedCash = aadhaarDeposits
    .filter((d) => d.status !== "Discrepancy")
    .reduce((s, d) => s + Number(d.deposit_amount || 0), 0);
  const unpaidPenaltyTotal = penalties
    .filter((p) => !p.is_settled && !p.is_waived)
    .reduce((s, p) => s + Number(p.penalty_amount || 0), 0);
  const pendingReportCash = Math.max(0, totalCollectionCash - totalDepositedCash);
  const totalPayableNow = Math.max(
    0,
    totalCollectionCash + unpaidPenaltyTotal - totalDepositedCash
  );

  const parsedQrAmount = parseFloat(qrPayAmount) || 0;
  const safeQrAmount = parsedQrAmount.toFixed(2);
  const upiDeepLink = `upi://pay?pa=${centerUpi}&pn=${encodeURIComponent(
    "Fast Ark Aadhaar"
  )}&am=${safeQrAmount}&cu=INR&tn=${encodeURIComponent(
    `Aadhaar_${partner?.aadhaar_station_id || partner?.center_id}`
  )}`;

  const parsedReceiptAmount = parseFloat(depositForm.amount) || 0;
  const isPdfSlip =
    slipFile?.type === "application/pdf" ||
    (slipFile?.name || "").toLowerCase().endsWith(".pdf");

  const effectiveMenu: AadhaarMenuTab = isAadhaarAuthorized ? activeMenu : "upgrade";
  const isDownloadReady = Boolean(
    filterFromDate &&
      filterToDate &&
      filteredHistory.length > 0 &&
      confirmDownloadCheck
  );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row font-sans">
      <AadhaarSidebar
        activeMenu={effectiveMenu}
        setActiveMenu={setActiveMenu}
        partner={partner}
        isAadhaarAuthorized={isAadhaarAuthorized}
        totalCollectionCash={totalCollectionCash}
        totalDepositedCash={totalDepositedCash}
        pendingReportCash={pendingReportCash}
        unpaidPenaltyTotal={unpaidPenaltyTotal}
        overdueDaysCount={penalties.filter((p) => !p.is_waived && !p.is_settled).length}
        onSignOut={async () => {
          await supabase.auth.signOut();
          router.push("/partner/login");
        }}
      />

      <main className="flex-1 p-4 md:p-8 pb-24 lg:pb-8 overflow-y-auto space-y-6 max-w-[1400px]">
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
            <button
              onClick={() => setStatusBanner(null)}
              className="font-black text-base px-2"
            >
              ✕
            </button>
          </div>
        )}

        {isAadhaarAuthorized && unpaidPenaltyTotal > 0 && (
          <div className="bg-red-600 text-white p-4 rounded-xl shadow-lg border-2 border-red-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-pulse">
            <div>
              <h3 className="font-black text-base uppercase tracking-widest flex items-center gap-2">
                <span>🚨</span> Late Payment Penalty Active (₹100 / Day)
              </h3>
              <p className="text-xs font-bold text-red-100 mt-1">
                You have {penalties.length} overdue day(s) of unsettled Aadhaar collections.
                ₹{unpaidPenaltyTotal} has been added to your closing ledger.
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

        {/* GLOBAL 7-PRESET DATE DROPDOWN (WEEK / MONTH / CUSTOM) + DOWNLOAD GATE */}
        {isAadhaarAuthorized && (
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[9px] font-black uppercase text-indigo-600 tracking-widest mb-1">
                  1. Period Filter (Week / Month / Custom)
                </label>
                <select
                  value={datePreset}
                  onChange={(e) => handlePresetChange(e.target.value as DatePresetMode)}
                  className="w-full border-2 border-indigo-200 p-2 rounded-lg text-xs font-black text-indigo-950 bg-indigo-50 outline-none focus:border-indigo-600"
                >
                  <option value="today">
                    Today ({formatToDDMMYYYY(getDateRangeFromPreset("today").start)})
                  </option>
                  <option value="yesterday">
                    Yesterday ({formatToDDMMYYYY(getDateRangeFromPreset("yesterday").start)})
                  </option>
                  <option value="current_week">Current Week</option>
                  <option value="current_month">Current Month</option>
                  <option value="previous_month">Previous Month</option>
                  <option value="all">All Time</option>
                  <option value="custom">Custom Date Filter</option>
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
                    setConfirmDownloadCheck(false);
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
                    setConfirmDownloadCheck(false);
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
                  onChange={(e) => {
                    setFileModeFilter(e.target.value as any);
                    setConfirmDownloadCheck(false);
                  }}
                  className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-black text-slate-800 bg-slate-50 outline-none focus:border-blue-600"
                >
                  <option value="ALL">📋 Both (With &amp; Without Files)</option>
                  <option value="WITH_FILES">✅ With CSV &amp; HTML Files Only</option>
                  <option value="WITHOUT_FILES">
                    ⚠️ Without Files (Manual / Exemption)
                  </option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <label className="flex items-center gap-2.5 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmDownloadCheck}
                  disabled={filteredHistory.length === 0}
                  onChange={(e) => setConfirmDownloadCheck(e.target.checked)}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="text-[11px] font-bold text-slate-800">
                  I confirm the selected filter details ({formatToDDMMYYYY(filterFromDate)} to{" "}
                  {formatToDDMMYYYY(filterToDate)} • {filteredHistory.length} records) and
                  request report download.
                </span>
              </label>

              <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  disabled={!isDownloadReady}
                  onClick={() =>
                    downloadAadhaarPDFReport(
                      filteredHistory,
                      fileModeFilter,
                      `${partner?.partner_name} (Op: ${
                        partner?.aadhaar_operator_id
                      } | Stn: ${partner?.aadhaar_station_id || "N/A"})`
                    )
                  }
                  className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                >
                  📄 Download PDF
                </button>
                <button
                  type="button"
                  disabled={!isDownloadReady}
                  onClick={() => downloadAadhaarCSVReport(filteredHistory, fileModeFilter)}
                  className="flex-1 sm:flex-none bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
                >
                  📊 Download CSV
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 1: DASHBOARD & COUNTS + BALANCE PAYABLE SUMMARY */}
        {isAadhaarAuthorized && effectiveMenu === "overview" && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  1. New Enrolment
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat1}</p>
                <p className="text-[10px] font-bold text-emerald-600 mt-1">Free (₹0.00)</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-teal-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  2. MBU Free
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat2}</p>
                <p className="text-[10px] font-bold text-teal-600 mt-1">
                  Mandatory Bio (₹0.00)
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-amber-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  3. MBU Chargeable
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat3}</p>
                <p className="text-[10px] font-bold text-amber-600 mt-1">
                  Rate: ₹{activeTariff?.mbu_chargeable_fee || 125}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-blue-500">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  4. Demographic
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat4}</p>
                <p className="text-[10px] font-bold text-blue-600 mt-1">
                  Rate: ₹{activeTariff?.demographic_fee || 75}
                </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-purple-600 col-span-2 md:col-span-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  5. Biometric Update
                </p>
                <p className="text-3xl font-black text-slate-900 mt-1">{totals.cat5}</p>
                <p className="text-[10px] font-bold text-purple-600 mt-1">
                  Rate: ₹{activeTariff?.biometric_fee || 125}
                </p>
              </div>
            </div>

            <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl grid grid-cols-2 md:grid-cols-5 gap-6">
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  Total Packets (Period)
                </p>
                <p className="text-3xl font-black text-white mt-1">{totals.pkts}</p>
                <p className="text-[10px] text-emerald-400 font-bold mt-1">
                  ✅ {totals.comp} Completed | ❌ {totals.rej} Rej
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">
                  Total Collection
                </p>
                <p className="text-2xl font-black text-white mt-1">
                  ₹{totalCollectionCash.toLocaleString("en-IN")}
                </p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  Period: ₹{totals.cash.toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">
                  Less: Total Deposited
                </p>
                <p className="text-2xl font-black text-emerald-400 mt-1">
                  - ₹{totalDepositedCash.toLocaleString("en-IN")}
                </p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  {aadhaarDeposits.length} Remittance(s)
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-amber-400 tracking-widest">
                  Balance Payable
                </p>
                <p className="text-3xl font-black text-amber-400 mt-1">
                  ₹{totalPayableNow.toLocaleString("en-IN")}
                </p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  Incl. ₹{unpaidPenaltyTotal} Penalty
                </p>
              </div>
              <div className="flex flex-col justify-center gap-2 col-span-2 md:col-span-1">
                <button
                  onClick={() => setActiveMenu("daily")}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-[10px] uppercase tracking-widest rounded-xl shadow-lg transition"
                >
                  📤 Upload Daily Report
                </button>
                <button
                  onClick={() => setActiveMenu("history")}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 font-black text-[10px] uppercase tracking-widest rounded-xl border border-slate-700 transition"
                >
                  📖 View Deposits &amp; Files
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: DAILY REPORT UPLOAD */}
        {isAadhaarAuthorized && effectiveMenu === "daily" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6 animate-in fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-4 gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  Daily Aadhaar Report Submission
                </h2>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  Select date (DD/MM/YYYY). Once a report is submitted for a date, duplicate
                  submissions are strictly locked.
                </p>
              </div>
              {!existingDailyForSelectedDate && (
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
              )}
            </div>

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
                  onChange={(e) => {
                    setReportDate(e.target.value);
                    setParsedPreview(null);
                    setParseError("");
                    setConfirmDailyCheck(false);
                  }}
                  className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-bold text-sm bg-white outline-none focus:border-blue-600"
                />
              </div>
              <div className="flex flex-col justify-center bg-white p-3 rounded-lg border border-slate-200">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">
                  Selected Date (Indian Format)
                </span>
                <span className="text-2xl font-black text-blue-700 mt-0.5">
                  {formatToDDMMYYYY(reportDate)}
                </span>
              </div>
              <div className="flex flex-col justify-center bg-white p-3 rounded-lg border border-slate-200">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">
                  Active UIDAI Tariff ({formatToDDMMYYYY(reportDate)})
                </span>
                <span className="text-xs font-black text-slate-800 mt-1">
                  Demo: ₹{activeTariff?.demographic_fee || 75} | Bio/MBU: ₹
                  {activeTariff?.biometric_fee || 125}
                </span>
              </div>
            </div>

            {existingDailyForSelectedDate ? (
              <div className="bg-slate-900 text-white p-6 rounded-2xl border-2 border-emerald-500/60 space-y-5 shadow-xl">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🔒</span>
                    <div>
                      <h3 className="font-black text-base uppercase tracking-wider text-emerald-400">
                        Report Already Submitted for {formatToDDMMYYYY(reportDate)} — Date
                        Locked
                      </h3>
                      <p className="text-xs font-bold text-slate-300 mt-0.5">
                        Re-submitting or overwriting an existing daily report is strictly
                        prohibited.
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    {existingDailyForSelectedDate.deposit_status}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
                  <div className="bg-slate-800 p-3 rounded-lg">
                    <p className="text-[9px] text-slate-400 uppercase font-bold">1. New</p>
                    <p className="text-xl font-black">
                      {existingDailyForSelectedDate.cat1_new_qty}
                    </p>
                  </div>
                  <div className="bg-slate-800 p-3 rounded-lg">
                    <p className="text-[9px] text-slate-400 uppercase font-bold">
                      2. MBU Free
                    </p>
                    <p className="text-xl font-black">
                      {existingDailyForSelectedDate.cat2_mbu_free_qty}
                    </p>
                  </div>
                  <div className="bg-slate-800 p-3 rounded-lg">
                    <p className="text-[9px] text-amber-400 uppercase font-bold">
                      3. MBU Paid
                    </p>
                    <p className="text-xl font-black text-amber-400">
                      {existingDailyForSelectedDate.cat3_mbu_chargeable_qty}
                    </p>
                  </div>
                  <div className="bg-slate-800 p-3 rounded-lg">
                    <p className="text-[9px] text-blue-400 uppercase font-bold">
                      4. Demographic
                    </p>
                    <p className="text-xl font-black text-blue-400">
                      {existingDailyForSelectedDate.cat4_demographic_qty}
                    </p>
                  </div>
                  <div className="bg-slate-800 p-3 rounded-lg">
                    <p className="text-[9px] text-purple-400 uppercase font-bold">
                      5. Biometric
                    </p>
                    <p className="text-xl font-black text-purple-400">
                      {existingDailyForSelectedDate.cat5_biometric_qty}
                    </p>
                  </div>
                  <div className="bg-emerald-950 border border-emerald-700 p-3 rounded-lg">
                    <p className="text-[9px] text-emerald-300 uppercase font-black">
                      Logged Cash
                    </p>
                    <p className="text-xl font-black text-white">
                      ₹
                      {Number(
                        existingDailyForSelectedDate.total_cash_collected || 0
                      ).toLocaleString("en-IN")}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  {existingDailyForSelectedDate.edit_request_status === "Pending" ? (
                    <span className="text-xs font-black text-amber-400 uppercase tracking-wider">
                      ⏳ Correction Request Pending Back-Office Audit (
                      {existingDailyForSelectedDate.edit_request_reason})
                    </span>
                  ) : requestingCorrectionId === existingDailyForSelectedDate.id ? (
                    <div className="w-full flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        placeholder="Describe what needs correction by Admin..."
                        value={correctionReasonText}
                        onChange={(e) => setCorrectionReasonText(e.target.value)}
                        className="flex-1 bg-slate-800 border border-slate-700 text-white p-2.5 rounded-lg text-xs font-bold outline-none"
                      />
                      <button
                        type="button"
                        disabled={isSendingCorrectionReq}
                        onClick={() =>
                          handleSendDailyCorrectionRequest(existingDailyForSelectedDate.id)
                        }
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2 rounded-lg text-[10px] uppercase"
                      >
                        {isSendingCorrectionReq ? "Sending..." : "Submit Request"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRequestingCorrectionId(null)}
                        className="bg-slate-700 text-white font-black px-3 py-2 rounded-lg text-[10px] uppercase"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-[11px] font-bold text-slate-400">
                        Need an adjustment on this locked date? Only Corporate Admin can audit
                        and edit submitted reports.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setRequestingCorrectionId(existingDailyForSelectedDate.id);
                          setCorrectionReasonText("");
                        }}
                        className="bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-amber-400 border border-amber-500/40 font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest transition shrink-0"
                      >
                        📝 Request Admin Correction
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleDailySubmit} className="space-y-6">
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
                      <p className="text-[10px] font-bold text-slate-500 mt-1">
                        Contains 20-column packet telemetry
                      </p>
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
                        <option value="CENTER_HOLIDAY">
                          1. Center Holiday / Sunday Closed (0 Enrolments)
                        </option>
                        <option value="OPERATOR_LEAVE">
                          2. Operator on Leave / Absent (0 Enrolments)
                        </option>
                        <option value="SERVER_L1_DOWN">
                          3. UIDAI Server / L1 Device Down (0 Enrolments)
                        </option>
                        <option value="POWER_NETWORK_OUTAGE">
                          4. Electricity / Network Outage (0 Enrolments)
                        </option>
                        <option value="ECMP_CRASH_MANUAL">
                          5. ECMP Client Crash — Enter Packet Counts Manually
                        </option>
                      </select>
                    </div>

                    {exemptionReason === "ECMP_CRASH_MANUAL" && (
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
                        <div>
                          <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                            1. New (₹0)
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="0"
                            value={manualCounts.cat1 || ""}
                            onWheel={handleNumericWheel}
                            onKeyDown={handleNumericKeyDown}
                            onChange={(e) =>
                              setManualCounts({
                                ...manualCounts,
                                cat1: Math.max(0, parseInt(e.target.value, 10) || 0),
                              })
                            }
                            className={noScrollNumClass}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                            2. MBU Free (₹0)
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="0"
                            value={manualCounts.cat2 || ""}
                            onWheel={handleNumericWheel}
                            onKeyDown={handleNumericKeyDown}
                            onChange={(e) =>
                              setManualCounts({
                                ...manualCounts,
                                cat2: Math.max(0, parseInt(e.target.value, 10) || 0),
                              })
                            }
                            className={noScrollNumClass}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase text-amber-800 block mb-1">
                            3. MBU Paid (₹{activeTariff?.mbu_chargeable_fee || 125})
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="0"
                            value={manualCounts.cat3 || ""}
                            onWheel={handleNumericWheel}
                            onKeyDown={handleNumericKeyDown}
                            onChange={(e) =>
                              setManualCounts({
                                ...manualCounts,
                                cat3: Math.max(0, parseInt(e.target.value, 10) || 0),
                              })
                            }
                            className={noScrollNumClass}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase text-blue-800 block mb-1">
                            4. Demo (₹{activeTariff?.demographic_fee || 75})
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="0"
                            value={manualCounts.cat4 || ""}
                            onWheel={handleNumericWheel}
                            onKeyDown={handleNumericKeyDown}
                            onChange={(e) =>
                              setManualCounts({
                                ...manualCounts,
                                cat4: Math.max(0, parseInt(e.target.value, 10) || 0),
                              })
                            }
                            className={noScrollNumClass}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase text-purple-800 block mb-1">
                            5. Bio (₹{activeTariff?.biometric_fee || 125})
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="0"
                            value={manualCounts.cat5 || ""}
                            onWheel={handleNumericWheel}
                            onKeyDown={handleNumericKeyDown}
                            onChange={(e) =>
                              setManualCounts({
                                ...manualCounts,
                                cat5: Math.max(0, parseInt(e.target.value, 10) || 0),
                              })
                            }
                            className={noScrollNumClass}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {parseError && (
                  <div className="p-4 bg-red-50 border-2 border-red-300 rounded-xl text-red-800 text-xs font-black">
                    ❌ {parseError}
                  </div>
                )}

                {(parsedPreview || (isManualMode && exemptionReason)) && (
                  <div className="bg-slate-900 text-white p-5 rounded-xl space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                      <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                        ✅ 5-Category Verification Summary ({formatToDDMMYYYY(reportDate)})
                      </span>
                      <span className="text-xs font-bold text-slate-300">
                        Operator:{" "}
                        {isManualMode
                          ? partner?.aadhaar_operator_id
                          : parsedPreview?.operator_id}{" "}
                        | Station:{" "}
                        {isManualMode
                          ? partner?.aadhaar_station_id
                          : parsedPreview?.station_id}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
                      <div className="bg-slate-800 p-3 rounded-lg">
                        <p className="text-[9px] text-slate-400 uppercase font-bold">
                          1. New (₹0)
                        </p>
                        <p className="text-xl font-black">
                          {isManualMode
                            ? isZeroExemption
                              ? 0
                              : manualCounts.cat1
                            : parsedPreview.cat1_new_qty}
                        </p>
                      </div>
                      <div className="bg-slate-800 p-3 rounded-lg">
                        <p className="text-[9px] text-slate-400 uppercase font-bold">
                          2. MBU Free
                        </p>
                        <p className="text-xl font-black">
                          {isManualMode
                            ? isZeroExemption
                              ? 0
                              : manualCounts.cat2
                            : parsedPreview.cat2_mbu_free_qty}
                        </p>
                      </div>
                      <div className="bg-slate-800 p-3 rounded-lg">
                        <p className="text-[9px] text-amber-400 uppercase font-bold">
                          3. MBU Paid
                        </p>
                        <p className="text-xl font-black text-amber-400">
                          {isManualMode
                            ? isZeroExemption
                              ? 0
                              : manualCounts.cat3
                            : parsedPreview.cat3_mbu_chargeable_qty}
                        </p>
                      </div>
                      <div className="bg-slate-800 p-3 rounded-lg">
                        <p className="text-[9px] text-blue-400 uppercase font-bold">
                          4. Demographic
                        </p>
                        <p className="text-xl font-black text-blue-400">
                          {isManualMode
                            ? isZeroExemption
                              ? 0
                              : manualCounts.cat4
                            : parsedPreview.cat4_demographic_qty}
                        </p>
                      </div>
                      <div className="bg-slate-800 p-3 rounded-lg">
                        <p className="text-[9px] text-purple-400 uppercase font-bold">
                          5. Biometric
                        </p>
                        <p className="text-xl font-black text-purple-400">
                          {isManualMode
                            ? isZeroExemption
                              ? 0
                              : manualCounts.cat5
                            : parsedPreview.cat5_biometric_qty}
                        </p>
                      </div>
                      <div className="bg-emerald-950 border border-emerald-700 p-3 rounded-lg">
                        <p className="text-[9px] text-emerald-300 uppercase font-black">
                          Cash Collected
                        </p>
                        <p className="text-xl font-black text-white">
                          ₹
                          {(isManualMode
                            ? manualCashTotal
                            : parsedPreview.total_cash_collected
                          ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
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
                          ₹
                          {(isManualMode
                            ? manualCashTotal
                            : parsedPreview.total_cash_collected
                          ).toLocaleString("en-IN")}
                        </strong>{" "}
                        collected amount for <strong>{formatToDDMMYYYY(reportDate)}</strong>{" "}
                        are accurate.
                      </span>
                    </label>

                    <button
                      type="submit"
                      disabled={isSubmittingDaily || !confirmDailyCheck}
                      className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-widest text-sm rounded-xl shadow-lg disabled:opacity-40 transition"
                    >
                      {isSubmittingDaily
                        ? "Committing Report..."
                        : "Submit Daily Report & Unlock Deposit QR \u2192"}
                    </button>
                  </div>
                )}
              </form>
            )}
          </div>
        )}

        {/* VIEW 3: SEPARATED REMITTANCE WORKSPACE (WITH UNIQUE UTR, TXN ID & REF CODE) */}
        {isAadhaarAuthorized && effectiveMenu === "deposit" && (
          <div className="space-y-6 animate-in fade-in">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 block">
                  Choose Remittance Channel
                </span>
                <h2 className="text-xl font-black text-slate-900 mt-0.5">
                  Aadhaar Cash Settlement &amp; OCR Receipt Verification
                </h2>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  Total Collection:{" "}
                  <strong>₹{totalCollectionCash.toLocaleString("en-IN")}</strong> &bull; Less
                  Deposited:{" "}
                  <strong className="text-emerald-600">
                    -₹{totalDepositedCash.toLocaleString("en-IN")}
                  </strong>{" "}
                  &bull; Late Fine:{" "}
                  <strong className="text-red-600">
                    +₹{unpaidPenaltyTotal.toLocaleString("en-IN")}
                  </strong>{" "}
                  &rarr; Balance Payable:{" "}
                  <strong className="text-red-600 text-sm">
                    ₹{totalPayableNow.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </strong>
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full lg:w-auto">
                <button
                  type="button"
                  onClick={() => handleSwitchRemittanceTrack("UPI_QR")}
                  className={`px-5 py-3.5 rounded-xl font-black text-xs uppercase tracking-wider border-2 transition flex items-center justify-center gap-2 ${
                    remittanceTrack === "UPI_QR"
                      ? "bg-slate-900 text-white border-slate-900 shadow-lg"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span>📲</span> Mode 1: Pay via UPI QR &amp; Upload Slip
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchRemittanceTrack("BANK_TRANSFER")}
                  className={`px-5 py-3.5 rounded-xl font-black text-xs uppercase tracking-wider border-2 transition flex items-center justify-center gap-2 ${
                    remittanceTrack === "BANK_TRANSFER"
                      ? "bg-amber-500 text-slate-950 border-amber-600 shadow-lg"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span>🏦</span> Mode 2: Bank Cash / NEFT / IMPS
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="space-y-6">
                {remittanceTrack === "UPI_QR" ? (
                  <div className="bg-slate-900 text-white rounded-2xl p-6 border border-slate-800 shadow-xl space-y-5">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block">
                          Step 1 of 2 — Isolated UPI QR Generator
                        </span>
                        <h3 className="text-lg font-black mt-0.5">
                          Generate QR &amp; Pay via UPI App
                        </h3>
                      </div>
                      <span className="bg-slate-800 text-slate-300 text-[10px] font-black px-2.5 py-1 rounded border border-slate-700">
                        UPI ID: {centerUpi}
                      </span>
                    </div>

                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-left space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black uppercase text-amber-400 tracking-widest">
                          QR Generation Amount (₹) — Separate from Receipt OCR
                        </label>
                        {totalPayableNow > 0 && (
                          <button
                            type="button"
                            onClick={() => setQrPayAmount(totalPayableNow.toFixed(2))}
                            className="text-[9px] font-black uppercase bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white px-2 py-0.5 rounded border border-blue-500/40 transition"
                          >
                            Reset to Balance Payable (₹{totalPayableNow})
                          </button>
                        )}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Enter amount to generate QR..."
                        value={qrPayAmount}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) => setQrPayAmount(e.target.value)}
                        className="w-full bg-slate-900 border-2 border-slate-700 focus:border-emerald-500 text-white font-black text-xl p-3 rounded-lg outline-none transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>

                    <div className="flex flex-col items-center text-center pt-2">
                      <div className="bg-white p-4 rounded-2xl shadow-lg mb-4">
                        <QRCodeSVG value={upiDeepLink} size={185} level="M" />
                      </div>
                      <p className="text-3xl font-black text-emerald-400">
                        ₹{parsedQrAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-1">
                        Scan with any UPI App or Tap Below on Mobile
                      </p>

                      {parsedQrAmount > 0 && (
                        <a
                          href={upiDeepLink}
                          className="mt-4 w-full max-w-sm py-3.5 px-5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                        >
                          <span>📲</span> Tap to Pay ₹
                          {parsedQrAmount.toLocaleString("en-IN")} via UPI App
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900 text-white rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4">
                    <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest inline-block">
                      Bank Counter / Online Transfer Mode
                    </span>
                    <h3 className="text-xl font-black">
                      Bank Cash Deposit / NEFT / IMPS / Cheque Remittance
                    </h3>
                    <p className="text-xs text-slate-300 font-medium leading-relaxed">
                      Upload your physical Bank Cash Deposit Challan or NEFT/IMPS advice on
                      the right — the enhanced OCR engine will automatically read the
                      collected amount, date, Unique UTR, and Transaction ID from your slip.
                    </p>
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-400 uppercase">
                        Remaining Balance Payable:
                      </span>
                      <span className="text-2xl font-black text-amber-400">
                        ₹
                        {totalPayableNow.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                )}

                {!isSlipExempted && slipPreviewUrl && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-3.5 bg-slate-900 text-white flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-widest">
                        📄 Uploaded Receipt Preview
                      </span>
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

              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
                <div className="border-b border-slate-100 pb-3 flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 block">
                      {remittanceTrack === "UPI_QR"
                        ? "Step 2 of 2 — Upload UPI Screenshot & Auto-Read OCR"
                        : "Upload Bank Slip / Challan & Auto-Read OCR"}
                    </span>
                    <h3 className="font-black text-lg text-slate-900 mt-0.5">
                      Receipt Verification &amp; Unique UTR Record
                    </h3>
                  </div>
                  <div className="text-right bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-lg">
                    <span className="text-[8px] font-black uppercase text-indigo-500 block">
                      Auto Reference Code
                    </span>
                    <span className="font-mono font-black text-xs text-indigo-900">
                      {depositForm.reference_code}
                    </span>
                  </div>
                </div>

                <form onSubmit={handleInstantDepositSubmit} className="space-y-4">
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <input
                        type="checkbox"
                        checked={isSlipExempted}
                        onChange={(e) => {
                          setIsSlipExempted(e.target.checked);
                          setSlipFile(null);
                          if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
                          setSlipPreviewUrl(null);
                          setOcrSummary({
                            platform: null,
                            amount: null,
                            utr: null,
                            transactionId: null,
                            date: null,
                          });
                          setSlipExemptionCategory("");
                          setSlipExemptionOtherText("");
                          setConfirmDepositCheck(false);
                        }}
                        className="w-5 h-5 accent-amber-600"
                      />
                      <span className="font-bold text-xs text-slate-800">
                        No deposit slip available (Select Missing Slip Reason)
                      </span>
                    </label>

                    {!isSlipExempted ? (
                      <div className="p-4 border-2 border-dashed border-blue-300 bg-blue-50/40 rounded-xl">
                        <label className="block text-[10px] font-black uppercase text-blue-800 mb-1.5">
                          1. Upload{" "}
                          {remittanceTrack === "UPI_QR"
                            ? "UPI Screenshot"
                            : "Bank Deposit Slip / Advice"}{" "}
                          (Enhanced OCR Auto-Reads Amount, UTR &amp; Txn ID) *
                        </label>
                        <input
                          type="file"
                          accept="image/*,application/pdf,.pdf"
                          required={!isSlipExempted}
                          onChange={handleSlipUploadOCR}
                          className="w-full text-xs font-bold cursor-pointer"
                        />
                        {isScanningSlip && (
                          <div className="mt-3 p-3 bg-blue-100/80 border border-blue-300 rounded-lg text-center">
                            <p className="text-[10px] font-black text-blue-800 uppercase animate-pulse">
                              🔍 Pre-processing Contrast &amp; Reading Amount, Date, UTR &amp;
                              Txn ID ({scanProgress}%)...
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 space-y-3 animate-in fade-in">
                        <div>
                          <label className="text-[10px] text-amber-800 font-black uppercase tracking-widest block mb-1">
                            1. Reason for Missing Deposit Slip *
                          </label>
                          <select
                            required={isSlipExempted}
                            value={slipExemptionCategory}
                            onChange={(e) => {
                              setSlipExemptionCategory(e.target.value);
                              setSlipExemptionOtherText("");
                            }}
                            className="w-full bg-white border-2 border-amber-300 text-slate-800 font-bold text-xs rounded-lg p-2.5 outline-none focus:border-amber-600"
                          >
                            <option value="" disabled>
                              -- Select Missing Slip Reason --
                            </option>
                            <option value="Missing">Missing / Lost Physical Slip</option>
                            <option value="Not downloaded">
                              Receipt Not Downloaded / UPI App Error
                            </option>
                            <option value="Other">Other (Specify Below)</option>
                          </select>
                        </div>

                        {slipExemptionCategory === "Other" && (
                          <div>
                            <label className="text-[10px] text-amber-800 font-black uppercase tracking-widest block mb-1">
                              Detailed Exemption Remarks *
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="TYPE DETAILED REASON HERE..."
                              value={slipExemptionOtherText}
                              onChange={(e) =>
                                setSlipExemptionOtherText(e.target.value.toUpperCase())
                              }
                              className="w-full bg-white border-2 border-amber-300 text-slate-900 font-black uppercase text-xs rounded-lg p-2.5 outline-none"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {!isScanningSlip && !isSlipExempted && slipFile && ocrSummary.platform && (
                    <div className="bg-slate-900 text-white rounded-xl p-4 space-y-2.5 border border-slate-800">
                      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">
                          ✅ Enhanced OCR Capture Summary
                        </span>
                        <span className="text-[10px] font-black bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded border border-blue-700">
                          {ocrSummary.platform}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-slate-800 p-2 rounded">
                          <p className="text-[9px] text-slate-400 uppercase">OCR Amount</p>
                          <p className="font-black text-emerald-400">
                            {ocrSummary.amount !== null
                              ? `₹${ocrSummary.amount.toLocaleString("en-IN")}`
                              : "Enter Below"}
                          </p>
                        </div>
                        <div className="bg-slate-800 p-2 rounded">
                          <p className="text-[9px] text-slate-400 uppercase">OCR Date</p>
                          <p className="font-bold text-slate-200">
                            {ocrSummary.date
                              ? formatToDDMMYYYY(ocrSummary.date)
                              : "Verify Below"}
                          </p>
                        </div>
                        <div className="bg-slate-800 p-2 rounded">
                          <p className="text-[9px] text-slate-400 uppercase">OCR UTR</p>
                          <p className="font-bold text-slate-200 truncate">
                            {ocrSummary.utr || "Enter Below"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-emerald-700 mb-1">
                        2. Deposit Amount (₹) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="Auto-filled from OCR slip..."
                        value={depositForm.amount}
                        onWheel={handleNumericWheel}
                        onKeyDown={handleNumericKeyDown}
                        onChange={(e) =>
                          setDepositForm({ ...depositForm, amount: e.target.value })
                        }
                        className="w-full border-2 border-emerald-300 bg-emerald-50/30 p-3 rounded-lg font-black text-lg text-slate-900 outline-none focus:border-emerald-600 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase text-blue-700 mb-1">
                        3. Deposit Date ({formatToDDMMYYYY(depositForm.date)}) *
                      </label>
                      <input
                        type="date"
                        required
                        max={getISTDateString(0)}
                        value={depositForm.date}
                        onChange={(e) =>
                          setDepositForm({
                            ...depositForm,
                            date: e.target.value,
                            reference_code: generateSystemReferenceCode(
                              "FA-ADH",
                              e.target.value
                            ),
                          })
                        }
                        className="w-full border-2 border-slate-200 p-3 rounded-lg font-bold text-sm text-slate-900 bg-white outline-none focus:border-blue-600 transition"
                      />
                    </div>
                  </div>

                  {/* 3 DISTINCT IDENTIFIERS: UNIQUE UTR, TRANSACTION ID & SYSTEM REFERENCE CODE */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                        4. Unique Bank / UPI UTR Number *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Unique UTR / RRN Number..."
                        value={depositForm.utr}
                        onChange={(e) =>
                          setDepositForm({
                            ...depositForm,
                            utr: e.target.value.toUpperCase(),
                          })
                        }
                        className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-black text-xs uppercase outline-none focus:border-blue-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                        5. Bank Transaction / Scroll ID *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Txn / Journal / Scroll No..."
                        value={depositForm.transaction_id}
                        onChange={(e) =>
                          setDepositForm({
                            ...depositForm,
                            transaction_id: e.target.value.toUpperCase(),
                          })
                        }
                        className="w-full border-2 border-slate-300 p-2.5 rounded-lg font-bold text-xs uppercase outline-none focus:border-blue-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                        6. Remittance Method
                      </label>
                      {remittanceTrack === "UPI_QR" ? (
                        <input
                          type="text"
                          readOnly
                          value="UPI (QR / App Payment)"
                          className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black text-xs bg-slate-100 text-slate-700 cursor-not-allowed"
                        />
                      ) : (
                        <select
                          value={
                            depositForm.method === "UPI"
                              ? "Cash Deposit"
                              : depositForm.method
                          }
                          onChange={(e) =>
                            setDepositForm({ ...depositForm, method: e.target.value })
                          }
                          className="w-full border-2 border-amber-300 p-2.5 rounded-lg font-black text-xs bg-amber-50/40 text-slate-900 outline-none focus:border-amber-600"
                        >
                          <option value="Cash Deposit">Bank Counter Cash Deposit</option>
                          <option value="NEFT/RTGS">NEFT / RTGS Transfer</option>
                          <option value="IMPS">IMPS Transfer</option>
                          <option value="Cheque">Bank Cheque Deposit</option>
                        </select>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase text-indigo-700 mb-1">
                        7. System Reference Code (Locked for Records)
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={depositForm.reference_code}
                        className="w-full border-2 border-indigo-200 p-2.5 rounded-lg font-mono font-black text-xs bg-indigo-50 text-indigo-900 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 bg-blue-50 p-3.5 rounded-xl border border-blue-200 cursor-pointer">
                    <input
                      type="checkbox"
                      required
                      checked={confirmDepositCheck}
                      onChange={(e) => setConfirmDepositCheck(e.target.checked)}
                      className="w-4 h-4 accent-blue-600 mt-0.5 shrink-0"
                    />
                    <span className="text-xs font-bold text-blue-950 leading-snug">
                      I confirm that the Deposit Amount (
                      <strong>
                        ₹
                        {parsedReceiptAmount.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </strong>
                      ), Unique UTR (<strong>{depositForm.utr || "N/A"}</strong>),
                      Transaction ID (
                      <strong>{depositForm.transaction_id || "N/A"}</strong>), and Reference
                      Code (<strong>{depositForm.reference_code}</strong>) match my payment
                      receipt.
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSubmittingDeposit || isScanningSlip || !confirmDepositCheck}
                    className="w-full py-4 bg-slate-900 hover:bg-blue-600 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-md disabled:opacity-40 transition"
                  >
                    {isSubmittingDeposit
                      ? "Submitting Remittance..."
                      : `Submit ₹${parsedReceiptAmount.toLocaleString("en-IN")} Remittance (${
                          depositForm.reference_code
                        })`}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: WEEKLY REPORT RECONCILIATION (MONDAY TO SUNDAY) */}
        {isAadhaarAuthorized && effectiveMenu === "weekly" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6 animate-in fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  Weekly UIDAI Report Reconciliation (Monday to Sunday)
                </h2>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  Pick any date in the week — the system automatically snaps to Monday
                  (Start) and consecutive Sunday (End).
                </p>
              </div>
              <span className="bg-indigo-50 text-indigo-800 border border-indigo-200 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest">
                📅 {formatToDDMMYYYY(weekStart)} (Mon) &rarr; {formatToDDMMYYYY(weekEnd)}{" "}
                (Sun)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[10px] font-black uppercase text-blue-700 mb-1">
                  1. Select Week Start (Auto-Snaps to Monday:{" "}
                  {formatToDDMMYYYY(weekStart)}) *
                </label>
                <input
                  type="date"
                  required
                  value={weekStart}
                  onChange={(e) => handleWeekDateSelection(e.target.value)}
                  className="w-full border-2 border-blue-300 p-2.5 rounded-lg font-black text-xs bg-white outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  2. Consecutive Week End (Locked to Sunday: {formatToDDMMYYYY(weekEnd)})
                </label>
                <input
                  type="date"
                  readOnly
                  value={weekEnd}
                  className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black text-xs bg-slate-200/70 text-slate-600 cursor-not-allowed outline-none"
                />
              </div>
            </div>

            {existingWeeklyForSelectedWindow ? (
              <div className="p-6 bg-slate-900 text-white rounded-2xl border-2 border-emerald-500/60 space-y-2">
                <h3 className="font-black text-sm uppercase tracking-widest text-emerald-400">
                  🔒 Weekly Reconciliation Already Submitted ({formatToDDMMYYYY(weekStart)}{" "}
                  to {formatToDDMMYYYY(weekEnd)})
                </h3>
                <p className="text-xs font-bold text-slate-300">
                  Logged Packets: {existingWeeklyForSelectedWindow.total_packets_qty} | Cash:
                  ₹
                  {Number(
                    existingWeeklyForSelectedWindow.total_cash_collected || 0
                  ).toLocaleString("en-IN")}{" "}
                  | Status: {existingWeeklyForSelectedWindow.reconciliation_status}
                </p>
              </div>
            ) : (
              <form onSubmit={handleWeeklySubmit} className="space-y-6">
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
                    ❌ {weeklyError}
                  </div>
                )}

                {weeklyPreview && (
                  <div className="space-y-4">
                    <h3 className="font-black text-xs uppercase tracking-widest text-slate-600">
                      Day-by-Day Weekly vs. Daily Matching Matrix (
                      {formatToDDMMYYYY(weekStart)} to {formatToDDMMYYYY(weekEnd)})
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
                            const dMatch = dailyReports.find(
                              (dr) => dr.report_date === wb.date
                            );
                            const isMatched =
                              dMatch && dMatch.total_packets_qty === wb.totalPkts;
                            return (
                              <tr key={wb.date} className="hover:bg-slate-50">
                                <td className="p-3 font-black">
                                  {formatToDDMMYYYY(wb.date)}
                                </td>
                                <td className="p-3 text-center font-bold">
                                  {wb.totalPkts}
                                </td>
                                <td className="p-3 text-center font-bold">
                                  {dMatch ? dMatch.total_packets_qty : "MISSING"}
                                </td>
                                <td className="p-3 text-center font-bold text-red-600">
                                  {wb.rejected}
                                </td>
                                <td className="p-3 text-right font-black">
                                  ₹{wb.totalCash.toLocaleString("en-IN")}
                                </td>
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
                        I confirm the Monday-to-Sunday weekly reconciliation matrix (
                        {weeklyPreview.total_packets_qty} packets, ₹
                        {weeklyPreview.total_cash_collected.toLocaleString("en-IN")}).
                      </span>
                    </label>

                    <button
                      type="submit"
                      disabled={isSubmittingWeekly || !confirmWeeklyCheck}
                      className="w-full py-4 bg-slate-900 hover:bg-blue-600 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg"
                    >
                      {isSubmittingWeekly
                        ? "Syncing Weekly Report..."
                        : "Submit Weekly Reconciliation"}
                    </button>
                  </div>
                )}
              </form>
            )}
          </div>
        )}

        {/* VIEW 5: MODULAR UPLOADED REPORTS & DEPOSIT REMITTANCE VAULT */}
        {isAadhaarAuthorized && effectiveMenu === "history" && (
          <PartnerAadhaarHistoryVault
            partner={partner}
            dailyReports={dailyReports}
            weeklyReports={weeklyReports}
            aadhaarDeposits={aadhaarDeposits}
            penalties={penalties}
            filterFromDate={filterFromDate}
            filterToDate={filterToDate}
            fileModeFilter={fileModeFilter}
            onDownloadRawFile={handleDownloadRawFile}
            onViewDepositSlip={handleViewDepositSlip}
          />
        )}

        {/* VIEW 6: MODULAR CREDENTIALS & 10-DOCUMENT COMPLIANCE DOSSIER */}
        {effectiveMenu === "upgrade" && (
          <PartnerAadhaarUpgradeModule
            partner={partner}
            latestUpgradeReq={latestUpgradeReq}
            isCredentialsLocked={isCredentialsLocked}
            upgradeForm={upgradeForm}
            setUpgradeForm={setUpgradeForm}
            showBanner={showBanner}
            onRefreshPortal={initializeAadhaarPortal}
          />
        )}
      </main>
    </div>
  );
}