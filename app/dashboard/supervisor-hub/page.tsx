"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// --- Time & Date Engines (IST Safe) ---
const getISTDate = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes('T')) return dateStr.split('T')[0];
  return dateStr;
};

export default function SupervisorHub() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [staffProfile, setStaffProfile] = useState<any>(null);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'rollcall' | 'ledger' | 'compliance'>('rollcall');
  const [secureImageUrl, setSecureImageUrl] = useState<string | null>(null);
  const [viewingSlipId, setViewingSlipId] = useState<string | null>(null);

  // Architecture & Isolated Data State
  const [allocatedLocations, setAllocatedLocations] = useState<any[]>([]);
  const [regionalPartners, setRegionalPartners] = useState<any[]>([]);
  const [regionalSales, setRegionalSales] = useState<any[]>([]);
  const [regionalDeposits, setRegionalDeposits] = useState<any[]>([]);

  // Action State
  const [isNudging, setIsNudging] = useState<string | null>(null);

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
        .select('location_id')
        .eq('supervisor_id', staff.id);

      if (!allocations || allocations.length === 0) {
        setLoading(false);
        return; // UI will render "No Centers Allocated" empty state
      }

      const allowedLocIds = allocations.map(a => a.location_id);

      // 3. PULL ISOLATED DATASTREAMS (Strict Row-Level Isolation)
      const [locsRes, partnersRes, salesRes, depositsRes] = await Promise.all([
        supabase.from('locations').select('*').in('id', allowedLocIds),
        supabase.from('active_partners').select('*, locations(center_name)').in('center_id', allowedLocIds),
        supabase.from('daily_sales_reports').select('*, active_partners(partner_name)').in('location_id', allowedLocIds).order('report_date', { ascending: false }),
        supabase.from('partner_deposits').select('*, active_partners(partner_name)').in('center_id', allowedLocIds).order('created_at', { ascending: false })
      ]);

      setAllocatedLocations(locsRes.data || []);
      setRegionalPartners(partnersRes.data || []);
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
        .createSignedUrl(deposit.deposit_slip_url, 60); // 60-second read-only token
      
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

  // --- COMPUTED DATA ENGINES ---
  const todayStr = getISTDate(0);
  const yesterdayStr = getISTDate(-1);

  // Compliance Matrix Engine
  const complianceMatrix = regionalPartners.map(p => {
    const pSales = regionalSales.filter(s => s.partner_id === p.id);
    const pDeposits = regionalDeposits.filter(d => d.partner_id === p.id && d.status !== 'Discrepancy');

    const loggedToday = pSales.some(s => normalizeToYYYYMMDD(s.report_date) === todayStr);
    const loggedYesterday = pSales.some(s => normalizeToYYYYMMDD(s.report_date) === yesterdayStr);

    let lifetimeCash = 0;
    pSales.forEach(s => {
      lifetimeCash += (Number(s.cbp_landline_amt||0) + Number(s.cbp_gsm_amt||0) + Number(s.ctop_recharge_amt||0) + Number(s.sim_replacement_amt||0) + Number(s.sim_fancy_amt||0) + Number(s.sim_postpaid_amt||0) + Number(s.other_amt||0));
    });
    
    let lifetimeDep = 0;
    pDeposits.forEach(d => { lifetimeDep += Number(d.deposit_amount || 0); });

    const pendingBalance = lifetimeCash - lifetimeDep;

    return {
      ...p,
      loggedToday,
      loggedYesterday,
      pendingBalance,
      isDefaulter: pendingBalance > 1000 || !loggedYesterday
    };
  });

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
                {regionalPartners.length} Active Partners
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

        {/* TAB NAVIGATION */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-px">
          <button onClick={() => setActiveTab('rollcall')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'rollcall' ? 'bg-white text-emerald-600 border-t-2 border-l border-r border-emerald-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>1. Daily Roll Call</button>
          <button onClick={() => setActiveTab('ledger')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'ledger' ? 'bg-white text-blue-600 border-t-2 border-l border-r border-blue-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>2. Regional Ledger</button>
          <button onClick={() => setActiveTab('compliance')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'compliance' ? 'bg-white text-red-600 border-t-2 border-l border-r border-red-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>3. Escalations</button>
        </div>

        {/* ========================================================== */}
        {/* MODULE 1: THE DAILY ROLL CALL                              */}
        {/* ========================================================== */}
        {activeTab === 'rollcall' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm">Franchise Roll Call</h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1">Cross-referencing live submissions for {todayStr}</p>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-4 font-black">Partner & Center</th>
                    <th className="p-4 font-black text-center border-l border-slate-200">Yesterday ({yesterdayStr})</th>
                    <th className="p-4 font-black text-center border-l border-slate-200">Today ({todayStr})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {complianceMatrix.map(p => (
                    <tr key={p.id} className={`transition ${p.isDefaulter ? 'bg-red-50/20' : 'hover:bg-slate-50'}`}>
                      <td className="p-4">
                        <p className="font-black text-slate-900 text-base">{p.partner_name}</p>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">📍 {p.locations?.center_name}</p>
                      </td>
                      <td className="p-4 text-center border-l border-slate-100">
                        {p.loggedYesterday ? (
                          <span className="bg-green-100 text-green-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-green-200 shadow-sm">✅ Submitted</span>
                        ) : (
                          <span className="bg-red-100 text-red-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-red-200 shadow-sm">❌ Missing</span>
                        )}
                      </td>
                      <td className="p-4 text-center border-l border-slate-100">
                        {p.loggedToday ? (
                          <span className="bg-green-100 text-green-700 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-green-200 shadow-sm">✅ Early Submission</span>
                        ) : (
                          <span className="bg-amber-50 text-amber-600 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-amber-200 shadow-sm">⏳ Expected Today</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {complianceMatrix.length === 0 && <tr><td colSpan={3} className="p-12 text-center font-bold text-slate-400">No active partners found in your allocated territory.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* MODULE 2: REGIONAL LEDGER & PROOFS (Strictly Read-Only)    */}
        {/* ========================================================== */}
        {activeTab === 'ledger' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 animate-in fade-in">
            {/* Sales Ledger */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
              <div className="p-4 bg-slate-900 border-b border-slate-800 text-white">
                <h3 className="font-black tracking-widest uppercase text-sm text-blue-400 flex items-center gap-2"><span>📊</span> Regional Sales Feed</h3>
              </div>
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 shadow-sm z-10">
                    <tr><th className="p-4">Date & Center</th><th className="p-4 text-right">Total Gross</th><th className="p-4 text-right">CBP/CTOP</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {regionalSales.length === 0 ? <tr><td colSpan={3} className="p-8 text-center text-slate-400 font-bold">No sales logged in your perimeter.</td></tr> :
                    regionalSales.map(s => {
                      const totalCbpCtop = Number(s.cbp_landline_amt||0) + Number(s.cbp_gsm_amt||0) + Number(s.ctop_recharge_amt||0);
                      const totalGross = totalCbpCtop + Number(s.sim_replacement_amt||0) + Number(s.sim_fancy_amt||0) + Number(s.sim_postpaid_amt||0) + Number(s.other_amt||0);
                      return (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="p-4"><p className="font-black text-slate-800">{s.report_date}</p><p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mt-1 truncate max-w-[150px]">{s.active_partners?.partner_name}</p></td>
                          <td className="p-4 text-right font-black text-blue-700">₹{totalGross.toLocaleString('en-IN')}</td>
                          <td className="p-4 text-right font-bold text-slate-600">₹{totalCbpCtop.toLocaleString('en-IN')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Deposits Ledger */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
              <div className="p-4 bg-slate-900 border-b border-slate-800 text-white">
                <h3 className="font-black tracking-widest uppercase text-sm text-emerald-400 flex items-center gap-2"><span>🏦</span> Regional Deposit Feed</h3>
              </div>
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 shadow-sm z-10">
                    <tr><th className="p-4">Date & Center</th><th className="p-4 text-right">Amount & Ref</th><th className="p-4 text-right">Bank Proof</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {regionalDeposits.length === 0 ? <tr><td colSpan={3} className="p-8 text-center text-slate-400 font-bold">No deposits logged in your perimeter.</td></tr> :
                    regionalDeposits.map(d => (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="p-4">
                          <p className="font-black text-slate-800">{new Date(d.created_at).toLocaleDateString('en-IN')}</p>
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mt-1 truncate max-w-[150px]">{d.active_partners?.partner_name}</p>
                        </td>
                        <td className="p-4 text-right">
                          <p className={`font-black text-lg ${d.status === 'Discrepancy' ? 'text-slate-400 line-through' : 'text-emerald-700'}`}>₹{Number(d.deposit_amount).toLocaleString('en-IN')}</p>
                          <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">{d.deposit_method} / {d.reference_no}</p>
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
          </div>
        )}

        {/* ========================================================== */}
        {/* MODULE 3: COMPLIANCE & ESCALATIONS                         */}
        {/* ========================================================== */}
        {activeTab === 'compliance' && (
          <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden animate-in fade-in">
            <div className="p-5 bg-slate-900 border-b border-red-500 flex justify-between items-center text-white">
              <div>
                <h3 className="font-black tracking-widest uppercase text-sm text-red-400 flex items-center gap-2"><span>🚨</span> Regional Defaulter Matrix</h3>
                <p className="text-[10px] text-slate-400 font-bold mt-1 tracking-widest">Partners missing sales logs or exceeding cash limits</p>
              </div>
              <span className="bg-red-950 text-red-400 font-black px-3 py-1 rounded text-[10px] uppercase tracking-widest border border-red-800">
                {complianceMatrix.filter(p => p.isDefaulter).length} Flagged
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-red-50 text-[10px] uppercase tracking-widest text-red-800 border-b border-red-200">
                  <tr>
                    <th className="p-4 font-black">Flagged Partner</th>
                    <th className="p-4 font-black text-center">Missing Sales (Yest)</th>
                    <th className="p-4 font-black text-center">Pending Cash Holding</th>
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
                          <p className="font-black text-slate-900 text-base">{p.partner_name}</p>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">📍 {p.locations?.center_name}</p>
                        </td>
                        <td className="p-4 text-center">
                          {!p.loggedYesterday ? (
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
                            onClick={() => handleRegionalNudge(p, !p.loggedYesterday ? 'SALES' : 'CASH')}
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