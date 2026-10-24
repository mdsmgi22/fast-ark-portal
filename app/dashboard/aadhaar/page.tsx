"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import {
  formatToDDMMYYYY,
  getISTDateString,
  downloadAadhaarCSVReport,
  downloadAadhaarPDFReport,
} from "../../lib/aadhaarEngine";

type AdminAadhaarMenu =
  | "overview"
  | "daily_vault"
  | "weekly_audit"
  | "penalties"
  | "operators"
  | "tariff_master";

type DatePresetMode =
  | "today"
  | "yesterday"
  | "current_week"
  | "current_month"
  | "previous_month"
  | "all"
  | "custom";

// Calculates IST YYYY-MM-DD start and end dates for the 7-Option Date Dropdown
const getDateRangeFromPreset = (preset: DatePresetMode): { start: string; end: string } => {
  const now = new Date();
  const istNow = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);

  const formatYMD = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const todayStr = formatYMD(istNow);

  if (preset === "today") {
    return { start: todayStr, end: todayStr };
  }
  if (preset === "yesterday") {
    const yest = new Date(istNow);
    yest.setDate(yest.getDate() - 1);
    const yStr = formatYMD(yest);
    return { start: yStr, end: yStr };
  }
  if (preset === "current_week") {
    const startOfWeek = new Date(istNow);
    const day = startOfWeek.getDay(); // 0 (Sun) to 6 (Sat)
    const diffToMonday = day === 0 ? -6 : 1 - day;
    startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
    return { start: formatYMD(startOfWeek), end: todayStr };
  }
  if (preset === "current_month") {
    const firstDay = new Date(istNow.getFullYear(), istNow.getMonth(), 1);
    return { start: formatYMD(firstDay), end: todayStr };
  }
  if (preset === "previous_month") {
    const firstDayPrev = new Date(istNow.getFullYear(), istNow.getMonth() - 1, 1);
    const lastDayPrev = new Date(istNow.getFullYear(), istNow.getMonth(), 0);
    return { start: formatYMD(firstDayPrev), end: formatYMD(lastDayPrev) };
  }
  if (preset === "all") {
    return { start: "2020-01-01", end: todayStr };
  }
  return { start: todayStr, end: todayStr };
};

export default function AdminAadhaarCommandHub() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeMenu, setActiveMenu] = useState<AdminAadhaarMenu>("overview");
  const [staffUser, setStaffUser] = useState<any>(null);

  // Live IST Clock & DD/MM/YYYY Date
  const [liveDateDDMMYYYY, setLiveDateDDMMYYYY] = useState<string>("");
  const [liveTimeIST, setLiveTimeIST] = useState<string>("");

  // Raw Database Streams
  const [locations, setLocations] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<any[]>([]);
  const [penaltyLogs, setPenaltyLogs] = useState<any[]>([]);
  const [upgradeRequests, setUpgradeRequests] = useState<any[]>([]);
  const [tariffHistory, setTariffHistory] = useState<any[]>([]);

  // 7-Option Date Preset + Custom Range States
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [fromDate, setFromDate] = useState<string>(() => getDateRangeFromPreset("current_month").start);
  const [toDate, setToDate] = useState<string>(() => getDateRangeFromPreset("current_month").end);

  // 4-Tier Cascading Geo & Operator Filters + File Mode
  const [fState, setFState] = useState<string>("ALL");
  const [fHq, setFHq] = useState<string>("ALL");
  const [fCenter, setFCenter] = useState<string>("ALL");
  const [fPartner, setFPartner] = useState<string>("ALL");
  const [fFileMode, setFFileMode] = useState<"ALL" | "WITH_FILES" | "WITHOUT_FILES">("ALL");

  // Direct Operator Mapping State (Menu 5)
  const [mappingForm, setMappingForm] = useState({
    partner_id: "",
    operator_id: "",
    station_id: "",
  });
  const [isSavingMapping, setIsSavingMapping] = useState(false);

  // UIDAI Tariff Master State (Menu 6)
  const [tariffForm, setTariffForm] = useState({
    effective_from: getISTDateString(1),
    new_enrolment_fee: "0",
    mbu_free_fee: "0",
    mbu_chargeable_fee: "125",
    demographic_fee: "75",
    biometric_fee: "125",
    demo_min_threshold: "50",
    demo_max_threshold: "100",
    bio_min_threshold: "100",
    gst_percent: "18",
    daily_late_penalty: "100",
  });
  const [isSavingTariff, setIsSavingTariff] = useState(false);

  // Live Clock Effect
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

  // Handle Date Preset Dropdown Change
  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFromDate(range.start);
      setToDate(range.end);
    }
  };

  useEffect(() => {
    initializeAdminAadhaarHub();
  }, [fromDate, toDate]);

  const initializeAdminAadhaarHub = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const { data: staff } = await supabase
        .from("back_office_staff")
        .select("*")
        .ilike("email", session.user.email || "")
        .maybeSingle();

      if (!staff) return router.push("/login");
      setStaffUser(staff);

      const [locRes, partRes, dailyRes, weeklyRes, penRes, upgRes, tarRes] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"),
        supabase
          .from("active_partners")
          .select("*, locations(id, center_name, center_code, state, dist, parent_master_id)")
          .order("partner_name"),
        supabase
          .from("aadhaar_daily_reports")
          .select("*, active_partners(partner_name, locations(id, center_name, state, parent_master_id))")
          .gte("report_date", fromDate)
          .lte("report_date", toDate)
          .order("report_date", { ascending: false }),
        supabase
          .from("aadhaar_weekly_reports")
          .select("*, active_partners(partner_name, locations(id, center_name, state, parent_master_id))")
          .order("end_date", { ascending: false }),
        supabase
          .from("aadhaar_penalty_logs")
          .select("*, active_partners(partner_name, aadhaar_operator_id, aadhaar_station_id, locations(id, center_name, state, parent_master_id))")
          .order("penalty_for_date", { ascending: false }),
        supabase
          .from("partner_upgrade_requests")
          .select("*, active_partners(partner_name, email, mobile, locations(center_name, state))")
          .order("created_at", { ascending: false }),
        supabase.from("aadhaar_tariff_history").select("*").order("effective_from", { ascending: false }),
      ]);

      setLocations(locRes.data || []);
      setPartners(partRes.data || []);
      setDailyReports(dailyRes.data || []);
      setWeeklyReports(weeklyRes.data || []);
      setPenaltyLogs(penRes.data || []);
      setUpgradeRequests(upgRes.data || []);
      setTariffHistory(tarRes.data || []);
    } catch (err: any) {
      console.error("Admin Aadhaar Init Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // 4-TIER CASCADING FILTER ENGINE (STATE -> MASTER HQ -> LOCATION -> OPERATOR)
  // =========================================================================
  const uniqueStates = useMemo(
    () => Array.from(new Set(locations.map((l) => l.state).filter(Boolean))).sort(),
    [locations]
  );

  const hqOptions = useMemo(
    () =>
      locations.filter(
        (l) => l.is_master_node && (fState === "ALL" || l.state === fState)
      ),
    [locations, fState]
  );

  const centerOptions = useMemo(
    () =>
      locations.filter(
        (l) =>
          !l.is_master_node &&
          (fState === "ALL" || l.state === fState) &&
          (fHq === "ALL" || l.parent_master_id?.toString() === fHq)
      ),
    [locations, fState, fHq]
  );

  const operatorOptions = useMemo(
    () =>
      partners.filter((p) => {
        const loc = p.locations;
        if (!loc) return false;
        if (fState !== "ALL" && loc.state !== fState) return false;
        if (fHq !== "ALL" && loc.parent_master_id?.toString() !== fHq) return false;
        if (fCenter !== "ALL" && loc.id?.toString() !== fCenter) return false;
        return p.role_aadhaar || (p.role || "").toUpperCase().includes("AADHAAR");
      }),
    [partners, fState, fHq, fCenter]
  );

  const matchesCascade = (partnerId: string, locObj: any) => {
    if (fState !== "ALL" && locObj?.state !== fState) return false;
    if (fHq !== "ALL" && locObj?.parent_master_id?.toString() !== fHq) return false;
    if (fCenter !== "ALL" && locObj?.id?.toString() !== fCenter) return false;
    if (fPartner !== "ALL" && partnerId !== fPartner) return false;
    return true;
  };

  const filteredDailyReports = useMemo(() => {
    return dailyReports.filter((r) => {
      const loc = r.active_partners?.locations;
      if (!matchesCascade(r.partner_id, loc)) return false;
      if (fFileMode === "WITH_FILES" && !r.has_files) return false;
      if (fFileMode === "WITHOUT_FILES" && r.has_files) return false;
      return true;
    });
  }, [dailyReports, fState, fHq, fCenter, fPartner, fFileMode]);

  const filteredWeeklyReports = useMemo(() => {
    return weeklyReports.filter((w) => matchesCascade(w.partner_id, w.active_partners?.locations));
  }, [weeklyReports, fState, fHq, fCenter, fPartner]);

  const filteredPenalties = useMemo(() => {
    return penaltyLogs.filter((p) => matchesCascade(p.partner_id, p.active_partners?.locations));
  }, [penaltyLogs, fState, fHq, fCenter, fPartner]);

  // Identify Aadhaar Operators who have NOT uploaded a report for ToDate
  const missingTodayOperators = useMemo(() => {
    const submittedPartnerIds = new Set(
      dailyReports.filter((r) => r.report_date === toDate).map((r) => r.partner_id)
    );
    return operatorOptions.filter((op) => !submittedPartnerIds.has(op.id));
  }, [operatorOptions, dailyReports, toDate]);

  // Aggregate 5-Category Metrics
  const kpi = useMemo(() => {
    return filteredDailyReports.reduce(
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
        acc.base += Number(r.base_amount || 0);
        acc.gst += Number(r.gst_amount || 0);
        acc.cash += Number(r.total_cash_collected || 0);
        return acc;
      },
      { cat1: 0, cat2: 0, cat3: 0, cat4: 0, cat5: 0, pkts: 0, comp: 0, inproc: 0, rej: 0, base: 0, gst: 0, cash: 0 }
    );
  }, [filteredDailyReports]);

  // =========================================================================
  // ACTIONS: RAW FILE DOWNLOAD, OPERATOR FLIP, TARIFF MASTER
  // =========================================================================
  const handleDownloadVaultFile = async (path: string | null, bucket = "aadhaar-reports") => {
    if (!path) return alert("No file attached (Manual / Exemption record).");
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120);
    if (error || !data?.signedUrl) return alert("Failed to generate secure download link.");
    window.open(data.signedUrl, "_blank");
  };

  const handleDirectOperatorMap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mappingForm.partner_id || !mappingForm.operator_id || !mappingForm.station_id) {
      return alert("Please select a Partner and enter both Operator ID and Station ID.");
    }
    setIsSavingMapping(true);
    try {
      const targetPartner = partners.find((p) => p.id === mappingForm.partner_id);
      const { error } = await supabase
        .from("active_partners")
        .update({
          role_aadhaar: true,
          aadhaar_operator_id: mappingForm.operator_id.trim().toUpperCase(),
          aadhaar_station_id: mappingForm.station_id.trim(),
        })
        .eq("id", mappingForm.partner_id);

      if (error) throw error;

      // Also enable role_aadhaar on their mapped location
      if (targetPartner?.center_id) {
        await supabase.from("locations").update({ role_aadhaar: true }).eq("id", targetPartner.center_id);
      }

      await supabase.from("staff_activity_logs").insert([
        {
          staff_id: staffUser?.id || "ADMIN",
          staff_email: staffUser?.email,
          action_type: "AADHAAR_ROLE_FLIP",
          module: "AADHAAR_HUB",
          target_id: mappingForm.partner_id,
          details: `Activated Aadhaar Role for ${targetPartner?.partner_name}. Operator: ${mappingForm.operator_id.toUpperCase()}, Station: ${mappingForm.station_id}`,
        },
      ]);

      alert("✅ Partner flipped to Aadhaar Role and bound to Operator ID & Station ID (No Master CTOP required).");
      setMappingForm({ partner_id: "", operator_id: "", station_id: "" });
      initializeAdminAadhaarHub();
    } catch (err: any) {
      alert("Mapping Error: " + err.message);
    } finally {
      setIsSavingMapping(false);
    }
  };

  const handleUpgradeDecision = async (req: any, decision: "Approved" | "Rejected") => {
    let reason = "";
    if (decision === "Rejected") {
      const input = prompt("Enter reason for rejecting this Aadhaar Upgrade request:");
      if (!input) return;
      reason = input;
    } else {
      if (!confirm(`Approve Aadhaar Upgrade for ${req.active_partners?.partner_name} (Station: ${req.requested_station_id})?`)) return;
    }

    try {
      if (decision === "Approved") {
        await supabase
          .from("active_partners")
          .update({
            role_aadhaar: true,
            aadhaar_operator_id: req.requested_operator_id,
            aadhaar_station_id: req.requested_station_id,
          })
          .eq("id", req.partner_id);

        if (req.center_id) {
          await supabase.from("locations").update({ role_aadhaar: true }).eq("id", req.center_id);
        }
      }

      await supabase
        .from("partner_upgrade_requests")
        .update({ status: decision, reject_reason: reason || null })
        .eq("id", req.id);

      await supabase.from("partner_messages").insert([
        {
          partner_id: req.partner_id,
          subject: `🆔 Aadhaar Upgrade Request ${decision}`,
          body:
            decision === "Approved"
              ? `Your Aadhaar Seva Kendra upgrade has been APPROVED! Operator ID: ${req.requested_operator_id} | Station ID: ${req.requested_station_id}. You can now upload daily CSV & HTML reports.`
              : `Your Aadhaar upgrade request was declined. Reason: ${reason}`,
        },
      ]);

      alert(`✅ Upgrade request marked as ${decision}.`);
      initializeAdminAadhaarHub();
    } catch (err: any) {
      alert("Error processing upgrade: " + err.message);
    }
  };

  const handleCreateNewTariffVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((staffUser?.role || "").toLowerCase() !== "admin") {
      return alert("Forbidden: Only Super Admins can modify UIDAI Tariff rates.");
    }
    if (
      !confirm(
        `Deploy new UIDAI Tariff effective from ${formatToDDMMYYYY(
          tariffForm.effective_from
        )}? All reports prior to this date will remain locked at their historical rates.`
      )
    )
      return;

    setIsSavingTariff(true);
    try {
      const effDate = new Date(`${tariffForm.effective_from}T00:00:00Z`);
      effDate.setUTCDate(effDate.getUTCDate() - 1);
      const prevCloseDate = effDate.toISOString().split("T")[0];

      await supabase
        .from("aadhaar_tariff_history")
        .update({ effective_to: prevCloseDate })
        .is("effective_to", null);

      const { error } = await supabase.from("aadhaar_tariff_history").insert([
        {
          effective_from: tariffForm.effective_from,
          effective_to: null,
          new_enrolment_fee: parseFloat(tariffForm.new_enrolment_fee) || 0,
          mbu_free_fee: parseFloat(tariffForm.mbu_free_fee) || 0,
          mbu_chargeable_fee: parseFloat(tariffForm.mbu_chargeable_fee) || 125,
          demographic_fee: parseFloat(tariffForm.demographic_fee) || 75,
          biometric_fee: parseFloat(tariffForm.biometric_fee) || 125,
          demo_min_threshold: parseFloat(tariffForm.demo_min_threshold) || 50,
          demo_max_threshold: parseFloat(tariffForm.demo_max_threshold) || 100,
          bio_min_threshold: parseFloat(tariffForm.bio_min_threshold) || 100,
          gst_percent: parseFloat(tariffForm.gst_percent) || 18,
          daily_late_penalty: parseFloat(tariffForm.daily_late_penalty) || 100,
          created_by: staffUser?.auth_id || null,
        },
      ]);

      if (error) throw error;

      alert(`✅ New UIDAI Tariff version activated from ${formatToDDMMYYYY(tariffForm.effective_from)}!`);
      initializeAdminAadhaarHub();
    } catch (err: any) {
      alert("Tariff Save Error: " + err.message);
    } finally {
      setIsSavingTariff(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white font-black text-xs uppercase tracking-widest animate-pulse">
        Loading Corporate Aadhaar Command Hub...
      </div>
    );
  }

  const isSuperAdmin = (staffUser?.role || "").trim().toLowerCase() === "admin";
  const unpaidPenaltiesSum = filteredPenalties
    .filter((p) => !p.is_settled)
    .reduce((s, p) => s + Number(p.penalty_amount || 0), 0);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row font-sans">
      {/* ===================================================================== */}
      {/* LEFT SIDEBAR NAVIGATION                                               */}
      {/* ===================================================================== */}
      <aside className="w-full lg:w-80 bg-slate-950 text-white flex flex-col justify-between border-r border-slate-800 shrink-0 min-h-screen select-none">
        <div>
          <div className="p-5 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center font-black text-xl text-slate-950 shadow">
                  🆔
                </div>
                <div>
                  <h1 className="font-black text-base tracking-wide text-white leading-none">
                    AADHAAR COMMAND
                  </h1>
                  <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest mt-1">
                    Corporate Back-Office Hub
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard"
                className="text-[10px] font-black uppercase tracking-widest bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded border border-slate-700 transition"
              >
                &larr; Admin
              </Link>
            </div>

            {/* INDIAN STANDARD DATE (DD/MM/YYYY) & LIVE IST CLOCK */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span>📅</span>
                <span className="font-black text-emerald-400 tracking-wider">{liveDateDDMMYYYY}</span>
              </div>
              <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2.5">
                <span>🕒</span>
                <span className="font-mono font-bold text-slate-200 text-[11px]">{liveTimeIST}</span>
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-1.5">
            {[
              {
                id: "overview",
                icon: "📊",
                label: "1. Network KPIs & Counts",
                sub: "5-Category Live Matrix",
              },
              {
                id: "daily_vault",
                icon: "📥",
                label: "2. Daily Reports & Vault",
                sub: "CSV/HTML & Manual Audit",
                badge: `${filteredDailyReports.length}`,
              },
              {
                id: "weekly_audit",
                icon: "📅",
                label: "3. Weekly vs Daily Audit",
                sub: "Reconciliation Matrix",
                badge: `${filteredWeeklyReports.filter((w) => w.discrepancy_days_count > 0).length} Flags`,
              },
              {
                id: "penalties",
                icon: "🚨",
                label: "4. Late Penalty Ledger",
                sub: "₹100/Day Overdue Tracker",
                badge: `₹${unpaidPenaltiesSum}`,
              },
              {
                id: "operators",
                icon: "🆔",
                label: "5. Operator Role & IDs",
                sub: "Flip Role & Map Station ID",
                badge: `${upgradeRequests.filter((u) => u.status === "Pending").length} Req`,
              },
              ...(isSuperAdmin
                ? [
                    {
                      id: "tariff_master",
                      icon: "⚙️",
                      label: "6. UIDAI Tariff Master",
                      sub: "Date-Versioned Pricing",
                    },
                  ]
                : []),
            ].map((item: any) => {
              const isActive = activeMenu === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenu(item.id as AdminAadhaarMenu)}
                  className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between border ${
                    isActive
                      ? "bg-blue-600 text-white border-blue-500 shadow-lg"
                      : "bg-slate-900/60 text-slate-300 border-slate-800/80 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{item.icon}</span>
                    <div className="truncate">
                      <p className="font-black text-xs uppercase tracking-wider truncate">{item.label}</p>
                      <p className={`text-[10px] font-bold truncate mt-0.5 ${isActive ? "text-blue-200" : "text-slate-500"}`}>
                        {item.sub}
                      </p>
                    </div>
                  </div>
                  {item.badge && (
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-slate-800 text-amber-400 shrink-0 ml-2">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/50 space-y-2">
          <div className="text-[10px] text-slate-400 font-bold flex justify-between">
            <span>Active Aadhaar Operators:</span>
            <span className="text-white font-black">{operatorOptions.length}</span>
          </div>
          <div className="text-[10px] text-red-400 font-bold flex justify-between">
            <span>Missing Upload ({formatToDDMMYYYY(toDate)}):</span>
            <span className="font-black">{missingTodayOperators.length}</span>
          </div>
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* RIGHT MAIN WORKSPACE                                                  */}
      {/* ===================================================================== */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6 max-w-[1500px]">
        {/* MASTER 4-TIER CASCADING FILTER + 7-PRESET DATE DROPDOWN CONSOLE */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-black text-base text-slate-900 uppercase tracking-wider">
                Cascading Network Filter &amp; Report Export Console
              </h2>
              <p className="text-[11px] font-bold text-slate-500">
                Active Window: <span className="text-blue-600 font-black">{formatToDDMMYYYY(fromDate)}</span> to{" "}
                <span className="text-blue-600 font-black">{formatToDDMMYYYY(toDate)}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  downloadAadhaarPDFReport(
                    filteredDailyReports,
                    fFileMode,
                    `State:${fState} | HQ:${fHq} | Loc:${fCenter} | Op:${fPartner}`
                  )
                }
                className="bg-red-600 hover:bg-red-700 text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
              >
                📄 Export Filtered PDF
              </button>
              <button
                onClick={() => downloadAadhaarCSVReport(filteredDailyReports, fFileMode)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow transition"
              >
                📊 Export Filtered CSV
              </button>
            </div>
          </div>

          {/* ROW 1: 4-TIER GEOGRAPHIC & OPERATOR CASCADE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">1. State</label>
              <select
                value={fState}
                onChange={(e) => {
                  setFState(e.target.value);
                  setFHq("ALL");
                  setFCenter("ALL");
                  setFPartner("ALL");
                }}
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-600"
              >
                <option value="ALL">All States</option>
                {uniqueStates.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">2. Master HQ</label>
              <select
                value={fHq}
                onChange={(e) => {
                  setFHq(e.target.value);
                  setFCenter("ALL");
                  setFPartner("ALL");
                }}
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-600"
              >
                <option value="ALL">All Master HQs</option>
                {hqOptions.map((hq) => (
                  <option key={hq.id} value={hq.id}>
                    {hq.center_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">3. Location (Center)</label>
              <select
                value={fCenter}
                onChange={(e) => {
                  setFCenter(e.target.value);
                  setFPartner("ALL");
                }}
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-600"
              >
                <option value="ALL">All Locations</option>
                {centerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.center_name} [{c.center_code || "NO-CODE"}]
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">4. Operator</label>
              <select
                value={fPartner}
                onChange={(e) => setFPartner(e.target.value)}
                className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-xs font-bold bg-slate-50 outline-none focus:border-blue-600"
              >
                <option value="ALL">All Operators</option>
                {operatorOptions.map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.partner_name} ({op.aadhaar_operator_id || "No-ID"} / {op.aadhaar_station_id || "No-Stn"})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ROW 2: 7-OPTION DATE PRESET DROPDOWN + CUSTOM DATES + FILE MODE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-[9px] font-black uppercase text-indigo-600 mb-1">
                5. Date Range Preset
              </label>
              <select
                value={datePreset}
                onChange={(e) => handlePresetChange(e.target.value as DatePresetMode)}
                className="w-full border-2 border-indigo-200 p-2.5 rounded-lg text-xs font-black bg-indigo-50 text-indigo-900 outline-none focus:border-indigo-600"
              >
                <option value="today">Today ({formatToDDMMYYYY(getDateRangeFromPreset("today").start)})</option>
                <option value="yesterday">Yesterday ({formatToDDMMYYYY(getDateRangeFromPreset("yesterday").start)})</option>
                <option value="current_week">Current Week</option>
                <option value="current_month">Current Month</option>
                <option value="previous_month">Previous Month</option>
                <option value="all">All Time</option>
                <option value="custom">Custom Filter (Select Dates)</option>
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">
                From Date ({formatToDDMMYYYY(fromDate)})
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setDatePreset("custom");
                  setFromDate(e.target.value);
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-slate-400 mb-1">
                To Date ({formatToDDMMYYYY(toDate)})
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setDatePreset("custom");
                  setToDate(e.target.value);
                }}
                className="w-full border-2 border-slate-200 p-2 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase text-blue-600 mb-1">
                6. File Submission Mode
              </label>
              <select
                value={fFileMode}
                onChange={(e) => setFFileMode(e.target.value as any)}
                className="w-full border-2 border-blue-200 p-2.5 rounded-lg text-xs font-black bg-blue-50 text-blue-900 outline-none focus:border-blue-600"
              >
                <option value="ALL">📋 Both (With &amp; Without Files)</option>
                <option value="WITH_FILES">✅ With CSV &amp; HTML Files Only</option>
                <option value="WITHOUT_FILES">⚠️ Without Files (Manual/Exemption)</option>
              </select>
            </div>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* MENU 1: NETWORK KPIS & 5-CATEGORY COUNTS                              */}
        {/* ===================================================================== */}
        {activeMenu === "overview" && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-emerald-500">
                <p className="text-[10px] font-black text-slate-400 uppercase">1. New Enrolment</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{kpi.cat1}</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-teal-500">
                <p className="text-[10px] font-black text-slate-400 uppercase">2. MBU Free</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{kpi.cat2}</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-amber-500">
                <p className="text-[10px] font-black text-slate-400 uppercase">3. MBU Chargeable</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{kpi.cat3}</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-blue-500">
                <p className="text-[10px] font-black text-slate-400 uppercase">4. Demographic</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{kpi.cat4}</p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-t-4 border-t-purple-600">
                <p className="text-[10px] font-black text-slate-400 uppercase">5. Biometric Update</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{kpi.cat5}</p>
              </div>
            </div>

            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400">Total Network Packets</p>
                <p className="text-3xl font-black mt-1">{kpi.pkts}</p>
                <p className="text-[10px] text-emerald-400 font-bold mt-1">
                  ✅ {kpi.comp} Completed | ❌ {kpi.rej} Rejected
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400">Net Base Fee (Excl. GST)</p>
                <p className="text-2xl font-black mt-1">₹{kpi.base.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-amber-400">18% GST Component</p>
                <p className="text-2xl font-black text-amber-400 mt-1">
                  ₹{kpi.gst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-emerald-400">Total Cash Collected</p>
                <p className="text-3xl font-black text-emerald-400 mt-1">
                  ₹{kpi.cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* MISSING DAILY REPORT DEFAULTERS */}
            <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
                <h3 className="font-black text-red-800 text-xs uppercase tracking-widest">
                  ⚠️ Operators Missing Daily Upload for {formatToDDMMYYYY(toDate)}
                </h3>
                <span className="bg-red-200 text-red-900 font-black px-2.5 py-0.5 rounded text-xs">
                  {missingTodayOperators.length} Pending
                </span>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                {missingTodayOperators.length === 0 ? (
                  <p className="col-span-3 text-center py-4 text-xs font-bold text-emerald-600">
                    ✅ All filtered Aadhaar operators have submitted reports for {formatToDDMMYYYY(toDate)}.
                  </p>
                ) : (
                  missingTodayOperators.map((op) => (
                    <div key={op.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex justify-between items-center">
                      <div>
                        <p className="font-black text-xs text-slate-900">{op.partner_name}</p>
                        <p className="text-[10px] font-bold text-slate-500">
                          {op.aadhaar_operator_id || "No-ID"} | Stn: {op.aadhaar_station_id || "N/A"}
                        </p>
                      </div>
                      <span className="text-[9px] font-black bg-red-100 text-red-700 px-2 py-1 rounded uppercase">
                        Unlogged
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 2: DAILY REPORTS LEDGER & RAW FILE VAULT                         */}
        {/* ===================================================================== */}
        {activeMenu === "daily_vault" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest">
                Daily Aadhaar Reports Vault ({filteredDailyReports.length} Rows)
              </h3>
              <span className="text-[10px] font-bold text-amber-400 uppercase">Mode: {fFileMode}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                  <tr>
                    <th className="p-3.5">Date (DD/MM/YYYY)</th>
                    <th className="p-3.5">Center &amp; Operator</th>
                    <th className="p-3.5">Mode</th>
                    <th className="p-3.5 text-center">New</th>
                    <th className="p-3.5 text-center">MBU(F)</th>
                    <th className="p-3.5 text-center">MBU(P)</th>
                    <th className="p-3.5 text-center">Demo</th>
                    <th className="p-3.5 text-center">Bio</th>
                    <th className="p-3.5 text-center">Total</th>
                    <th className="p-3.5 text-right">Cash (₹)</th>
                    <th className="p-3.5 text-center">Deposit</th>
                    <th className="p-3.5 text-center">Vault Files</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredDailyReports.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-black">{formatToDDMMYYYY(r.report_date)}</td>
                      <td className="p-3.5">
                        <p className="font-black text-slate-900">{r.active_partners?.partner_name}</p>
                        <p className="text-[10px] font-bold text-slate-500">
                          {r.operator_id} | Stn: {r.station_id} | {r.active_partners?.locations?.center_name}
                        </p>
                      </td>
                      <td className="p-3.5">
                        {r.has_files ? (
                          <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                            CSV + HTML
                          </span>
                        ) : (
                          <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                            Manual ({r.exemption_reason})
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
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                            r.deposit_status === "Pending Deposit"
                              ? "bg-red-100 text-red-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {r.deposit_status}
                        </span>
                      </td>
                      <td className="p-3.5 text-center">
                        {r.has_files ? (
                          <div className="flex justify-center gap-1">
                            <button
                              onClick={() => handleDownloadVaultFile(r.csv_file_url)}
                              className="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                            >
                              CSV
                            </button>
                            <button
                              onClick={() => handleDownloadVaultFile(r.html_file_url)}
                              className="bg-indigo-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                            >
                              HTML
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-bold">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredDailyReports.length === 0 && (
                    <tr>
                      <td colSpan={12} className="p-10 text-center text-slate-400 font-bold">
                        No daily Aadhaar records match the selected cascade and date filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 3: WEEKLY VS DAILY RECONCILIATION AUDIT                          */}
        {/* ===================================================================== */}
        {activeMenu === "weekly_audit" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 text-white">
              <h3 className="font-black text-xs uppercase tracking-widest">
                Weekly vs. Daily Reconciliation Audit ({filteredWeeklyReports.length} Submissions)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                  <tr>
                    <th className="p-3.5">Week Range (DD/MM/YYYY)</th>
                    <th className="p-3.5">Operator &amp; Station</th>
                    <th className="p-3.5 text-center">Weekly Packets</th>
                    <th className="p-3.5 text-center">Rejected Pkts</th>
                    <th className="p-3.5 text-right">Weekly Cash (₹)</th>
                    <th className="p-3.5 text-center">Audit Status</th>
                    <th className="p-3.5 text-center">Files</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredWeeklyReports.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-black">
                        {formatToDDMMYYYY(w.start_date)} &rarr; {formatToDDMMYYYY(w.end_date)}
                      </td>
                      <td className="p-3.5">
                        <p className="font-black text-slate-900">{w.active_partners?.partner_name}</p>
                        <p className="text-[10px] font-bold text-slate-500">
                          {w.operator_id} | Stn: {w.station_id}
                        </p>
                      </td>
                      <td className="p-3.5 text-center font-black">{w.total_packets_qty}</td>
                      <td className="p-3.5 text-center font-black text-red-600">{w.rejected_qty}</td>
                      <td className="p-3.5 text-right font-black">
                        ₹{Number(w.total_cash_collected).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center">
                        {w.discrepancy_days_count === 0 ? (
                          <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded text-[10px] font-black uppercase">
                            ✅ 100% Matched
                          </span>
                        ) : (
                          <span className="bg-red-100 text-red-800 px-2.5 py-1 rounded text-[10px] font-black uppercase">
                            🚨 {w.discrepancy_days_count} Day(s) Mismatched
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => handleDownloadVaultFile(w.csv_file_url)}
                            className="bg-slate-800 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                          >
                            CSV
                          </button>
                          <button
                            onClick={() => handleDownloadVaultFile(w.html_file_url)}
                            className="bg-indigo-600 text-white px-2 py-1 rounded text-[9px] font-black uppercase"
                          >
                            HTML
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 4: ₹100/DAY LATE DEPOSIT PENALTY LEDGER                          */}
        {/* ===================================================================== */}
        {activeMenu === "penalties" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest">
                Automated ₹100/Day Late Payment Penalty Ledger
              </h3>
              <span className="text-xs font-black text-red-400">
                Unsettled Penalties: ₹{unpaidPenaltiesSum.toLocaleString("en-IN")}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                  <tr>
                    <th className="p-3.5">Penalty Date (DD/MM/YYYY)</th>
                    <th className="p-3.5">Overdue Report Date</th>
                    <th className="p-3.5">Partner &amp; Station</th>
                    <th className="p-3.5 text-right">Penalty Charged</th>
                    <th className="p-3.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredPenalties.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-black">{formatToDDMMYYYY(p.penalty_for_date)}</td>
                      <td className="p-3.5 font-bold text-red-600">{formatToDDMMYYYY(p.report_date)}</td>
                      <td className="p-3.5">
                        <p className="font-black text-slate-900">{p.active_partners?.partner_name}</p>
                        <p className="text-[10px] font-bold text-slate-500">
                          {p.active_partners?.aadhaar_operator_id} | Stn: {p.active_partners?.aadhaar_station_id}
                        </p>
                      </td>
                      <td className="p-3.5 text-right font-black text-red-600">
                        ₹{Number(p.penalty_amount).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                            p.is_settled ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                          }`}
                        >
                          {p.is_settled ? "Settled" : "Unpaid in Ledger"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 5: OPERATOR ROLE FLIP & UPGRADE APPROVALS (NO MASTER CTOP)       */}
        {/* ===================================================================== */}
        {activeMenu === "operators" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-fit">
              <h3 className="font-black text-base text-slate-900 border-b pb-3 mb-4">
                Direct Aadhaar Role Flip &amp; Station Bind
              </h3>
              <p className="text-xs font-bold text-slate-500 mb-4">
                Flip any active partner to the Aadhaar role and bind their UIDAI Operator ID and Station ID (No Master CTOP required).
              </p>
              <form onSubmit={handleDirectOperatorMap} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Select Active Partner *
                  </label>
                  <select
                    required
                    value={mappingForm.partner_id}
                    onChange={(e) => {
                      const p = partners.find((x) => x.id === e.target.value);
                      setMappingForm({
                        partner_id: e.target.value,
                        operator_id: p?.aadhaar_operator_id || "",
                        station_id: p?.aadhaar_station_id || "",
                      });
                    }}
                    className="w-full border-2 p-2.5 rounded-lg text-xs font-bold bg-slate-50"
                  >
                    <option value="" disabled>
                      -- Choose Partner --
                    </option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partner_name} ({p.locations?.center_name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    UIDAI Operator ID (e.g., MYS_FAAFREEN) *
                  </label>
                  <input
                    type="text"
                    required
                    value={mappingForm.operator_id}
                    onChange={(e) => setMappingForm({ ...mappingForm, operator_id: e.target.value })}
                    className="w-full border-2 p-2.5 rounded-lg text-xs font-black uppercase"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    UIDAI Station ID (5 Digits, e.g., 21505) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={5}
                    value={mappingForm.station_id}
                    onChange={(e) =>
                      setMappingForm({ ...mappingForm, station_id: e.target.value.replace(/\D/g, "") })
                    }
                    className="w-full border-2 p-2.5 rounded-lg text-xs font-black"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingMapping}
                  className="w-full py-3.5 bg-slate-900 hover:bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow transition"
                >
                  {isSavingMapping ? "Saving..." : "Activate Aadhaar Role & Bind IDs"}
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit">
              <div className="p-4 bg-slate-900 text-white">
                <h3 className="font-black text-xs uppercase tracking-widest">
                  Partner Aadhaar Upgrade Requests ({upgradeRequests.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                    <tr>
                      <th className="p-3.5">Date</th>
                      <th className="p-3.5">Partner &amp; Center</th>
                      <th className="p-3.5">Requested IDs</th>
                      <th className="p-3.5 text-center">Compliance PDF</th>
                      <th className="p-3.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {upgradeRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-bold">{formatToDDMMYYYY(req.created_at)}</td>
                        <td className="p-3.5">
                          <p className="font-black text-slate-900">{req.active_partners?.partner_name}</p>
                          <p className="text-[10px] font-bold text-slate-500">
                            {req.active_partners?.locations?.center_name}
                          </p>
                        </td>
                        <td className="p-3.5">
                          <p className="font-black text-blue-700">Op: {req.requested_operator_id}</p>
                          <p className="text-[10px] font-bold text-slate-600">
                            Stn: {req.requested_station_id} | NSEIT: {req.nseit_cert_no}
                          </p>
                        </td>
                        <td className="p-3.5 text-center">
                          <button
                            onClick={() => handleDownloadVaultFile(req.compliance_pdf_url, "application_documents")}
                            className="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded text-[10px] font-black uppercase"
                          >
                            📄 View PDF
                          </button>
                        </td>
                        <td className="p-3.5 text-right">
                          {req.status === "Pending" ? (
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => handleUpgradeDecision(req, "Approved")}
                                className="bg-emerald-600 text-white px-3 py-1 rounded text-[10px] font-black uppercase"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleUpgradeDecision(req, "Rejected")}
                                className="bg-red-600 text-white px-3 py-1 rounded text-[10px] font-black uppercase"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] font-black uppercase text-slate-500">{req.status}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* MENU 6: UIDAI TARIFF MASTER (DATE-VERSIONED PRICE CONTROL)            */}
        {/* ===================================================================== */}
        {activeMenu === "tariff_master" && isSuperAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-fit">
              <h3 className="font-black text-base text-slate-900 border-b pb-3 mb-2">
                Deploy New UIDAI Tariff Version
              </h3>
              <p className="text-[11px] font-bold text-slate-500 mb-4">
                Setting a new Effective Date automatically closes the previous tariff on the prior day, ensuring backdated reports are never altered.
              </p>
              <form onSubmit={handleCreateNewTariffVersion} className="space-y-3 text-xs">
                <div>
                  <label className="block text-[10px] font-black uppercase text-blue-700 mb-1">
                    Effective From Date ({formatToDDMMYYYY(tariffForm.effective_from)}) *
                  </label>
                  <input
                    type="date"
                    required
                    value={tariffForm.effective_from}
                    onChange={(e) => setTariffForm({ ...tariffForm, effective_from: e.target.value })}
                    className="w-full border-2 border-blue-200 p-2.5 rounded-lg font-black bg-blue-50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">3. MBU Paid (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tariffForm.mbu_chargeable_fee}
                      onChange={(e) => setTariffForm({ ...tariffForm, mbu_chargeable_fee: e.target.value })}
                      className="w-full border p-2 rounded font-bold mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">4. Demographic (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tariffForm.demographic_fee}
                      onChange={(e) => setTariffForm({ ...tariffForm, demographic_fee: e.target.value })}
                      className="w-full border p-2 rounded font-bold mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">5. Biometric (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tariffForm.biometric_fee}
                      onChange={(e) => setTariffForm({ ...tariffForm, biometric_fee: e.target.value })}
                      className="w-full border p-2 rounded font-bold mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-red-600">Late Fine / Day (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tariffForm.daily_late_penalty}
                      onChange={(e) => setTariffForm({ ...tariffForm, daily_late_penalty: e.target.value })}
                      className="w-full border p-2 rounded font-bold mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">Demo Min (&gt; ₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tariffForm.demo_min_threshold}
                      onChange={(e) => setTariffForm({ ...tariffForm, demo_min_threshold: e.target.value })}
                      className="w-full border p-2 rounded font-bold mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">Demo Max (&lt; ₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tariffForm.demo_max_threshold}
                      onChange={(e) => setTariffForm({ ...tariffForm, demo_max_threshold: e.target.value })}
                      className="w-full border p-2 rounded font-bold mt-1"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSavingTariff}
                  className="w-full py-3.5 bg-slate-900 hover:bg-emerald-600 text-white font-black uppercase tracking-widest rounded-xl shadow mt-2 transition"
                >
                  {isSavingTariff ? "Deploying..." : "Commit New Tariff Version"}
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit">
              <div className="p-4 bg-slate-900 text-white">
                <h3 className="font-black text-xs uppercase tracking-widest">
                  UIDAI Tariff Version History (Backdate Protection Log)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                    <tr>
                      <th className="p-3.5">Effective From</th>
                      <th className="p-3.5">Effective To</th>
                      <th className="p-3.5 text-center">MBU Paid</th>
                      <th className="p-3.5 text-center">Demographic</th>
                      <th className="p-3.5 text-center">Biometric</th>
                      <th className="p-3.5 text-center">Demo Range</th>
                      <th className="p-3.5 text-center">Late Fine</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tariffHistory.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-black text-emerald-700">{formatToDDMMYYYY(t.effective_from)}</td>
                        <td className="p-3.5 font-black text-slate-600">
                          {t.effective_to ? formatToDDMMYYYY(t.effective_to) : "ACTIVE NOW"}
                        </td>
                        <td className="p-3.5 text-center font-bold">₹{t.mbu_chargeable_fee}</td>
                        <td className="p-3.5 text-center font-bold">₹{t.demographic_fee}</td>
                        <td className="p-3.5 text-center font-bold">₹{t.biometric_fee}</td>
                        <td className="p-3.5 text-center font-bold">
                          &gt;₹{t.demo_min_threshold} &amp; &lt;₹{t.demo_max_threshold}
                        </td>
                        <td className="p-3.5 text-center font-black text-red-600">₹{t.daily_late_penalty}/d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}