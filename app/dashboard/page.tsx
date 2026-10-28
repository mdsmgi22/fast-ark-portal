// FILE PATH: ./app/dashboard/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";

import StaffManagementEngine from "../components/StaffManagementEngine";
import SupportDeskModule from "../components/mis/SupportDeskModule";
import {
  DatePresetMode,
  getDateRangeFromPreset,
  formatToDDMMYYYY,
  getISTDateString,
} from "../lib/aadhaarEngine";

type AdminDeptGroup =
  | "pulse"
  | "treasury"
  | "operations"
  | "network"
  | "governance";

type RevenueStreamFilter = "ALL" | "TELECOM" | "AADHAAR";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val ?? "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

export default function AdminCommandCenter() {
  const router = useRouter();
  const [adminUser, setAdminUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isRouting, setIsRouting] = useState(false);

  // LEFT SIDEBAR DEPARTMENT GROUP & SPA SUPPORT VIEW
  const [activeGroup, setActiveGroup] = useState<AdminDeptGroup>("pulse");
  const [activeView, setActiveView] = useState<"dashboard" | "support">(
    "dashboard"
  );
  const [streamFilter, setStreamFilter] =
    useState<RevenueStreamFilter>("ALL");
  const [showGeoFilters, setShowGeoFilters] = useState<boolean>(true);

  // LIVE IST CLOCK & DD/MM/YYYY DATE
  const [liveDateDDMMYYYY, setLiveDateDDMMYYYY] = useState<string>("");
  const [liveTimeIST, setLiveTimeIST] = useState<string>("");

  const [stats, setStats] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    locations: 0,
  });
  const [recentApps, setRecentApps] = useState<any[]>([]);
  const [enquiries, setEnquiries] = useState<any[]>([]);

  // MASTER DIRECTORY STATES
  const [allPartners, setAllPartners] = useState<any[]>([]);
  const [allLocations, setAllLocations] = useState<any[]>([]);

  // LIVE REVENUE RAW DATA (TELECOM + PAYBULL + AADHAAR + DEPOSITS)
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawAadhaar, setRawAadhaar] = useState<any[]>([]);
  const [rawDeposits, setRawDeposits] = useState<any[]>([]);

  // 7-OPTION DATE PRESET + 4-TIER CASCADE FILTER ENGINE STATES
  const [datePreset, setDatePreset] = useState<DatePresetMode>("current_month");
  const [fromDate, setFromDate] = useState(
    () => getDateRangeFromPreset("current_month").start
  );
  const [toDate, setToDate] = useState(
    () => getDateRangeFromPreset("current_month").end
  );

  const [fState, setFState] = useState("ALL");
  const [fHq, setFHq] = useState("ALL");
  const [fCenter, setFCenter] = useState("ALL");
  const [fPartner, setFPartner] = useState("ALL");

  const [financials, setFinancials] = useState({
    cbpLandline: 0,
    cbpGsm: 0,
    cbp: 0,
    ctop: 0,
    frcCash: 0,
    mnpCash: 0,
    frcMnpCash: 0,
    simOnlyCash: 0,
    otherCash: 0,
    sim: 0,
    pbCtop: 0,
    pbCbp: 0,
    pbFrc: 0,
    pbMnp: 0,
    pbOther: 0,
    paybull: 0,
    aadhaar: 0,
    cheque: 0,
    chequeQty: 0,
    totalSalesCash: 0,
    totalDeposits: 0,
    telecomSalesCash: 0,
    telecomDeposits: 0,
    telecomPending: 0,
    aadhaarSalesCash: 0,
    aadhaarDeposits: 0,
    aadhaarPending: 0,
    adhCat1: 0,
    adhCat2: 0,
    adhCat3: 0,
    adhCat4: 0,
    adhCat5: 0,
    aadhaarPackets: 0,
    adhCompleted: 0,
    adhInProcess: 0,
    adhRejected: 0,
    adhBase: 0,
    adhGst: 0,
    qNew: 0,
    qUpgrade: 0,
    qReplace: 0,
    qFancy: 0,
    qMnp: 0,
    qFrc: 0,
    qPostpaid: 0,
    totalPrepaidSims: 0,
    totalSims: 0,
  });
  const [chartData, setChartData] = useState<any[]>([]);

  const [missingSales, setMissingSales] = useState<any[]>([]);
  const [missingDeposits, setMissingDeposits] = useState<any[]>([]);
  const [isRefreshingFinance, setIsRefreshingFinance] = useState(false);

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
      if (!session) return router.push("/login");

      const { data: staffData } = await supabase
        .from("back_office_staff")
        .select("*")
        .ilike("email", (session.user.email || "").trim())
        .maybeSingle();

      if (!staffData || staffData.status !== "Active") {
        return router.push("/login");
      }

      const safeRole = (staffData?.role || "").trim().toLowerCase();
      if (safeRole === "supervisor") {
        return router.push("/dashboard/supervisor-hub");
      }

      // Role-Based Default Landing Tab: Admin, Manager & Accountant -> 1. DRS Dashboard, Staff -> 3. Daily Operations
      if (safeRole === "staff") {
        setActiveGroup("operations");
      } else {
        setActiveGroup("pulse");
      }

      setAdminUser(staffData);

      const [locRes, partRes] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"),
        supabase
          .from("active_partners")
          .select(
            "id, partner_name, mobile, role, role_aadhaar, aadhaar_station_id, locations(id, state, dist, center_name, center_code, parent_master_id)"
          )
          .eq("status", "Active")
          .order("partner_name"),
      ]);

      const locData = locRes.data || [];
      setAllLocations(locData);
      setAllPartners(partRes.data || []);

      if (["admin", "manager", "staff"].includes(safeRole)) {
        await fetchOperationalData(locData);
      }

      if (!["admin", "accountant", "manager"].includes(safeRole)) {
        setLoading(false);
      }
    } catch (err: any) {
      console.error("Dashboard init error:", err.message);
      setLoading(false);
    }
  };

  const fetchOperationalData = async (locationsArray: any[]) => {
    try {
      const [appsRes, enqRes] = await Promise.all([
        supabase
          .from("pending_applications")
          .select("id, name, requested_role, status, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("enquiries")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);

      if (enqRes.data) setEnquiries(enqRes.data);

      const apps = appsRes.data || [];
      setStats({
        pending: apps.filter((app) => app.status === "Pending" || !app.status)
          .length,
        approved: apps.filter((app) => app.status === "Approved").length,
        rejected: apps.filter((app) => app.status === "Rejected").length,
        locations:
          locationsArray.filter((l) => l.is_active !== false).length || 0,
      });
      setRecentApps(apps.slice(0, 6));
    } catch (error: any) {
      console.error("Operational data error:", error.message);
    }
  };

  useEffect(() => {
    if (
      adminUser &&
      ["admin", "accountant", "manager"].includes(
        adminUser.role.trim().toLowerCase()
      )
    ) {
      fetchFinancialData();
    }
  }, [fromDate, toDate, adminUser]);

  const fetchFinancialData = async () => {
    setIsRefreshingFinance(true);
    try {
      const [salesRes, aadhaarRes, depositsRes] = await Promise.all([
        supabase
          .from("daily_sales_reports")
          .select(
            `*, active_partners (id, partner_name, locations (id, state, dist, center_name, center_code, parent_master_id))`
          )
          .gte("report_date", fromDate)
          .lte("report_date", toDate),
        supabase
          .from("aadhaar_daily_reports")
          .select(
            `*, active_partners (id, partner_name, locations (id, state, dist, center_name, center_code, parent_master_id))`
          )
          .gte("report_date", fromDate)
          .lte("report_date", toDate),
        supabase
          .from("partner_deposits")
          .select(
            `*, active_partners (id, partner_name, locations (id, state, dist, center_name, center_code, parent_master_id))`
          )
          .neq("status", "Discrepancy")
          .gte("deposit_date", fromDate)
          .lte("deposit_date", toDate),
      ]);

      setRawSales(salesRes.data || []);
      setRawAadhaar(aadhaarRes.data || []);
      setRawDeposits(depositsRes.data || []);
    } catch (error: any) {
      console.error("Finance fetch error:", error.message);
    } finally {
      setIsRefreshingFinance(false);
      setLoading(false);
    }
  };

  const handlePresetChange = (mode: DatePresetMode) => {
    setDatePreset(mode);
    if (mode !== "custom") {
      const range = getDateRangeFromPreset(mode);
      setFromDate(range.start);
      setToDate(range.end);
    }
  };

  useEffect(() => {
    if (
      allPartners.length > 0 ||
      rawSales.length > 0 ||
      rawAadhaar.length > 0
    ) {
      calculateEngine(rawSales, rawAadhaar, rawDeposits, allPartners);
    }
  }, [
    fState,
    fHq,
    fCenter,
    fPartner,
    streamFilter,
    rawSales,
    rawAadhaar,
    rawDeposits,
    allPartners,
  ]);

  const calculateEngine = (
    sales: any[],
    aadhaar: any[],
    deposits: any[],
    directory: any[]
  ) => {
    const applyGeoFilter = (item: any) => {
      const p = item.active_partners || item;
      const locData = p?.locations;
      const l: any = Array.isArray(locData) ? locData[0] : locData;
      if (!l) return false;

      if (fState !== "ALL" && l.state !== fState) return false;
      if (
        fHq !== "ALL" &&
        l.parent_master_id?.toString() !== fHq &&
        l.id?.toString() !== fHq
      )
        return false;
      if (fCenter !== "ALL" && l.id?.toString() !== fCenter) return false;
      if (fPartner !== "ALL" && p.id?.toString() !== fPartner) return false;

      return true;
    };

    const isAadhaarDeposit = (d: any) =>
      d.deposit_stream === "AADHAAR" ||
      String(d.reference_no || "")
        .toUpperCase()
        .startsWith("AADHAAR_");

    const filteredSales = sales.filter(applyGeoFilter);
    const filteredAadhaar = aadhaar.filter(applyGeoFilter);
    const filteredDeposits = deposits.filter(applyGeoFilter);
    const filteredDirectory = directory.filter(applyGeoFilter);

    let cbpLL = 0,
      cbpGsm = 0,
      tCbp = 0,
      tCtop = 0,
      frcCash = 0,
      mnpCash = 0,
      simOnlyCash = 0,
      otherCash = 0,
      tSim = 0,
      pbCtop = 0,
      pbCbp = 0,
      pbFrc = 0,
      pbMnp = 0,
      pbOther = 0,
      tPaybull = 0,
      tAadhaar = 0,
      tCheque = 0,
      chequeQty = 0,
      tTelecomSalesCash = 0,
      tTelecomDeposits = 0,
      tAadhaarDeposits = 0;

    let qNew = 0,
      qUpgrade = 0,
      qReplace = 0,
      qFancy = 0,
      qMnp = 0,
      qFrc = 0,
      qPostpaid = 0;

    let adhCat1 = 0,
      adhCat2 = 0,
      adhCat3 = 0,
      adhCat4 = 0,
      adhCat5 = 0,
      aadhaarPackets = 0,
      adhCompleted = 0,
      adhInProcess = 0,
      adhRejected = 0,
      adhBase = 0,
      adhGst = 0;

    const chartMap: Record<
      string,
      { date: string; Sales: number; Deposits: number }
    > = {};

    filteredSales.forEach((s) => {
      const sLL = Number(s.cbp_landline_amt || 0);
      const sGsm = Number(s.cbp_gsm_amt || 0);
      const sCbp = sLL + sGsm;
      const sCtop = Number(s.ctop_recharge_amt || 0);
      const sFrc = Number(s.frc_amt || 0);
      const sMnp = Number(s.mnp_amt || 0);
      const sSimCards =
        Number(s.sim_replacement_amt || 0) +
        Number(s.sim_fancy_amt || 0) +
        Number(s.sim_postpaid_amt || 0);
      const sOther = Number(s.other_amt || 0);

      const sPbCtop = Number(s.pb_ctop_amt || 0);
      const sPbCbp = Number(s.pb_cbp_amt || 0);
      const sPbFrc = Number(s.pb_frc_amt || 0);
      const sPbMnp = Number(s.pb_mnp_amt || 0);
      const sPbOther = Number(s.pb_other_amt || 0);
      const sPb = sPbCtop + sPbCbp + sPbFrc + sPbMnp + sPbOther;

      const totalCashRow =
        sCbp + sCtop + sFrc + sMnp + sSimCards + sOther + sPb;

      cbpLL += sLL;
      cbpGsm += sGsm;
      tCbp += sCbp;
      tCtop += sCtop;
      frcCash += sFrc;
      mnpCash += sMnp;
      simOnlyCash += sSimCards;
      otherCash += sOther;
      tSim += sSimCards + sFrc + sMnp + sOther;

      pbCtop += sPbCtop;
      pbCbp += sPbCbp;
      pbFrc += sPbFrc;
      pbMnp += sPbMnp;
      pbOther += sPbOther;
      tPaybull += sPb;

      tCheque += Number(s.cheque_amt || 0);
      chequeQty += Number(s.cheque_qty || 0);
      tTelecomSalesCash += totalCashRow;

      qNew += Number(s.sim_new_qty || 0);
      qUpgrade += Number(s.sim_upgrade_qty || 0);
      qReplace += Number(s.sim_replacement_qty || 0);
      qFancy += Number(s.sim_fancy_qty || 0);
      qMnp += Number(s.mnp_qty || 0);
      qFrc += Number(s.frc_qty || 0);
      qPostpaid += Number(s.sim_postpaid_qty || 0);

      if (streamFilter !== "AADHAAR") {
        const dateKey = s.report_date;
        if (!chartMap[dateKey])
          chartMap[dateKey] = { date: dateKey, Sales: 0, Deposits: 0 };
        chartMap[dateKey].Sales += totalCashRow;
      }
    });

    filteredAadhaar.forEach((a) => {
      const aCash = Number(a.total_cash_collected || 0);
      tAadhaar += aCash;
      adhCat1 += Number(a.cat1_new_qty || 0);
      adhCat2 += Number(a.cat2_mbu_free_qty || 0);
      adhCat3 += Number(a.cat3_mbu_chargeable_qty || 0);
      adhCat4 += Number(a.cat4_demographic_qty || 0);
      adhCat5 += Number(a.cat5_biometric_qty || 0);
      aadhaarPackets += Number(a.total_packets_qty || 0);
      adhCompleted += Number(a.completed_qty || 0);
      adhInProcess += Number(a.inprocess_qty || 0);
      adhRejected += Number(a.rejected_qty || 0);
      adhBase += Number(a.base_amount || 0);
      adhGst += Number(a.gst_amount || 0);

      if (streamFilter !== "TELECOM") {
        const dateKey = a.report_date;
        if (!chartMap[dateKey])
          chartMap[dateKey] = { date: dateKey, Sales: 0, Deposits: 0 };
        chartMap[dateKey].Sales += aCash;
      }
    });

    filteredDeposits.forEach((d) => {
      const amt = Number(d.deposit_amount || 0);
      const isAdh = isAadhaarDeposit(d);

      if (isAdh) {
        tAadhaarDeposits += amt;
      } else {
        tTelecomDeposits += amt;
      }

      const includeInChart =
        streamFilter === "ALL" ||
        (streamFilter === "AADHAAR" && isAdh) ||
        (streamFilter === "TELECOM" && !isAdh);

      if (includeInChart) {
        const dateKey = (d.deposit_date || d.created_at).split("T")[0];
        if (!chartMap[dateKey])
          chartMap[dateKey] = { date: dateKey, Sales: 0, Deposits: 0 };
        chartMap[dateKey].Deposits += amt;
      }
    });

    const totalPrepaidSims =
      qNew + qUpgrade + qReplace + qFancy + qMnp + qFrc;
    const totalSims = totalPrepaidSims + qPostpaid;

    const totalSalesCash = tTelecomSalesCash + tAadhaar;
    const totalDeposits = tTelecomDeposits + tAadhaarDeposits;

    setFinancials({
      cbpLandline: cbpLL,
      cbpGsm,
      cbp: tCbp,
      ctop: tCtop,
      frcCash,
      mnpCash,
      frcMnpCash: frcCash + mnpCash,
      simOnlyCash,
      otherCash,
      sim: tSim,
      pbCtop,
      pbCbp,
      pbFrc,
      pbMnp,
      pbOther,
      paybull: tPaybull,
      aadhaar: tAadhaar,
      cheque: tCheque,
      chequeQty,
      totalSalesCash,
      totalDeposits,
      telecomSalesCash: tTelecomSalesCash,
      telecomDeposits: tTelecomDeposits,
      telecomPending: Math.max(0, tTelecomSalesCash - tTelecomDeposits),
      aadhaarSalesCash: tAadhaar,
      aadhaarDeposits: tAadhaarDeposits,
      aadhaarPending: Math.max(0, tAadhaar - tAadhaarDeposits),
      adhCat1,
      adhCat2,
      adhCat3,
      adhCat4,
      adhCat5,
      aadhaarPackets,
      adhCompleted,
      adhInProcess,
      adhRejected,
      adhBase,
      adhGst,
      qNew,
      qUpgrade,
      qReplace,
      qFancy,
      qMnp,
      qFrc,
      qPostpaid,
      totalPrepaidSims,
      totalSims,
    });

    setChartData(
      Object.values(chartMap).sort((a, b) => a.date.localeCompare(b.date))
    );

    const relevantDirectory = filteredDirectory.filter((p) => {
      if (streamFilter === "AADHAAR") {
        return Boolean(
          p.role_aadhaar ||
            p.aadhaar_station_id ||
            String(p.role || "")
              .toUpperCase()
              .includes("AADHAAR")
        );
      }
      return true;
    });

    const partnersWithActivity = new Set<string>([
      ...(streamFilter !== "AADHAAR"
        ? filteredSales.map((s) => s.partner_id)
        : []),
      ...(streamFilter !== "TELECOM"
        ? filteredAadhaar.map((a) => a.partner_id)
        : []),
    ]);

    const partnersWithDeposits = new Set<string>(
      filteredDeposits
        .filter((d) => {
          const isAdh = isAadhaarDeposit(d);
          if (streamFilter === "AADHAAR") return isAdh;
          if (streamFilter === "TELECOM") return !isAdh;
          return true;
        })
        .map((d) => d.partner_id)
    );

    setMissingSales(
      relevantDirectory.filter((p) => !partnersWithActivity.has(p.id))
    );
    setMissingDeposits(
      relevantDirectory.filter((p) => !partnersWithDeposits.has(p.id))
    );
  };

  // --- 1-CLICK DEFAULTER WATCHLIST CSV EXPORT ---
  const handleExportDefaulterWatchlistCSV = (
    listType: "MISSING_REPORTS" | "MISSING_DEPOSITS"
  ) => {
    const targetList =
      listType === "MISSING_REPORTS" ? missingSales : missingDeposits;
    if (targetList.length === 0) {
      return alert("No pending defaulters in this watchlist to export.");
    }

    const headers = [
      "Date Window",
      "Vertical Mode",
      "Watchlist Type",
      "Partner Name",
      "Mobile",
      "Operational Role",
      "UIDAI Station ID",
      "Center Code",
      "Center Name",
      "District",
      "State",
    ];

    const rows = targetList.map((p) => {
      const locData = p.locations;
      const l: any = Array.isArray(locData) ? locData[0] : locData;
      return [
        sanitizeCSV(
          `${formatToDDMMYYYY(fromDate)} to ${formatToDDMMYYYY(toDate)}`
        ),
        sanitizeCSV(streamFilter),
        sanitizeCSV(listType),
        sanitizeCSV(p.partner_name),
        sanitizeCSV(p.mobile || "N/A"),
        sanitizeCSV(p.role),
        sanitizeCSV(p.aadhaar_station_id || "N/A"),
        sanitizeCSV(l?.center_code || "NO-CODE"),
        sanitizeCSV(l?.center_name || "Unassigned"),
        sanitizeCSV(l?.dist || "N/A"),
        sanitizeCSV(l?.state || "N/A"),
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_DRS_${listType}_${streamFilter}_${formatToDDMMYYYY(
      toDate
    ).replace(/\//g, "-")}.csv`;
    link.click();
  };

  const uniqueStates = Array.from(
    new Set(allLocations.map((l) => l.state).filter(Boolean))
  ).sort();

  const hqLocations = allLocations
    .filter(
      (l) => l.is_master_node && (fState === "ALL" || l.state === fState)
    )
    .sort((a, b) => a.center_name.localeCompare(b.center_name));

  const centerLocations = allLocations
    .filter(
      (l) =>
        !l.is_master_node &&
        (fState === "ALL" || l.state === fState) &&
        (fHq === "ALL" || l.parent_master_id?.toString() === fHq)
    )
    .sort((a, b) => a.center_name.localeCompare(b.center_name));

  const filteredPartners = allPartners
    .filter((p) => {
      const locData = p.locations;
      const l: any = Array.isArray(locData) ? locData[0] : locData;
      if (!l) return false;
      if (fState !== "ALL" && l.state !== fState) return false;
      if (
        fHq !== "ALL" &&
        l.parent_master_id?.toString() !== fHq &&
        l.id?.toString() !== fHq
      )
        return false;
      if (fCenter !== "ALL" && l.id?.toString() !== fCenter) return false;
      return true;
    })
    .sort((a, b) => a.partner_name.localeCompare(b.partner_name));

  const handleSignOut = async () => {
    setLoading(true);
    localStorage.removeItem("fapl_session_token");
    localStorage.removeItem("fapl_last_active_ts");
    await supabase.auth.signOut();
    router.push("/login");
  };

  const routeTo = (path: string) => {
    setIsRouting(true);
    router.push(path);
    setTimeout(() => setIsRouting(false), 8000);
  };

  const rawRole = adminUser?.role || "";
  const safeRole = rawRole.trim().toLowerCase();

  const isGodMode = safeRole === "admin";
  const isAccountant = safeRole === "accountant";
  const isStaff = safeRole === "staff";
  const isFinanceTeam = ["admin", "accountant"].includes(safeRole);
  const isOpsTeam = ["admin", "manager", "staff"].includes(safeRole);
  const isManagerOrAdmin = ["admin", "manager"].includes(safeRole);

  if (loading)
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-slate-800 border-t-blue-500 rounded-full animate-spin"></div>
        <p className="text-xs font-black uppercase tracking-widest text-slate-400 animate-pulse">
          Initializing Fast Ark DRS (Daily Report System)...
        </p>
      </div>
    );

  if (activeView === "support") {
    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans">
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <button
            onClick={() => setActiveView("dashboard")}
            className="text-blue-600 font-black text-xs uppercase tracking-widest hover:underline flex items-center gap-2 mb-4 bg-white px-4 py-2.5 rounded-xl shadow-sm border border-slate-200 w-fit transition"
          >
            <span>&larr;</span> Back to DRS Dashboard
          </button>
          <SupportDeskModule
            allLocations={allLocations}
            currentUserRole={safeRole}
          />
        </div>
      </div>
    );
  }

  // Settlement Progress Math (Dynamic by Active Vertical)
  const activeDisplayedGenerated =
    streamFilter === "TELECOM"
      ? financials.telecomSalesCash
      : streamFilter === "AADHAAR"
      ? financials.aadhaarSalesCash
      : financials.totalSalesCash;

  const activeDisplayedDeposited =
    streamFilter === "TELECOM"
      ? financials.telecomDeposits
      : streamFilter === "AADHAAR"
      ? financials.aadhaarDeposits
      : financials.totalDeposits;

  const activeDisplayedShortfall = Math.max(
    0,
    activeDisplayedGenerated - activeDisplayedDeposited
  );

  const overallSettlementPct =
    activeDisplayedGenerated > 0
      ? Math.min(
          100,
          (activeDisplayedDeposited / activeDisplayedGenerated) * 100
        )
      : activeDisplayedDeposited > 0
      ? 100
      : 0;

  const telecomSettlementPct =
    financials.telecomSalesCash > 0
      ? Math.min(
          100,
          (financials.telecomDeposits / financials.telecomSalesCash) * 100
        )
      : financials.telecomDeposits > 0
      ? 100
      : 0;

  const aadhaarSettlementPct =
    financials.aadhaarSalesCash > 0
      ? Math.min(
          100,
          (financials.aadhaarDeposits / financials.aadhaarSalesCash) * 100
        )
      : financials.aadhaarDeposits > 0
      ? 100
      : 0;

  const getProgressColor = (pct: number) => {
    if (pct >= 90) return "bg-emerald-500";
    if (pct >= 70) return "bg-amber-500";
    return "bg-red-500";
  };

  // Department Navigation Groups (Updated to DRS & Team-Friendly Names)
  const departmentGroups: {
    id: AdminDeptGroup;
    icon: string;
    shortLabel: string;
    label: string;
    sub: string;
    visible: boolean;
    badge?: string;
    badgeColor?: string;
  }[] = [
    {
      id: "pulse",
      icon: "📊",
      shortLabel: "DRS",
      label: "1. DRS Dashboard",
      sub: "Revenue, SIM Qty & Vertical Split",
      visible: isFinanceTeam || isManagerOrAdmin,
      badge: `${overallSettlementPct.toFixed(0)}%`,
      badgeColor:
        overallSettlementPct >= 90
          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
          : "bg-amber-500/20 text-amber-300 border border-amber-500/40",
    },
    {
      id: "treasury",
      icon: "🏦",
      shortLabel: "Accounts",
      label: "2. Account & Audit",
      sub: "Deposits, Corrections & Banking",
      visible: isFinanceTeam || isManagerOrAdmin,
      badge: "4 Hubs",
      badgeColor: "bg-slate-800 text-amber-400",
    },
    {
      id: "operations",
      icon: "📡",
      shortLabel: "Daily Ops",
      label: "3. Daily Operations",
      sub: "Aadhaar, MIS, CTOP & Stock",
      visible: true,
      badge: `${financials.totalSims} SIMs`,
      badgeColor:
        "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40",
    },
    {
      id: "network",
      icon: "🌐",
      shortLabel: "Centers",
      label: "4. Approvals & Center List",
      sub: "Application / Center Management",
      visible: isOpsTeam,
      badge:
        stats.pending > 0
          ? `${stats.pending} Pending`
          : `${stats.locations} Locs`,
      badgeColor:
        stats.pending > 0
          ? "bg-amber-500 text-slate-950 animate-pulse"
          : "bg-slate-800 text-slate-300",
    },
    {
      id: "governance",
      icon: "🛡️",
      shortLabel: "Helpdesk",
      label: "5. Helpdesk, Alerts & Staff",
      sub: "Support Desk, Defaulters & Team",
      visible: !isAccountant,
      badge:
        missingSales.length > 0 ? `${missingSales.length} Flags` : "Active",
      badgeColor:
        missingSales.length > 0
          ? "bg-red-500/20 text-red-300 border border-red-500/40"
          : "bg-slate-800 text-emerald-400",
    },
  ];

  const visibleDeptGroups = departmentGroups.filter((g) => g.visible);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row font-sans relative">
      {isRouting && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="text-sm font-bold text-white animate-pulse tracking-widest uppercase">
            Opening DRS Module...
          </p>
        </div>
      )}

      {/* ===================================================================== */}
      {/* LEFT DEPARTMENT SIDEBAR                                               */}
      {/* ===================================================================== */}
      <aside className="w-full lg:w-80 bg-slate-950 text-white flex flex-col justify-between border-r border-slate-800 shrink-0 lg:min-h-screen select-none">
        <div>
          <div className="p-5 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="bg-white px-2.5 py-1.5 rounded-lg flex items-center justify-center shadow shrink-0">
                  <Image
                    src="/logo.png"
                    alt="Fast Ark Logo"
                    width={105}
                    height={32}
                    priority
                    className="object-contain h-7 w-auto"
                  />
                </div>
                <div>
                  <h1 className="font-black text-sm tracking-wide text-white leading-none">
                    FAST ARK DRS
                  </h1>
                  <p className="text-[9px] text-blue-400 font-black uppercase tracking-widest mt-1">
                    Daily Report System
                  </p>
                </div>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2.5 py-1 rounded">
                {rawRole || "Staff"}
              </span>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span>📅</span>
                <span className="font-black text-emerald-400 tracking-wider">
                  {liveDateDDMMYYYY}
                </span>
              </div>
              <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2.5">
                <span>🕒</span>
                <span className="font-mono font-bold text-slate-200 text-[11px]">
                  {liveTimeIST}
                </span>
              </div>
            </div>
          </div>

          {/* DEPARTMENTAL GROUP NAVIGATION */}
          <div className="px-4 pt-3 pb-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              DRS Workspaces
            </p>
          </div>
          <nav className="p-3 space-y-1.5">
            {visibleDeptGroups.map((group) => {
              const isActive = activeGroup === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroup(group.id)}
                  className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between border ${
                    isActive
                      ? "bg-blue-600 text-white border-blue-500 shadow-lg"
                      : "bg-slate-900/60 text-slate-300 border-slate-800/80 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{group.icon}</span>
                    <div className="truncate">
                      <p className="font-black text-xs uppercase tracking-wider truncate">
                        {group.label}
                      </p>
                      <p
                        className={`text-[10px] font-bold truncate mt-0.5 ${
                          isActive ? "text-blue-200" : "text-slate-500"
                        }`}
                      >
                        {group.sub}
                      </p>
                    </div>
                  </div>
                  {group.badge && (
                    <span
                      className={`text-[9px] font-black uppercase px-2 py-0.5 rounded shrink-0 ml-2 ${
                        isActive
                          ? "bg-slate-950/40 text-white"
                          : group.badgeColor
                      }`}
                    >
                      {group.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* PINNED BOTTOM EXECUTIVE SNAPSHOT & SESSION CONTROLS */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 space-y-3">
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-bold">Logged Officer:</span>
              <span className="text-white font-black truncate max-w-[130px]">
                {adminUser?.name || "Officer"}
              </span>
            </div>
            {(isFinanceTeam || isManagerOrAdmin) && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-blue-400 font-bold">
                    BSNL + PB Due:
                  </span>
                  <span className="text-white font-black">
                    ₹{financials.telecomPending.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-amber-400 font-bold">
                    Aadhaar Due:
                  </span>
                  <span className="text-amber-400 font-black">
                    ₹{financials.aadhaarPending.toLocaleString("en-IN")}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-bold">Active Centers:</span>
              <span className="text-emerald-400 font-black">
                {stats.locations}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                if (isOpsTeam) fetchOperationalData(allLocations);
                if (isFinanceTeam || isManagerOrAdmin) fetchFinancialData();
              }}
              className="py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-black text-[10px] uppercase tracking-widest rounded-lg border border-slate-700 transition"
            >
              ↻ Refresh
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="py-2.5 bg-red-600/90 hover:bg-red-600 text-white font-black text-[10px] uppercase tracking-widest rounded-lg transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* RIGHT MAIN WORKSPACE (RENDERS ONLY THE SELECTED DEPARTMENT GROUP)     */}
      {/* ===================================================================== */}
      <main className="flex-1 p-4 md:p-8 pb-24 lg:pb-8 overflow-y-auto space-y-6 max-w-[1500px]">
        {/* TOP CONTEXT HEADER BAR */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                {visibleDeptGroups.find((g) => g.id === activeGroup)?.label}
              </span>
              <span className="text-xs font-bold text-slate-400">
                • {formatToDDMMYYYY(fromDate)} to {formatToDDMMYYYY(toDate)}
              </span>
            </div>
            <h2 className="text-2xl font-black text-slate-900 mt-1">
              {activeGroup === "pulse"
                ? "DRS Dashboard"
                : activeGroup === "treasury"
                ? "Account & Audit"
                : activeGroup === "operations"
                ? "Daily Operations — Aadhaar, MIS, CTOP & Stock"
                : activeGroup === "network"
                ? "Application / Center Management"
                : "Helpdesk, Alerts & Staff"}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isAccountant && (
              <button
                type="button"
                onClick={() => setActiveView("support")}
                className="bg-slate-900 hover:bg-red-600 text-white font-black px-4 py-2.5 rounded-xl text-xs uppercase tracking-widest shadow-sm transition flex items-center gap-2"
              >
                <span>🎧</span> Open Helpdesk
              </button>
            )}
            <button
              type="button"
              onClick={() => routeTo("/dashboard/aadhaar")}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs uppercase tracking-widest shadow-sm transition flex items-center gap-2"
            >
              <span>🆔</span> Aadhaar Dashboard
            </button>
          </div>
        </div>

        {/* =================================================================== */}
        {/* GROUP 1: DRS DASHBOARD (OPTION X: 3-IN-1 VERTICAL MORPHING)         */}
        {/* =================================================================== */}
        {activeGroup === "pulse" && (isFinanceTeam || isManagerOrAdmin) && (
          <div className="space-y-6 animate-in fade-in">
            <div className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden">
              <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                <div>
                  <h3 className="text-white font-black text-base uppercase tracking-wider flex items-center gap-2">
                    <span>📈</span> Revenue &amp; Remittance Reconciliation
                    Control Panel
                  </h3>
                  <p className="text-xs font-bold text-slate-400 mt-1">
                    Filter by Territory, Center Code, Date Window &amp; Business
                    Vertical • Window:{" "}
                    <span className="text-blue-400">
                      {formatToDDMMYYYY(fromDate)}
                    </span>{" "}
                    to{" "}
                    <span className="text-blue-400">
                      {formatToDDMMYYYY(toDate)}
                    </span>
                  </p>
                </div>

                {/* 3-VERTICAL MORPHING SELECTOR */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-[10px] font-black uppercase">
                    <button
                      type="button"
                      onClick={() => setStreamFilter("ALL")}
                      className={`px-3.5 py-2 rounded-lg transition ${
                        streamFilter === "ALL"
                          ? "bg-blue-600 text-white shadow"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      🌐 All Verticals
                    </button>
                    <button
                      type="button"
                      onClick={() => setStreamFilter("TELECOM")}
                      className={`px-3.5 py-2 rounded-lg transition ${
                        streamFilter === "TELECOM"
                          ? "bg-indigo-600 text-white shadow"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      📡 1. BSNL + Paybull
                    </button>
                    <button
                      type="button"
                      onClick={() => setStreamFilter("AADHAAR")}
                      className={`px-3.5 py-2 rounded-lg transition ${
                        streamFilter === "AADHAAR"
                          ? "bg-amber-500 text-slate-950 shadow"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      🆔 2. Aadhaar Kendra
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowGeoFilters(!showGeoFilters)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-black px-3 py-2 rounded-xl text-[10px] uppercase tracking-widest border border-slate-700"
                  >
                    {showGeoFilters ? "▲ Hide Filters" : "▼ Geo & Date Filters"}
                  </button>
                </div>
              </div>

              {showGeoFilters && (
                <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        1. State
                      </label>
                      <select
                        value={fState}
                        onChange={(e) => {
                          setFState(e.target.value);
                          setFHq("ALL");
                          setFCenter("ALL");
                          setFPartner("ALL");
                        }}
                        className="w-full bg-slate-800 border border-slate-700 text-white text-xs font-bold rounded-lg p-2.5 outline-none focus:border-blue-500 transition"
                      >
                        <option value="ALL">All States</option>
                        {uniqueStates.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        2. Master HQ
                      </label>
                      <select
                        value={fHq}
                        onChange={(e) => {
                          setFHq(e.target.value);
                          setFCenter("ALL");
                          setFPartner("ALL");
                        }}
                        className="w-full bg-slate-800 border border-slate-700 text-white text-xs font-bold rounded-lg p-2.5 outline-none focus:border-blue-500 transition"
                      >
                        <option value="ALL">All Master HQs</option>
                        {hqLocations.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.center_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        3. Center / Location [Code]
                      </label>
                      <select
                        value={fCenter}
                        onChange={(e) => {
                          setFCenter(e.target.value);
                          setFPartner("ALL");
                        }}
                        className="w-full bg-slate-800 border border-slate-700 text-white text-xs font-bold rounded-lg p-2.5 outline-none focus:border-blue-500 transition"
                      >
                        <option value="ALL">All Centers</option>
                        {centerLocations.map((c) => (
                          <option key={c.id} value={c.id}>
                            [{c.center_code || "NO-CODE"}] {c.center_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        4. Operator / Partner
                      </label>
                      <select
                        value={fPartner}
                        onChange={(e) => setFPartner(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white text-xs font-bold rounded-lg p-2.5 outline-none focus:border-blue-500 transition"
                      >
                        <option value="ALL">
                          All Operators ({filteredPartners.length})
                        </option>
                        {filteredPartners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.partner_name}{" "}
                            {p.aadhaar_station_id
                              ? `(Stn: ${p.aadhaar_station_id})`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
                    <div>
                      <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1">
                        5. Date Filter Preset
                      </label>
                      <select
                        value={datePreset}
                        disabled={isRefreshingFinance}
                        onChange={(e) =>
                          handlePresetChange(e.target.value as DatePresetMode)
                        }
                        className="w-full bg-slate-800 border-2 border-indigo-500/70 text-white font-black text-xs rounded-lg p-2.5 outline-none focus:border-indigo-400"
                      >
                        <option value="today">
                          1. Today (
                          {formatToDDMMYYYY(
                            getDateRangeFromPreset("today").start
                          )}
                          )
                        </option>
                        <option value="yesterday">
                          2. Yesterday (
                          {formatToDDMMYYYY(
                            getDateRangeFromPreset("yesterday").start
                          )}
                          )
                        </option>
                        <option value="current_week">3. Current Week</option>
                        <option value="current_month">4. Current Month</option>
                        <option value="previous_month">
                          5. Previous Month
                        </option>
                        <option value="all">6. All Time</option>
                        <option value="custom">7. Custom Filter</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        From ({formatToDDMMYYYY(fromDate)})
                      </label>
                      <input
                        type="date"
                        value={fromDate}
                        onChange={(e) => {
                          setFromDate(e.target.value);
                          setDatePreset("custom");
                        }}
                        className="w-full bg-slate-800 border border-slate-700 text-white text-xs font-bold rounded-lg p-2 outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        To ({formatToDDMMYYYY(toDate)})
                      </label>
                      <input
                        type="date"
                        value={toDate}
                        max={getISTDateString(0)}
                        onChange={(e) => {
                          setToDate(e.target.value);
                          setDatePreset("custom");
                        }}
                        className="w-full bg-slate-800 border border-slate-700 text-white text-xs font-bold rounded-lg p-2 outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* VISUAL SETTLEMENT PROGRESS BAR */}
              <div className="p-5 bg-slate-950/90 border-b border-slate-800 space-y-2.5">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🎯</span>
                    <span className="text-xs font-black uppercase tracking-widest text-white">
                      {streamFilter === "TELECOM"
                        ? "BSNL + Paybull Settlement Progress (Deposited ÷ Generated)"
                        : streamFilter === "AADHAAR"
                        ? "Aadhaar Settlement Progress (Deposited ÷ Generated)"
                        : "DRS Settlement Progress (Total Deposited ÷ Total Generated)"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-black">
                    <span className="text-emerald-400">
                      Deposited: ₹
                      {activeDisplayedDeposited.toLocaleString("en-IN")}
                    </span>
                    <span className="text-slate-600">/</span>
                    <span className="text-blue-400">
                      Generated: ₹
                      {activeDisplayedGenerated.toLocaleString("en-IN")}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] ${
                        overallSettlementPct >= 90
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : overallSettlementPct >= 70
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "bg-red-500/20 text-red-300 border border-red-500/40"
                      }`}
                    >
                      {overallSettlementPct.toFixed(1)}% Settled
                    </span>
                  </div>
                </div>

                <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className={`h-full transition-all duration-500 ${getProgressColor(
                      overallSettlementPct
                    )}`}
                    style={{ width: `${overallSettlementPct}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[10px] font-bold">
                  <span className="text-slate-400 uppercase tracking-wider">
                    Target: 100% Remittance Clearance
                  </span>
                  <span
                    className={
                      activeDisplayedShortfall > 0
                        ? "text-red-400 font-black uppercase tracking-wider"
                        : "text-emerald-400 font-black uppercase tracking-wider"
                    }
                  >
                    {activeDisplayedShortfall > 0
                      ? `⚠️ Unsettled Shortfall: ₹${activeDisplayedShortfall.toLocaleString(
                          "en-IN"
                        )}`
                      : "✅ Zero Shortfall — Fully Settled"}
                  </span>
                </div>
              </div>

              {/* ============================================================= */}
              {/* OPTION X MORPHING DECK: MODE 1 (ALL VERTICALS CONSOLIDATED)    */}
              {/* ============================================================= */}
              {streamFilter === "ALL" && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-slate-800 border-b border-slate-800">
                    {/* STREAM 1: BSNL + PAYBULL */}
                    <div className="p-5 bg-slate-900 hover:bg-slate-900/90 transition">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 block">
                            Business Vertical 1
                          </span>
                          <h4 className="text-white font-black text-sm flex items-center gap-2 mt-0.5">
                            <span>📡</span> BSNL Telecom &amp; Paybull
                            Collection
                          </h4>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setStreamFilter("TELECOM")}
                            className="px-2.5 py-1 rounded text-[9px] font-black uppercase bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 transition"
                          >
                            🔍 Focus BSNL + PB View
                          </button>
                          <button
                            type="button"
                            onClick={() => routeTo("/dashboard/accounts")}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-3 py-1 rounded text-[9px] uppercase tracking-wider shadow transition"
                          >
                            Deposit Verification &rarr;
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-xs mb-2.5">
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-400">
                            Generated
                          </p>
                          <p className="font-black text-white text-sm mt-0.5">
                            ₹
                            {financials.telecomSalesCash.toLocaleString(
                              "en-IN"
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase text-emerald-400">
                            Deposited
                          </p>
                          <p className="font-black text-emerald-400 text-sm mt-0.5">
                            ₹
                            {financials.telecomDeposits.toLocaleString("en-IN")}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase text-red-400">
                            Pending Due
                          </p>
                          <p className="font-black text-red-400 text-sm mt-0.5">
                            ₹{financials.telecomPending.toLocaleString("en-IN")}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${getProgressColor(
                              telecomSettlementPct
                            )}`}
                            style={{ width: `${telecomSettlementPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-black text-slate-300 w-12 text-right">
                          {telecomSettlementPct.toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    {/* STREAM 2: AADHAAR SEVA KENDRA */}
                    <div className="p-5 bg-slate-900 hover:bg-slate-900/90 transition">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 block">
                            Business Vertical 2
                          </span>
                          <h4 className="text-white font-black text-sm flex items-center gap-2 mt-0.5">
                            <span>🆔</span> Aadhaar Seva Kendra Collection
                          </h4>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setStreamFilter("AADHAAR")}
                            className="px-2.5 py-1 rounded text-[9px] font-black uppercase bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 transition"
                          >
                            🔍 Focus Aadhaar View
                          </button>
                          <button
                            type="button"
                            onClick={() => routeTo("/dashboard/aadhaar")}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3 py-1 rounded text-[9px] uppercase tracking-wider shadow transition"
                          >
                            Aadhaar Dashboard &rarr;
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-xs mb-2.5">
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-400">
                            Generated
                          </p>
                          <p className="font-black text-white text-sm mt-0.5">
                            ₹
                            {financials.aadhaarSalesCash.toLocaleString(
                              "en-IN"
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase text-emerald-400">
                            Deposited
                          </p>
                          <p className="font-black text-emerald-400 text-sm mt-0.5">
                            ₹
                            {financials.aadhaarDeposits.toLocaleString("en-IN")}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase text-red-400">
                            Pending Due
                          </p>
                          <p className="font-black text-red-400 text-sm mt-0.5">
                            ₹{financials.aadhaarPending.toLocaleString("en-IN")}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${getProgressColor(
                              aadhaarSettlementPct
                            )}`}
                            style={{ width: `${aadhaarSettlementPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-black text-slate-300 w-12 text-right">
                          {aadhaarSettlementPct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 8 CONSOLIDATED REVENUE CARDS */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-slate-800">
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">
                        1. Total CBP
                      </p>
                      <p className="text-lg font-black text-white">
                        ₹{financials.cbp.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">
                        2. Total CTOP
                      </p>
                      <p className="text-lg font-black text-white">
                        ₹{financials.ctop.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">
                        3. SIM / FRC / MNP
                      </p>
                      <p className="text-lg font-black text-white">
                        ₹{financials.sim.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest mb-1">
                        4. Paybull Cash
                      </p>
                      <p className="text-lg font-black text-indigo-400">
                        ₹{financials.paybull.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-amber-400 font-bold uppercase tracking-widest mb-1">
                        5. Aadhaar Cash
                      </p>
                      <p className="text-lg font-black text-amber-400">
                        ₹{financials.aadhaar.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-amber-500/70 font-bold uppercase tracking-widest mb-1">
                        6. Cheque Amt
                      </p>
                      <p className="text-lg font-black text-amber-500">
                        ₹{financials.cheque.toLocaleString("en-IN")}
                      </p>
                    </div>

                    <div className="bg-slate-900 p-4 border-t-4 lg:border-t-0 lg:border-l-4 border-blue-500 flex flex-col justify-center">
                      <p className="text-[9px] text-blue-400 font-black uppercase tracking-widest mb-1">
                        7. Total Generated
                      </p>
                      <p className="text-xl font-black text-white">
                        ₹{financials.totalSalesCash.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 border-t-4 lg:border-t-0 lg:border-l-4 border-emerald-500 flex flex-col justify-center">
                      <p className="text-[9px] text-emerald-400 font-black uppercase tracking-widest mb-1">
                        8. Total Deposited
                      </p>
                      <p className="text-xl font-black text-white">
                        ₹{financials.totalDeposits.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>

                  {/* COMBINED SIM SALES COUNT & AADHAAR PACKET VOLUME STRIP */}
                  <div className="bg-slate-950 border-t border-slate-800 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-200 flex items-center gap-2">
                        <span>📱</span> SIM Sales Count &amp; Enrolment Packet
                        Volume
                      </h4>
                      <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase">
                        <span className="bg-blue-900/50 text-blue-300 border border-blue-700/60 px-3 py-1 rounded-lg">
                          Total SIMs Sold: {financials.totalSims} Qty
                        </span>
                        <span className="bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1 rounded-lg">
                          Prepaid: {financials.totalPrepaidSims} | Postpaid:{" "}
                          {financials.qPostpaid}
                        </span>
                        <span className="bg-amber-900/40 text-amber-300 border border-amber-700/60 px-3 py-1 rounded-lg">
                          Aadhaar Packets: {financials.aadhaarPackets} Pkts
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center">
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          New SIMs
                        </p>
                        <p className="text-lg font-black text-white mt-0.5">
                          {financials.qNew}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          Upgrades
                        </p>
                        <p className="text-lg font-black text-white mt-0.5">
                          {financials.qUpgrade}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          Replacements
                        </p>
                        <p className="text-lg font-black text-white mt-0.5">
                          {financials.qReplace}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          Fancy SIMs
                        </p>
                        <p className="text-lg font-black text-white mt-0.5">
                          {financials.qFancy}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-purple-400">
                          MNP Port-In
                        </p>
                        <p className="text-lg font-black text-purple-300 mt-0.5">
                          {financials.qMnp}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-emerald-400">
                          FRC Count
                        </p>
                        <p className="text-lg font-black text-emerald-300 mt-0.5">
                          {financials.qFrc}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-blue-400">
                          Postpaid Qty
                        </p>
                        <p className="text-lg font-black text-blue-300 mt-0.5">
                          {financials.qPostpaid}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-amber-500/30">
                        <p className="text-[9px] font-bold uppercase text-amber-400">
                          Aadhaar Pkts
                        </p>
                        <p className="text-lg font-black text-amber-400 mt-0.5">
                          {financials.aadhaarPackets}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ============================================================= */}
              {/* OPTION X MORPHING DECK: MODE 2 (BSNL + PAYBULL ISOLATED)       */}
              {/* ============================================================= */}
              {streamFilter === "TELECOM" && (
                <div className="animate-in fade-in">
                  <div className="p-4 bg-indigo-950/80 border-b border-indigo-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">📡</span>
                      <div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-indigo-300 block">
                          Isolated Vertical View Active
                        </span>
                        <h4 className="text-white font-black text-sm">
                          BSNL Telecom, SIM Inventory &amp; Paybull Operations
                        </h4>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => routeTo("/dashboard/accounts")}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-3.5 py-1.5 rounded-lg text-[10px] uppercase tracking-wider shadow transition"
                      >
                        Deposit Verification &rarr;
                      </button>
                      <button
                        type="button"
                        onClick={() => setStreamFilter("ALL")}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-black px-3.5 py-1.5 rounded-lg text-[10px] uppercase tracking-wider border border-slate-700 transition"
                      >
                        &larr; Back to All Verticals
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-slate-800">
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">
                        1. CBP Landline
                      </p>
                      <p className="text-lg font-black text-white">
                        ₹{financials.cbpLandline.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">
                        2. CBP GSM
                      </p>
                      <p className="text-lg font-black text-white">
                        ₹{financials.cbpGsm.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-blue-400 font-bold uppercase tracking-widest mb-1">
                        3. CTOP Recharge
                      </p>
                      <p className="text-lg font-black text-blue-300">
                        ₹{financials.ctop.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-widest mb-1">
                        4. FRC + MNP Cash
                      </p>
                      <p className="text-lg font-black text-emerald-300">
                        ₹{financials.frcMnpCash.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-purple-400 font-bold uppercase tracking-widest mb-1">
                        5. SIM &amp; Other Cash
                      </p>
                      <p className="text-lg font-black text-purple-300">
                        ₹
                        {(
                          financials.simOnlyCash + financials.otherCash
                        ).toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest mb-1">
                        6. Paybull Total
                      </p>
                      <p className="text-lg font-black text-indigo-400">
                        ₹{financials.paybull.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 border-t-4 lg:border-t-0 lg:border-l-4 border-blue-500 flex flex-col justify-center">
                      <p className="text-[9px] text-blue-400 font-black uppercase tracking-widest mb-1">
                        7. Telecom Generated
                      </p>
                      <p className="text-xl font-black text-white">
                        ₹{financials.telecomSalesCash.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 border-t-4 lg:border-t-0 lg:border-l-4 border-emerald-500 flex flex-col justify-center">
                      <p className="text-[9px] text-emerald-400 font-black uppercase tracking-widest mb-1">
                        8. Telecom Deposited
                      </p>
                      <p className="text-xl font-black text-emerald-400">
                        ₹{financials.telecomDeposits.toLocaleString("en-IN")}
                      </p>
                      <p className="text-[9px] font-black text-red-400 mt-0.5">
                        Due: ₹
                        {financials.telecomPending.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-900/90 border-t border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
                      💳 Paybull 5-Head Breakdown:
                    </span>
                    <div className="flex flex-wrap gap-3 text-[11px] font-bold text-slate-300">
                      <span>
                        PB CTOP:{" "}
                        <strong className="text-white">
                          ₹{financials.pbCtop.toLocaleString("en-IN")}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        PB CBP:{" "}
                        <strong className="text-white">
                          ₹{financials.pbCbp.toLocaleString("en-IN")}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        PB FRC:{" "}
                        <strong className="text-white">
                          ₹{financials.pbFrc.toLocaleString("en-IN")}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        PB MNP:{" "}
                        <strong className="text-white">
                          ₹{financials.pbMnp.toLocaleString("en-IN")}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        PB Other:{" "}
                        <strong className="text-white">
                          ₹{financials.pbOther.toLocaleString("en-IN")}
                        </strong>
                      </span>
                      <span>|</span>
                      <span className="text-amber-400">
                        Cheques ({financials.chequeQty}):{" "}
                        <strong>
                          ₹{financials.cheque.toLocaleString("en-IN")}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-950 border-t border-slate-800 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-200 flex items-center gap-2">
                        <span>📱</span> BSNL SIM Sales Count Breakdown (7
                        Categories)
                      </h4>
                      <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase">
                        <span className="bg-blue-900/50 text-blue-300 border border-blue-700/60 px-3 py-1 rounded-lg">
                          Total SIMs Sold: {financials.totalSims} Qty
                        </span>
                        <span className="bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1 rounded-lg">
                          Prepaid: {financials.totalPrepaidSims} | Postpaid:{" "}
                          {financials.qPostpaid}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center">
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          1. New SIMs
                        </p>
                        <p className="text-lg font-black text-white mt-0.5">
                          {financials.qNew}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          2. Upgrades
                        </p>
                        <p className="text-lg font-black text-white mt-0.5">
                          {financials.qUpgrade}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          3. Replacements
                        </p>
                        <p className="text-lg font-black text-white mt-0.5">
                          {financials.qReplace}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-slate-400">
                          4. Fancy SIMs
                        </p>
                        <p className="text-lg font-black text-white mt-0.5">
                          {financials.qFancy}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-purple-400">
                          5. MNP Port-In
                        </p>
                        <p className="text-lg font-black text-purple-300 mt-0.5">
                          {financials.qMnp}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                        <p className="text-[9px] font-bold uppercase text-emerald-400">
                          6. FRC Count
                        </p>
                        <p className="text-lg font-black text-emerald-300 mt-0.5">
                          {financials.qFrc}
                        </p>
                      </div>
                      <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800 col-span-2 sm:col-span-1">
                        <p className="text-[9px] font-bold uppercase text-blue-400">
                          7. Postpaid SIMs
                        </p>
                        <p className="text-lg font-black text-blue-300 mt-0.5">
                          {financials.qPostpaid}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================= */}
              {/* OPTION X MORPHING DECK: MODE 3 (AADHAAR KENDRA ISOLATED)       */}
              {/* ============================================================= */}
              {streamFilter === "AADHAAR" && (
                <div className="animate-in fade-in">
                  <div className="p-4 bg-amber-950/70 border-b border-amber-800/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">🆔</span>
                      <div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-amber-300 block">
                          Isolated Vertical View Active
                        </span>
                        <h4 className="text-white font-black text-sm">
                          Aadhaar Dashboard — 5-Category UIDAI Enrolments &amp;
                          Collections
                        </h4>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => routeTo("/dashboard/aadhaar")}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3.5 py-1.5 rounded-lg text-[10px] uppercase tracking-wider shadow transition"
                      >
                        Open Aadhaar Dashboard &rarr;
                      </button>
                      <button
                        type="button"
                        onClick={() => setStreamFilter("ALL")}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-black px-3.5 py-1.5 rounded-lg text-[10px] uppercase tracking-wider border border-slate-700 transition"
                      >
                        &larr; Back to All Verticals
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-slate-800 border-b border-slate-800">
                    <div className="bg-slate-900 p-4 border-t-2 border-t-emerald-500">
                      <p className="text-[9px] text-emerald-400 font-black uppercase tracking-widest">
                        1. New Enrolment (Free)
                      </p>
                      <p className="text-2xl font-black text-white mt-1">
                        {financials.adhCat1}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                        UIDAI Citizen Fee: ₹0
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 border-t-2 border-t-teal-500">
                      <p className="text-[9px] text-teal-400 font-black uppercase tracking-widest">
                        2. MBU Free (5 &amp; 15 Yrs)
                      </p>
                      <p className="text-2xl font-black text-white mt-1">
                        {financials.adhCat2}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                        Mandatory Bio: ₹0
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 border-t-2 border-t-amber-500">
                      <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest">
                        3. MBU Chargeable
                      </p>
                      <p className="text-2xl font-black text-amber-400 mt-1">
                        {financials.adhCat3}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                        Paid Mandatory Bio
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 border-t-2 border-t-blue-500">
                      <p className="text-[9px] text-blue-400 font-black uppercase tracking-widest">
                        4. Demographic Update
                      </p>
                      <p className="text-2xl font-black text-blue-300 mt-1">
                        {financials.adhCat4}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                        Name / Address / Mobile
                      </p>
                    </div>
                    <div className="bg-slate-900 p-4 border-t-2 border-t-purple-500 col-span-2 md:col-span-1">
                      <p className="text-[9px] text-purple-400 font-black uppercase tracking-widest">
                        5. Biometric Update
                      </p>
                      <p className="text-2xl font-black text-purple-300 mt-1">
                        {financials.adhCat5}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                        Iris / Fingerprint / Photo
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-slate-800">
                    <div className="bg-slate-950 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">
                        Total Packets Logged
                      </p>
                      <p className="text-xl font-black text-white">
                        {financials.aadhaarPackets} Pkts
                      </p>
                    </div>
                    <div className="bg-slate-950 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">
                        Packet Status Split
                      </p>
                      <p className="text-xs font-black text-emerald-400">
                        ✅ {financials.adhCompleted} Comp | ⏳{" "}
                        {financials.adhInProcess} Proc
                      </p>
                      <p className="text-[10px] font-black text-red-400 mt-0.5">
                        ❌ {financials.adhRejected} Rejected
                      </p>
                    </div>
                    <div className="bg-slate-950 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">
                        Net Base Fee (Excl. GST)
                      </p>
                      <p className="text-lg font-black text-slate-200">
                        ₹
                        {financials.adhBase.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="bg-slate-950 p-4 flex flex-col justify-center">
                      <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest mb-1">
                        18% GST Component
                      </p>
                      <p className="text-lg font-black text-amber-400">
                        ₹
                        {financials.adhGst.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="bg-slate-950 p-4 border-l-4 border-amber-500 flex flex-col justify-center">
                      <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest mb-1">
                        Aadhaar Cash Generated
                      </p>
                      <p className="text-xl font-black text-white">
                        ₹{financials.aadhaarSalesCash.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="bg-slate-950 p-4 border-l-4 border-emerald-500 flex flex-col justify-center">
                      <p className="text-[9px] text-emerald-400 font-black uppercase tracking-widest mb-1">
                        Aadhaar Cash Deposited
                      </p>
                      <p className="text-xl font-black text-emerald-400">
                        ₹{financials.aadhaarDeposits.toLocaleString("en-IN")}
                      </p>
                      <p className="text-[9px] font-black text-red-400 mt-0.5">
                        Due: ₹
                        {financials.aadhaarPending.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* RECHARTS BAR CHART */}
              {chartData.length > 0 && (
                <div className="p-6 bg-slate-900 w-full h-80 border-t border-slate-800">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#334155"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        stroke="#94a3b8"
                        fontSize={12}
                        tickLine={false}
                        tickFormatter={(val) => formatToDDMMYYYY(val)}
                      />
                      <YAxis
                        stroke="#94a3b8"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `₹${val / 1000}k`}
                      />
                      <Tooltip
                        labelFormatter={(label) =>
                          `Date: ${formatToDDMMYYYY(String(label))}`
                        }
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          color: "#fff",
                        }}
                        cursor={{ fill: "#1e293b" }}
                      />
                      <Legend
                        iconType="circle"
                        wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }}
                      />
                      <Bar
                        dataKey="Sales"
                        fill={
                          streamFilter === "AADHAAR"
                            ? "#f59e0b"
                            : streamFilter === "TELECOM"
                            ? "#6366f1"
                            : "#3b82f6"
                        }
                        radius={[4, 4, 0, 0]}
                        name={
                          streamFilter === "TELECOM"
                            ? "BSNL + Paybull Cash Generated"
                            : streamFilter === "AADHAAR"
                            ? "Aadhaar Cash Generated"
                            : "Cash Generated (All Verticals)"
                        }
                      />
                      <Bar
                        dataKey="Deposits"
                        fill="#22c55e"
                        radius={[4, 4, 0, 0]}
                        name={
                          streamFilter === "TELECOM"
                            ? "BSNL + Paybull Cash Remitted"
                            : streamFilter === "AADHAAR"
                            ? "Aadhaar Cash Remitted"
                            : "Cash Remitted (All Verticals)"
                        }
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* DEFAULTER WATCHLISTS WITH 1-CLICK CSV EXPORT */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden">
                <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center gap-2">
                  <h3 className="font-black text-red-800 text-xs uppercase tracking-widest">
                    ⚠️ Missing{" "}
                    {streamFilter === "TELECOM"
                      ? "Daily MIS"
                      : streamFilter === "AADHAAR"
                      ? "Aadhaar"
                      : "Daily MIS / Aadhaar"}{" "}
                    Reports
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="bg-red-200 text-red-900 font-black px-2.5 py-0.5 rounded text-xs">
                      {missingSales.length} Partners
                    </span>
                    {missingSales.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          handleExportDefaulterWatchlistCSV("MISSING_REPORTS")
                        }
                        className="bg-red-600 hover:bg-red-700 text-white font-black px-2.5 py-1 rounded text-[9px] uppercase tracking-wider shadow-sm transition"
                      >
                        📥 CSV
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto p-4 space-y-2">
                  {missingSales.length === 0 ? (
                    <p className="text-sm text-green-600 font-bold text-center py-4">
                      ✅ All filtered partners have submitted reports.
                    </p>
                  ) : (
                    missingSales.map((p) => {
                      const locData = p.locations;
                      const l: any = Array.isArray(locData)
                        ? locData[0]
                        : locData;
                      return (
                        <div
                          key={p.id}
                          className="text-sm border-b pb-2 flex justify-between items-center"
                        >
                          <div>
                            <p className="font-bold text-slate-800">
                              {p.partner_name}
                            </p>
                            <p className="text-xs text-slate-500">
                              [{l?.center_code || "NO-CODE"}] {l?.center_name} (
                              {l?.dist})
                            </p>
                          </div>
                          <span className="text-[9px] font-black uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                            {p.role}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
                <div className="bg-amber-50 p-4 border-b border-amber-100 flex justify-between items-center gap-2">
                  <h3 className="font-black text-amber-800 text-xs uppercase tracking-widest">
                    ⏳ Missing{" "}
                    {streamFilter === "TELECOM"
                      ? "BSNL + Paybull"
                      : streamFilter === "AADHAAR"
                      ? "Aadhaar"
                      : "Cash"}{" "}
                    Deposits
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-200 text-amber-900 font-black px-2.5 py-0.5 rounded text-xs">
                      {missingDeposits.length} Partners
                    </span>
                    {missingDeposits.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          handleExportDefaulterWatchlistCSV("MISSING_DEPOSITS")
                        }
                        className="bg-amber-600 hover:bg-amber-700 text-white font-black px-2.5 py-1 rounded text-[9px] uppercase tracking-wider shadow-sm transition"
                      >
                        📥 CSV
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto p-4 space-y-2">
                  {missingDeposits.length === 0 ? (
                    <p className="text-sm text-green-600 font-bold text-center py-4">
                      ✅ All filtered partners have submitted deposits.
                    </p>
                  ) : (
                    missingDeposits.map((p) => {
                      const locData = p.locations;
                      const l: any = Array.isArray(locData)
                        ? locData[0]
                        : locData;
                      return (
                        <div
                          key={p.id}
                          className="text-sm border-b pb-2 flex justify-between items-center"
                        >
                          <div>
                            <p className="font-bold text-slate-800">
                              {p.partner_name}
                            </p>
                            <p className="text-xs text-slate-500">
                              [{l?.center_code || "NO-CODE"}] {l?.center_name} (
                              {l?.dist})
                            </p>
                          </div>
                          <span className="text-[9px] font-black uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                            {p.role}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* GROUP 2: ACCOUNT & AUDIT (RENAMED CARDS)                            */}
        {/* =================================================================== */}
        {activeGroup === "treasury" && (isFinanceTeam || isManagerOrAdmin) && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {isFinanceTeam && (
                <div
                  onClick={() => routeTo("/dashboard/accounts")}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-500 transition group cursor-pointer border-t-4 border-t-emerald-500 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-4xl">🏦</span>
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase px-2.5 py-1 rounded">
                        UTR + OCR Audit
                      </span>
                    </div>
                    <h3 className="font-black text-xl text-slate-900 group-hover:text-emerald-600">
                      Deposit Verification
                    </h3>
                    <p className="text-slate-500 text-xs mt-2 font-medium leading-relaxed">
                      Verify partner bank deposits, inspect OCR slips
                      side-by-side with Unique UTR &amp; Reference Codes, and
                      clear ledgers.
                    </p>
                  </div>
                  <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-black text-emerald-600 uppercase tracking-wider">
                    <span>Open Deposit Verification</span>
                    <span>&rarr;</span>
                  </div>
                </div>
              )}

              <div
                onClick={() => routeTo("/dashboard/sales-verification")}
                className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-500 transition group cursor-pointer border-t-4 border-t-amber-500 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-4xl">⚖️</span>
                    <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-black uppercase px-2.5 py-1 rounded">
                      Daily MIS + Aadhaar
                    </span>
                  </div>
                  <h3 className="font-black text-xl text-slate-900 group-hover:text-amber-600">
                    Report Correction
                  </h3>
                  <p className="text-slate-500 text-xs mt-2 font-medium leading-relaxed">
                    Review partner edit requests and enforce audited financial
                    overrides across BSNL, Paybull, and Aadhaar daily reports.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-black text-amber-600 uppercase tracking-wider">
                  <span>Open Report Correction</span>
                  <span>&rarr;</span>
                </div>
              </div>

              {isManagerOrAdmin && (
                <div
                  onClick={() => routeTo("/dashboard/banking")}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-500 transition group cursor-pointer border-t-4 border-t-blue-600 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-4xl">💳</span>
                      <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black uppercase px-2.5 py-1 rounded">
                        CMS + UPI + QR
                      </span>
                    </div>
                    <h3 className="font-black text-xl text-slate-900 group-hover:text-blue-600">
                      Banking Credentials
                    </h3>
                    <p className="text-slate-500 text-xs mt-2 font-medium leading-relaxed">
                      Configure physical Master Banks, center-mapped Virtual
                      Accounts, dynamic UPI IDs, and Center QR Codes.
                    </p>
                  </div>
                  <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-black text-blue-600 uppercase tracking-wider">
                    <span>Open Banking Credentials</span>
                    <span>&rarr;</span>
                  </div>
                </div>
              )}

              <div
                onClick={() => routeTo("/dashboard/reports")}
                className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-500 transition group cursor-pointer border-t-4 border-t-indigo-600 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-4xl">📈</span>
                    <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-black uppercase px-2.5 py-1 rounded">
                      CSV &amp; PDF Exports
                    </span>
                  </div>
                  <h3 className="font-black text-xl text-slate-900 group-hover:text-indigo-600">
                    DRS MIS
                  </h3>
                  <p className="text-slate-500 text-xs mt-2 font-medium leading-relaxed">
                    Generate Station-wise, Operator-wise, and Consolidated
                    closing ledger exports in CSV and watermarked A4 PDF.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-black text-indigo-600 uppercase tracking-wider">
                  <span>Open DRS MIS</span>
                  <span>&rarr;</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* GROUP 3: DAILY OPERATIONS (AADHAAR, MIS, CTOP & STOCK)              */}
        {/* =================================================================== */}
        {activeGroup === "operations" && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div
                onClick={() => routeTo("/dashboard/aadhaar")}
                className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-500 transition group cursor-pointer border-t-4 border-t-amber-500 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-4xl">🆔</span>
                    <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black uppercase px-2.5 py-1 rounded">
                      {financials.aadhaarPackets} Packets Logged
                    </span>
                  </div>
                  <h3 className="font-black text-xl text-slate-900 group-hover:text-amber-600">
                    Aadhaar Dashboard
                  </h3>
                  <p className="text-slate-500 text-xs mt-2 font-medium leading-relaxed">
                    Audit 5-category CSV/HTML daily &amp; weekly uploads, live
                    station working/leave status, ₹100/day penalty waive-offs,
                    and UIDAI tariffs.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-black text-amber-600 uppercase tracking-wider">
                  <span>Open Aadhaar Dashboard</span>
                  <span>&rarr;</span>
                </div>
              </div>

              {!isAccountant && (
                <div
                  onClick={() => routeTo("/dashboard/manager-mis")}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-500 transition group cursor-pointer border-t-4 border-t-indigo-600 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-4xl">📊</span>
                      <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-black uppercase px-2.5 py-1 rounded">
                        OTF Matrix
                      </span>
                    </div>
                    <h3 className="font-black text-xl text-slate-900 group-hover:text-indigo-600">
                      Manager MIS &amp; Balances
                    </h3>
                    <p className="text-slate-500 text-xs mt-2 font-medium leading-relaxed">
                      Log daily Master CTOP Opening/Closing balances, central
                      stock procurements, monthly center sales, and OTF
                      variances.
                    </p>
                  </div>
                  <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-black text-indigo-600 uppercase tracking-wider">
                    <span>Open Manager MIS</span>
                    <span>&rarr;</span>
                  </div>
                </div>
              )}

              {isManagerOrAdmin && (
                <>
                  <div
                    onClick={() => routeTo("/dashboard/ocsc")}
                    className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-500 transition group cursor-pointer border-t-4 border-t-blue-600 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-4xl">📡</span>
                        <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black uppercase px-2.5 py-1 rounded">
                          Partner Credentials
                        </span>
                      </div>
                      <h3 className="font-black text-xl text-slate-900 group-hover:text-blue-600">
                        Master &amp; Agent CTOP
                      </h3>
                      <p className="text-slate-500 text-xs mt-2 font-medium leading-relaxed">
                        Manage Master CTOP accounts anchored to HQs, Sanchar
                        Soft IDs, MPINs, and strictly mapped Agent CTOP
                        credentials.
                      </p>
                    </div>
                    <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-black text-blue-600 uppercase tracking-wider">
                      <span>Open Master &amp; Agent CTOP</span>
                      <span>&rarr;</span>
                    </div>
                  </div>

                  <div
                    onClick={() => routeTo("/dashboard/logistics")}
                    className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-500 transition group cursor-pointer border-t-4 border-t-emerald-600 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-4xl">📦</span>
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase px-2.5 py-1 rounded">
                          Stock &amp; SIM Dispatch
                        </span>
                      </div>
                      <h3 className="font-black text-xl text-slate-900 group-hover:text-emerald-600">
                        Stock &amp; Inventory
                      </h3>
                      <p className="text-slate-500 text-xs mt-2 font-medium leading-relaxed">
                        Approve digital CTOP/CBP balance top-ups and mark
                        physical SIM requisitions as dispatched across centers.
                      </p>
                    </div>
                    <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-black text-emerald-600 uppercase tracking-wider">
                      <span>Open Stock &amp; Inventory</span>
                      <span>&rarr;</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* GROUP 4: APPROVALS & CENTER LIST (APPLICATION / CENTER MANAGEMENT)  */}
        {/* =================================================================== */}
        {activeGroup === "network" && isOpsTeam && (
          <div className="space-y-6 animate-in fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div
                onClick={() => routeTo("/dashboard/applications")}
                className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-yellow-400 hover:shadow-md transition cursor-pointer"
              >
                <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest mb-1">
                  Action Required
                </p>
                <h2 className="text-3xl font-black text-slate-900">
                  {stats.pending}
                </h2>
                <p className="text-yellow-600 font-black mt-2 text-xs flex items-center justify-between">
                  Pending Applications <span>&rarr;</span>
                </p>
              </div>

              <div
                onClick={() => routeTo("/dashboard/partners")}
                className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-emerald-500 hover:shadow-md transition cursor-pointer"
              >
                <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest mb-1">
                  Network Growth
                </p>
                <h2 className="text-3xl font-black text-slate-900">
                  {stats.approved}
                </h2>
                <p className="text-emerald-600 font-black mt-2 text-xs flex items-center justify-between">
                  Approved Partners <span>&rarr;</span>
                </p>
              </div>

              <div
                onClick={() => routeTo("/dashboard/applications")}
                className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-red-500 hover:shadow-md transition cursor-pointer"
              >
                <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest mb-1">
                  Declined Queue
                </p>
                <h2 className="text-3xl font-black text-slate-900">
                  {stats.rejected}
                </h2>
                <p className="text-red-600 font-black mt-2 text-xs flex items-center justify-between">
                  Rejected Applications <span>&rarr;</span>
                </p>
              </div>

              <div
                onClick={() => routeTo("/dashboard/locations")}
                className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-blue-600 hover:shadow-md transition cursor-pointer"
              >
                <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest mb-1">
                  Center / Location
                </p>
                <h2 className="text-3xl font-black text-slate-900">
                  {stats.locations}
                </h2>
                <p className="text-blue-600 font-black mt-2 text-xs flex items-center justify-between">
                  Active Centers <span>&rarr;</span>
                </p>
              </div>
            </div>

            {isManagerOrAdmin && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div
                  onClick={() => routeTo("/dashboard/applications")}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-500 transition group cursor-pointer border-t-4 border-t-blue-600"
                >
                  <div className="text-3xl mb-3">📝</div>
                  <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-600">
                    Franchise Onboarding
                  </h3>
                  <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                    Inspect watermarked KYC PDFs, map official Center Codes, and
                    provision partner credentials.
                  </p>
                </div>

                <div
                  onClick={() => routeTo("/dashboard/partners")}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-500 transition group cursor-pointer border-t-4 border-t-emerald-600"
                >
                  <div className="text-3xl mb-3">🤝</div>
                  <h3 className="font-black text-lg text-slate-900 group-hover:text-emerald-600">
                    Partner Database (360°)
                  </h3>
                  <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                    Inspect full 360° KYC dossiers, passport photos, Partner
                    Credentials, and export A4 partner dossiers.
                  </p>
                </div>

                <div
                  onClick={() => routeTo("/dashboard/locations")}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-500 transition group cursor-pointer border-t-4 border-t-indigo-600"
                >
                  <div className="text-3xl mb-3">📍</div>
                  <h3 className="font-black text-lg text-slate-900 group-hover:text-indigo-600">
                    Center / Location
                  </h3>
                  <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                    Deploy Master HQs and Spoke Centers, toggle Aadhaar/OCSC/CM
                    roles, and allocate Field Supervisors.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-5">
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-wider">
                    🌐 Website Enquiries ({enquiries.length})
                  </h3>
                  <span className="text-[10px] font-black uppercase text-slate-400">
                    Public Contact Feed
                  </span>
                </div>
                {enquiries.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 font-bold">
                    No recent enquiries found.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto pr-1">
                    {enquiries.map((enquiry) => (
                      <div
                        key={enquiry.id}
                        className="p-4 bg-slate-50 rounded-xl border border-slate-200 hover:shadow-sm transition"
                      >
                        <div className="flex justify-between items-start mb-1.5">
                          <h4 className="font-black text-blue-700 text-sm">
                            {enquiry.name}
                          </h4>
                          <span className="text-[10px] text-slate-400 font-bold uppercase">
                            {formatToDDMMYYYY(
                              String(enquiry.created_at || "").split("T")[0]
                            )}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 font-bold mb-2.5">
                          ✉️ {enquiry.email}
                        </p>
                        <p className="text-slate-700 bg-white p-3 rounded-lg border border-slate-200 text-xs font-medium italic">
                          &quot;{enquiry.message}&quot;
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-fit">
                <div className="bg-slate-900 p-4 flex justify-between items-center text-white">
                  <h3 className="font-black text-xs uppercase tracking-widest">
                    Recent Franchise Apps
                  </h3>
                  <button
                    type="button"
                    onClick={() => routeTo("/dashboard/applications")}
                    className="text-[10px] font-black uppercase text-amber-400 hover:underline"
                  >
                    View All &rarr;
                  </button>
                </div>
                <div className="flex-1">
                  {recentApps.length === 0 ? (
                    <p className="p-6 text-center text-slate-400 font-bold">
                      No recent applications.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {recentApps.map((app) => (
                        <li
                          key={app.id}
                          onClick={() =>
                            routeTo(`/dashboard/applications/${app.id}`)
                          }
                          className="p-4 hover:bg-slate-50 transition cursor-pointer"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-black text-slate-800 text-sm">
                              {app.name}
                            </span>
                            <span
                              className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${
                                app.status === "Approved"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : app.status === "Rejected"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {app.status || "Pending"}
                            </span>
                          </div>
                          <div className="text-xs text-blue-600 font-black uppercase">
                            {app.requested_role}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 font-bold">
                            {formatToDDMMYYYY(
                              String(app.created_at || "").split("T")[0]
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* GROUP 5: HELPDESK, ALERTS & STAFF                                   */}
        {/* =================================================================== */}
        {activeGroup === "governance" && !isAccountant && (
          <div className="space-y-8 animate-in fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div
                onClick={() => setActiveView("support")}
                className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-red-500 transition group cursor-pointer border-t-4 border-t-red-500 flex flex-col justify-between"
              >
                <div>
                  <div className="text-3xl mb-3">🎧</div>
                  <h3 className="font-black text-lg text-slate-900 group-hover:text-red-600">
                    Support &amp; Escalation Desk
                  </h3>
                  <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                    Review partner BSNL &amp; Company tickets, inspect evidence,
                    and resolve or escalate across L1/L2/L3 SLAs.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] font-black text-red-600 uppercase flex justify-between">
                  <span>Launch Helpdesk SPA</span>
                  <span>&rarr;</span>
                </div>
              </div>

              {isManagerOrAdmin && (
                <>
                  <div
                    onClick={() => routeTo("/dashboard/compliance")}
                    className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-rose-500 transition group cursor-pointer border-t-4 border-t-rose-600 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-3xl">🚨</span>
                        <span className="bg-red-100 text-red-700 text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-red-200 animate-pulse">
                          Auto-Scan
                        </span>
                      </div>
                      <h3 className="font-black text-lg text-slate-900 group-hover:text-rose-600">
                        Compliance &amp; Defaulter Engine
                      </h3>
                      <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                        Automated tracking for unlogged yesterday reports,
                        &gt;₹1K cash limit breaches, and ignored alerts.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] font-black text-rose-600 uppercase flex justify-between">
                      <span>Open Defaulter Roster</span>
                      <span>&rarr;</span>
                    </div>
                  </div>

                  <div
                    onClick={() => routeTo("/dashboard/messages")}
                    className="bg-white p-6 rounded-2xl border border-slate-200 hover:shadow-md hover:border-purple-500 transition group cursor-pointer border-t-4 border-t-purple-600 flex flex-col justify-between"
                  >
                    <div>
                      <div className="text-3xl mb-3">💬</div>
                      <h3 className="font-black text-lg text-slate-900 group-hover:text-purple-600">
                        Partner Alerts Command
                      </h3>
                      <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                        Dispatch targeted compliance warnings or global network
                        broadcasts and track partner read receipts.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] font-black text-purple-600 uppercase flex justify-between">
                      <span>Open Alerts Command</span>
                      <span>&rarr;</span>
                    </div>
                  </div>
                </>
              )}

              {isGodMode && (
                <div
                  onClick={() => routeTo("/dashboard/staff-reports")}
                  className="bg-white p-6 rounded-2xl border border-slate-200 hover:shadow-md hover:border-violet-500 transition group cursor-pointer border-t-4 border-t-violet-600 flex flex-col justify-between"
                >
                  <div>
                    <div className="text-3xl mb-3">⏱️</div>
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-violet-600">
                      Staff Productivity Matrix
                    </h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                      Real-time back-office staff output analytics and live
                      audit feed across all enterprise modules.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] font-black text-violet-600 uppercase flex justify-between">
                    <span>View Staff Telemetry</span>
                    <span>&rarr;</span>
                  </div>
                </div>
              )}
            </div>

            {isGodMode && <StaffManagementEngine />}
          </div>
        )}
      </main>

      {/* MOBILE STICKY BOTTOM DEPARTMENT BAR */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950 border-t border-slate-800 grid grid-cols-5 gap-1 px-1.5 py-1.5 shadow-2xl">
        {visibleDeptGroups.map((group) => {
          const isActive = activeGroup === group.id;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveGroup(group.id)}
              className={`flex flex-col items-center justify-center py-1.5 rounded-lg transition ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">{group.icon}</span>
              <span className="text-[9px] font-black uppercase tracking-tighter mt-1 truncate max-w-full px-0.5">
                {group.shortLabel}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}