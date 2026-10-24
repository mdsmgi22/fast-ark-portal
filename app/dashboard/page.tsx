"use client";

import { useEffect, useState } from "react";
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

export default function AdminCommandCenter() {
  const router = useRouter();
  const [adminUser, setAdminUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isRouting, setIsRouting] = useState(false);

  // SUPPORT DESK SPA ENGINE
  const [activeView, setActiveView] = useState<"dashboard" | "support">("dashboard");

  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, locations: 0 });
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
  const [fromDate, setFromDate] = useState(() => getDateRangeFromPreset("current_month").start);
  const [toDate, setToDate] = useState(() => getDateRangeFromPreset("current_month").end);

  const [fState, setFState] = useState("ALL");
  const [fHq, setFHq] = useState("ALL");
  const [fCenter, setFCenter] = useState("ALL");
  const [fPartner, setFPartner] = useState("ALL");

  const [financials, setFinancials] = useState({
    cbp: 0,
    ctop: 0,
    sim: 0,
    paybull: 0,
    aadhaar: 0,
    cheque: 0,
    totalSalesCash: 0,
    totalDeposits: 0,
  });
  const [chartData, setChartData] = useState<any[]>([]);

  const [missingSales, setMissingSales] = useState<any[]>([]);
  const [missingDeposits, setMissingDeposits] = useState<any[]>([]);
  const [isRefreshingFinance, setIsRefreshingFinance] = useState(false);

  useEffect(() => {
    initializeDashboard();
  }, [router]);

  const initializeDashboard = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const { data: staffData } = await supabase
        .from("back_office_staff")
        .select("*")
        .eq("email", session.user.email)
        .single();

      if (staffData) setAdminUser(staffData);

      const safeRole = (staffData?.role || "").trim().toLowerCase();

      const [locRes, partRes] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"),
        supabase
          .from("active_partners")
          .select("id, partner_name, role, role_aadhaar, aadhaar_station_id, locations(id, state, dist, center_name, center_code, parent_master_id)")
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
      const { data: appsData } = await supabase
        .from("pending_applications")
        .select("id, name, requested_role, status, created_at")
        .order("created_at", { ascending: false });
      const { data: enqData } = await supabase
        .from("enquiries")
        .select("*")
        .order("created_at", { ascending: false });

      if (enqData) setEnquiries(enqData);

      const apps = appsData || [];
      setStats({
        pending: apps.filter((app) => app.status === "Pending" || !app.status).length,
        approved: apps.filter((app) => app.status === "Approved").length,
        rejected: apps.filter((app) => app.status === "Rejected").length,
        locations: locationsArray.filter((l) => l.is_active).length || 0,
      });
      setRecentApps(apps.slice(0, 5));
    } catch (error: any) {
      console.error("Operational data error:", error.message);
    }
  };

  useEffect(() => {
    if (adminUser && ["admin", "accountant", "manager"].includes(adminUser.role.trim().toLowerCase())) {
      fetchFinancialData();
    }
  }, [fromDate, toDate, adminUser]);

  const fetchFinancialData = async () => {
    setIsRefreshingFinance(true);
    try {
      const [salesRes, aadhaarRes, depositsRes] = await Promise.all([
        supabase
          .from("daily_sales_reports")
          .select(`*, active_partners (id, partner_name, locations (id, state, dist, center_name, parent_master_id))`)
          .gte("report_date", fromDate)
          .lte("report_date", toDate),
        supabase
          .from("aadhaar_daily_reports")
          .select(`*, active_partners (id, partner_name, locations (id, state, dist, center_name, parent_master_id))`)
          .gte("report_date", fromDate)
          .lte("report_date", toDate),
        supabase
          .from("partner_deposits")
          .select(`*, active_partners (id, partner_name, locations (id, state, dist, center_name, parent_master_id))`)
          .neq("status", "Discrepancy")
          .gte("created_at", `${fromDate}T00:00:00+05:30`)
          .lte("created_at", `${toDate}T23:59:59+05:30`),
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
    if (allPartners.length > 0) {
      calculateEngine(rawSales, rawAadhaar, rawDeposits, allPartners);
    }
  }, [fState, fHq, fCenter, fPartner, rawSales, rawAadhaar, rawDeposits, allPartners]);

  const calculateEngine = (sales: any[], aadhaar: any[], deposits: any[], directory: any[]) => {
    const applyGeoFilter = (item: any) => {
      const p = item.active_partners || item;
      const locData = p?.locations;
      const l: any = Array.isArray(locData) ? locData[0] : locData;
      if (!l) return false;

      if (fState !== "ALL" && l.state !== fState) return false;
      if (fHq !== "ALL" && l.parent_master_id?.toString() !== fHq && l.id?.toString() !== fHq) return false;
      if (fCenter !== "ALL" && l.id?.toString() !== fCenter) return false;
      if (fPartner !== "ALL" && p.id?.toString() !== fPartner) return false;

      return true;
    };

    const filteredSales = sales.filter(applyGeoFilter);
    const filteredAadhaar = aadhaar.filter(applyGeoFilter);
    const filteredDeposits = deposits.filter(applyGeoFilter);
    const filteredDirectory = directory.filter(applyGeoFilter);

    let tCbp = 0,
      tCtop = 0,
      tSim = 0,
      tPaybull = 0,
      tAadhaar = 0,
      tCheque = 0,
      tSalesCash = 0,
      tDepositCash = 0;
    const chartMap: Record<string, { date: string; Sales: number; Deposits: number }> = {};

    filteredSales.forEach((s) => {
      const sCbp = Number(s.cbp_landline_amt || 0) + Number(s.cbp_gsm_amt || 0);
      const sCtop = Number(s.ctop_recharge_amt || 0);
      const sSim =
        Number(s.sim_replacement_amt || 0) +
        Number(s.sim_fancy_amt || 0) +
        Number(s.sim_postpaid_amt || 0) +
        Number(s.frc_amt || 0) +
        Number(s.mnp_amt || 0);
      const sOther = Number(s.other_amt || 0);
      const sPb =
        Number(s.pb_cbp_amt || 0) +
        Number(s.pb_ctop_amt || 0) +
        Number(s.pb_frc_amt || 0) +
        Number(s.pb_mnp_amt || 0) +
        Number(s.pb_other_amt || 0);
      const totalCashRow = sCbp + sCtop + sSim + sOther + sPb;

      tCbp += sCbp;
      tCtop += sCtop;
      tSim += sSim + sOther;
      tPaybull += sPb;
      tCheque += Number(s.cheque_amt || 0);
      tSalesCash += totalCashRow;

      const dateKey = s.report_date;
      if (!chartMap[dateKey]) chartMap[dateKey] = { date: dateKey, Sales: 0, Deposits: 0 };
      chartMap[dateKey].Sales += totalCashRow;
    });

    filteredAadhaar.forEach((a) => {
      const aCash = Number(a.total_cash_collected || 0);
      tAadhaar += aCash;
      tSalesCash += aCash;

      const dateKey = a.report_date;
      if (!chartMap[dateKey]) chartMap[dateKey] = { date: dateKey, Sales: 0, Deposits: 0 };
      chartMap[dateKey].Sales += aCash;
    });

    filteredDeposits.forEach((d) => {
      const amt = Number(d.deposit_amount || 0);
      tDepositCash += amt;

      const dateKey = (d.deposit_date || d.created_at).split("T")[0];
      if (!chartMap[dateKey]) chartMap[dateKey] = { date: dateKey, Sales: 0, Deposits: 0 };
      chartMap[dateKey].Deposits += amt;
    });

    setFinancials({
      cbp: tCbp,
      ctop: tCtop,
      sim: tSim,
      paybull: tPaybull,
      aadhaar: tAadhaar,
      cheque: tCheque,
      totalSalesCash: tSalesCash,
      totalDeposits: tDepositCash,
    });
    setChartData(Object.values(chartMap).sort((a, b) => a.date.localeCompare(b.date)));

    // Recognize both Telecom Sales AND Aadhaar Daily Reports as valid activity
    const partnersWithActivity = new Set([
      ...filteredSales.map((s) => s.partner_id),
      ...filteredAadhaar.map((a) => a.partner_id),
    ]);
    const partnersWithDeposits = new Set(filteredDeposits.map((d) => d.partner_id));

    setMissingSales(filteredDirectory.filter((p) => !partnersWithActivity.has(p.id)));
    setMissingDeposits(filteredDirectory.filter((p) => !partnersWithDeposits.has(p.id)));
  };

  const uniqueStates = Array.from(new Set(allLocations.map((l) => l.state).filter(Boolean))).sort();

  const hqLocations = allLocations
    .filter((l) => l.is_master_node && (fState === "ALL" || l.state === fState))
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
      if (fHq !== "ALL" && l.parent_master_id?.toString() !== fHq && l.id?.toString() !== fHq) return false;
      if (fCenter !== "ALL" && l.id?.toString() !== fCenter) return false;
      return true;
    })
    .sort((a, b) => a.partner_name.localeCompare(b.partner_name));

  const handleSignOut = async () => {
    setLoading(true);
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
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );

  if (activeView === "support") {
    return (
      <div className="min-h-screen bg-slate-50 p-6 md:p-8 font-sans">
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <button
            onClick={() => setActiveView("dashboard")}
            className="text-blue-600 font-black text-sm hover:underline flex items-center gap-2 mb-4 bg-blue-50 px-4 py-2 rounded shadow-sm border border-blue-200 w-fit transition"
          >
            <span>&larr;</span> Back to Command Center
          </button>
          <SupportDeskModule allLocations={allLocations} currentUserRole={safeRole} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8 font-sans relative">
      {isRouting && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="text-sm font-bold text-white animate-pulse tracking-widest uppercase">
            Establishing secure connection to module...
          </p>
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 pb-6 gap-4">
          <div>
            <h1 className="text-4xl font-black text-slate-900">
              {isAccountant ? "Finance Command" : isStaff ? "Operations Desk" : "Admin Command Center"}
            </h1>
            <p className="text-slate-500 mt-2 font-medium">
              Welcome back, <span className="font-bold text-slate-800">{adminUser?.name || "User"}</span> | Role:{" "}
              <span className="font-black text-purple-600 uppercase tracking-widest">{rawRole || "System"}</span>
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                if (isOpsTeam) fetchOperationalData(allLocations);
                if (isFinanceTeam || isManagerOrAdmin) fetchFinancialData();
              }}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-bold hover:bg-gray-50 shadow-sm transition text-sm"
            >
              ↻ Refresh Data
            </button>
            <button
              onClick={handleSignOut}
              className="bg-slate-200 text-slate-700 px-4 py-2 rounded-md font-bold hover:bg-slate-300 transition text-sm shadow-sm"
            >
              Sign Out
            </button>
          </div>
        </div>

        {(isFinanceTeam || isManagerOrAdmin) && (
          <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden animate-in fade-in">
            {/* TOP HEADER & 7-OPTION DATE PRESET DROPDOWN (DD/MM/YYYY) */}
            <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
              <div>
                <h2 className="text-white font-black text-lg tracking-wide flex items-center gap-2">
                  <span>📈</span> Live Revenue &amp; Reconciliation (BSNL + Paybull + Aadhaar)
                </h2>
                <p className="text-xs font-bold text-slate-400 mt-1">
                  Active Window: <span className="text-blue-400">{formatToDDMMYYYY(fromDate)}</span> to{" "}
                  <span className="text-blue-400">{formatToDDMMYYYY(toDate)}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                <div>
                  <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block mb-1">
                    Date Filter Preset
                  </label>
                  <select
                    value={datePreset}
                    disabled={isRefreshingFinance}
                    onChange={(e) => handlePresetChange(e.target.value as DatePresetMode)}
                    className="bg-slate-800 border-2 border-indigo-500/70 text-white font-black text-xs rounded-lg p-2 outline-none focus:border-indigo-400"
                  >
                    <option value="today">1. Today ({formatToDDMMYYYY(getDateRangeFromPreset("today").start)})</option>
                    <option value="yesterday">
                      2. Yesterday ({formatToDDMMYYYY(getDateRangeFromPreset("yesterday").start)})
                    </option>
                    <option value="current_week">3. Current Week</option>
                    <option value="current_month">4. Current Month</option>
                    <option value="previous_month">5. Previous Month</option>
                    <option value="all">6. All Time</option>
                    <option value="custom">7. Custom Filter</option>
                  </select>
                </div>

                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                    From ({formatToDDMMYYYY(fromDate)})
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => {
                      setFromDate(e.target.value);
                      setDatePreset("custom");
                    }}
                    className="bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded-lg p-2 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
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
                    className="bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded-lg p-2 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* 4-TIER GEOGRAPHIC & OPERATOR CASCADE */}
            <div className="p-4 bg-slate-800 border-b border-slate-700 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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
                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded p-2.5 outline-none focus:border-blue-500 transition"
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
                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded p-2.5 outline-none focus:border-blue-500 transition"
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
                  3. Location / Center
                </label>
                <select
                  value={fCenter}
                  onChange={(e) => {
                    setFCenter(e.target.value);
                    setFPartner("ALL");
                  }}
                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded p-2.5 outline-none focus:border-blue-500 transition"
                >
                  <option value="ALL">All Locations</option>
                  {centerLocations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.center_name} [{c.center_code || "NO-CODE"}]
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
                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-bold rounded p-2.5 outline-none focus:border-blue-500 transition"
                >
                  <option value="ALL">All Operators ({filteredPartners.length})</option>
                  {filteredPartners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partner_name} {p.aadhaar_station_id ? `(Stn: ${p.aadhaar_station_id})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 8-CARD MULTI-STREAM REVENUE SUMMARY */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-slate-700">
              <div className="bg-slate-900 p-4 flex flex-col justify-center">
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total CBP</p>
                <p className="text-lg font-black text-white">₹{financials.cbp.toLocaleString("en-IN")}</p>
              </div>
              <div className="bg-slate-900 p-4 flex flex-col justify-center">
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total CTOP</p>
                <p className="text-lg font-black text-white">₹{financials.ctop.toLocaleString("en-IN")}</p>
              </div>
              <div className="bg-slate-900 p-4 flex flex-col justify-center">
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-1">SIM / FRC / MNP</p>
                <p className="text-lg font-black text-white">₹{financials.sim.toLocaleString("en-IN")}</p>
              </div>
              <div className="bg-slate-900 p-4 flex flex-col justify-center">
                <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest mb-1">Paybull Cash</p>
                <p className="text-lg font-black text-indigo-400">₹{financials.paybull.toLocaleString("en-IN")}</p>
              </div>
              <div className="bg-slate-900 p-4 flex flex-col justify-center">
                <p className="text-[9px] text-amber-400 font-bold uppercase tracking-widest mb-1">Aadhaar Cash</p>
                <p className="text-lg font-black text-amber-400">₹{financials.aadhaar.toLocaleString("en-IN")}</p>
              </div>
              <div className="bg-slate-900 p-4 flex flex-col justify-center">
                <p className="text-[9px] text-amber-500/70 font-bold uppercase tracking-widest mb-1">Cheque Amt</p>
                <p className="text-lg font-black text-amber-500">₹{financials.cheque.toLocaleString("en-IN")}</p>
              </div>

              <div className="bg-slate-900 p-4 border-t-4 lg:border-t-0 lg:border-l-4 border-blue-500 flex flex-col justify-center">
                <p className="text-[9px] text-blue-400 font-black uppercase tracking-widest mb-1">Total Generated</p>
                <p className="text-xl font-black text-white">₹{financials.totalSalesCash.toLocaleString("en-IN")}</p>
              </div>
              <div className="bg-slate-900 p-4 border-t-4 lg:border-t-0 lg:border-l-4 border-green-500 flex flex-col justify-center">
                <p className="text-[9px] text-green-400 font-black uppercase tracking-widest mb-1">Total Deposited</p>
                <p className="text-xl font-black text-white">₹{financials.totalDeposits.toLocaleString("en-IN")}</p>
              </div>
            </div>

            {chartData.length > 0 && (
              <div className="p-6 bg-slate-900 w-full h-80 border-t border-slate-700">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} />
                    <YAxis
                      stroke="#94a3b8"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `₹${val / 1000}k`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "8px", color: "#fff" }}
                      cursor={{ fill: "#1e293b" }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                    <Bar dataKey="Sales" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Cash Generated (All Streams)" />
                    <Bar dataKey="Deposits" fill="#22c55e" radius={[4, 4, 0, 0]} name="Cash Remitted" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {(isFinanceTeam || isManagerOrAdmin) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in">
            <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
              <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
                <h3 className="font-black text-red-800 text-sm uppercase tracking-widest">
                  ⚠️ Missing Sales / Aadhaar Reports
                </h3>
                <span className="bg-red-200 text-red-900 font-black px-2 py-0.5 rounded text-xs">
                  {missingSales.length} Partners
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto p-4 space-y-2">
                {missingSales.length === 0 ? (
                  <p className="text-sm text-green-600 font-bold text-center py-4">
                    All filtered partners have submitted reports.
                  </p>
                ) : (
                  missingSales.map((p) => {
                    const locData = p.locations;
                    const l: any = Array.isArray(locData) ? locData[0] : locData;
                    return (
                      <div key={p.id} className="text-sm border-b pb-2 flex justify-between items-center">
                        <div>
                          <p className="font-bold text-slate-800">{p.partner_name}</p>
                          <p className="text-xs text-slate-500">
                            [{l?.center_code || "NO-CODE"}] {l?.center_name} ({l?.dist})
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

            <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
              <div className="bg-amber-50 p-4 border-b border-amber-100 flex justify-between items-center">
                <h3 className="font-black text-amber-800 text-sm uppercase tracking-widest">
                  ⏳ Missing Cash Deposits
                </h3>
                <span className="bg-amber-200 text-amber-900 font-black px-2 py-0.5 rounded text-xs">
                  {missingDeposits.length} Partners
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto p-4 space-y-2">
                {missingDeposits.length === 0 ? (
                  <p className="text-sm text-green-600 font-bold text-center py-4">
                    All filtered partners have submitted deposits.
                  </p>
                ) : (
                  missingDeposits.map((p) => {
                    const locData = p.locations;
                    const l: any = Array.isArray(locData) ? locData[0] : locData;
                    return (
                      <div key={p.id} className="text-sm border-b pb-2 flex justify-between items-center">
                        <div>
                          <p className="font-bold text-slate-800">{p.partner_name}</p>
                          <p className="text-xs text-slate-500">
                            [{l?.center_code || "NO-CODE"}] {l?.center_name} ({l?.dist})
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
        )}

        {isManagerOrAdmin && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in">
            <div
              onClick={() => routeTo("/dashboard/applications")}
              className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-yellow-400 hover:shadow-md transition group block cursor-pointer"
            >
              <p className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-1">Action Required</p>
              <h2 className="text-3xl font-black text-slate-800">{stats.pending}</h2>
              <p className="text-yellow-600 font-bold mt-2 text-xs flex items-center justify-between">
                Pending Apps <span>→</span>
              </p>
            </div>

            <div
              onClick={() => routeTo("/dashboard/partners")}
              className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-green-500 hover:shadow-md transition group block cursor-pointer"
            >
              <p className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-1">Network Growth</p>
              <h2 className="text-3xl font-black text-slate-800">{stats.approved}</h2>
              <p className="text-green-600 font-bold mt-2 text-xs flex items-center justify-between">
                Approved Partners <span>→</span>
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-red-500">
              <p className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-1">Declined</p>
              <h2 className="text-3xl font-black text-slate-800">{stats.rejected}</h2>
              <p className="text-red-600 font-bold mt-2 text-xs">Rejected Apps</p>
            </div>
            <div
              onClick={() => routeTo("/dashboard/locations")}
              className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-blue-600 hover:shadow-md transition group block cursor-pointer"
            >
              <p className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-1">Infrastructure</p>
              <h2 className="text-3xl font-black text-slate-800">{stats.locations}</h2>
              <p className="text-blue-600 font-bold mt-2 text-xs flex items-center justify-between">
                Active Centers <span>→</span>
              </p>
            </div>
          </div>
        )}

        <h2 className="text-xl font-black text-slate-800 border-l-4 border-blue-600 pl-3 pt-2">
          {isAccountant ? "Financial Modules" : isStaff ? "Assigned Tasks" : "Enterprise Modules"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in">
          {/* AADHAAR SEVA KENDRA HUB MODULE CARD */}
          <div
            onClick={() => routeTo("/dashboard/aadhaar")}
            className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-500 transition group block cursor-pointer border-t-4 border-t-amber-500"
          >
            <div className="text-3xl mb-3">🆔</div>
            <h3 className="font-black text-lg text-slate-900 group-hover:text-amber-600">
              Aadhaar Seva Kendra Hub
            </h3>
            <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
              Audit 5-category CSV/HTML uploads, weekly reconciliations, ₹100/day penalties, and UIDAI tariffs.
            </p>
          </div>

          {!isAccountant && (
            <div
              onClick={() => setActiveView("support")}
              className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-red-400 transition-all group block cursor-pointer border-t-4 border-t-red-500"
            >
              <div className="text-3xl mb-3">🎧</div>
              <h3 className="font-black text-lg text-slate-900 group-hover:text-red-600">
                Support &amp; Escalation
              </h3>
              <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                Review partner complaints, escalate issues, and track SLAs.
              </p>
            </div>
          )}

          {isManagerOrAdmin && (
            <div
              onClick={() => routeTo("/dashboard/compliance")}
              className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-all group block cursor-pointer"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="text-3xl">🚨</div>
                <span className="bg-red-100 text-red-700 text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-red-200 animate-pulse">
                  Auto-Scan
                </span>
              </div>
              <h3 className="font-black text-lg text-slate-900 group-hover:text-red-600">Compliance Engine</h3>
              <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                Automated Defaulter Tracking for unlogged sales, cash limit breaches, and ignored alerts.
              </p>
            </div>
          )}

          {(isFinanceTeam || isManagerOrAdmin) && (
            <>
              <div
                onClick={() => routeTo("/dashboard/reports")}
                className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-400 transition group block cursor-pointer"
              >
                <div className="text-3xl mb-3">📈</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-indigo-600">
                  Corporate MIS Export
                </h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                  Generate filtered Excel/CSV &amp; PDF reports for sales, deposits, and Aadhaar.
                </p>
              </div>

              <div
                onClick={() => routeTo("/dashboard/sales-verification")}
                className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-400 transition group block cursor-pointer"
              >
                <div className="text-3xl mb-3">⚖</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-amber-600">
                  Sales Correction Audit
                </h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                  Audit raw partner sales data and enforce financial overrides.
                </p>
              </div>
            </>
          )}

          {isFinanceTeam && (
            <div
              onClick={() => routeTo("/dashboard/accounts")}
              className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-400 transition group block cursor-pointer"
            >
              <div className="text-3xl mb-3">🏦</div>
              <h3 className="font-black text-lg text-slate-900 group-hover:text-amber-600">Accountant Portal</h3>
              <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                Verify partner cash deposits, OCR slips, and clear ledgers.
              </p>
            </div>
          )}

          {!isAccountant && (
            <>
              <div
                onClick={() => routeTo("/dashboard/manager-mis")}
                className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-400 transition group block cursor-pointer"
              >
                <div className="text-3xl mb-3">📊</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-indigo-600">MIS &amp; Balances</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                  Log daily Opening/Closing balances and manage operational ledgers.
                </p>
              </div>

              {isManagerOrAdmin && (
                <>
                  <div
                    onClick={() => routeTo("/dashboard/ocsc")}
                    className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition group block cursor-pointer"
                  >
                    <div className="text-3xl mb-3">📡</div>
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-600">
                      Telecom &amp; OCSC Data
                    </h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                      Manage Master CTOP accounts, Sanchar Soft credentials, and Agent mappings.
                    </p>
                  </div>

                  <div
                    onClick={() => routeTo("/dashboard/applications")}
                    className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition group block cursor-pointer"
                  >
                    <div className="text-3xl mb-3">📝</div>
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-600">
                      Franchise Onboarding
                    </h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                      Review applications and approve new Fast Ark partners.
                    </p>
                  </div>

                  <div
                    onClick={() => routeTo("/dashboard/logistics")}
                    className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-green-400 transition group block cursor-pointer"
                  >
                    <div className="text-3xl mb-3">📦</div>
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-green-600">
                      Logistics &amp; Supply
                    </h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                      Approve CTOP/CBP top-ups and mark physical SIMs dispatched.
                    </p>
                  </div>

                  <div
                    onClick={() => routeTo("/dashboard/banking")}
                    className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-400 transition group block cursor-pointer"
                  >
                    <div className="text-3xl mb-3">💳</div>
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-emerald-600">
                      Corporate Banking Hub
                    </h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                      Manage remittance channels, virtual accounts, and UPI configurations.
                    </p>
                  </div>

                  <div
                    onClick={() => routeTo("/dashboard/messages")}
                    className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-purple-400 transition group block cursor-pointer"
                  >
                    <div className="text-3xl mb-3">💬</div>
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-purple-600">Partner Alerts</h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                      Dispatch secure priority alerts directly to partner dashboards.
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {isGodMode && (
            <div
              onClick={() => routeTo("/dashboard/staff-reports")}
              className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-purple-400 transition group block cursor-pointer"
            >
              <div className="text-3xl mb-3">⏱️</div>
              <h3 className="font-black text-lg text-slate-900 group-hover:text-purple-600">
                Productivity Matrix
              </h3>
              <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">
                View real-time staff performance analytics and strict audit trails.
              </p>
            </div>
          )}
        </div>

        {isManagerOrAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4 animate-in fade-in">
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-fit">
              <h2 className="text-lg font-black mb-6 text-slate-800 border-b pb-2">Website Enquiries</h2>
              {enquiries.length === 0 ? (
                <div className="p-8 text-center text-gray-500 font-medium">No recent enquiries found.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {enquiries.map((enquiry) => (
                    <div
                      key={enquiry.id}
                      className="p-4 bg-slate-50 rounded-lg border border-gray-200 hover:shadow-sm transition"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-black text-blue-700">{enquiry.name}</h3>
                        <span className="text-[10px] text-gray-500 font-bold uppercase">
                          {new Date(enquiry.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 font-bold mb-3 flex items-center gap-1">
                        ✉️ {enquiry.email}
                      </p>
                      <p className="text-slate-700 bg-white p-3 rounded border border-gray-200 text-xs font-medium italic">
                        &quot;{enquiry.message}&quot;
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-fit">
              <div className="bg-slate-900 p-4">
                <h3 className="text-white font-black text-sm uppercase tracking-widest">
                  Recent Franchise Apps
                </h3>
              </div>
              <div className="flex-1">
                {recentApps.length === 0 ? (
                  <p className="p-6 text-center text-gray-500 font-medium">No recent activity.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {recentApps.map((app) => (
                      <li key={app.id} className="p-4 hover:bg-slate-50 transition">
                        <div
                          onClick={() => routeTo(`/dashboard/applications/${app.id}`)}
                          className="block cursor-pointer"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-bold text-slate-800">{app.name}</span>
                            <span
                              className={`text-[10px] font-black px-2 py-0.5 rounded-sm uppercase ${
                                app.status === "Approved"
                                  ? "bg-green-100 text-green-700"
                                  : app.status === "Rejected"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-yellow-100 text-yellow-700"
                              }`}
                            >
                              {app.status || "Pending"}
                            </span>
                          </div>
                          <div className="text-xs text-blue-600 font-bold uppercase">{app.requested_role}</div>
                          <div className="text-[10px] text-gray-400 mt-1 font-bold">
                            {new Date(app.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {isGodMode && <StaffManagementEngine />}
      </div>
    </div>
  );
}