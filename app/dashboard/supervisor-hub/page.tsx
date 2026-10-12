"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// --- Time & Date Engines (IST Safe) ---
const getISTDate = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

const getLocalDateString = (date: Date) => {
  const istTime = new Date(date.getTime() + (330 * 60000));
  return istTime.toISOString().split('T')[0];
};

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes('T')) return dateStr.split('T')[0];
  return dateStr;
};

// --- Security: CSV Sanitizer ---
const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

export default function SupervisorHub() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [staffProfile, setStaffProfile] = useState<any>(null);
  
  // UI State - Upgraded to 4 dedicated professional tabs
  const [activeTab, setActiveTab] = useState<'activity' | 'sales' | 'deposits' | 'compliance'>('activity');
  const [secureImageUrl, setSecureImageUrl] = useState<string | null>(null);
  const [viewingSlipId, setViewingSlipId] = useState<string | null>(null);

  // Architecture & Raw Data State
  const [allocatedLocations, setAllocatedLocations] = useState<any[]>([]);
  const [masterHQs, setMasterHQs] = useState<any[]>([]);
  const [regionalPartners, setRegionalPartners] = useState<any[]>([]);
  const [regionalSales, setRegionalSales] = useState<any[]>([]);
  const [regionalDeposits, setRegionalDeposits] = useState<any[]>([]);

  // Action State
  const [isNudging, setIsNudging] = useState<string | null>(null);

  // --- CASCADING FILTER STATE ---
  const [timeFilter, setTimeFilter] = useState("today");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [hqFilter, setHqFilter] = useState("ALL");

  useEffect(() => {
    initializeSupervisorEngine();
  }, []);

  const initializeSupervisorEngine = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      // 1. Authenticate & Verify Supervisor Role
      const { data: staff } = await supabase
        .from('back_office_staff')
        .select('*')
        .eq('email', session.user.email)
        .single();

      if (!staff || staff.role !== 'Supervisor') {
        return router.push("/login");
      }
      setStaffProfile(staff);

      // 2. FETCH ISOLATED TERRITORY ALLOCATIONS
      const { data: allocations } = await supabase
        .from('supervisor_allocations')
        .select('location_id, manage_cm, manage_ocsc, manage_aadhaar, manage_partner')
        .eq('supervisor_id', staff.auth_id);

      if (!allocations || allocations.length === 0) {
        setLoading(false);
        return; 
      }

      const allowedLocIds = allocations.map(a => a.location_id);
      const permissionMap: Record<number, any> = {};
      allocations.forEach(a => { permissionMap[a.location_id] = a; });

      // 3. PULL ISOLATED DATASTREAMS 
      // ARCHITECTURAL FIX: Fetch 'state' alongside 'center_name' for HQ State Filtering
      const [locsRes, partnersRes, hqRes] = await Promise.all([
        supabase.from('locations').select('*').in('id', allowedLocIds),
        supabase.from('active_partners').select('*, locations(center_name, state, parent_master_id)').in('center_id', allowedLocIds).eq('status', 'Active'),
        supabase.from('locations').select('id, center_name, state').eq('is_master_node', true)
      ]);

      const allocatedLocs = locsRes.data || [];
      setAllocatedLocations(allocatedLocs);
      
      // ARCHITECTURAL FIX: HQ Dropdown Isolation Engine
      // Only extract HQs that this specific supervisor manages directly, or HQs that are the parents of centers they manage.
      const relevantHqIds = new Set();
      allocatedLocs.forEach(loc => {
        if (loc.parent_master_id) relevantHqIds.add(loc.parent_master_id);
        if (loc.is_master_node) relevantHqIds.add(loc.id);
      });

      const rawHqs = hqRes.data || [];
      const isolatedHQs = rawHqs.filter(hq => relevantHqIds.has(hq.id));
      setMasterHQs(isolatedHQs);
      
      const rawPartners = partnersRes.data || [];
      
      // 4. FINE-GRAINED ROLE ISOLATION ENGINE
      const permittedPartners = rawPartners.filter(p => {
        const rules = permissionMap[p.center_id];
        if (!rules) return false;
        
        const r = (p.role || "").toUpperCase();
        if (r.includes('CM') && rules.manage_cm) return true;
        if (r.includes('OCSC') && rules.manage_ocsc) return true;
        if (r.includes('AADHAAR') && rules.manage_aadhaar) return true;
        if ((r === 'PARTNER' || r.includes('IRCTC')) && rules.manage_partner) return true;
        
        return false;
      });

      const permittedPartnerIds = permittedPartners.map(p => p.id);

      // 5. FETCH SALES & DEPOSITS STRICTLY FOR PERMITTED PARTNERS
      const [salesRes, depositsRes] = await Promise.all([
        supabase.from('daily_sales_reports').select('*, active_partners(partner_name, locations(center_name, state, parent_master_id))').in('partner_id', permittedPartnerIds).order('report_date', { ascending: false }),
        supabase.from('partner_deposits').select('*, active_partners(partner_name, locations(center_name, state, parent_master_id))').in('partner_id', permittedPartnerIds).order('created_at', { ascending: false })
      ]);

      setRegionalPartners(permittedPartners);
      setRegionalSales(salesRes.data || []);
      setRegionalDeposits(depositsRes.data || []);

    } catch (err: any) {
      console.error("Supervisor Init Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- VAULT DECRYPTION ENGINE (Read-Only Proofs) ---
  const handleViewSecureSlip = async (deposit: any) => {
    setSecureImageUrl(null);
    setViewingSlipId(deposit.id);

    try {
      if (deposit.deposit_slip_url.startsWith("http")) {
        window.open(deposit.deposit_slip_url, "_blank");
        setViewingSlipId(null);
        return;
      }

      const { data, error } = await supabase.storage
        .from("deposit-slips")
        .createSignedUrl(deposit.deposit_slip_url, 60); 
      
      if (error || !data) throw new Error("Vault Access Denied");
      
      window.open(data.signedUrl, "_blank");
    } catch (err: any) {
      alert("Error loading slip: " + err.message);
    } finally {
      setViewingSlipId(null);
    }
  };

  // --- DISPATCH NUDGE ENGINE ---
  const handleRegionalNudge = async (partner: any, issueType: string) => {
    if (!confirm(`Dispatch an official regional alert to ${partner.partner_name}?`)) return;
    
    setIsNudging(partner.id);
    try {
      let subject = "Regional Compliance Notice";
      let body = `Dear ${partner.partner_name},\n\nYour regional supervisor has flagged your account for immediate action:\n\n`;

      if (issueType === 'CASH') {
        subject = "Urgent: Cash Limit Exceeded";
        body += `⚠️ You have exceeded the allowable pending cash limit. Please deposit your pending balances into the corporate accounts immediately and upload the slip to avoid operational suspension.`;
      } else if (issueType === 'SALES') {
        subject = "Urgent: Missing Daily Sales Report";
        body += `❌ You have failed to log your end-of-day sales report. Please access your dashboard and submit your sales immediately to maintain network compliance.`;
      }

      const { error } = await supabase.from('partner_messages').insert([{
        partner_id: partner.id,
        subject: `🚨 ALERT: ${subject}`,
        body: body
      }]);

      if (error) throw error;

      await supabase.from('staff_activity_logs').insert([{
        staff_id: staffProfile.id,
        staff_email: staffProfile.email,
        action_type: 'DISPATCH_ALERT',
        module: 'MESSAGES',
        target_id: partner.id,
        details: `Dispatched Regional Nudge to ${partner.partner_name} for ${issueType} compliance.`
      }]);

      alert(`✅ Regional Nudge securely dispatched to ${partner.partner_name}.`);

    } catch (err: any) {
      alert("Error sending nudge: " + err.message);
    } finally {
      setIsNudging(null);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // --- CASCADING FILTER LOGIC ---
  const uniqueStates = Array.from(new Set(regionalPartners.map(p => p.locations?.state).filter(Boolean))).sort();

  const getDateRange = () => {
    const today = new Date();
    let start = new Date();
    let end = new Date();

    if (timeFilter === "today") {
      // Keep today
    } else if (timeFilter === "yesterday") {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (timeFilter === "week") {
      start.setDate(today.getDate() - today.getDay()); 
    } else if (timeFilter === "month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (timeFilter === "all") {
      start = new Date("2000-01-01");
    }

    return { startStr: getLocalDateString(start), endStr: getLocalDateString(end) };
  };

  const { startStr, endStr } = getDateRange();

  // Apply filters to generate memory matrices
  const filteredPartners = useMemo(() => {
    return regionalPartners.filter(p => {
      const loc = p.locations;
      if (stateFilter !== "ALL" && loc?.state !== stateFilter) return false;
      if (hqFilter !== "ALL" && loc?.parent_master_id?.toString() !== hqFilter) return false;
      return true;
    });
  }, [regionalPartners, stateFilter, hqFilter]);

  const filteredSales = useMemo(() => {
    return regionalSales.filter(s => {
      const d = normalizeToYYYYMMDD(s.report_date);
      const isTimeMatch = d >= startStr && d <= endStr;
      const isPartnerMatch = filteredPartners.some(p => p.id === s.partner_id);
      return isTimeMatch && isPartnerMatch;
    });
  }, [regionalSales, filteredPartners, startStr, endStr]);

  const filteredDeposits = useMemo(() => {
    return regionalDeposits.filter(d => {
      const date = normalizeToYYYYMMDD(d.created_at);
      const isTimeMatch = date >= startStr && date <= endStr;
      const isPartnerMatch = filteredPartners.some(p => p.id === d.partner_id);
      return isTimeMatch && isPartnerMatch;
    });
  }, [regionalDeposits, filteredPartners, startStr, endStr]);

  // Compute Compliance & Activity Audit Matrix
  const complianceMatrix = useMemo(() => {
    return filteredPartners.map(p => {
      const pSalesTime = filteredSales.filter(s => s.partner_id === p.id);
      
      // For Activity Audit: Did they submit within the filtered time window?
      const hasLoggedActivity = pSalesTime.length > 0;

      // For Defaulter Escaltions: We need lifetime pending cash to be accurate
      const pSalesLifetime = regionalSales.filter(s => s.partner_id === p.id);
      const pDepositsLifetime = regionalDeposits.filter(d => d.partner_id === p.id && d.status !== 'Discrepancy');

      let lifetimeCash = 0;
      pSalesLifetime.forEach(s => {
        lifetimeCash += (Number(s.cbp_landline_amt||0) + Number(s.cbp_gsm_amt||0) + Number(s.ctop_recharge_amt||0) + Number(s.sim_replacement_amt||0) + Number(s.sim_fancy_amt||0) + Number(s.sim_postpaid_amt||0) + Number(s.other_amt||0));
      });
      
      let lifetimeDep = 0;
      pDepositsLifetime.forEach(d => { lifetimeDep += Number(d.deposit_amount || 0); });

      const pendingBalance = lifetimeCash - lifetimeDep;

      return {
        ...p,
        hasLoggedActivity,
        pendingBalance,
        isDefaulter: pendingBalance > 1000 || !hasLoggedActivity
      };
    });
  }, [filteredPartners, filteredSales, regionalSales, regionalDeposits]);

  // --- CSV EXPORT ENGINE ---
  const downloadCSV = (type: 'activity' | 'sales' | 'deposits' | 'compliance') => {
    let headers: string[] = [];
    let csvData: any[] = [];
    let fileName = `FastArk_Supervisor_${type.toUpperCase()}_${timeFilter}_${getISTDate()}`;

    if (type === 'activity') {
      headers = ["Partner Name", "Role", "Center", "State", "Activity Status"];
      csvData = complianceMatrix.map(p => [
        sanitizeCSV(p.partner_name), sanitizeCSV(p.role), sanitizeCSV(p.locations?.center_name), sanitizeCSV(p.locations?.state),
        p.hasLoggedActivity ? "Logged" : "Missing"
      ]);
    } else if (type === 'sales') {
      headers = [
        "Report Date", "State", "Master HQ", "Center", "Partner Name", 
        "BSNL CBP Revenue", "BSNL CTOP Revenue", "BSNL SIM Revenue", "Paybull Revenue", 
        "Total Gross Revenue", "Audit Status"
      ];
      csvData = filteredSales.map(s => {
        const cbp = Number(s.cbp_landline_amt||0) + Number(s.cbp_gsm_amt||0);
        const ctop = Number(s.ctop_recharge_amt||0);
        const sim = Number(s.sim_replacement_amt||0) + Number(s.sim_fancy_amt||0) + Number(s.sim_postpaid_amt||0) + Number(s.other_amt||0) + Number(s.frc_amt||0) + Number(s.mnp_amt||0);
        const pb = Number(s.pb_cbp_amt||0) + Number(s.pb_ctop_amt||0) + Number(s.pb_frc_amt||0) + Number(s.pb_mnp_amt||0) + Number(s.pb_other_amt||0);
        const total = cbp + ctop + sim + pb;
        
        // Find HQ Name
        const hqName = masterHQs.find(h => h.id === s.active_partners?.locations?.parent_master_id)?.center_name || "N/A";

        return [
          s.report_date,
          sanitizeCSV(s.active_partners?.locations?.state),
          sanitizeCSV(hqName),
          sanitizeCSV(s.active_partners?.locations?.center_name),
          sanitizeCSV(s.active_partners?.partner_name),
          cbp, ctop, sim, pb, total,
          s.is_edited_by_staff ? "Audited/Edited" : "Original"
        ];
      });
    } else if (type === 'deposits') {
      headers = ["Date", "Partner Name", "Method", "Ref No", "Amount (INR)", "Status"];
      csvData = filteredDeposits.map(d => [
        normalizeToYYYYMMDD(d.created_at), sanitizeCSV(d.active_partners?.partner_name), d.deposit_method, sanitizeCSV(d.reference_no),
        d.deposit_amount, d.status
      ]);
    } else if (type === 'compliance') {
      headers = ["Flagged Partner", "Center", "State", "Missing Sales (Period)", "Lifetime Pending Cash (INR)"];
      const defaulters = complianceMatrix.filter(p => p.isDefaulter);
      csvData = defaulters.map(p => [
        sanitizeCSV(p.partner_name), sanitizeCSV(p.locations?.center_name), sanitizeCSV(p.locations?.state),
        p.hasLoggedActivity ? "Logged" : "Missing", p.pendingBalance
      ]);
      if (defaulters.length === 0) return alert("No defaulters found to export.");
    }

    if (csvData.length === 0) return alert("No data available to export for current filters.");

    const csvContent = [headers.join(","), ...csvData.map(row => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.csv`;
    link.click();
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin"></div>
    </div>
  );

  if (allocatedLocations.length === 0) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="bg-white p-12 rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full text-center">
        <div className="text-6xl mb-6">🗺️</div>
        <h2 className="text-2xl font-black text-slate-900 mb-2">No Territory Allocated</h2>
        <p className="text-slate-500 font-medium mb-8">Your account is active, but the corporate office has not yet assigned any centers to your regional perimeter.</p>
        <button onClick={handleSignOut} className="bg-slate-900 text-white font-black px-6 py-3 rounded-lg w-full uppercase tracking-widest hover:bg-slate-800 transition shadow-md">
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 pb-6 gap-4">
          <div>
            <h1 className="text-4xl font-black text-slate-900 flex items-center gap-3">
              <span className="text-4xl">🔭</span> Field Supervisor Hub
            </h1>
            <p className="text-slate-500 mt-2 font-medium">
              Regional Command Desk for: <span className="font-black text-slate-800">{staffProfile?.name}</span>
            </p>
            <div className="mt-3 flex gap-2">
              <span className="text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1 rounded shadow-sm tracking-widest">
                {allocatedLocations.length} Centers Monitored
              </span>
              <span className="text-[10px] font-black uppercase bg-blue-100 text-blue-800 border border-blue-200 px-3 py-1 rounded shadow-sm tracking-widest">
                {regionalPartners.length} Permitted Partners
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={initializeSupervisorEngine} className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-black hover:bg-slate-50 shadow-sm transition text-xs uppercase tracking-widest">
              ↻ Refresh Data
            </button>
            <button onClick={handleSignOut} className="bg-slate-900 text-white px-5 py-2.5 rounded-lg font-black hover:bg-slate-800 shadow-sm transition text-xs uppercase tracking-widest">
              Sign Out
            </button>
          </div>
        </div>

        {/* CASCADING FILTER BAR (Controls All Tabs) */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex flex-wrap gap-2 w-full lg:w-auto">
            {['today', 'yesterday', 'week', 'month', 'all'].map(mode => (
              <button 
                key={mode} 
                onClick={() => setTimeFilter(mode)} 
                className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition ${timeFilter === mode ? 'bg-slate-900 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {mode === 'week' ? 'This Week' : mode === 'month' ? 'This Month' : mode}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">State Filter</label>
              <select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setHqFilter("ALL"); }} className="w-full sm:w-48 bg-slate-50 border border-slate-300 text-slate-800 font-bold text-xs rounded p-2 outline-none focus:border-slate-800">
                <option value="ALL">All States</option>
                {uniqueStates.map((st: string) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Master HQ Filter</label>
              <select value={hqFilter} onChange={e => setHqFilter(e.target.value)} className="w-full sm:w-48 bg-slate-50 border border-slate-300 text-slate-800 font-bold text-xs rounded p-2 outline-none focus:border-slate-800">
                <option value="ALL">All Master HQs</option>
                {masterHQs.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-px">
          <button onClick={() => setActiveTab('activity')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'activity' ? 'bg-white text-emerald-600 border-t-2 border-l border-r border-emerald-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>1. Daily Activity Audit</button>
          <button onClick={() => setActiveTab('sales')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'sales' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>2. Sales Reports</button>
          <button onClick={() => setActiveTab('deposits')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'deposits' ? 'bg-white text-blue-600 border-t-2 border-l border-r border-blue-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>3. Deposit Ledger</button>
          <button onClick={() => setActiveTab('compliance')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'compliance' ? 'bg-white text-red-600 border-t-2 border-l border-r border-red-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>4. Escalations</button>
        </div>

        {/* ========================================================== */}
        {/* MODULE 1: DAILY ACTIVITY AUDIT                             */}
        {/* ========================================================== */}
        {activeTab === 'activity' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center text-white gap-4">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm">Daily Activity Audit</h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">Cross-referencing submissions for selected period</p>
              </div>
              <button onClick={() => downloadCSV('activity')} className="bg-emerald-600 hover:bg-emerald-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm">
                📥 Export Activity Audit
              </button>
            </div>
            
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-4 font-black">Partner & Center</th>
                    <th className="p-4 font-black text-center border-l border-slate-200">Activity Status ({timeFilter})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {complianceMatrix.map(p => (
                    <tr key={p.id} className={`transition hover:bg-slate-50`}>
                      <td className="p-4">
                        <div className="flex items-start gap-3">
                           <p className="font-black text-slate-900 text-base">{p.partner_name}</p>
                           <span className="text-[9px] font-black uppercase text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded mt-0.5">{p.role}</span>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">📍 {p.locations?.center_name} ({p.locations?.state})</p>
                      </td>
                      <td className="p-4 text-center border-l border-slate-100">
                        {p.hasLoggedActivity ? (
                          <span className="bg-green-100 text-green-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-green-200 shadow-sm">✅ Active / Logged</span>
                        ) : (
                          <span className="bg-red-100 text-red-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-red-200 shadow-sm">❌ Missing Submission</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {complianceMatrix.length === 0 && <tr><td colSpan={2} className="p-12 text-center font-bold text-slate-400">No active partners found matching your filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* MODULE 2: REGIONAL SALES REPORTS (Deep Dive)               */}
        {/* ========================================================== */}
        {activeTab === 'sales' && (() => {
          const totalSalesGross = filteredSales.reduce((acc, s) => acc + Number(s.cbp_landline_amt||0) + Number(s.cbp_gsm_amt||0) + Number(s.ctop_recharge_amt||0) + Number(s.sim_replacement_amt||0) + Number(s.sim_fancy_amt||0) + Number(s.sim_postpaid_amt||0) + Number(s.other_amt||0) + Number(s.frc_amt||0) + Number(s.mnp_amt||0) + Number(s.pb_cbp_amt||0) + Number(s.pb_ctop_amt||0) + Number(s.pb_frc_amt||0) + Number(s.pb_mnp_amt||0) + Number(s.pb_other_amt||0), 0);
          
          return (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
              <div className="p-5 bg-slate-900 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center text-white gap-4">
                <div>
                  <h3 className="font-black tracking-widest uppercase text-sm text-indigo-400 flex items-center gap-2"><span>📈</span> Regional Sales Reports</h3>
                  <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">Detailed breakdown for {timeFilter}</p>
                </div>
                <div className="flex gap-4 items-center">
                  <div className="text-right border-r border-slate-700 pr-4">
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Total Sales</p>
                    <p className="font-black text-lg text-indigo-400">₹{totalSalesGross.toLocaleString('en-IN')}</p>
                  </div>
                  <button onClick={() => downloadCSV('sales')} className="bg-indigo-600 hover:bg-indigo-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm">
                    📥 Export Sales CSV
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 shadow-sm z-10">
                    <tr>
                      <th className="p-4 font-black">Date & Center</th>
                      <th className="p-4 font-black text-right border-l">BSNL CBP/CTOP</th>
                      <th className="p-4 font-black text-right">BSNL SIMs</th>
                      <th className="p-4 font-black text-right text-indigo-600 bg-indigo-50/30 border-l">Paybull Cash</th>
                      <th className="p-4 font-black text-right text-slate-800 bg-slate-100 border-l">Total Gross (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSales.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-400 font-bold">No sales logged in your perimeter.</td></tr> :
                    filteredSales.map(s => {
                      const cbpCtop = Number(s.cbp_landline_amt||0) + Number(s.cbp_gsm_amt||0) + Number(s.ctop_recharge_amt||0);
                      const simCash = Number(s.sim_replacement_amt||0) + Number(s.sim_fancy_amt||0) + Number(s.sim_postpaid_amt||0) + Number(s.other_amt||0) + Number(s.frc_amt||0) + Number(s.mnp_amt||0);
                      const pbCash = Number(s.pb_cbp_amt||0) + Number(s.pb_ctop_amt||0) + Number(s.pb_frc_amt||0) + Number(s.pb_mnp_amt||0) + Number(s.pb_other_amt||0);
                      const totalGross = cbpCtop + simCash + pbCash;
                      
                      return (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="p-4">
                            <p className="font-black text-slate-800">{s.report_date}</p>
                            <p className="font-bold text-slate-600 mt-1 truncate max-w-[200px]">{s.active_partners?.partner_name}</p>
                            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">📍 {s.active_partners?.locations?.center_name}</p>
                            {s.is_edited_by_staff && <span className="inline-block mt-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 text-[8px] font-black uppercase tracking-widest rounded">Audited / Edited</span>}
                          </td>
                          <td className="p-4 text-right font-medium border-l">₹{cbpCtop.toLocaleString('en-IN')}</td>
                          <td className="p-4 text-right font-medium">₹{simCash.toLocaleString('en-IN')}</td>
                          <td className="p-4 text-right font-black text-indigo-600 bg-indigo-50/10 border-l">₹{pbCash.toLocaleString('en-IN')}</td>
                          <td className="p-4 text-right font-black text-slate-800 bg-slate-50 border-l">₹{totalGross.toLocaleString('en-IN')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ========================================================== */}
        {/* MODULE 3: REGIONAL DEPOSITS LEDGER                         */}
        {/* ========================================================== */}
        {activeTab === 'deposits' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-slate-800 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm text-blue-400 flex items-center gap-2"><span>🏦</span> Regional Deposit Feed</h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">Bank Remittances & Proofs</p>
              </div>
              <button onClick={() => downloadCSV('deposits')} className="bg-blue-600 hover:bg-blue-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm">
                📥 Export Deposits CSV
              </button>
            </div>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 shadow-sm z-10">
                  <tr><th className="p-4">Date & Center</th><th className="p-4 text-right">Amount & Ref</th><th className="p-4 text-center">Status</th><th className="p-4 text-right">Bank Proof</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDeposits.length === 0 ? <tr><td colSpan={4} className="p-8 text-center text-slate-400 font-bold">No deposits logged in your perimeter.</td></tr> :
                  filteredDeposits.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="p-4">
                        <p className="font-black text-slate-800">{new Date(d.created_at).toLocaleDateString('en-IN')}</p>
                        <p className="font-bold text-slate-600 mt-1 truncate max-w-[200px]">{d.active_partners?.partner_name}</p>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">📍 {d.active_partners?.locations?.center_name}</p>
                      </td>
                      <td className="p-4 text-right">
                        <p className={`font-black text-lg ${d.status === 'Discrepancy' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>₹{Number(d.deposit_amount).toLocaleString('en-IN')}</p>
                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">{d.deposit_method} / {d.reference_no}</p>
                      </td>
                      <td className="p-4 text-center">
                         <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${
                           d.status === "Verified" ? "bg-green-100 text-green-700 border-green-200" : 
                           d.status === "Discrepancy" ? "bg-red-100 text-red-700 border-red-200" : 
                           "bg-amber-100 text-amber-700 border-amber-200"
                         }`}>
                           {d.status}
                         </span>
                      </td>
                      <td className="p-4 text-right">
                        {d.is_exempted ? (
                          <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest">⚠️ Exempted</span>
                        ) : d.deposit_slip_url ? (
                          <button 
                            onClick={() => handleViewSecureSlip(d)} 
                            disabled={viewingSlipId === d.id}
                            className="bg-slate-800 hover:bg-slate-700 text-white font-black px-3 py-1.5 rounded shadow-sm text-[9px] uppercase tracking-widest transition disabled:opacity-50"
                          >
                            {viewingSlipId === d.id ? "Decrypting..." : "📄 View Slip"}
                          </button>
                        ) : (
                          <span className="text-[9px] text-slate-400 uppercase font-bold">No Proof</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* MODULE 4: COMPLIANCE & ESCALATIONS                         */}
        {/* ========================================================== */}
        {activeTab === 'compliance' && (
          <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-red-500 flex flex-col md:flex-row justify-between items-start md:items-center text-white gap-4">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm text-red-400 flex items-center gap-2"><span>🚨</span> Regional Defaulter Matrix</h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 tracking-widest uppercase">Missing sales or exceeding lifetime cash limits</p>
              </div>
              <div className="flex gap-3 items-center">
                <span className="bg-red-950 text-red-400 font-black px-3 py-1.5 rounded text-[10px] uppercase tracking-widest border border-red-800">
                  {complianceMatrix.filter(p => p.isDefaulter).length} Flagged
                </span>
                <button onClick={() => downloadCSV('compliance')} className="bg-red-600 hover:bg-red-500 transition px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest shadow-sm">
                  📥 Export Defaulters
                </button>
              </div>
            </div>
            
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-red-50 text-[10px] uppercase tracking-widest text-red-800 border-b border-red-200 sticky top-0 shadow-sm z-10">
                  <tr>
                    <th className="p-4 font-black">Flagged Partner</th>
                    <th className="p-4 font-black text-center">Missing Sales (Period)</th>
                    <th className="p-4 font-black text-center">Lifetime Pending Cash</th>
                    <th className="p-4 font-black text-right">Field Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {complianceMatrix.filter(p => p.isDefaulter).length === 0 ? (
                    <tr><td colSpan={4} className="p-16 text-center text-slate-500 font-bold text-lg">🎉 Your territory is perfectly compliant. No defaulters.</td></tr>
                  ) : (
                    complianceMatrix.filter(p => p.isDefaulter).map(p => (
                      <tr key={p.id} className="hover:bg-red-50/30 transition">
                        <td className="p-4">
                          <div className="flex items-start gap-2">
                            <p className="font-black text-slate-900 text-base">{p.partner_name}</p>
                            <span className="text-[9px] font-black uppercase text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">{p.role}</span>
                          </div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">📍 {p.locations?.center_name}</p>
                        </td>
                        <td className="p-4 text-center">
                          {!p.hasLoggedActivity ? (
                            <span className="bg-red-100 text-red-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-red-200">❌ Missing</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Logged</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {p.pendingBalance > 1000 ? (
                            <div className="flex flex-col items-center">
                              <span className="text-red-600 font-black text-lg">₹{p.pendingBalance.toLocaleString('en-IN')}</span>
                              <span className="text-[9px] font-black text-red-500 uppercase tracking-widest mt-0.5">⚠️ Limit Breach</span>
                            </div>
                          ) : (
                            <span className="text-slate-800 font-black">₹{Math.max(0, p.pendingBalance).toLocaleString('en-IN')}</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => handleRegionalNudge(p, !p.hasLoggedActivity ? 'SALES' : 'CASH')}
                            disabled={isNudging === p.id}
                            className="bg-red-600 hover:bg-red-700 text-white font-black px-4 py-2 rounded text-[10px] uppercase tracking-widest shadow-md transition disabled:opacity-50 flex items-center gap-2 ml-auto"
                          >
                            {isNudging === p.id ? "Dispatching..." : "🔔 Send Regional Nudge"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}