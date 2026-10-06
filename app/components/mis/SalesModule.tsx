"use client";
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

const calculateTotalSalesCash = (s: any) => {
  return Number(s.cbp_landline_cash||0) + Number(s.cbp_gsm_cash||0) + Number(s.ctop_recharge_cash||0) + 
         Number(s.sim_postpaid_amt||0) + Number(s.sim_replace_cash||0) + Number(s.sim_fancy_cash||0) + Number(s.sim_other_cash||0);
};

const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function SalesModule({ 
  hqLocations, uniqueStates, entryFilteredFranchises, allLocations,
  agentMappings, rawSales, fetchArchitectureAndReports,
  reportingMonth, setReportingMonth, entryMasterLocId, setEntryMasterLocId, selectedChildLocKey, setSelectedChildLocKey
}: any) {
  const [salesMode, setSalesMode] = useState<'entry' | 'ledger'>('entry');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingSalesId, setEditingSalesId] = useState<string | null>(null);
  const [confirmSalesLock, setConfirmSalesLock] = useState(false);
  const [salesEditRemarks, setSalesEditRemarks] = useState("");

  const [ocscSales, setOcscSales] = useState({
    cbp_landline_qty: "", cbp_landline_cash: "", cbp_gsm_qty: "", cbp_gsm_cash: "", 
    ctop_recharge_qty: "", ctop_recharge_cash: "", sim_new_qty: "", sim_upgrade_qty: "", 
    sim_postpaid_qty: "", sim_postpaid_amt: "", sim_replace_qty: "", sim_replace_cash: "", 
    sim_fancy_qty: "", sim_fancy_cash: "", sim_other_qty: "", sim_other_cash: "",
  });
  const [cmSales, setCmSales] = useState<{agent_ctop_no: string, qty: string}[]>([]);

  const [salesStateFilter, setSalesStateFilter] = useState("ALL");
  const [salesHqFilter, setSalesHqFilter] = useState("ALL");
  const [salesChildLocFilter, setSalesChildLocFilter] = useState("ALL");
  const [salesMonthFilter, setSalesMonthFilter] = useState(new Date().toISOString().substring(0, 7));

  useEffect(() => {
    const loadCmSales = async () => {
      if (selectedChildLocKey && selectedChildLocKey.includes('-CM')) {
        const locIdInt = parseInt(selectedChildLocKey.split('-')[0]); 
        const filteredAgents = agentMappings.filter((a: any) => a.active_partners?.locations?.id === locIdInt);
        
        let existingChildSales: any[] = [];
        if (editingSalesId) {
           const { data } = await supabase.from('mis_cm_agent_sales').select('*').eq('monthly_sales_id', editingSalesId);
           existingChildSales = data || [];
        }
        
        setCmSales(filteredAgents.map((a: any) => {
          const existing = existingChildSales.find((e: any) => e.agent_ctop_no === a.agent_ctop_no);
          return { agent_ctop_no: a.agent_ctop_no, qty: existing ? existing.qty.toString() : "" };
        }));
      } else {
        setCmSales([]);
      }
    };
    loadCmSales();
  }, [selectedChildLocKey, agentMappings, editingSalesId]);

  const getActiveLocationType = () => {
    if (!selectedChildLocKey) return null;
    return selectedChildLocKey.split('-')[1]; 
  };

  const preventNegativeScroll = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') e.preventDefault();
  };
  
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handleSalesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChildLocKey || !reportingMonth) return alert("Select child center and month.");
    if (!confirmSalesLock) return alert("You must check the confirmation box to proceed.");
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const centerType = getActiveLocationType();
      const dbReportingMonth = `${reportingMonth}-01`;

      const cleanOcscSales = {
        cbp_landline_qty: parseInt(ocscSales.cbp_landline_qty) || 0,
        cbp_landline_cash: parseFloat(ocscSales.cbp_landline_cash) || 0,
        cbp_gsm_qty: parseInt(ocscSales.cbp_gsm_qty) || 0,
        cbp_gsm_cash: parseFloat(ocscSales.cbp_gsm_cash) || 0,
        ctop_recharge_qty: parseInt(ocscSales.ctop_recharge_qty) || 0,
        ctop_recharge_cash: parseFloat(ocscSales.ctop_recharge_cash) || 0,
        sim_new_qty: parseInt(ocscSales.sim_new_qty) || 0,
        sim_upgrade_qty: parseInt(ocscSales.sim_upgrade_qty) || 0,
        sim_postpaid_qty: parseInt(ocscSales.sim_postpaid_qty) || 0,
        sim_postpaid_amt: parseFloat(ocscSales.sim_postpaid_amt) || 0,
        sim_replace_qty: parseInt(ocscSales.sim_replace_qty) || 0,
        sim_replace_cash: parseFloat(ocscSales.sim_replace_cash) || 0,
        sim_fancy_qty: parseInt(ocscSales.sim_fancy_qty) || 0,
        sim_fancy_cash: parseFloat(ocscSales.sim_fancy_cash) || 0,
        sim_other_qty: parseInt(ocscSales.sim_other_qty) || 0,
        sim_other_cash: parseFloat(ocscSales.sim_other_cash) || 0,
      };

      const basePayload = {
        reporting_month: dbReportingMonth,
        location_id: parseInt(selectedChildLocKey.split('-')[0]), 
        center_type: centerType,
        logged_by: user.id,
        ...(centerType === 'OCSC' ? cleanOcscSales : {}) 
      };

      if (editingSalesId) {
        if (!salesEditRemarks || salesEditRemarks.trim().length < 5) {
          setIsSubmitting(false);
          return alert("Audit log remarks are mandatory for modifying a locked sales ledger.");
        }

        const updatePayload = {
          ...basePayload,
          is_edited_by_staff: true,
          staff_edit_remarks: salesEditRemarks
        };

        const { error: updateError } = await supabase.from('mis_monthly_sales').update(updatePayload).eq('id', editingSalesId);
        if (updateError) throw updateError;

        if (centerType === 'CM' && cmSales.length > 0) {
          await supabase.from('mis_cm_agent_sales').delete().eq('monthly_sales_id', editingSalesId);
          const childPayloads = cmSales.map(agent => ({
            monthly_sales_id: editingSalesId,
            agent_ctop_no: agent.agent_ctop_no,
            qty: parseFloat(agent.qty) || 0 
          })).filter(payload => payload.qty > 0); 

          if (childPayloads.length > 0) {
            const { error: childError } = await supabase.from('mis_cm_agent_sales').insert(childPayloads);
            if (childError) throw childError;
          }
        }

        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id, staff_email: user.email, action_type: 'MIS_EDIT', module: 'MANAGER_MIS',
          target_id: editingSalesId, details: `Modified Sales Ledger for ${centerType}. Remarks: ${salesEditRemarks}`
        }]);

        alert(`✅ Center Sales successfully updated & audited.`);
      } else {
        const { data: parentRecord, error: parentError } = await supabase.from('mis_monthly_sales').insert([basePayload]).select().single();
        if (parentError) throw parentError;

        if (centerType === 'CM' && cmSales.length > 0) {
          const childPayloads = cmSales.map(agent => ({
            monthly_sales_id: parentRecord.id,
            agent_ctop_no: agent.agent_ctop_no,
            qty: parseFloat(agent.qty) || 0 
          })).filter(payload => payload.qty > 0); 

          if (childPayloads.length > 0) {
            const { error: childError } = await supabase.from('mis_cm_agent_sales').insert(childPayloads);
            if (childError) throw childError;
          }
        }

        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id, staff_email: user.email, action_type: 'MIS_CLOSURE', module: 'MANAGER_MIS',
          target_id: parentRecord.id, details: `Locked Center Sales for ${centerType} location. Month: ${reportingMonth}`
        }]);

        alert(`✅ Center Sales for ${reportingMonth} successfully locked.`);
      }

      setEditingSalesId(null);
      setConfirmSalesLock(false);
      setSalesEditRemarks("");
      setSalesMode('ledger');
      fetchArchitectureAndReports(); 
    } catch (err: any) {
      if (err.message.includes('unique constraint')) alert("❌ Blocked: Sales for this Center Type and Month are already locked.");
      else alert("Error saving sales: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSales = (sale: any) => {
    setEditingSalesId(sale.id);
    setReportingMonth(sale.reporting_month.substring(0, 7));
    setEntryMasterLocId(sale.locations?.parent_master_id?.toString() || "");
    setSelectedChildLocKey(`${sale.location_id}-${sale.center_type}`);
    setConfirmSalesLock(false);
    setSalesEditRemarks("");
    setSalesMode('entry');
    
    if (sale.center_type === 'OCSC') {
      setOcscSales({
        cbp_landline_qty: sale.cbp_landline_qty?.toString() || "",
        cbp_landline_cash: sale.cbp_landline_cash?.toString() || "",
        cbp_gsm_qty: sale.cbp_gsm_qty?.toString() || "",
        cbp_gsm_cash: sale.cbp_gsm_cash?.toString() || "",
        ctop_recharge_qty: sale.ctop_recharge_qty?.toString() || "",
        ctop_recharge_cash: sale.ctop_recharge_cash?.toString() || "",
        sim_new_qty: sale.sim_new_qty?.toString() || "",
        sim_upgrade_qty: sale.sim_upgrade_qty?.toString() || "",
        sim_postpaid_qty: sale.sim_postpaid_qty?.toString() || "",
        sim_postpaid_amt: sale.sim_postpaid_amt?.toString() || "",
        sim_replace_qty: sale.sim_replace_qty?.toString() || "",
        sim_replace_cash: sale.sim_replace_cash?.toString() || "",
        sim_fancy_qty: sale.sim_fancy_qty?.toString() || "",
        sim_fancy_cash: sale.sim_fancy_cash?.toString() || "",
        sim_other_qty: sale.sim_other_qty?.toString() || "",
        sim_other_cash: sale.sim_other_cash?.toString() || "",
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelSalesEdit = () => {
    setEditingSalesId(null);
    setConfirmSalesLock(false);
    setSalesEditRemarks("");
    setSelectedChildLocKey("");
  };

  const filteredSalesLedger = rawSales.filter((s: any) => {
    let mMatch = salesMonthFilter === "ALL" || s.reporting_month === `${salesMonthFilter}-01`;
    let sMatch = salesStateFilter === "ALL" || s.locations?.state === salesStateFilter;
    let hMatch = salesHqFilter === "ALL" || s.locations?.parent_master_id?.toString() === salesHqFilter;
    let cMatch = salesChildLocFilter === "ALL" || s.location_id?.toString() === salesChildLocFilter;
    return mMatch && sMatch && hMatch && cMatch;
  });

  const cumSalesLedgerCash = filteredSalesLedger.reduce((sum: number, s: any) => sum + calculateTotalSalesCash(s), 0);

  const currentMonthSalesContext = rawSales.filter((s: any) => s.reporting_month === `${reportingMonth}-01` && (entryMasterLocId === "" || s.locations?.parent_master_id?.toString() === entryMasterLocId));
  const cumulativeSalesCash = currentMonthSalesContext.reduce((sum: number, s: any) => sum + calculateTotalSalesCash(s), 0);
  const cumulativeCBPCash = currentMonthSalesContext.reduce((sum: number, s: any) => sum + Number(s.cbp_landline_cash||0) + Number(s.cbp_gsm_cash||0), 0);
  const cumulativeCTOPCash = currentMonthSalesContext.reduce((sum: number, s: any) => sum + Number(s.ctop_recharge_cash||0), 0);
  const cumulativeSIMCash = currentMonthSalesContext.reduce((sum: number, s: any) => sum + Number(s.sim_postpaid_amt||0) + Number(s.sim_replace_cash||0) + Number(s.sim_fancy_cash||0) + Number(s.sim_other_cash||0), 0);

  const downloadCSV = () => {
    if (filteredSalesLedger.length === 0) return alert("No data available to export.");
    const csvContent = "Month,State,Location,Type,CBP_Landline_Qty,CBP_Landline_Cash,CBP_GSM_Qty,CBP_GSM_Cash,CTOP_Qty,CTOP_Cash,SIM_New_Qty,SIM_Upgrade_Qty,SIM_Postpaid_Qty,SIM_Postpaid_Cash,SIM_Replace_Qty,SIM_Replace_Cash,SIM_Fancy_Qty,SIM_Fancy_Cash,SIM_Other_Qty,SIM_Other_Cash,Total_Cash,Edited,Audit_Remarks\n" + 
      filteredSalesLedger.map((r: any) => 
      `${r.reporting_month},${sanitizeCSV(r.locations?.state)},${sanitizeCSV(r.locations?.center_name)},${r.center_type},${r.cbp_landline_qty||0},${r.cbp_landline_cash||0},${r.cbp_gsm_qty||0},${r.cbp_gsm_cash||0},${r.ctop_recharge_qty||0},${r.ctop_recharge_cash||0},${r.sim_new_qty||0},${r.sim_upgrade_qty||0},${r.sim_postpaid_qty||0},${r.sim_postpaid_amt||0},${r.sim_replace_qty||0},${r.sim_replace_cash||0},${r.sim_fancy_qty||0},${r.sim_fancy_cash||0},${r.sim_other_qty||0},${r.sim_other_cash||0},${calculateTotalSalesCash(r)},${r.is_edited_by_staff?'YES':'NO'},${sanitizeCSV(r.staff_edit_remarks)}`
    ).join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_MIS_Sales_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex gap-2 mb-2">
        <button onClick={() => setSalesMode('entry')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded transition ${salesMode === 'entry' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>📝 Data Entry</button>
        <button onClick={() => setSalesMode('ledger')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded transition ${salesMode === 'ledger' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>📊 View Ledger & Reports</button>
      </div>

      {salesMode === 'entry' ? (
        <div className="space-y-6 animate-in fade-in">
          
          <div className="bg-slate-900 p-5 rounded-xl shadow-lg border border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="col-span-1">
              <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1.5">1. Filter by Master HQ</label>
              <select value={entryMasterLocId} onChange={(e) => { setEntryMasterLocId(e.target.value); setSelectedChildLocKey(""); }} className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-400 transition">
                <option value="">-- All Master HQs --</option>
                {hqLocations.map((hq: any) => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
              </select>
            </div>

            <div className="col-span-1">
              <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest block mb-1.5">2. Target Child Center *</label>
              <select value={selectedChildLocKey} onChange={(e) => setSelectedChildLocKey(e.target.value)} className="w-full bg-slate-800 border-2 border-emerald-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-emerald-400 transition">
                <option value="" disabled>-- Select Franchise Center --</option>
                {entryFilteredFranchises.flatMap((l: any) => {
                  const options = [];
                  if (l.role_ocsc) options.push(<option key={`${l.id}-OCSC`} value={`${l.id}-OCSC`}>{l.center_name} (OCSC)</option>);
                  if (l.role_cm) options.push(<option key={`${l.id}-CM`} value={`${l.id}-CM`}>{l.center_name} (CM)</option>);
                  return options;
                })}
              </select>
            </div>

            <div className="col-span-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Reporting Month Context</label>
              <input type="month" value={reportingMonth} onChange={(e) => setReportingMonth(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-500 transition"/>
            </div>

            <div className="col-span-1 flex flex-col justify-end">
              <div className="bg-slate-800 px-4 py-2.5 rounded-lg border border-slate-700 text-center h-full flex flex-col justify-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Center Mode</p>
                <p className={`font-black tracking-widest uppercase ${getActiveLocationType() === 'OCSC' ? 'text-blue-400' : getActiveLocationType() === 'CM' ? 'text-emerald-400' : 'text-slate-600'}`}>
                  {getActiveLocationType() || 'NONE'}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
            <div className="bg-white p-4 rounded-xl border border-indigo-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Sales Cash</p>
              <p className="text-2xl font-black text-indigo-700 mt-1">₹{cumulativeSalesCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">CBP Cash</p>
              <p className="text-xl font-black text-slate-800 mt-1">₹{cumulativeCBPCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">CTOP Cash</p>
              <p className="text-xl font-black text-slate-800 mt-1">₹{cumulativeCTOPCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">SIM Cash</p>
              <p className="text-xl font-black text-slate-800 mt-1">₹{cumulativeSIMCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className={`p-4 rounded-lg mb-6 flex gap-4 items-center justify-between ${editingSalesId ? 'bg-amber-100 border border-amber-300' : 'bg-slate-900'}`}>
              <div className="flex gap-4 items-center">
                <span className="text-3xl">📝</span>
                <div>
                  <h2 className={`font-black uppercase tracking-widest ${editingSalesId ? 'text-amber-900' : 'text-white'}`}>
                    {editingSalesId ? `Editing Sales Ledger (${reportingMonth})` : `Sales Entry (${reportingMonth})`}
                  </h2>
                </div>
              </div>
              {editingSalesId && (
                <button onClick={cancelSalesEdit} className="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-2 rounded text-xs uppercase tracking-widest transition">
                  Cancel Edit
                </button>
              )}
            </div>

            {!getActiveLocationType() ? (
              <div className="text-center p-8 bg-slate-50 rounded-xl border border-slate-200">
                <p className="font-bold text-slate-500">Please select an OCSC or CM Child Center from the ribbon above.</p>
              </div>
            ) : (
              <form onSubmit={handleSalesSubmit} className="space-y-6">
                {getActiveLocationType() === 'OCSC' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded">CBP & CTOP Cash</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP Landline Qty</label><input type="number" step="1" min="0" value={ocscSales.cbp_landline_qty} onChange={e => setOcscSales({...ocscSales, cbp_landline_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP Landline Cash</label><input type="number" step="0.01" min="0" value={ocscSales.cbp_landline_cash} onChange={e => setOcscSales({...ocscSales, cbp_landline_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP GSM Qty</label><input type="number" step="1" min="0" value={ocscSales.cbp_gsm_qty} onChange={e => setOcscSales({...ocscSales, cbp_gsm_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP GSM Cash</label><input type="number" step="0.01" min="0" value={ocscSales.cbp_gsm_cash} onChange={e => setOcscSales({...ocscSales, cbp_gsm_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CTOP Recharge Qty</label><input type="number" step="1" min="0" value={ocscSales.ctop_recharge_qty} onChange={e => setOcscSales({...ocscSales, ctop_recharge_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CTOP Recharge Cash</label><input type="number" step="0.01" min="0" value={ocscSales.ctop_recharge_cash} onChange={e => setOcscSales({...ocscSales, ctop_recharge_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={`${numInputClass} bg-indigo-50 border-indigo-200`} /></div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded">SIM Cash & Qty</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">New SIM Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_new_qty} onChange={e => setOcscSales({...ocscSales, sim_new_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Upgrade SIM Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_upgrade_qty} onChange={e => setOcscSales({...ocscSales, sim_upgrade_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Postpaid Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_postpaid_qty} onChange={e => setOcscSales({...ocscSales, sim_postpaid_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Postpaid Cash</label><input type="number" step="0.01" min="0" value={ocscSales.sim_postpaid_amt} onChange={e => setOcscSales({...ocscSales, sim_postpaid_amt: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Replace Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_replace_qty} onChange={e => setOcscSales({...ocscSales, sim_replace_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Replace Cash</label><input type="number" step="0.01" min="0" value={ocscSales.sim_replace_cash} onChange={e => setOcscSales({...ocscSales, sim_replace_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Fancy Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_fancy_qty} onChange={e => setOcscSales({...ocscSales, sim_fancy_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Fancy Cash</label><input type="number" step="0.01" min="0" value={ocscSales.sim_fancy_cash} onChange={e => setOcscSales({...ocscSales, sim_fancy_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Other Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_other_qty} onChange={e => setOcscSales({...ocscSales, sim_other_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Other Cash</label><input type="number" step="0.01" min="0" value={ocscSales.sim_other_cash} onChange={e => setOcscSales({...ocscSales, sim_other_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                      </div>
                    </div>
                  </div>
                )}
                {getActiveLocationType() === 'CM' && (
                  <div className="space-y-3">
                    <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded mb-4">Mapped Agent CTOP Volumes</h3>
                    {cmSales.length === 0 ? (
                      <p className="text-sm font-bold text-red-600 bg-red-50 p-4 border border-red-200 rounded">No agents mapped to this Child Center.</p>
                    ) : (
                      cmSales.map((a, idx) => (
                        <div key={a.agent_ctop_no} className="flex justify-between items-center bg-slate-50 p-3 rounded border border-slate-200">
                          <span className="font-black text-slate-800 tracking-wider">Agent: {a.agent_ctop_no}</span>
                          <div className="flex items-center gap-3">
                            <label className="text-[10px] font-bold uppercase text-slate-500">Sales Qty</label>
                            <input 
                              type="number" min="0" step="0.01" value={a.qty} 
                              onChange={(e) => {
                                const newSales = [...cmSales];
                                newSales[idx].qty = e.target.value;
                                setCmSales(newSales);
                              }} 
                              onKeyDown={preventNegativeScroll} onWheel={handleWheel}
                              className="border border-slate-300 p-2 rounded font-bold outline-none focus:border-indigo-500 w-32" 
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {editingSalesId && (
                  <div className="bg-red-50 p-4 border border-red-200 rounded-lg animate-in fade-in">
                    <label className="block text-[10px] text-red-600 font-black uppercase tracking-widest mb-1.5">Audit Remarks (Mandatory for Modifying Locked Sales) *</label>
                    <input required type="text" value={salesEditRemarks} onChange={e => setSalesEditRemarks(e.target.value)} className={numInputClass} placeholder="Reason for editing this locked entry..." />
                  </div>
                )}

                <div className="bg-amber-50 p-4 border border-amber-200 rounded-lg flex items-center gap-3 animate-in fade-in">
                  <input 
                    type="checkbox" 
                    id="confirmSales"
                    checked={confirmSalesLock} 
                    onChange={(e) => setConfirmSalesLock(e.target.checked)}
                    className="w-5 h-5 accent-amber-600 cursor-pointer" 
                  />
                  <label htmlFor="confirmSales" className="text-xs font-black text-amber-800 uppercase tracking-widest cursor-pointer flex-1">
                    I confirm these sales figures are accurate and verified. {editingSalesId && "(Audit action will be logged)"}
                  </label>
                </div>

                <button type="submit" disabled={isSubmitting || (getActiveLocationType() === 'CM' && cmSales.length === 0) || !confirmSalesLock} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition mt-6">
                  {isSubmitting ? "Locking Ledger..." : editingSalesId ? "Update & Save Ledger" : "Finalize & Lock Center Sales"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
          <div className="bg-slate-900 p-5 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h3 className="font-black uppercase tracking-widest text-white text-sm">Center Sales Ledger & KPIs</h3>
            <div className="flex flex-wrap gap-3">
              <select value={salesStateFilter} onChange={(e) => { setSalesStateFilter(e.target.value); setSalesHqFilter("ALL"); setSalesChildLocFilter("ALL"); }} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded outline-none focus:border-indigo-400">
                <option value="ALL">All States</option>
                {uniqueStates.map((st: string) => <option key={st} value={st}>{st}</option>)}
              </select>
              <select value={salesHqFilter} onChange={(e) => { setSalesHqFilter(e.target.value); setSalesChildLocFilter("ALL"); }} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded max-w-[200px] outline-none focus:border-indigo-400">
                <option value="ALL">All HQ Hubs</option>
                {hqLocations.filter((h: any) => salesStateFilter === "ALL" || h.state === salesStateFilter).map((h: any) => <option key={h.id} value={h.id}>{h.center_name}</option>)}
              </select>
              <select value={salesChildLocFilter} onChange={(e) => setSalesChildLocFilter(e.target.value)} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded max-w-[200px] outline-none focus:border-indigo-400">
                <option value="ALL">All Child Centers</option>
                {allLocations.filter((l: any) => !l.is_master_node && (salesHqFilter === "ALL" || l.parent_master_id?.toString() === salesHqFilter)).map((c: any) => <option key={c.id} value={c.id.toString()}>{c.center_name}</option>)}
              </select>
              <input type="month" value={salesMonthFilter} onChange={(e) => setSalesMonthFilter(e.target.value)} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded outline-none focus:border-indigo-400" />
              <button onClick={downloadCSV} className="bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded text-[10px] font-black text-white uppercase shadow transition">📥 Export Full CSV</button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 border-b border-slate-200">
            <div className="bg-white p-4">
              <p className="text-[10px] font-black text-slate-500 uppercase">Total Sales Cash</p>
              <p className="text-2xl font-black text-indigo-700 mt-1">₹{cumSalesLedgerCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[10px] font-black text-slate-500 uppercase">CBP Cash</p>
              <p className="text-xl font-black text-slate-800 mt-1">₹{filteredSalesLedger.reduce((sum: number, s: any) => sum + Number(s.cbp_landline_cash||0) + Number(s.cbp_gsm_cash||0), 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[10px] font-black text-slate-500 uppercase">CTOP Cash</p>
              <p className="text-xl font-black text-slate-800 mt-1">₹{filteredSalesLedger.reduce((sum: number, s: any) => sum + Number(s.ctop_recharge_cash||0), 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[10px] font-black text-slate-500 uppercase">SIM Cash</p>
              <p className="text-xl font-black text-slate-800 mt-1">₹{filteredSalesLedger.reduce((sum: number, s: any) => sum + Number(s.sim_postpaid_amt||0) + Number(s.sim_replace_cash||0) + Number(s.sim_fancy_cash||0) + Number(s.sim_other_cash||0), 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 sticky top-0 border-b border-slate-200 shadow-sm z-10">
                <tr><th className="p-4">Month</th><th className="p-4">Center</th><th className="p-4 text-right">CBP Cash</th><th className="p-4 text-right">CTOP Cash</th><th className="p-4 text-right">SIM Cash</th><th className="p-4 text-right">Total Cash</th><th className="p-4 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSalesLedger.map((s: any) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-black text-slate-800">{s.reporting_month}</td>
                    <td className="p-4 font-bold text-slate-800">
                      {s.locations?.center_name} <span className="text-[10px] text-blue-600 border px-1 rounded ml-2">{s.center_type}</span>
                      {s.is_edited_by_staff && <span className="block text-[9px] text-red-500 font-bold uppercase mt-1">Edited: {s.staff_edit_remarks}</span>}
                    </td>
                    <td className="p-4 text-right font-black">₹{Number(Number(s.cbp_landline_cash||0) + Number(s.cbp_gsm_cash||0)).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td className="p-4 text-right font-black">₹{Number(s.ctop_recharge_cash||0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td className="p-4 text-right font-black">₹{Number(Number(s.sim_postpaid_amt||0) + Number(s.sim_replace_cash||0) + Number(s.sim_fancy_cash||0) + Number(s.sim_other_cash||0)).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td className="p-4 text-right font-black text-indigo-700">₹{calculateTotalSalesCash(s).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td className="p-4 text-right">
                      <button onClick={() => handleEditSales(s)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black px-4 py-1.5 rounded border border-slate-300 text-[10px] uppercase tracking-widest transition shadow-sm">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredSalesLedger.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500 font-bold">No sales records found for this criteria.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}