"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid 
} from 'recharts';

// --- INJECT DECOUPLED COMPONENT ---
import StaffManagementEngine from "../components/StaffManagementEngine";

const getLocalDateString = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

export default function AdminCommandCenter() {
  const router = useRouter();
  const [adminUser, setAdminUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Strict routing state to prevent "Ghost Clicks"
  const [isRouting, setIsRouting] = useState(false);
  
  // --- STATE 1: Operational Analytics ---
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, locations: 0 });
  const [recentApps, setRecentApps] = useState<any[]>([]);
  const [enquiries, setEnquiries] = useState<any[]>([]);

  // --- STATE 2: Financial & Tracking ---
  const [allPartners, setAllPartners] = useState<any[]>([]);
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawDeposits, setRawDeposits] = useState<any[]>([]);
  
  const [timeFilter, setTimeFilter] = useState("monthly"); 
  const [geoFilter, setGeoFilter] = useState({ state: "All", dist: "All", location: "All", partner: "All" });
  
  const [dropdowns, setDropdowns] = useState<{
    states: string[];
    dists: string[];
    locations: string[];
    partners: string[];
  }>({ states: [], dists: [], locations: [], partners: [] });
  
  const [financials, setFinancials] = useState({ cbp: 0, ctop: 0, sim: 0, cheque: 0, totalSalesCash: 0, totalDeposits: 0 });
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

      const rawRole = staffData?.role || '';
      const safeRole = rawRole.trim().toLowerCase(); 

      if (['admin', 'manager', 'staff'].includes(safeRole)) {
        await fetchOperationalData();
      }
      
      if (['admin', 'accountant'].includes(safeRole)) {
        await fetchFinancialData("monthly");
      } else {
        setLoading(false); 
      }
      
    } catch (err: any) {
      console.error("Dashboard init error:", err.message);
      setLoading(false);
    }
  };

  const fetchOperationalData = async () => {
    try {
      const { data: appsData } = await supabase.from('pending_applications').select('id, name, requested_role, status, created_at').order('created_at', { ascending: false });
      const { count: locCount } = await supabase.from('locations').select('*', { count: 'exact', head: true }).eq('is_active', true);
      const { data: enqData } = await supabase.from('enquiries').select('*').order('created_at', { ascending: false });
      const { data: partnersData } = await supabase.from('active_partners').select('id, partner_name, locations(state, dist, center_name)');

      if (partnersData) setAllPartners(partnersData);
      if (enqData) setEnquiries(enqData);
      
      const apps = appsData || [];
      setStats({
        pending: apps.filter(app => app.status === 'Pending' || !app.status).length,
        approved: apps.filter(app => app.status === 'Approved').length,
        rejected: apps.filter(app => app.status === 'Rejected').length,
        locations: locCount || 0
      });
      setRecentApps(apps.slice(0, 5));
    } catch (error: any) {
      console.error("Operational data error:", error.message);
    }
  };

  const fetchFinancialData = async (timeMode: string) => {
    setIsRefreshingFinance(true);
    try {
      let startDate = new Date();
      let endDate = new Date();

      if (timeMode === "today") {
      } else if (timeMode === "yesterday") {
        startDate.setDate(startDate.getDate() - 1);
        endDate.setDate(endDate.getDate() - 1);
      } else if (timeMode === "weekly") {
        startDate.setDate(startDate.getDate() - 7);
      } else if (timeMode === "monthly") {
        startDate.setDate(1); 
      }

      const startStr = getLocalDateString(startDate);
      const endStr = getLocalDateString(endDate);

      const { data: sales } = await supabase
        .from('daily_sales_reports')
        .select(`*, active_partners (id, partner_name, locations (state, dist, center_name))`)
        .gte('report_date', startStr)
        .lte('report_date', endStr);

      const { data: deposits } = await supabase
        .from('partner_deposits')
        .select(`*, active_partners (id, partner_name, locations (state, dist, center_name))`)
        .neq('status', 'Discrepancy')
        .gte('created_at', `${startStr}T00:00:00+05:30`) 
        .lte('created_at', `${endStr}T23:59:59+05:30`);

      const validSales = sales || [];
      const validDeposits = deposits || [];

      setRawSales(validSales);
      setRawDeposits(validDeposits);
      
      extractDropdownOptions(allPartners); 
      
      const resetFilters = { state: "All", dist: "All", location: "All", partner: "All" };
      setGeoFilter(resetFilters);
      calculateEngine(validSales, validDeposits, allPartners, resetFilters);
      setTimeFilter(timeMode);

    } catch (error: any) {
      console.error("Finance fetch error:", error.message);
    } finally {
      setIsRefreshingFinance(false);
      setLoading(false);
    }
  };

  const extractDropdownOptions = (partners: any[]) => {
    const states = new Set<string>();
    const dists = new Set<string>();
    const locs = new Set<string>();
    const names = new Set<string>();

    partners.forEach(p => {
      names.add(p.partner_name);
      if (p.locations) {
        if (p.locations.state) states.add(p.locations.state);
        if (p.locations.dist) dists.add(p.locations.dist);
        if (p.locations.center_name) locs.add(p.locations.center_name);
      }
    });

    setDropdowns({
      states: Array.from(states).sort(),
      dists: Array.from(dists).sort(),
      locations: Array.from(locs).sort(),
      partners: Array.from(names).sort()
    });
  };

  const calculateEngine = (sales: any[], deposits: any[], directory: any[], filters: any) => {
    const applyGeoFilter = (item: any) => {
      const p = item.active_partners || item; 
      const l = p.locations;
      if (filters.state !== "All" && l?.state !== filters.state) return false;
      if (filters.dist !== "All" && l?.dist !== filters.dist) return false;
      if (filters.location !== "All" && l?.center_name !== filters.location) return false;
      if (filters.partner !== "All" && p?.partner_name !== filters.partner) return false;
      return true;
    };

    const filteredSales = sales.filter(applyGeoFilter);
    const filteredDeposits = deposits.filter(applyGeoFilter);
    const filteredDirectory = directory.filter(applyGeoFilter);

    let tCbp = 0, tCtop = 0, tSim = 0, tCheque = 0, tSalesCash = 0, tDepositCash = 0;
    const chartMap: Record<string, { date: string, Sales: number, Deposits: number }> = {};

    filteredSales.forEach(s => {
      const sCbp = Number(s.cbp_landline_amt || 0) + Number(s.cbp_gsm_amt || 0);
      const sCtop = Number(s.ctop_recharge_amt || 0);
      const sSim = Number(s.sim_replacement_amt || 0) + Number(s.sim_fancy_amt || 0) + Number(s.sim_postpaid_amt || 0);
      const sOther = Number(s.other_amt || 0);
      const totalCashRow = sCbp + sCtop + sSim + sOther;

      tCbp += sCbp; 
      tCtop += sCtop; 
      tSim += sSim;
      tCheque += Number(s.cheque_amt || 0);
      tSalesCash += totalCashRow;

      const dateKey = s.report_date;
      if (!chartMap[dateKey]) chartMap[dateKey] = { date: dateKey, Sales: 0, Deposits: 0 };
      chartMap[dateKey].Sales += totalCashRow;
    });

    filteredDeposits.forEach(d => {
      const amt = Number(d.deposit_amount || 0);
      tDepositCash += amt;

      const dateKey = d.created_at.split('T')[0];
      if (!chartMap[dateKey]) chartMap[dateKey] = { date: dateKey, Sales: 0, Deposits: 0 };
      chartMap[dateKey].Deposits += amt;
    });

    setFinancials({ cbp: tCbp, ctop: tCtop, sim: tSim, cheque: tCheque, totalSalesCash: tSalesCash, totalDeposits: tDepositCash });
    setChartData(Object.values(chartMap).sort((a, b) => a.date.localeCompare(b.date)));

    const partnersWithSales = new Set(filteredSales.map(s => s.partner_id));
    const partnersWithDeposits = new Set(filteredDeposits.map(d => d.partner_id));

    setMissingSales(filteredDirectory.filter(p => !partnersWithSales.has(p.id)));
    setMissingDeposits(filteredDirectory.filter(p => !partnersWithDeposits.has(p.id)));
  };

  const handleGeoChange = (field: string, value: string) => {
    const newFilters = { ...geoFilter, [field]: value };
    setGeoFilter(newFilters);
    calculateEngine(rawSales, rawDeposits, allPartners, newFilters);
  };

  const handleSignOut = async () => {
    setLoading(true);
    await supabase.auth.signOut(); 
    router.push("/login");
  };

  // [FIX 1]: Safe Router Push with Failsafe Timeout
  const routeTo = (path: string) => {
    setIsRouting(true);
    router.push(path);
    // Safety net: Automatically dismiss overlay if route takes > 8s due to network error
    setTimeout(() => setIsRouting(false), 8000);
  };

  // [FIX 2]: Only return the hard unmount on pure `loading`
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
    </div>
  );

  // --- Normalized RBAC PERMISSION BOOLEANS ---
  const rawRole = adminUser?.role || '';
  const safeRole = rawRole.trim().toLowerCase();
  
  const isGodMode = safeRole === 'admin';
  const isFinanceTeam = ['admin', 'accountant'].includes(safeRole);
  const isOpsTeam = ['admin', 'manager', 'staff'].includes(safeRole);
  const isManagerOrAdmin = ['admin', 'manager'].includes(safeRole);

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8 font-sans relative">
      
      {/* [FIX 3]: Z-Index UI Overlay. Keeps the DOM intact so Next.js can transition safely! */}
      {isRouting && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="text-sm font-bold text-white animate-pulse tracking-widest uppercase">Establishing secure connection to module...</p>
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* --- HEADER --- */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 pb-6 gap-4">
          <div>
            <h1 className="text-4xl font-black text-slate-900">
              {safeRole === 'accountant' ? "Finance Command" : safeRole === 'staff' ? "Operations Desk" : "Admin Command Center"}
            </h1>
            <p className="text-slate-500 mt-2 font-medium">
              Welcome back, <span className="font-bold text-slate-800">{adminUser?.name || "User"}</span> | Role:{" "}
              <span className="font-black text-purple-600 uppercase tracking-widest">{rawRole || "System"}</span>
            </p>
          </div>
          
          <div className="flex gap-3">
            <button 
              onClick={() => { 
                if(isOpsTeam) fetchOperationalData(); 
                if(isFinanceTeam) fetchFinancialData(timeFilter); 
              }} 
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-bold hover:bg-gray-50 shadow-sm transition text-sm"
            >
              ↻ Refresh Data
            </button>
            <button onClick={handleSignOut} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-md font-bold hover:bg-slate-300 transition text-sm shadow-sm">
              Sign Out
            </button>
          </div>
        </div>

        {/* --- SECTION 1: LIVE FINANCIAL ENGINE (Finance Team Only) --- */}
        {isFinanceTeam && (
          <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden animate-in fade-in">
            
            <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-col lg:flex-row justify-between items-center gap-4">
              <h2 className="text-white font-black text-lg tracking-wide flex items-center gap-2"><span>📈</span> Live Revenue & Reconciliation</h2>
              <div className="flex bg-slate-800 rounded-lg p-1 overflow-x-auto">
                {['today', 'yesterday', 'weekly', 'monthly'].map(mode => (
                  <button 
                    key={mode} 
                    onClick={() => fetchFinancialData(mode)} 
                    disabled={isRefreshingFinance} 
                    className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition whitespace-nowrap ${timeFilter === mode ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Geo Filters */}
            <div className="p-4 bg-slate-800 border-b border-slate-700 grid grid-cols-2 md:grid-cols-4 gap-4">
              {(Object.keys(geoFilter) as Array<keyof typeof geoFilter>).map((field) => (
                <div key={field}>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{field === 'dist' ? 'District' : field === 'location' ? 'Center' : field}</label>
                  <select value={geoFilter[field as keyof typeof geoFilter]} onChange={e => handleGeoChange(field, e.target.value)} className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded p-2 outline-none focus:border-blue-500">
                    <option value="All">All {field}s</option>
                    {(dropdowns as any)[field + 's']?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {/* KPI Output */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-slate-700">
              <div className="bg-slate-900 p-5 flex flex-col justify-center">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total CBP</p>
                <p className="text-xl font-black text-white">₹{financials.cbp.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total CTOP</p>
                <p className="text-xl font-black text-white">₹{financials.ctop.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total SIM</p>
                <p className="text-xl font-black text-white">₹{financials.sim.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-slate-900 p-5 flex flex-col justify-center">
                <p className="text-[10px] text-amber-500/70 font-bold uppercase tracking-widest mb-1">Cheque Amt</p>
                <p className="text-xl font-black text-amber-500">₹{financials.cheque.toLocaleString('en-IN')}</p>
              </div>
              
              <div className="bg-slate-900 p-5 border-l-0 md:border-l-4 border-t-4 md:border-t-0 border-blue-500 flex flex-col justify-center">
                <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest mb-1">Total Sales Cash</p>
                <p className="text-2xl md:text-3xl font-black text-white">₹{financials.totalSalesCash.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-slate-900 p-5 border-l-0 md:border-l-4 border-t-4 md:border-t-0 border-green-500 flex flex-col justify-center">
                <p className="text-[10px] text-green-400 font-black uppercase tracking-widest mb-1">Total Deposited</p>
                <p className="text-2xl md:text-3xl font-black text-white">₹{financials.totalDeposits.toLocaleString('en-IN')}</p>
              </div>
            </div>

            {/* Graphical Chart output */}
            {chartData.length > 0 && (
              <div className="p-6 bg-slate-900 w-full h-80 border-t border-slate-700">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `₹${val/1000}k`} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px', color: '#fff' }} cursor={{fill: '#1e293b'}} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="Sales" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Cash Generated" />
                    <Bar dataKey="Deposits" fill="#22c55e" radius={[4, 4, 0, 0]} name="Cash Remitted" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* --- SECTION 2: DEFAULTER TRACKING (Finance & Managers) --- */}
        {(isFinanceTeam || isManagerOrAdmin) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in">
            <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
              <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
                <h3 className="font-black text-red-800 text-sm uppercase tracking-widest">⚠️ Missing Sales Reports</h3>
                <span className="bg-red-200 text-red-900 font-black px-2 py-0.5 rounded text-xs">{missingSales.length} Partners</span>
              </div>
              <div className="max-h-64 overflow-y-auto p-4 space-y-2">
                {missingSales.length === 0 ? <p className="text-sm text-green-600 font-bold text-center py-4">All filtered partners have submitted sales.</p> : 
                  missingSales.map(p => (
                    <div key={p.id} className="text-sm border-b pb-2 flex justify-between items-center">
                      <div>
                        <p className="font-bold text-slate-800">{p.partner_name}</p>
                        <p className="text-xs text-slate-500">{p.locations?.center_name} ({p.locations?.dist})</p>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
              <div className="bg-amber-50 p-4 border-b border-amber-100 flex justify-between items-center">
                <h3 className="font-black text-amber-800 text-sm uppercase tracking-widest">⏳ Missing Cash Deposits</h3>
                <span className="bg-amber-200 text-amber-900 font-black px-2 py-0.5 rounded text-xs">{missingDeposits.length} Partners</span>
              </div>
              <div className="max-h-64 overflow-y-auto p-4 space-y-2">
                {missingDeposits.length === 0 ? <p className="text-sm text-green-600 font-bold text-center py-4">All filtered partners have submitted deposits.</p> : 
                  missingDeposits.map(p => (
                    <div key={p.id} className="text-sm border-b pb-2 flex justify-between items-center">
                      <div>
                        <p className="font-bold text-slate-800">{p.partner_name}</p>
                        <p className="text-xs text-slate-500">{p.locations?.center_name} ({p.locations?.dist})</p>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        )}

        {/* --- SECTION 3: OPERATIONAL METRICS (Ops Team Only) --- */}
        {isOpsTeam && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in fade-in">
            <div onClick={() => routeTo("/dashboard/applications")} className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-yellow-400 hover:shadow-md transition group block cursor-pointer">
              <p className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-1">Action Required</p>
              <h2 className="text-3xl font-black text-slate-800">{stats.pending}</h2>
              <p className="text-yellow-600 font-bold mt-2 text-xs flex items-center justify-between">Pending Apps <span>→</span></p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-green-500">
              <p className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-1">Network Growth</p>
              <h2 className="text-3xl font-black text-slate-800">{stats.approved}</h2>
              <p className="text-green-600 font-bold mt-2 text-xs">Approved Partners</p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-red-500">
              <p className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-1">Declined</p>
              <h2 className="text-3xl font-black text-slate-800">{stats.rejected}</h2>
              <p className="text-red-600 font-bold mt-2 text-xs">Rejected Apps</p>
            </div>
            <div onClick={() => isManagerOrAdmin ? routeTo("/dashboard/locations") : null} className={`bg-white p-6 rounded-xl shadow-sm border-l-4 border-l-blue-600 transition group block ${isManagerOrAdmin ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}`}>
              <p className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-1">Infrastructure</p>
              <h2 className="text-3xl font-black text-slate-800">{stats.locations}</h2>
              <p className="text-blue-600 font-bold mt-2 text-xs flex items-center justify-between">Active Centers {isManagerOrAdmin && <span>→</span>}</p>
            </div>
          </div>
        )}

        {/* --- SECTION 4: ENTERPRISE MODULES GRID (DYNAMIC PER ROLE) --- */}
        <h2 className="text-xl font-black text-slate-800 border-l-4 border-blue-600 pl-3 pt-2">
          {safeRole === 'accountant' ? "Financial Modules" : safeRole === 'staff' ? "Assigned Tasks" : "Enterprise Modules"}
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in">
          
          {/* MANAGER & ADMIN ONLY */}
          {isManagerOrAdmin && (
            <div onClick={() => routeTo("/dashboard/compliance")} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-all hover:border-red-500 hover:-translate-y-1 group block border-t-4 border-t-red-600 cursor-pointer">
              <div className="flex justify-between items-start mb-3">
                <div className="text-3xl">🚨</div>
                <span className="bg-red-100 text-red-700 text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-red-200 animate-pulse">
                  Auto-Scan
                </span>
              </div>
              <h3 className="font-black text-lg text-slate-900 group-hover:text-red-600">Compliance Engine</h3>
              <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Automated Defaulter Tracking for unlogged sales, cash limit breaches, and ignored alerts.</p>
            </div>
          )}

          {/* FINANCE TEAM ONLY */}
          {isFinanceTeam && (
            <>
              <div onClick={() => routeTo("/dashboard/reports")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-400 transition group block cursor-pointer">
                <div className="text-3xl mb-3">📈</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-indigo-600">Corporate MIS Export</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Generate filtered Excel/CSV reports for sales and deposits.</p>
              </div>
              
              <div onClick={() => routeTo("/dashboard/accounts")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-400 transition group block cursor-pointer">
                <div className="text-3xl mb-3">🏦</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-amber-600">Accountant Portal</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Verify partner cash deposits, OCR slips, and clear ledgers.</p>
              </div>

              <div onClick={() => routeTo("/dashboard/sales-verification")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-400 transition group block cursor-pointer">
                <div className="text-3xl mb-3">⚖️</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-amber-600">Sales Correction Audit</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Audit raw partner sales data and enforce financial overrides.</p>
              </div>

              <div onClick={() => routeTo("/dashboard/banking")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-400 transition group block cursor-pointer">
                <div className="text-3xl mb-3">💳</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-emerald-600">Corporate Banking Hub</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Manage remittance channels, virtual accounts, and UPI configurations.</p>
              </div>
            </>
          )}

          {/* OPS TEAM ONLY (Admin, Manager, Staff) */}
          {isOpsTeam && (
            <>
              <div onClick={() => routeTo("/dashboard/ocsc")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition group block cursor-pointer">
                <div className="text-3xl mb-3">📡</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-600">Telecom & OCSC Data</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Manage Master CTOP accounts, Sanchar Soft credentials, and Agent mappings.</p>
              </div>

              <div onClick={() => routeTo("/dashboard/applications")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition group block cursor-pointer">
                <div className="text-3xl mb-3">📝</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-600">Franchise Onboarding</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Review applications and approve new Fast Ark partners.</p>
              </div>

              <div onClick={() => routeTo("/dashboard/logistics")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-green-400 transition group block cursor-pointer">
                <div className="text-3xl mb-3">📦</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-green-600">Logistics & Supply</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Approve CTOP/CBP top-ups and mark physical SIMs dispatched.</p>
              </div>

              {/* Managers & Admins Only */}
              {isManagerOrAdmin && (
                <>
                  <div onClick={() => routeTo("/dashboard/manager-mis")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-400 transition group block cursor-pointer">
                    <div className="text-3xl mb-3">📊</div>
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-indigo-600">Manager MIS Dashboard</h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Hierarchical MIS pipeline for procurement, center sales, collections, and live Hub & Spoke reporting.</p>
                  </div>

                  <div onClick={() => routeTo("/dashboard/messages")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-purple-400 transition group block cursor-pointer">
                    <div className="text-3xl mb-3">💬</div>
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-purple-600">Partner Alerts</h3>
                    <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">Dispatch secure priority alerts directly to partner dashboards.</p>
                  </div>
                </>
              )}
            </>
          )}

          {/* SUPER ADMIN EXCLUSIVES */}
          {isGodMode && (
            <>
              {/* Productivty Matrix mapped correctly to /dashboard/staff-reports */}
              <div onClick={() => routeTo("/dashboard/staff-reports")} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-purple-400 transition group block cursor-pointer">
                <div className="text-3xl mb-3">⏱️</div>
                <h3 className="font-black text-lg text-slate-900 group-hover:text-purple-600">Productivity Matrix</h3>
                <p className="text-slate-500 text-xs mt-1.5 font-medium leading-relaxed">View real-time staff performance analytics and strict audit trails.</p>
              </div>
            </>
          )}
        </div>

        {/* --- SECTION 5: RECENT ACTIVITY (Ops Team Only) --- */}
        {isOpsTeam && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4 animate-in fade-in">
            
            {/* Website Enquiries */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-fit">
              <h2 className="text-lg font-black mb-6 text-slate-800 border-b pb-2">Website Enquiries</h2>
              {enquiries.length === 0 ? (
                <div className="p-8 text-center text-gray-500 font-medium">No recent enquiries found.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {enquiries.map((enquiry) => (
                    <div key={enquiry.id} className="p-4 bg-slate-50 rounded-lg border border-gray-200 hover:shadow-sm transition">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-black text-blue-700">{enquiry.name}</h3>
                        <span className="text-[10px] text-gray-500 font-bold uppercase">{new Date(enquiry.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-xs text-gray-600 font-bold mb-3 flex items-center gap-1">✉️ {enquiry.email}</p>
                      <p className="text-slate-700 bg-white p-3 rounded border border-gray-200 text-xs font-medium italic">"{enquiry.message}"</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Franchise Applications */}
            <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-fit">
              <div className="bg-slate-900 p-4">
                <h3 className="text-white font-black text-sm uppercase tracking-widest">Recent Franchise Apps</h3>
              </div>
              <div className="flex-1">
                {recentApps.length === 0 ? (
                  <p className="p-6 text-center text-gray-500 font-medium">No recent activity.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {recentApps.map((app) => (
                      <li key={app.id} className="p-4 hover:bg-slate-50 transition">
                        <div onClick={() => routeTo(`/dashboard/applications/${app.id}`)} className="block cursor-pointer">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-bold text-slate-800">{app.name}</span>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-sm uppercase ${app.status === 'Approved' ? 'bg-green-100 text-green-700' : app.status === 'Rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                              {app.status || 'Pending'}
                            </span>
                          </div>
                          <div className="text-xs text-blue-600 font-bold uppercase">{app.requested_role}</div>
                          <div className="text-[10px] text-gray-400 mt-1 font-bold">{new Date(app.created_at).toLocaleDateString()}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

          </div>
        )}

        {/* --- SECTION 6: INJECTED STAFF MANAGEMENT ENGINE --- */}
        {isGodMode && <StaffManagementEngine />}
        
      </div>
    </div>
  );
}