"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// --- Date Normalizers (IST Safe) ---
const getLocalDateString = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  } 
  if (dateStr.includes('-')) {
    const dateOnly = dateStr.split('T')[0];
    const parts = dateOnly.split('-');
    if (parts[0].length === 4) return dateOnly; 
    if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return dateStr.split('T')[0];
};

const formatToDDMMYYYY = (dateStr: string) => {
  const yyyymmdd = normalizeToYYYYMMDD(dateStr);
  if (!yyyymmdd.includes('-')) return dateStr;
  const [y, m, d] = yyyymmdd.split('-');
  return `${d}/${m}/${y}`;
};

export default function StaffSalesVerification() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // Data States
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [filteredSales, setFilteredSales] = useState<any[]>([]);
  const [latestDeposits, setLatestDeposits] = useState<Record<string, any>>({});
  
  // Filter States (Upgraded with State & District)
  const [timeFilter, setTimeFilter] = useState("today"); 
  const [specificDateFilter, setSpecificDateFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("All");
  const [distFilter, setDistFilter] = useState("All");
  const [partnerFilter, setPartnerFilter] = useState("All");
  
  const [dropdowns, setDropdowns] = useState({ states: [] as string[], dists: [] as string[], partners: [] as string[] });

  // Audit / Edit Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingSale, setEditingSale] = useState<any>(null);
  
  // Correction Reason States
  const [correctionCategory, setCorrectionCategory] = useState("");
  const [otherCorrectionText, setOtherCorrectionText] = useState("");

  useEffect(() => {
    fetchAuditData();
  }, []);

  const fetchAuditData = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      // 1. Fetch Sales (Pulling last 90 days, now extracting 'state' along with 'dist')
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const { data: sales, error: salesError } = await supabase
        .from("daily_sales_reports")
        .select(`*, active_partners ( partner_name, locations (state, dist, center_name) )`)
        .gte("report_date", getLocalDateString(ninetyDaysAgo))
        .order("report_date", { ascending: false });

      if (salesError) throw salesError;

      // 2. Fetch Latest Deposits to cross-reference "Status of Deposit"
      const { data: deposits, error: depsError } = await supabase
        .from("partner_deposits")
        .select("partner_id, status, created_at, deposit_amount")
        .order("created_at", { ascending: false });

      if (depsError) throw depsError;

      // Map the most recent deposit for each partner
      const depMap: Record<string, any> = {};
      (deposits || []).forEach(d => {
        if (!depMap[d.partner_id]) {
          depMap[d.partner_id] = d;
        }
      });
      setLatestDeposits(depMap);

      const salesData = sales || [];
      setRawSales(salesData);

      // Extract unique geographical and partner data for dropdowns
      const stNames = new Set<string>();
      const dtNames = new Set<string>();
      const pNames = new Set<string>();
      
      salesData.forEach(s => {
        const l = s.active_partners?.locations;
        if (l?.state) stNames.add(l.state);
        if (l?.dist) dtNames.add(l.dist);
        if (s.active_partners?.partner_name) {
          pNames.add(`${s.active_partners.partner_name} (${l?.center_name})`);
        }
      });
      
      setDropdowns({ 
        states: Array.from(stNames).sort(),
        dists: Array.from(dtNames).sort(),
        partners: Array.from(pNames).sort() 
      });

      // Apply initial filters
      applyFilters("today", "", "All", "All", "All", salesData);

    } catch (err: any) {
      console.error("Fetch Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- UPGRADED FILTER ENGINE ---
  const applyFilters = (time: string, specDate: string, state: string, dist: string, partner: string, data = rawSales) => {
    let result = data;

    // 1. Apply Specific Date OR Time Range
    if (specDate) {
      const targetDate = normalizeToYYYYMMDD(specDate);
      result = result.filter(s => normalizeToYYYYMMDD(s.report_date) === targetDate);
      setTimeFilter("custom"); 
    } else {
      let startDate = new Date();
      let endDate = new Date();

      if (time === "today") {
        // Keep as today
      } else if (time === "yesterday") {
        startDate.setDate(startDate.getDate() - 1);
        endDate.setDate(endDate.getDate() - 1);
      } else if (time === "thisweek") {
        startDate.setDate(startDate.getDate() - startDate.getDay()); 
      } else if (time === "month") {
        startDate.setDate(1); 
      } else if (time === "all") {
        startDate = new Date("2000-01-01");
      }

      const startStr = getLocalDateString(startDate);
      const endStr = getLocalDateString(endDate);

      result = result.filter(s => {
        const d = normalizeToYYYYMMDD(s.report_date);
        return d >= startStr && d <= endStr;
      });
      setTimeFilter(time);
    }

    // 2. Apply Geo & Partner Filters
    if (state !== "All") {
      result = result.filter(s => s.active_partners?.locations?.state === state);
    }
    if (dist !== "All") {
      result = result.filter(s => s.active_partners?.locations?.dist === dist);
    }
    if (partner !== "All") {
      result = result.filter(s => `${s.active_partners?.partner_name} (${s.active_partners?.locations?.center_name})` === partner);
    }

    setFilteredSales(result);
  };

  // UI Handlers for Filters
  const handleTimeClick = (mode: string) => {
    setSpecificDateFilter(""); 
    applyFilters(mode, "", stateFilter, distFilter, partnerFilter, rawSales);
  };

  const handleSpecificDateChange = (val: string) => {
    setSpecificDateFilter(val);
    applyFilters("custom", val, stateFilter, distFilter, partnerFilter, rawSales);
  };

  const handleStateChange = (val: string) => {
    setStateFilter(val);
    applyFilters(timeFilter, specificDateFilter, val, distFilter, partnerFilter, rawSales);
  };

  const handleDistChange = (val: string) => {
    setDistFilter(val);
    applyFilters(timeFilter, specificDateFilter, stateFilter, val, partnerFilter, rawSales);
  };

  const handlePartnerChange = (val: string) => {
    setPartnerFilter(val);
    applyFilters(timeFilter, specificDateFilter, stateFilter, distFilter, val, rawSales);
  };

  // --- EDIT MODAL ENGINE ---
  const openEditModal = (sale: any) => {
    setEditingSale({ ...sale }); 
    setCorrectionCategory("");
    setOtherCorrectionText("");
    setIsEditModalOpen(true);
  };

  const handleEditInputChange = (field: string, value: string) => {
    const isQtyField = field.includes('qty');
    const num = isQtyField ? parseInt(value, 10) : parseFloat(value);
    setEditingSale((prev: any) => ({ ...prev, [field]: isNaN(num) || num < 0 ? 0 : num }));
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionCategory) return alert("You must select a Correction Reason from the dropdown.");
    if (correctionCategory === "Other" && otherCorrectionText.trim().length < 5) {
      return alert("You must provide detailed remarks for 'Other' corrections.");
    }

    if (!confirm("Are you sure you want to forcefully overwrite this partner's sales ledger? This action will be permanently logged.")) return;
    
    setIsSubmitting(true);
    try {
      // FIX: Replaced fragile getUser() network request with robust getSession() cache read
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      
      if (!user) throw new Error("Staff authentication failed. Session lost.");

      const finalRemarks = correctionCategory === "Other" 
        ? `OTHER: ${otherCorrectionText}` 
        : `CORRECTION: ${correctionCategory}`;

      const updatePayload = {
        cbp_landline_qty: editingSale.cbp_landline_qty,
        cbp_landline_amt: editingSale.cbp_landline_amt,
        cbp_gsm_qty: editingSale.cbp_gsm_qty,
        cbp_gsm_amt: editingSale.cbp_gsm_amt,
        ctop_recharge_qty: editingSale.ctop_recharge_qty,
        ctop_recharge_amt: editingSale.ctop_recharge_amt,
        sim_new_qty: editingSale.sim_new_qty,
        sim_upgrade_qty: editingSale.sim_upgrade_qty,
        sim_postpaid_qty: editingSale.sim_postpaid_qty,
        sim_postpaid_amt: editingSale.sim_postpaid_amt,
        sim_replacement_qty: editingSale.sim_replacement_qty,
        sim_replacement_amt: editingSale.sim_replacement_amt,
        sim_fancy_qty: editingSale.sim_fancy_qty,
        sim_fancy_amt: editingSale.sim_fancy_amt,
        cheque_qty: editingSale.cheque_qty,
        cheque_amt: editingSale.cheque_amt,
        other_amt: editingSale.other_amt,
        other_details: editingSale.other_details,
        is_edited_by_staff: true,
        staff_edit_remarks: finalRemarks,
        edited_at: new Date().toISOString(),
        edited_by: user.id,
        edit_request_status: null, 
        edit_request_reason: null
      };

      // 1. Update Core Database
      const { error } = await supabase.from("daily_sales_reports").update(updatePayload).eq("id", editingSale.id);
      if (error) throw error;

      // 2. Staff Telemetry Logging
      await supabase.from('staff_activity_logs').insert([{
        staff_id: user.id,
        staff_email: user.email,
        action_type: 'AUDIT',
        module: 'SALES',
        target_id: editingSale.id,
        details: `Overwrote sales report for ${editingSale.report_date}. Reason: ${finalRemarks}`
      }]);

      // 3. Dispatch UI Alert to Partner
      await supabase.from("partner_messages").insert([{
        partner_id: editingSale.partner_id,
        subject: `⚠️️ Financial Ledger Correction: ${editingSale.report_date}`,
        body: `Your sales report for ${editingSale.report_date} was audited and corrected by the Back-Office. Reason: ${finalRemarks}. Please check your updated ledger balance.`
      }]);

      alert("✅ Sales Ledger Successfully Overwritten.");
      setIsEditModalOpen(false);
      fetchAuditData(); 

    } catch (err: any) {
      alert("System Error: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePermitEdit = async (saleId: string, action: 'Approved' | 'Rejected') => {
    if (!confirm(`Are you sure you want to mark this request as ${action}?`)) return;
    try {
      const { error } = await supabase.from("daily_sales_reports").update({ edit_request_status: action }).eq("id", saleId);
      if (error) throw error;
      fetchAuditData();
    } catch (err: any) {
      alert("Error processing edit request: " + err.message);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin"></div>
    </div>
  );

  const numInputClass = "w-full border border-slate-300 p-2 text-sm rounded bg-white outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200 font-bold text-slate-800 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-6 gap-4">
          <div>
            <Link href="/dashboard" className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-block">
              &larr; Back to Admin Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span className="text-4xl">⚖️</span> Sales Audit & Correction
            </h1>
            <p className="text-slate-500 font-medium mt-1">Review raw partner sales data and strictly enforce ledger corrections.</p>
          </div>
        </div>

        {/* MASTER FILTER ENGINE (Upgraded) */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          
          {/* Row 1: Time & Date */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 flex bg-slate-100 rounded-lg p-1 overflow-x-auto border border-slate-200">
              {['today', 'yesterday', 'thisweek', 'month', 'all'].map(mode => (
                <button 
                  key={mode} 
                  onClick={() => handleTimeClick(mode)} 
                  className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-wider transition whitespace-nowrap flex-1 ${timeFilter === mode ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  {mode === 'thisweek' ? 'This Week' : mode}
                </button>
              ))}
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Specific Report Date</label>
              <input 
                type="date" 
                value={specificDateFilter}
                onChange={(e) => handleSpecificDateChange(e.target.value)}
                className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Row 2: Geo & Partner Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">State Filter</label>
              <select value={stateFilter} onChange={e => handleStateChange(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-amber-500">
                <option value="All">All States</option>
                {dropdowns.states.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">District Filter</label>
              <select value={distFilter} onChange={e => handleDistChange(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-amber-500">
                <option value="All">All Districts</option>
                {dropdowns.dists.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Center / Partner Filter</label>
              <select value={partnerFilter} onChange={e => handlePartnerChange(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-amber-500">
                <option value="All">All Partners</option>
                {dropdowns.partners.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          </div>

        </div>

        {/* SALES AUDIT GRID */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
            <h3 className="font-black tracking-widest uppercase text-xs">Sales Reports Ledger</h3>
            <span className="bg-slate-800 text-amber-400 font-black px-3 py-1 rounded text-[10px] uppercase tracking-widest border border-slate-700">
              {filteredSales.length} Records Found
            </span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-4 font-black">Report Date</th>
                  <th className="p-4 font-black">Geography & Partner</th>
                  <th className="p-4 font-black text-right">Total Sales Amt (₹)</th>
                  <th className="p-4 font-black text-center">Status of Deposit</th>
                  <th className="p-4 font-black text-center">Audit Status</th>
                  <th className="p-4 font-black text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-slate-400 font-bold">No sales records match the current filters.</td>
                  </tr>
                ) : (
                  filteredSales.map(sale => {
                    const totalCash = Number(sale.cbp_landline_amt || 0) + Number(sale.cbp_gsm_amt || 0) + Number(sale.ctop_recharge_amt || 0) + Number(sale.sim_replacement_amt || 0) + Number(sale.sim_fancy_amt || 0) + Number(sale.sim_postpaid_amt || 0) + Number(sale.other_amt || 0);
                    const lDep = latestDeposits[sale.partner_id];
                    const loc = sale.active_partners?.locations;

                    return (
                      <tr key={sale.id} className={`hover:bg-slate-50 transition ${sale.edit_request_status === 'Pending' ? 'bg-amber-50/30' : ''}`}>
                        
                        <td className="p-4">
                          <p className="font-black text-slate-900 text-lg">{formatToDDMMYYYY(sale.report_date)}</p>
                          {sale.zero_business_reason && (
                            <span className="text-[9px] bg-red-100 text-red-700 font-black uppercase tracking-widest px-2 py-0.5 rounded border border-red-200 mt-1 inline-block">
                              Zero Biz: {sale.zero_business_reason}
                            </span>
                          )}
                        </td>
                        
                        <td className="p-4">
                          <p className="font-black text-blue-700">{sale.active_partners?.partner_name}</p>
                          <p className="text-xs font-bold text-slate-500">{loc?.center_name}</p>
                          <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">{loc?.dist}, {loc?.state}</p>
                        </td>
                        
                        <td className="p-4 text-right">
                          <p className="text-xl font-black text-emerald-600">₹{totalCash.toLocaleString('en-IN')}</p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mt-0.5">Gross Revenue</p>
                        </td>

                        <td className="p-4 text-center">
                          {lDep ? (
                            <div className="flex flex-col items-center">
                              <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${
                                lDep.status === 'Verified' ? 'bg-green-100 text-green-700 border-green-200' : 
                                lDep.status === 'Discrepancy' ? 'bg-red-100 text-red-700 border-red-200' : 
                                'bg-amber-100 text-amber-700 border-amber-200'
                              }`}>
                                Latest: {lDep.status}
                              </span>
                              <p className="text-[9px] text-slate-400 font-bold mt-1">Vol: ₹{Number(lDep.deposit_amount).toLocaleString('en-IN')}</p>
                            </div>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 uppercase">No Deposits Yet</span>
                          )}
                        </td>

                        <td className="p-4 text-center">
                          {sale.edit_request_status === 'Pending' ? (
                            <div className="flex flex-col gap-1 items-center">
                              <span className="text-[10px] font-black uppercase bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-1 rounded shadow-sm animate-pulse">Partner Requests Edit</span>
                              <div className="flex gap-1 mt-1">
                                <button onClick={() => handlePermitEdit(sale.id, 'Approved')} className="bg-green-500 text-white text-[9px] font-black uppercase px-2 py-1 rounded shadow-sm hover:bg-green-600">Approve</button>
                                <button onClick={() => handlePermitEdit(sale.id, 'Rejected')} className="bg-red-500 text-white text-[9px] font-black uppercase px-2 py-1 rounded shadow-sm hover:bg-red-600">Deny</button>
                              </div>
                            </div>
                          ) : sale.is_edited_by_staff ? (
                            <span className="text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 border border-indigo-300 px-2 py-1 rounded shadow-sm">Overwritten by Admin</span>
                          ) : (
                            <span className="text-[10px] font-black uppercase text-slate-400">Original Data</span>
                          )}
                        </td>

                        <td className="p-4 text-right">
                          <button 
                            onClick={() => openEditModal(sale)}
                            className="bg-slate-900 hover:bg-amber-500 hover:text-slate-900 text-white font-black px-4 py-2 rounded-lg text-xs uppercase tracking-widest transition shadow-sm border border-slate-700 flex items-center gap-2 ml-auto"
                          >
                            <span>⚙️</span> Edit / Audit
                          </button>
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* 🔴 MASSIVE EDIT / AUDIT MODAL (GOD MODE) */}
      {isEditModalOpen && editingSale && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-slate-50 rounded-2xl shadow-2xl border border-slate-300 w-full max-w-5xl my-8 animate-in fade-in zoom-in-95">
            
            <div className="p-5 bg-slate-900 flex justify-between items-center text-white rounded-t-2xl border-b-4 border-amber-500">
              <div>
                <h3 className="font-black text-xl flex items-center gap-2"><span>⚠️</span> Force Correction: {editingSale.active_partners?.partner_name}</h3>
                <p className="text-slate-400 text-xs font-bold tracking-widest uppercase mt-1">Target Ledger Date: {formatToDDMMYYYY(editingSale.report_date)}</p>
              </div>
              <button onClick={() => setIsEditModalOpen(false)} className="hover:text-amber-500 text-3xl font-black transition">&times;</button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 md:p-8 space-y-6">
              
              <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r shadow-sm">
                <p className="text-sm font-black text-amber-900">WARNING: You are about to permanently alter a franchise's daily ledger.</p>
                <p className="text-xs font-bold text-amber-700 mt-1">This action cannot be undone. An alert will be dispatched to the partner immediately.</p>
              </div>

              {/* DYNAMIC TOTALS HEADER */}
              <div className="bg-white p-4 rounded-xl border-2 border-slate-200 shadow-sm flex flex-wrap gap-4 justify-between items-center">
                <h4 className="font-black text-slate-800 text-sm uppercase tracking-widest">Live Audit Totals:</h4>
                <div className="flex gap-4">
                  <div className="text-center bg-slate-50 p-2 rounded border border-slate-200 min-w-[100px]">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">CBP / CTOP</p>
                    <p className="font-black text-lg text-slate-800">₹{(Number(editingSale.cbp_landline_amt)+Number(editingSale.cbp_gsm_amt)+Number(editingSale.ctop_recharge_amt)).toLocaleString()}</p>
                  </div>
                  <div className="text-center bg-slate-50 p-2 rounded border border-slate-200 min-w-[100px]">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">SIM / Other</p>
                    <p className="font-black text-lg text-slate-800">₹{(Number(editingSale.sim_replacement_amt)+Number(editingSale.sim_fancy_amt)+Number(editingSale.sim_postpaid_amt)+Number(editingSale.other_amt)).toLocaleString()}</p>
                  </div>
                  <div className="text-center bg-emerald-50 border border-emerald-200 p-2 rounded min-w-[120px]">
                    <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Total Gross</p>
                    <p className="font-black text-xl text-emerald-700">₹{(Number(editingSale.cbp_landline_amt)+Number(editingSale.cbp_gsm_amt)+Number(editingSale.ctop_recharge_amt)+Number(editingSale.sim_replacement_amt)+Number(editingSale.sim_fancy_amt)+Number(editingSale.sim_postpaid_amt)+Number(editingSale.other_amt)).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* CBP Block */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-black text-xs text-slate-500 uppercase tracking-widest border-b pb-2 mb-4">1. CBP Sales</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[10px] font-bold text-slate-500">LL Qty</label><input type="number" value={editingSale.cbp_landline_qty} onChange={e => handleEditInputChange('cbp_landline_qty', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">LL ₹</label><input type="number" step="0.01" value={editingSale.cbp_landline_amt} onChange={e => handleEditInputChange('cbp_landline_amt', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">GSM Qty</label><input type="number" value={editingSale.cbp_gsm_qty} onChange={e => handleEditInputChange('cbp_gsm_qty', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">GSM ₹</label><input type="number" step="0.01" value={editingSale.cbp_gsm_amt} onChange={e => handleEditInputChange('cbp_gsm_amt', e.target.value)} className={numInputClass} /></div>
                  </div>
                </div>

                {/* CTOP Block */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-black text-xs text-slate-500 uppercase tracking-widest border-b pb-2 mb-4">2. CTOP Balances</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[10px] font-bold text-slate-500">CTOP Qty</label><input type="number" value={editingSale.ctop_recharge_qty} onChange={e => handleEditInputChange('ctop_recharge_qty', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">CTOP ₹</label><input type="number" step="0.01" value={editingSale.ctop_recharge_amt} onChange={e => handleEditInputChange('ctop_recharge_amt', e.target.value)} className={`${numInputClass} bg-blue-50`} /></div>
                  </div>
                </div>

                {/* SIM Block */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
                  <h4 className="font-black text-xs text-slate-500 uppercase tracking-widest border-b pb-2 mb-4">3. SIM Activations & Upgrades</h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div><label className="text-[10px] font-bold text-slate-500">New Qty</label><input type="number" value={editingSale.sim_new_qty} onChange={e => handleEditInputChange('sim_new_qty', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Upgrd Qty</label><input type="number" value={editingSale.sim_upgrade_qty} onChange={e => handleEditInputChange('sim_upgrade_qty', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Postpd Qty</label><input type="number" value={editingSale.sim_postpaid_qty} onChange={e => handleEditInputChange('sim_postpaid_qty', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Replc Qty</label><input type="number" value={editingSale.sim_replacement_qty} onChange={e => handleEditInputChange('sim_replacement_qty', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Fancy Qty</label><input type="number" value={editingSale.sim_fancy_qty} onChange={e => handleEditInputChange('sim_fancy_qty', e.target.value)} className={numInputClass} /></div>
                    
                    <div className="md:col-start-3"><label className="text-[10px] font-bold text-slate-500">Postpd ₹</label><input type="number" step="0.01" value={editingSale.sim_postpaid_amt} onChange={e => handleEditInputChange('sim_postpaid_amt', e.target.value)} className={`${numInputClass} bg-purple-50`} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Replc ₹</label><input type="number" step="0.01" value={editingSale.sim_replacement_amt} onChange={e => handleEditInputChange('sim_replacement_amt', e.target.value)} className={`${numInputClass} bg-purple-50`} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Fancy ₹</label><input type="number" step="0.01" value={editingSale.sim_fancy_amt} onChange={e => handleEditInputChange('sim_fancy_amt', e.target.value)} className={`${numInputClass} bg-purple-50`} /></div>
                  </div>
                </div>

                {/* Other / Cheque */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
                  <h4 className="font-black text-xs text-slate-500 uppercase tracking-widest border-b pb-2 mb-4">4. Adjustments & Cheques</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div><label className="text-[10px] font-bold text-slate-500">Cheque Qty</label><input type="number" value={editingSale.cheque_qty} onChange={e => handleEditInputChange('cheque_qty', e.target.value)} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Cheque ₹</label><input type="number" step="0.01" value={editingSale.cheque_amt} onChange={e => handleEditInputChange('cheque_amt', e.target.value)} className={`${numInputClass} bg-amber-50`} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Other Text</label><input type="text" value={editingSale.other_details || ''} onChange={e => setEditingSale({...editingSale, other_details: e.target.value})} className={numInputClass} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500">Other ₹</label><input type="number" step="0.01" value={editingSale.other_amt} onChange={e => handleEditInputChange('other_amt', e.target.value)} className={`${numInputClass} bg-emerald-50`} /></div>
                  </div>
                </div>

              </div>

              {/* STRICT COMPLIANCE SUBMISSION BLOCK */}
              <div className="bg-slate-900 p-6 rounded-xl shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                  <label className="text-[10px] text-amber-500 font-black uppercase tracking-widest block mb-2">Correction Reason Dropdown *</label>
                  <select 
                    required 
                    value={correctionCategory} 
                    onChange={e => { setCorrectionCategory(e.target.value); setOtherCorrectionText(""); }}
                    className="w-full bg-slate-800 border-2 border-slate-600 text-white font-bold text-sm rounded-lg p-3 outline-none focus:border-amber-500"
                  >
                    <option value="" disabled>-- Select Strict Reason Code --</option>
                    <option value="CBP correction">CBP correction</option>
                    <option value="Ctop correction">Ctop correction</option>
                    <option value="sim sales Correction">sim sales Correction</option>
                    <option value="cheque correction">cheque correction</option>
                    <option value="All above">All above</option>
                    <option value="Other">Other (Specify Below)</option>
                  </select>
                </div>
                
                {correctionCategory === "Other" && (
                  <div className="flex-1 w-full animate-in fade-in slide-in-from-top-2">
                    <label className="text-[10px] text-amber-500 font-black uppercase tracking-widest block mb-2">Manual Reason (Min 5 Chars) *</label>
                    <input 
                      required 
                      type="text" 
                      placeholder="TYPE DETAILED REASON HERE..."
                      value={otherCorrectionText} 
                      onChange={e => setOtherCorrectionText(e.target.value.toUpperCase())} // Forces Uppercase instantly
                      className="w-full bg-slate-800 border-2 border-amber-600 text-white font-black uppercase tracking-wider text-sm rounded-lg p-3 outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                )}

                <div className="flex gap-2 w-full md:w-auto mt-4 md:mt-0">
                  <button 
                    type="button" 
                    onClick={() => setIsEditModalOpen(false)} 
                    className="bg-slate-700 hover:bg-slate-600 text-white font-black px-6 py-3.5 rounded-lg shadow-md transition uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSubmitting} 
                    className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-black px-8 py-3.5 rounded-lg shadow-md transition disabled:opacity-50 tracking-widest uppercase"
                  >
                    {isSubmitting ? "Overwriting..." : "Apply Overwrite"}
                  </button>
                </div>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}