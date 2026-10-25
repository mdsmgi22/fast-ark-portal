// FILE PATH: ./app/partner/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

import {
  normalizeToYYYYMMDD,
  executePartnerSalesCSVExport,
} from "../../lib/partnerUtils";
import { buildCompliancePDF } from "../../lib/pdfEngine";
import {
  DatePresetMode,
  getDateRangeFromPreset,
  formatToDDMMYYYY,
  getISTDateString,
  syncAadhaarLatePenalties,
} from "../../lib/aadhaarEngine";

import DashboardQuickActions from "../../components/partner/DashboardQuickActions";
import ComplianceModal from "../../components/partner/ComplianceModal";
import InfrastructureAccordions from "../../components/partner/InfrastructureAccordions";
import CorporateInbox from "../../components/partner/CorporateInbox";
import LedgerKPIs from "../../components/partner/LedgerKPIs";
import SalesHistory from "../../components/partner/SalesHistory";
import DepositsHistory from "../../components/partner/DepositsHistory";

export default function PartnerDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [isRouting, setIsRouting] = useState(false);

  const [liveDateDDMMYYYY, setLiveDateDDMMYYYY] = useState("");
  const [liveTimeIST, setLiveTimeIST] = useState("");

  const [partner, setPartner] = useState<any>(null);
  const [partnerCtops, setPartnerCtops] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null);
  const [virtualAccounts, setVirtualAccounts] = useState<any[]>([]);
  const [upiIds, setUpiIds] = useState<any[]>([]);
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawDeposits, setRawDeposits] = useState<any[]>([]);
  const [rawAadhaar, setRawAadhaar] = useState<any[]>([]);
  const [rawPenalties, setRawPenalties] = useState<any[]>([]);

  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [fromDate, setFromDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").start
  );
  const [toDate, setToDate] = useState<string>(
    () => getDateRangeFromPreset("current_month").end
  );
  const [timeFilter, setTimeFilter] = useState("current_month");

  const [hasSubmittedToday, setHasSubmittedToday] = useState(false);
  const [lifetimePendingBalance, setLifetimePendingBalance] = useState(0);
  const [telecomPendingBalance, setTelecomPendingBalance] = useState(0);
  const [aadhaarPendingBalance, setAadhaarPendingBalance] = useState(0);
  const [aadhaarPenaltyBalance, setAadhaarPenaltyBalance] = useState(0);

  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [requestingEditId, setRequestingEditId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);

  const [displayLedger, setDisplayLedger] = useState({
    totalCBP: 0,
    totalCTOP: 0,
    totalSimCash: 0,
    totalPostpaidCash: 0,
    totalOtherCash: 0,
    totalPaybullCash: 0,
    totalAadhaarCash: 0,
    totalCheque: 0,
    totalCashSales: 0,
    totalDeposits: 0,
    qNew: 0,
    qUp: 0,
    qRep: 0,
    qFan: 0,
    qPost: 0,
    qMnp: 0,
    qAadhaarPkts: 0,
  });

  const [docFiles, setDocFiles] = useState<Record<string, File | File[] | null>>(
    {}
  );
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [hasUploadedDocs, setHasUploadedDocs] = useState(false);
  const [docUploadMessage, setDocUploadMessage] = useState("");

  const getRequiredDocuments = (role: string) => {
    const r = (role || "").toUpperCase();
    if (r.includes("OCSC"))
      return [
        "Marks Card",
        "Photo with Location GPS Tagged (5 Nos)",
        "HOTO Letter Copy",
        "Police Verification Certificate",
        "Bank Passbook / Cancel Cheque",
      ];
    if (r.includes("AADHAAR"))
      return [
        "Marks Card (12th Pass)",
        "Photo with Location GPS Tagged (5 Nos)",
        "HOTO Letter Copy",
        "Police Verification Certificate",
        "NSEIT Certificate",
        "LMS Certificate",
        "Annexure A & B",
        "L1 Readiness Document",
        "100 Rs BSNL Stamp Undertaking",
        "100 Rs Company Stamp Undertaking",
        "EA Request Form",
        "Bank Passbook / Cancel Cheque",
      ];
    return [
      "GST Certificate",
      "Bank Mapping",
      "Other Document 1",
      "Other Document 2",
      "Other Document 3",
    ];
  };

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setLiveDateDDMMYYYY(formatToDDMMYYYY(getISTDateString(0)));
      setLiveTimeIST(
        now
          .toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          })
          .toUpperCase()
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    initializeDashboard();
  }, [router]);

  const initializeDashboard = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return router.push("/partner/login");

      const { data: partnerData } = await supabase
        .from("active_partners")
        .select("*, locations(*)")
        .ilike("email", (session.user.email || "").trim())
        .maybeSingle();

      if (!partnerData) {
        setSyncError(
          "DATABASE DESYNC: Your partner profile could not be loaded. Please sign out and contact administration."
        );
        setLoading(false);
        return;
      }

      if (!partnerData.tc_accepted) return router.push("/partner/terms");
      setPartner(partnerData);

      await syncAadhaarLatePenalties(supabase, partnerData.id);

      if (partnerData.compliance_docs_url) {
        setHasUploadedDocs(true);
      } else {
        const { data: fileList } = await supabase.storage
          .from("application_documents")
          .list("", { search: `COMPLIANCE_${partnerData.id}` });
        if (fileList && fileList.length > 0) setHasUploadedDocs(true);
      }

      if (partnerData.center_id) {
        const [virtualsRes, upisRes] = await Promise.all([
          supabase
            .from("virtual_accounts")
            .select("*, master_banks(*)")
            .eq("assigned_location_id", partnerData.center_id)
            .order("created_at", { ascending: false }),
          supabase
            .from("upi_ids")
            .select("*, master_banks(*)")
            .eq("assigned_location_id", partnerData.center_id)
            .order("created_at", { ascending: false }),
        ]);
        setVirtualAccounts(virtualsRes.data || []);
        setUpiIds(upisRes.data || []);
      }

      const { data: ctopData } = await supabase
        .from("agent_ctop_mappings")
        .select(
          "agent_ctop_no, agent_ocsc_login_id, is_active, master_ctop_accounts(master_ctop_no)"
        )
        .eq("partner_id", partnerData.id)
        .eq("is_active", true);
      setPartnerCtops(ctopData || []);

      const { data: msgData } = await supabase
        .from("partner_messages")
        .select("*")
        .eq("partner_id", partnerData.id)
        .order("created_at", { ascending: false });
      setMessages(msgData || []);
      setUnreadCount((msgData || []).filter((m) => !m.is_read).length);

      await fetchAllLedgerData(partnerData.id);
    } catch (err: any) {
      console.error("Init Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllLedgerData = async (partnerId: string) => {
    try {
      const [salesRes, depositsRes, aadhaarRes, penaltyRes] = await Promise.all([
        supabase
          .from("daily_sales_reports")
          .select("*")
          .eq("partner_id", partnerId)
          .order("report_date", { ascending: false }),
        supabase
          .from("partner_deposits")
          .select("*")
          .eq("partner_id", partnerId)
          .order("deposit_date", { ascending: false }),
        supabase
          .from("aadhaar_daily_reports")
          .select("*")
          .eq("partner_id", partnerId)
          .order("report_date", { ascending: false }),
        supabase
          .from("aadhaar_penalty_logs")
          .select("*")
          .eq("partner_id", partnerId)
          .eq("is_settled", false),
      ]);

      const salesList = salesRes.data || [];
      const depList = depositsRes.data || [];
      const aadhaarList = aadhaarRes.data || [];
      const penList = (penaltyRes.data || []).filter((p: any) => !p.is_waived);

      setRawSales(salesList);
      setRawDeposits(depList);
      setRawAadhaar(aadhaarList);
      setRawPenalties(penList);

      const todayStr = getISTDateString(0);
      setHasSubmittedToday(
        salesList.some((s) => normalizeToYYYYMMDD(s.report_date) === todayStr)
      );

      // 1. Lifetime Telecom/Paybull Pending Balance (Isolated from Aadhaar stream)
      let lifetimeTelecomSales = 0;
      salesList.forEach((s) => {
        lifetimeTelecomSales +=
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
      });

      const isAadhaarDeposit = (d: any) =>
        d.deposit_stream === "AADHAAR" ||
        String(d.reference_no || "")
          .toUpperCase()
          .startsWith("AADHAAR_");

      const lifetimeTelecomDeposits = depList
        .filter((d) => d.status !== "Discrepancy" && !isAadhaarDeposit(d))
        .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);

      const netTelecomDue = Math.max(
        0,
        lifetimeTelecomSales - lifetimeTelecomDeposits
      );

      // 2. Unified Aadhaar Deduction Formula: (Total Aadhaar Collection - Total Aadhaar Deposits) + Non-Waived Penalties
      const lifetimeAadhaarCollected = aadhaarList.reduce(
        (sum, a) => sum + Number(a.total_cash_collected || 0),
        0
      );
      const lifetimeAadhaarDeposited = depList
        .filter((d) => d.status !== "Discrepancy" && isAadhaarDeposit(d))
        .reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);

      const netAadhaarDue = Math.max(
        0,
        lifetimeAadhaarCollected - lifetimeAadhaarDeposited
      );
      const netPenaltyDue = penList.reduce(
        (sum, p) => sum + Number(p.penalty_amount || 0),
        0
      );

      setTelecomPendingBalance(netTelecomDue);
      setAadhaarPendingBalance(netAadhaarDue);
      setAadhaarPenaltyBalance(netPenaltyDue);
      setLifetimePendingBalance(netTelecomDue + netAadhaarDue + netPenaltyDue);

      const defaultRange = getDateRangeFromPreset("current_month");
      recalculateWindow(
        defaultRange.start,
        defaultRange.end,
        "current_month",
        salesList,
        depList,
        aadhaarList
      );
    } catch (error) {
      console.error(error);
    }
  };

  const recalculateWindow = (
    startStr: string,
    endStr: string,
    labelMode: string,
    sales = rawSales,
    deposits = rawDeposits,
    aadhaar = rawAadhaar
  ) => {
    const filteredSales = sales.filter((s) => {
      const d = normalizeToYYYYMMDD(s.report_date);
      return d >= startStr && d <= endStr;
    });
    const filteredDeposits = deposits.filter((d) => {
      const dt = normalizeToYYYYMMDD(d.deposit_date || d.created_at);
      return dt >= startStr && dt <= endStr;
    });
    const filteredAadhaar = aadhaar.filter((a) => {
      const dt = normalizeToYYYYMMDD(a.report_date);
      return dt >= startStr && dt <= endStr;
    });

    let cbp = 0,
      ctop = 0,
      simCash = 0,
      postpaidCash = 0,
      otherCash = 0,
      cheque = 0,
      pbCash = 0,
      aadhaarCash = 0,
      totalSales = 0,
      totalDep = 0;
    let qN = 0,
      qU = 0,
      qR = 0,
      qF = 0,
      qP = 0,
      qM = 0,
      qAadhaar = 0;

    filteredSales.forEach((s) => {
      const sCbp = Number(s.cbp_landline_amt || 0) + Number(s.cbp_gsm_amt || 0);
      const sCtop = Number(s.ctop_recharge_amt || 0);
      const sSim =
        Number(s.sim_replacement_amt || 0) +
        Number(s.sim_fancy_amt || 0) +
        Number(s.frc_amt || 0) +
        Number(s.mnp_amt || 0);
      const sPost = Number(s.sim_postpaid_amt || 0);
      const sOther = Number(s.other_amt || 0);
      const sPbCash =
        Number(s.pb_cbp_amt || 0) +
        Number(s.pb_ctop_amt || 0) +
        Number(s.pb_frc_amt || 0) +
        Number(s.pb_mnp_amt || 0) +
        Number(s.pb_other_amt || 0);

      cbp += sCbp;
      ctop += sCtop;
      simCash += sSim;
      postpaidCash += sPost;
      otherCash += sOther;
      pbCash += sPbCash;
      cheque += Number(s.cheque_amt || 0);
      totalSales += sCbp + sCtop + sSim + sPost + sOther + sPbCash;

      qN += Number(s.sim_new_qty || 0);
      qU += Number(s.sim_upgrade_qty || 0);
      qR += Number(s.sim_replacement_qty || 0);
      qF += Number(s.sim_fancy_qty || 0);
      qP += Number(s.sim_postpaid_qty || 0);
      qM += Number(s.mnp_qty || 0);
    });

    filteredAadhaar.forEach((a) => {
      const aCash = Number(a.total_cash_collected || 0);
      aadhaarCash += aCash;
      totalSales += aCash;
      qAadhaar += Number(a.total_packets_qty || 0);
    });

    filteredDeposits
      .filter((d) => d.status !== "Discrepancy")
      .forEach((d) => {
        totalDep += Number(d.deposit_amount || 0);
      });

    setDisplayLedger({
      totalCBP: cbp,
      totalCTOP: ctop,
      totalSimCash: simCash,
      totalPostpaidCash: postpaidCash,
      totalOtherCash: otherCash,
      totalPaybullCash: pbCash,
      totalAadhaarCash: aadhaarCash,
      totalCheque: cheque,
      totalCashSales: totalSales,
      totalDeposits: totalDep,
      qNew: qN,
      qUp: qU,
      qRep: qR,
      qFan: qF,
      qPost: qP,
      qMnp: qM,
      qAadhaarPkts: qAadhaar,
    });
    setTimeFilter(labelMode);
  };

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFromDate(range.start);
      setToDate(range.end);
      recalculateWindow(range.start, range.end, mode);
    }
  };

  const handleCustomDateChange = (newFrom: string, newTo: string) => {
    setDatePreset("custom");
    setFromDate(newFrom);
    setToDate(newTo);
    recalculateWindow(newFrom, newTo, "custom");
  };

  const handleReadMessage = async (msg: any) => {
    if (expandedMsgId === msg.id) return setExpandedMsgId(null);
    setExpandedMsgId(msg.id);
    if (msg.is_read) return;
    try {
      setMessages((current) =>
        current.map((m) => (m.id === msg.id ? { ...m, is_read: true } : m))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await supabase
        .from("partner_messages")
        .update({ is_read: true })
        .eq("id", msg.id);
    } catch (err) {}
  };

  const handleRequestEdit = async (saleId: string) => {
    if (editReason.trim().length < 5)
      return alert("Please provide a detailed reason (minimum 5 characters).");
    try {
      const { error } = await supabase
        .from("daily_sales_reports")
        .update({
          edit_request_status: "Pending",
          edit_request_reason: editReason,
        })
        .eq("id", saleId);
      if (error) throw error;
      alert("✅ Edit request submitted. Waiting for Back-Office approval.");
      setRawSales(
        rawSales.map((s) =>
          s.id === saleId
            ? {
                ...s,
                edit_request_status: "Pending",
                edit_request_reason: editReason,
              }
            : s
        )
      );
      setRequestingEditId(null);
      setEditReason("");
    } catch (err: any) {
      alert("Error submitting request: " + err.message);
    }
  };

  const handleDocFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    docName: string,
    isMulti: boolean
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      for (const file of selectedFiles) {
        if (file.size > 5 * 1024 * 1024)
          return alert(`File size for ${file.name} must be under 5MB.`);
      }
      if (isMulti) {
        if (selectedFiles.length !== 5)
          return alert(
            `Requirement Error: You must select exactly 5 photos for '${docName}'.`
          );
        setDocFiles((prev) => ({ ...prev, [docName]: selectedFiles }));
      } else {
        setDocFiles((prev) => ({ ...prev, [docName]: selectedFiles[0] }));
      }
    }
  };

  const handleDocUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const requiredDocs = getRequiredDocuments(partner?.role);

    for (const doc of requiredDocs) {
      if (!docFiles[doc])
        return alert(
          `Validation Error: Please upload the mandatory document: ${doc}`
        );
      if (
        doc.includes("(5 Nos)") &&
        Array.isArray(docFiles[doc]) &&
        (docFiles[doc] as File[]).length !== 5
      ) {
        return alert(
          `Validation Error: Please select exactly 5 photos for: ${doc}`
        );
      }
    }

    setIsUploadingDocs(true);
    try {
      let userIp = "Unknown";
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const ipRes = await fetch("https://api.ipify.org?format=json", {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (ipRes.ok) {
          userIp = (await ipRes.json()).ip || "Unknown";
        }
      } catch (_) {}

      const mergedPdfBytes = await buildCompliancePDF(
        partner.email,
        partner.locations?.center_name,
        userIp,
        requiredDocs,
        docFiles,
        setDocUploadMessage
      );
      const { error: uploadError, data } = await supabase.storage
        .from("application_documents")
        .upload(`COMPLIANCE_${partner.id}_${Date.now()}.pdf`, mergedPdfBytes, {
          contentType: "application/pdf",
        });
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from("active_partners")
        .update({ compliance_docs_url: data.path })
        .eq("id", partner.id);
      if (dbError) throw dbError;

      setHasUploadedDocs(true);
      setDocUploadMessage("✅ Documents successfully locked and stored.");
      setTimeout(() => {
        setDocUploadMessage("");
        setIsDocModalOpen(false);
      }, 3000);
    } catch (error: any) {
      alert("Upload Failed: " + error.message);
      setDocUploadMessage("");
    } finally {
      setIsUploadingDocs(false);
    }
  };

  const downloadCSV = () => {
    const visible = rawSales.filter((s) => {
      const d = normalizeToYYYYMMDD(s.report_date);
      return d >= fromDate && d <= toDate;
    });
    executePartnerSalesCSVExport(
      visible,
      `${formatToDDMMYYYY(fromDate)}_to_${formatToDDMMYYYY(toDate)}`
    );
  };

  const routeTo = (path: string) => {
    setIsRouting(true);
    router.push(path);
    setTimeout(() => setIsRouting(false), 8000);
  };

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const handleSignOut = async () => {
    setIsLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/partner/login");
  };

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  if (syncError)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-red-50 p-8 rounded-2xl shadow-sm border-2 border-red-200 text-center">
          <h2 className="text-xl font-black text-red-800">
            Database Sync Error
          </h2>
          <p className="text-sm text-red-900 mt-2">{syncError}</p>
          <button
            onClick={handleSignOut}
            className="mt-4 bg-red-600 text-white font-black px-6 py-3 rounded-lg"
          >
            Sign Out
          </button>
        </div>
      </div>
    );

  const visibleSales = rawSales.filter((s) => {
    const d = normalizeToYYYYMMDD(s.report_date);
    return d >= fromDate && d <= toDate;
  });
  const visibleDeposits = rawDeposits.filter((d) => {
    const dt = normalizeToYYYYMMDD(d.deposit_date || d.created_at);
    return dt >= fromDate && dt <= toDate;
  });
  const requiredDocs = getRequiredDocuments(partner?.role);

  return (
    <div className="min-h-screen bg-slate-50 font-sans relative">
      {isRouting && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="text-sm font-bold text-white animate-pulse tracking-widest uppercase">
            Opening Module...
          </p>
        </div>
      )}

      <header className="bg-blue-600 text-white shadow-lg sticky top-0 z-40">
        <div className="px-4 md:px-8 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center font-black text-2xl text-blue-600 shadow-sm transform -rotate-12">
              F
            </div>
            <div>
              <h1 className="font-black text-lg leading-tight tracking-wide text-white">
                FAST ARK
              </h1>
              <p className="text-[9px] text-blue-200 font-bold uppercase tracking-widest hidden sm:block">
                Partner Operations Hub • [
                {partner?.locations?.center_code || "CENTER"}]{" "}
                {partner?.locations?.center_name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            <div className="hidden md:flex items-center gap-2 bg-blue-700/80 border border-blue-500 px-3 py-1.5 rounded-lg text-xs font-black">
              <span>📅 {liveDateDDMMYYYY}</span>
              <span className="text-blue-200">|</span>
              <span className="font-mono">{liveTimeIST}</span>
            </div>

            <div
              className="flex bg-blue-700 border border-blue-500 px-2 sm:px-3 py-1.5 rounded-lg text-right shadow-sm items-center gap-2 cursor-pointer hover:bg-blue-800 transition"
              title="View Inbox Below"
              onClick={() =>
                window.scrollTo({
                  top: document.body.scrollHeight,
                  behavior: "smooth",
                })
              }
            >
              <span className="text-xl animate-pulse">
                {unreadCount > 0 ? "🔔" : "🔕"}
              </span>
              <div className="hidden sm:block">
                <p className="text-[9px] text-blue-200 font-black uppercase tracking-widest leading-none">
                  Unread Alerts
                </p>
                <p
                  className={`font-black text-xs ${
                    unreadCount > 0 ? "text-white" : "text-blue-300"
                  }`}
                >
                  {unreadCount} Notices
                </p>
              </div>
              <span className="sm:hidden font-black text-xs text-white bg-red-500 px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            </div>

            <button
              onClick={handleSignOut}
              disabled={isLoggingOut}
              className="text-xs font-black text-blue-600 bg-white hover:bg-slate-100 px-3 sm:px-4 py-2 rounded-lg shadow-sm transition uppercase tracking-widest"
            >
              {isLoggingOut ? "Closing..." : "Logout"}
            </button>
          </div>
        </div>

        <div className="bg-slate-900 px-4 md:px-8 py-2 flex items-center gap-2 overflow-x-auto border-t border-blue-500/30 text-[11px] font-black uppercase tracking-wider">
          <Link
            href="/partner/dashboard"
            className="px-3 py-1.5 rounded bg-blue-600 text-white shrink-0"
          >
            📊 Dashboard
          </Link>
          <Link
            href="/partner/sales"
            className="px-3 py-1.5 rounded text-slate-300 hover:bg-slate-800 hover:text-white shrink-0 transition"
          >
            📈 Daily Sales
          </Link>
          <Link
            href="/partner/deposit"
            className="px-3 py-1.5 rounded text-slate-300 hover:bg-slate-800 hover:text-white shrink-0 transition"
          >
            💳 Deposit of Sales
          </Link>
          <Link
            href="/partner/stock"
            className="px-3 py-1.5 rounded text-slate-300 hover:bg-slate-800 hover:text-white shrink-0 transition"
          >
            📦 Stock Request
          </Link>
          <Link
            href="/partner/aadhaar"
            className="px-3 py-1.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500 hover:text-slate-950 shrink-0 transition"
          >
            🆔 Aadhaar Kendra Hub
          </Link>
          <Link
            href="/partner/helpdesk"
            className="px-3 py-1.5 rounded text-slate-300 hover:bg-slate-800 hover:text-white shrink-0 transition"
          >
            🎧 Helpdesk
          </Link>
        </div>
      </header>

      <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
        {!hasUploadedDocs ? (
          <button
            onClick={() => setIsDocModalOpen(true)}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 px-6 rounded-xl shadow-lg border-2 border-red-800 flex flex-col md:flex-row items-center justify-between gap-4 transition transform hover:-translate-y-1 animate-in fade-in"
          >
            <div className="flex items-center gap-4 text-left">
              <span className="text-3xl md:text-4xl animate-pulse">🚨</span>
              <div>
                <h3 className="text-lg md:text-xl uppercase tracking-widest leading-tight">
                  Action Required: Upload Compliance Docs
                </h3>
                <p className="text-xs font-bold text-red-200 mt-1">
                  Your account requires mandatory documentation to maintain
                  active status.
                </p>
              </div>
            </div>
            <span className="bg-white text-red-700 font-black px-5 py-2.5 rounded-lg text-sm uppercase tracking-widest shrink-0 shadow-sm w-full md:w-auto text-center">
              Tap to Upload ↗
            </span>
          </button>
        ) : (
          <div className="bg-emerald-100 text-emerald-800 border border-emerald-200 p-4 rounded-xl shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✅</span>
              <p className="font-black uppercase tracking-widest text-sm">
                Compliance Documents Secured
              </p>
            </div>
            <span className="text-[10px] font-bold opacity-70 bg-emerald-200 px-2 py-1 rounded">
              Locked &amp; Validated
            </span>
          </div>
        )}

        {messages.filter((m) => !m.is_read).length > 0 && (
          <div className="bg-red-50 border-l-4 border-red-600 p-5 rounded-r-xl shadow-sm animate-in fade-in">
            <h3 className="font-black text-red-800 flex items-center gap-2 text-lg">
              <span className="text-2xl">⚠️</span> Unread Corporate Notices
            </h3>
            <p className="text-xs font-bold text-red-700">
              You must acknowledge these notices in your Official Inbox.
            </p>
          </div>
        )}

        {lifetimePendingBalance >= 1000 && (
          <div className="bg-red-600 text-white p-4 rounded-xl shadow-lg border-2 border-red-800 flex flex-col md:flex-row items-start md:items-center justify-between animate-pulse">
            <div>
              <h3 className="font-black text-lg uppercase tracking-widest flex items-center gap-2">
                <span className="text-2xl">🚨</span> Priority Remittance
                Required
              </h3>
              <p className="font-bold text-sm mt-1">
                Your pending cash balance has exceeded the ₹1,000 limit. Settle
                your ledger immediately.
              </p>
            </div>
            <div className="mt-4 md:mt-0 text-left md:text-right bg-red-800/50 p-3 rounded-lg border border-red-700">
              <p className="text-[10px] uppercase font-black text-red-300 tracking-widest">
                Pending Amount
              </p>
              <p className="text-3xl font-black">
                ₹{lifetimePendingBalance.toLocaleString("en-IN")}
              </p>
            </div>
          </div>
        )}

        <DashboardQuickActions hasSubmittedToday={hasSubmittedToday} />

        <div
          onClick={() => routeTo("/partner/helpdesk")}
          className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 cursor-pointer hover:border-blue-500 hover:shadow-xl transition-all group animate-in fade-in"
        >
          <div className="flex items-start md:items-center gap-4 md:gap-6">
            <div className="w-14 h-14 md:w-16 md:h-16 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center text-3xl shrink-0 group-hover:scale-110 transition-transform shadow-inner">
              🎧
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-black text-white flex items-center gap-2 tracking-wide">
                Support &amp; Escalation Helpdesk
              </h2>
              <p className="text-slate-400 font-medium mt-1 text-sm md:text-base leading-relaxed">
                Report BSNL infrastructure issues, portal downtime, or company
                queries. Track your live SLA resolutions.
              </p>
            </div>
          </div>
          <button className="w-full md:w-auto bg-blue-600 group-hover:bg-blue-500 text-white font-black px-6 py-3.5 rounded-lg shadow-md uppercase tracking-widest text-xs transition-colors shrink-0 flex items-center justify-center gap-2">
            Open Helpdesk <span>&rarr;</span>
          </button>
        </div>

        <InfrastructureAccordions
          partner={partner}
          partnerCtops={partnerCtops}
          virtualAccounts={virtualAccounts}
          upiIds={upiIds}
        />

        <LedgerKPIs
          displayLedger={displayLedger}
          timeFilter={timeFilter}
          datePreset={datePreset}
          fromDate={fromDate}
          toDate={toDate}
          onPresetChange={handlePresetChange}
          onCustomDateChange={handleCustomDateChange}
          lifetimePendingBalance={lifetimePendingBalance}
          telecomPendingBalance={telecomPendingBalance}
          aadhaarPendingBalance={aadhaarPendingBalance}
          aadhaarPenaltyBalance={aadhaarPenaltyBalance}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <SalesHistory
            timeFilter={`${formatToDDMMYYYY(fromDate)} - ${formatToDDMMYYYY(
              toDate
            )}`}
            visibleSales={visibleSales}
            expandedSaleId={expandedSaleId}
            setExpandedSaleId={setExpandedSaleId}
            requestingEditId={requestingEditId}
            setRequestingEditId={setRequestingEditId}
            editReason={editReason}
            setEditReason={setEditReason}
            handleRequestEdit={handleRequestEdit}
            downloadCSV={downloadCSV}
          />
          <div className="space-y-6">
            <DepositsHistory
              timeFilter={`${formatToDDMMYYYY(fromDate)} - ${formatToDDMMYYYY(
                toDate
              )}`}
              visibleDeposits={visibleDeposits}
            />
            <CorporateInbox
              messages={messages}
              unreadCount={unreadCount}
              expandedMsgId={expandedMsgId}
              handleReadMessage={handleReadMessage}
            />
          </div>
        </div>
      </div>

      <ComplianceModal
        isOpen={isDocModalOpen}
        onClose={() => setIsDocModalOpen(false)}
        hasUploadedDocs={hasUploadedDocs}
        requiredDocs={requiredDocs}
        docFiles={docFiles}
        handleDocFileChange={handleDocFileChange}
        handleDocUploadSubmit={handleDocUploadSubmit}
        isUploadingDocs={isUploadingDocs}
        docUploadMessage={docUploadMessage}
      />
    </div>
  );
}