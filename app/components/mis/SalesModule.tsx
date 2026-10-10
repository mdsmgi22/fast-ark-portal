"use client";
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

// UPGRADED: Core Calculator securely aggregates BSNL and Paybull platforms
const calculateTotalSalesCash = (s: any) => {
  const bsnlCash = Number(s.cbp_landline_cash || s.cbp_landline_amt || 0) + 
                   Number(s.cbp_gsm_cash || s.cbp_gsm_amt || 0) + 
                   Number(s.ctop_recharge_cash || s.ctop_recharge_amt || 0) + 
                   Number(s.sim_postpaid_amt || 0) + 
                   Number(s.sim_replace_cash || s.sim_replacement_amt || 0) + 
                   Number(s.sim_fancy_cash || s.sim_fancy_amt || 0) + 
                   Number(s.sim_other_cash || s.other_amt || 0) +
                   Number(s.frc_amt || 0) + Number(s.mnp_amt || 0);

  const paybullCash = Number(s.pb_cbp_amt || 0) + Number(s.pb_ctop_amt || 0) + 
                      Number(s.pb_frc_amt || 0) + Number(s.pb_mnp_amt || 0) + 
                      Number(s.pb_other_amt || 0);

  return bsnlCash + paybullCash;
};

const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function SalesModule({ 
  hqLocations, uniqueStates, entryFilteredFranchises, allLocations,
  agentMappings, rawSales, rawCollections = [], fetchArchitectureAndReports,
  reportingMonth, setReportingMonth, entryMasterLocId, setEntryMasterLocId, selectedChildLocKey, setSelectedChildLocKey
}: any) {
  const [salesMode, setSalesMode] = useState<'entry' | 'ledger'>('entry');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingSalesId, setEditingSalesId] = useState<string | null>(null);
  const [confirmSalesLock, setConfirmSalesLock] = useState(false);
  const [salesEditRemarks, setSalesEditRemarks] = useState("");

  const [ocscSales, setOcscSales] = useState({
    cbp_landline_qty: "", cbp_landline_cash: "", cbp_gsm_qty: "", cbp_gsm_cash: "", 
    ctop_recharge_qty: "", ctop_recharge_cash: "", frc_qty: "", frc_amt: "",
    sim_new_qty: "", sim_upgrade_qty: "", mnp_qty: "", mnp_amt: "",
    sim_postpaid_qty: "", sim_postpaid_amt: "", sim_replace_qty: "", sim_replace_cash: "", 
    sim_fancy_qty: "", sim_fancy_cash: "", sim_other_qty: "", sim_other_cash: "",
    pb_cbp_amt: "", pb_ctop_amt: "", pb_frc_amt: "", pb_mnp_amt: "", pb_other_amt: ""
  });
  const [cmSales, setCmSales] = useState<{agent_ctop_no: string, qty: string}[]>([]);

  const [salesEntryStateFilter, setSalesEntryStateFilter] = useState("ALL");

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

  const currentCenterId = selectedChildLocKey ? parseInt(selectedChildLocKey.split('-')[0]) : null;
  const dbReportingMonth = `${reportingMonth}-01`;
  
  const existingSaleRecord = rawSales.find((s: any) => s.location_id === currentCenterId && s.reporting_month === dbReportingMonth);
  const existingCollectionRecord = rawCollections.find((c: any) => c.location_id === currentCenterId && c.reporting_month === dbReportingMonth);
  
  const hasExistingEntry = !!existingSaleRecord;
  const currentSalesVal = existingSaleRecord ? calculateTotalSalesCash(existingSaleRecord) : 0;
  const currentColVal = existingCollectionRecord ? Number(existingCollectionRecord.total_cash_collected) : 0;
  const currentPendingVal = currentSalesVal - currentColVal;

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

      const cleanOcscSales = {
        cbp_landline_qty: parseInt(ocscSales.cbp_landline_qty) || 0,
        cbp_landline_cash: parseFloat(ocscSales.cbp_landline_cash) || 0,
        cbp_gsm_qty: parseInt(ocscSales.cbp_gsm_qty) || 0,
        cbp_gsm_cash: parseFloat(ocscSales.cbp_gsm_cash) || 0,
        ctop_recharge_qty: parseInt(ocscSales.ctop_recharge_qty) || 0,
        ctop_recharge_cash: parseFloat(ocscSales.ctop_recharge_cash) || 0,
        frc_qty: parseInt(ocscSales.frc_qty) || 0,
        frc_amt: parseFloat(ocscSales.frc_amt) || 0,
        mnp_qty: parseInt(ocscSales.mnp_qty) || 0,
        mnp_amt: parseFloat(ocscSales.mnp_amt) || 0,
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
        pb_cbp_amt: parseFloat(ocscSales.pb_cbp_amt) || 0,
        pb_ctop_amt: parseFloat(ocscSales.pb_ctop_amt) || 0,
        pb_frc_amt: parseFloat(ocscSales.pb_frc_amt) || 0,
        pb_mnp_amt: parseFloat(ocscSales.pb_mnp_amt) || 0,
        pb_other_amt: parseFloat(ocscSales.pb_other_amt) || 0,
      };

      const basePayload = {
        reporting_month: dbReportingMonth,
        location_id: currentCenterId, 
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
        setSalesMode('ledger'); 
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
      setSelectedChildLocKey(""); 
      setOcscSales({
        cbp_landline_qty: "", cbp_landline_cash: "", cbp_gsm_qty: "", cbp_gsm_cash: "", 
        ctop_recharge_qty: "", ctop_recharge_cash: "", frc_qty: "", frc_amt: "",
        sim_new_qty: "", sim_upgrade_qty: "", mnp_qty: "", mnp_amt: "",
        sim_postpaid_qty: "", sim_postpaid_amt: "", sim_replace_qty: "", sim_replace_cash: "", 
        sim_fancy_qty: "", sim_fancy_cash: "", sim_other_qty: "", sim_other_cash: "",
        pb_cbp_amt: "", pb_ctop_amt: "", pb_frc_amt: "", pb_mnp_amt: "", pb_other_amt: ""
      });
      setCmSales(cmSales.map(a => ({ ...a, qty: "" })));
      
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
    
    const parentHq = hqLocations.find((h: any) => h.id === sale.locations?.parent_master_id);
    if (parentHq) setSalesEntryStateFilter(parentHq.state || "ALL");
    
    setEntryMasterLocId(sale.locations?.parent_master_id?.toString() || "");
    setSelectedChildLocKey(`${sale.location_id}-${sale.center_type}`);
    setConfirmSalesLock(false);
    setSalesEditRemarks("");
    setSalesMode('entry');
    
    if (sale.center_type === 'OCSC') {
      setOcscSales({
        cbp_landline_qty: sale.cbp_landline_qty?.toString() || "",
        cbp_landline_cash: sale.cbp_landline_cash?.toString() || sale.cbp_landline_amt?.toString() || "",
        cbp_gsm_qty: sale.cbp_gsm_qty?.toString() || "",
        cbp_gsm_cash: sale.cbp_gsm_cash?.toString() || sale.cbp_gsm_amt?.toString() || "",
        ctop_recharge_qty: sale.ctop_recharge_qty?.toString() || "",
        ctop_recharge_cash: sale.ctop_recharge_cash?.toString() || sale.ctop_recharge_amt?.toString() || "",
        frc_qty: sale.frc_qty?.toString() || "",
        frc_amt: sale.frc_amt?.toString() || "",
        mnp_qty: sale.mnp_qty?.toString() || "",
        mnp_amt: sale.mnp_amt?.toString() || "",
        sim_new_qty: sale.sim_new_qty?.toString() || "",
        sim_upgrade_qty: sale.sim_upgrade_qty?.toString() || "",
        sim_postpaid_qty: sale.sim_postpaid_qty?.toString() || "",
        sim_postpaid_amt: sale.sim_postpaid_amt?.toString() || "",
        sim_replace_qty: sale.sim_replace_qty?.toString() || sale.sim_replacement_qty?.toString() || "",
        sim_replace_cash: sale.sim_replace_cash?.toString() || sale.sim_replacement_amt?.toString() || "",
        sim_fancy_qty: sale.sim_fancy_qty?.toString() || "",
        sim_fancy_cash: sale.sim_fancy_cash?.toString() || sale.sim_fancy_amt?.toString() || "",
        sim_other_qty: sale.sim_other_qty?.toString() || "",
        sim_other_cash: sale.sim_other_cash?.toString() || sale.other_amt?.toString() || "",
        pb_cbp_amt: sale.pb_cbp_amt?.toString() || "",
        pb_ctop_amt: sale.pb_ctop_amt?.toString() || "",
        pb_frc_amt: sale.pb_frc_amt?.toString() || "",
        pb_mnp_amt: sale.pb_mnp_amt?.toString() || "",
        pb_other_amt: sale.pb_other_amt?.toString() || "",
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelSalesEdit = () => {
    setEditingSalesId(null);
    setConfirmSalesLock(false);
    setSalesEditRemarks("");
    setSelectedChildLocKey("");
    setSalesMode('ledger');
  };

  const filteredSalesLedger = rawSales.filter((s: any) => {
    let mMatch = salesMonthFilter === "ALL" || s.reporting_month === `${salesMonthFilter}-01`;
    let sMatch = salesStateFilter === "ALL" || s.locations?.state === salesStateFilter;
    let hMatch = salesHqFilter === "ALL" || s.locations?.parent_master_id?.toString() === salesHqFilter;
    let cMatch = salesChildLocFilter === "ALL" || s.location_id?.toString() === salesChildLocFilter;
    return mMatch && sMatch && hMatch && cMatch;
  });

  const filteredCollectionsLedger = rawCollections.filter((c: any) => {
    let mMatch = salesMonthFilter === "ALL" || c.reporting_month === `${salesMonthFilter}-01`;
    let sMatch = salesStateFilter === "ALL" || c.locations?.state === salesStateFilter;
    let hMatch = salesHqFilter === "ALL" || c.locations?.parent_master_id?.toString() === salesHqFilter;
    let cMatch = salesChildLocFilter === "ALL" || c.location_id?.toString() === salesChildLocFilter;
    return mMatch && sMatch && hMatch && cMatch;
  });

  const cumSalesLedgerCash = filteredSalesLedger.reduce((sum: number, s: any) => sum + calculateTotalSalesCash(s), 0);
  const cumColLedgerCash = filteredCollectionsLedger.reduce((sum: number, c: any) => sum + Number(c.total_cash_collected || 0), 0);
  const cumPendingLedgerCash = cumSalesLedgerCash - cumColLedgerCash;

  const currentMonthSalesContext = rawSales.filter((s: any) => s.reporting_month === `${reportingMonth}-01` && (entryMasterLocId === "" || s.locations?.parent_master_id?.toString() === entryMasterLocId));
  const cumulativeSalesCash = currentMonthSalesContext.reduce((sum: number, s: any) => sum + calculateTotalSalesCash(s), 0);
  
  // Realtime Active Form Calculators
  const activeBsnlSimCash = Number(ocscSales.sim_postpaid_amt||0) + Number(ocscSales.sim_replace_cash||0) + Number(ocscSales.sim_fancy_cash||0) + Number(ocscSales.sim_other_cash||0) + Number(ocscSales.frc_amt||0) + Number(ocscSales.mnp_amt||0);
  const activePaybullCash = Number(ocscSales.pb_cbp_amt||0) + Number(ocscSales.pb_ctop_amt||0) + Number(ocscSales.pb_frc_amt||0) + Number(ocscSales.pb_mnp_amt||0) + Number(ocscSales.pb_other_amt||0);
  const activeTotalSimQty = Number(ocscSales.sim_new_qty||0) + Number(ocscSales.sim_upgrade_qty||0) + Number(ocscSales.sim_postpaid_qty||0) + Number(ocscSales.sim_replace_qty||0) + Number(ocscSales.sim_fancy_qty||0) + Number(ocscSales.frc_qty||0) + Number(ocscSales.mnp_qty||0);

  const downloadCSV = () => {
    if (filteredSalesLedger.length === 0) return alert("No data available to export.");
    const csvContent = "Month,State,Location,Type,CBP_Landline_Qty,CBP_Landline_Cash,CBP_GSM_Qty,CBP_GSM_Cash,CTOP_Qty,CTOP_Cash,FRC_Qty,FRC_Cash,MNP_Qty,MNP_Cash,SIM_New_Qty,SIM_Upgrade_Qty,SIM_Postpaid_Qty,SIM_Postpaid_Cash,SIM_Replace_Qty,SIM_Replace_Cash,SIM_Fancy_Qty,SIM_Fancy_Cash,SIM_Other_Qty,SIM_Other_Cash,PB_CBP_Amt,PB_CTOP_Amt,PB_FRC_Amt,PB_MNP_Amt,PB_Other_Amt,Total_Sales_INR,Total_Collected_INR,Pending_Balance_INR,Edited,Audit_Remarks\n" + 
      filteredSalesLedger.map((r: any) => {
        const salesCash = calculateTotalSalesCash(r);
        const col = rawCollections.find((c: any) => c.location_id === r.location_id && c.reporting_month === r.reporting_month);
        const colCash = col ? Number(col.total_cash_collected || 0) : 0;
        const pending = salesCash - colCash;

        return `${r.reporting_month},${sanitizeCSV(r.locations?.state)},${sanitizeCSV(r.locations?.center_name)},${r.center_type},${r.cbp_landline_qty||0},${r.cbp_landline_cash||r.cbp_landline_amt||0},${r.cbp_gsm_qty||0},${r.cbp_gsm_cash||r.cbp_gsm_amt||0},${r.ctop_recharge_qty||0},${r.ctop_recharge_cash||r.ctop_recharge_amt||0},${r.frc_qty||0},${r.frc_amt||0},${r.mnp_qty||0},${r.mnp_amt||0},${r.sim_new_qty||0},${r.sim_upgrade_qty||0},${r.sim_postpaid_qty||0},${r.sim_postpaid_amt||0},${r.sim_replace_qty||r.sim_replacement_qty||0},${r.sim_replace_cash||r.sim_replacement_amt||0},${r.sim_fancy_qty||0},${r.sim_fancy_cash||r.sim_fancy_amt||0},${r.sim_other_qty||0},${r.sim_other_cash||r.other_amt||0},${r.pb_cbp_amt||0},${r.pb_ctop_amt||0},${r.pb_frc_amt||0},${r.pb_mnp_amt||0},${r.pb_other_amt||0},${salesCash},${colCash},${pending},${r.is_edited_by_staff?'YES':'NO'},${sanitizeCSV(r.staff_edit_remarks)}`
      }).join("\n");
    
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
          
          <div className="bg-slate-900 p-5 rounded-xl shadow-lg border border-slate-800 grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="col-span-1">
              <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1.5">1. State Scope</label>
              <select value={salesEntryStateFilter} onChange={(e) => { setSalesEntryStateFilter(e.target.value); setEntryMasterLocId(""); setSelectedChildLocKey(""); }} className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-400 transition">
                <option value="ALL">-- All States --</option>
                {uniqueStates.map((st: string) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>

            <div className="col-span-1">
              <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1.5">2. Master HQ</label>
              <select value={entryMasterLocId} onChange={(e) => { setEntryMasterLocId(e.target.value); setSelectedChildLocKey(""); }} className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-400 transition">
                <option value="">-- All Master HQs --</option>
                {hqLocations.filter((h: any) => salesEntryStateFilter === "ALL" || h.state === salesEntryStateFilter).map((hq: any) => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
              </select>
            </div>

            <div className="col-span-1">
              <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest block mb-1.5">3. Target Center *</label>
              <select value={selectedChildLocKey} onChange={(e) => setSelectedChildLocKey(e.target.value)} className="w-full bg-slate-800 border-2 border-emerald-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-emerald-400 transition">
                <option value="" disabled>-- Select Franchise --</option>
                {entryFilteredFranchises.flatMap((l: any) => {
                  const options = [];
                  if (l.role_ocsc) options.push(<option key={`${l.id}-OCSC`} value={`${l.id}-OCSC`}>{l.center_name} (OCSC)</option>);
                  if (l.role_cm) options.push(<option key={`${l.id}-CM`} value={`${l.id}-CM`}>{l.center_name} (CM)</option>);
                  return options;
                })}
              </select>
            </div>

            <div className="col-span-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Reporting Month</label>
              <input type="month" value={reportingMonth} onChange={(e) => setReportingMonth(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-500 transition"/>
            </div>

            <div className="col-span-1 flex flex-col justify-end">
              <div className="bg-slate-800 px-4 py-2.5 rounded-lg border border-slate-700 text-center h-full flex flex-col justify-center">
                {selectedChildLocKey ? (
                  <>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Pending Balance</p>
                    <p className={`font-black uppercase ${currentPendingVal > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      ₹{currentPendingVal.toLocaleString('en-IN', {minimumFractionDigits: 2})}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Center Mode</p>
                    <p className="font-black uppercase text-slate-600">NONE</p>
                  </>
                )}
              </div>
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
                    
                    {/* BSNL CORE METRICS */}
                    <div className="space-y-4">
                      <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded border border-slate-200">1. BSNL CBP & CTOP Heads</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP Landline Qty</label><input type="number" step="1" min="0" value={ocscSales.cbp_landline_qty} onChange={e => setOcscSales({...ocscSales, cbp_landline_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP Landline Cash</label><input type="number" step="0.01" min="0" value={ocscSales.cbp_landline_cash} onChange={e => setOcscSales({...ocscSales, cbp_landline_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP GSM Qty</label><input type="number" step="1" min="0" value={ocscSales.cbp_gsm_qty} onChange={e => setOcscSales({...ocscSales, cbp_gsm_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP GSM Cash</label><input type="number" step="0.01" min="0" value={ocscSales.cbp_gsm_cash} onChange={e => setOcscSales({...ocscSales, cbp_gsm_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                        <div><label className="text-[10px] font-bold text-indigo-800 uppercase">CTOP Recharge Qty</label><input type="number" step="1" min="0" value={ocscSales.ctop_recharge_qty} onChange={e => setOcscSales({...ocscSales, ctop_recharge_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-indigo-800 uppercase">CTOP Recharge Cash</label><input type="number" step="0.01" min="0" value={ocscSales.ctop_recharge_cash} onChange={e => setOcscSales({...ocscSales, ctop_recharge_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={`${numInputClass} border-indigo-300 text-indigo-900`} /></div>
                        
                        <div><label className="text-[10px] font-bold text-emerald-800 uppercase">FRC Qty</label><input type="number" step="1" min="0" value={ocscSales.frc_qty} onChange={e => setOcscSales({...ocscSales, frc_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-emerald-800 uppercase">FRC Cash</label><input type="number" step="0.01" min="0" value={ocscSales.frc_amt} onChange={e => setOcscSales({...ocscSales, frc_amt: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={`${numInputClass} border-emerald-300 text-emerald-900`} /></div>
                      </div>

                      <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded border border-slate-200 mt-4">2. BSNL SIM Tracking</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold text-purple-800 uppercase">MNP Qty</label><input type="number" step="1" min="0" value={ocscSales.mnp_qty} onChange={e => setOcscSales({...ocscSales, mnp_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-purple-800 uppercase">MNP Cash</label><input type="number" step="0.01" min="0" value={ocscSales.mnp_amt} onChange={e => setOcscSales({...ocscSales, mnp_amt: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={`${numInputClass} bg-purple-50 border-purple-300`} /></div>

                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">New SIM Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_new_qty} onChange={e => setOcscSales({...ocscSales, sim_new_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Upgrade SIM Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_upgrade_qty} onChange={e => setOcscSales({...ocscSales, sim_upgrade_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Postpaid Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_postpaid_qty} onChange={e => setOcscSales({...ocscSales, sim_postpaid_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Postpaid Cash</label><input type="number" step="0.01" min="0" value={ocscSales.sim_postpaid_amt} onChange={e => setOcscSales({...ocscSales, sim_postpaid_amt: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Replace Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_replace_qty} onChange={e => setOcscSales({...ocscSales, sim_replace_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Replace Cash</label><input type="number" step="0.01" min="0" value={ocscSales.sim_replace_cash} onChange={e => setOcscSales({...ocscSales, sim_replace_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Fancy Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_fancy_qty} onChange={e => setOcscSales({...ocscSales, sim_fancy_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Fancy Cash</label><input type="number" step="0.01" min="0" value={ocscSales.sim_fancy_cash} onChange={e => setOcscSales({...ocscSales, sim_fancy_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Other Adjust. Qty</label><input type="number" step="1" min="0" value={ocscSales.sim_other_qty} onChange={e => setOcscSales({...ocscSales, sim_other_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold text-slate-500 uppercase">Other Adjust. Cash</label><input type="number" step="0.01" min="0" value={ocscSales.sim_other_cash} onChange={e => setOcscSales({...ocscSales, sim_other_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                      </div>
                    </div>

                    {/* PAYBULL ISOLATION */}
                    <div className="space-y-4">
                      
                      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 rounded-xl border border-indigo-200 shadow-sm">
                        <h3 className="font-black text-indigo-900 border-b border-indigo-200 pb-2 mb-4 flex items-center gap-2">
                          <span className="text-xl">💳</span> 3. Paybull Platform Cash
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div><label className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest">PB CTOP ₹</label><input type="number" step="0.01" min="0" value={ocscSales.pb_ctop_amt} onChange={(e) => setOcscSales({...ocscSales, pb_ctop_amt: e.target.value})} placeholder="0.00" className={numInputClass} /></div>
                          <div><label className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest">PB CBP ₹</label><input type="number" step="0.01" min="0" value={ocscSales.pb_cbp_amt} onChange={(e) => setOcscSales({...ocscSales, pb_cbp_amt: e.target.value})} placeholder="0.00" className={numInputClass} /></div>
                          <div><label className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest">PB FRC ₹</label><input type="number" step="0.01" min="0" value={ocscSales.pb_frc_amt} onChange={(e) => setOcscSales({...ocscSales, pb_frc_amt: e.target.value})} placeholder="0.00" className={numInputClass} /></div>
                          <div><label className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest">PB MNP ₹</label><input type="number" step="0.01" min="0" value={ocscSales.pb_mnp_amt} onChange={(e) => setOcscSales({...ocscSales, pb_mnp_amt: e.target.value})} placeholder="0.00" className={numInputClass} /></div>
                          <div className="col-span-2"><label className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest">PB Other ₹</label><input type="number" step="0.01" min="0" value={ocscSales.pb_other_amt} onChange={(e) => setOcscSales({...ocscSales, pb_other_amt: e.target.value})} placeholder="0.00" className={numInputClass} /></div>
                        </div>
                      </div>

                      <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl">
                         <div className="flex justify-between items-center text-sm border-b border-slate-700 pb-3 mb-3"><span className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">BSNL SIM Cash Head:</span><span className="text-emerald-400 font-black">₹{activeBsnlSimCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                         <div className="flex justify-between items-center text-sm border-b border-slate-700 pb-3 mb-3"><span className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Total SIMs Deployed:</span><span className="text-emerald-400 font-black">{activeTotalSimQty}</span></div>
                         <div className="flex justify-between items-center text-sm border-b border-slate-700 pb-3 mb-3"><span className="text-indigo-400 font-bold uppercase tracking-widest text-[10px]">Paybull Platform Cash:</span><span className="text-indigo-400 font-black">₹{activePaybullCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                         <div className="flex justify-between items-center pt-2">
                           <span className="text-white font-black uppercase tracking-widest text-xs">Gross Revenue:</span>
                           <span className="text-white text-2xl font-black">
                             ₹{(Number(ocscSales.cbp_landline_cash||0) + Number(ocscSales.cbp_gsm_cash||0) + Number(ocscSales.ctop_recharge_cash||0) + activeBsnlSimCash + activePaybullCash).toLocaleString('en-IN')}
                           </span>
                         </div>
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

                <button type="submit" disabled={isSubmitting || (getActiveLocationType() === 'CM' && cmSales.length === 0) || !confirmSalesLock || (hasExistingEntry && !editingSalesId)} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition mt-6">
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
              <select value={salesHqFilter} onChange={(e) => { setSalesHqFilter(e.target.value); setSalesChildLocFilter("ALL"); }} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded max-w-[150px] outline-none focus:border-indigo-400">
                <option value="ALL">All HQ Hubs</option>
                {hqLocations.filter((h: any) => salesStateFilter === "ALL" || h.state === salesStateFilter).map((h: any) => <option key={h.id} value={h.id}>{h.center_name}</option>)}
              </select>
              <select value={salesChildLocFilter} onChange={(e) => setSalesChildLocFilter(e.target.value)} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded max-w-[150px] outline-none focus:border-indigo-400">
                <option value="ALL">All Child Centers</option>
                {allLocations.filter((l: any) => !l.is_master_node && (salesStateFilter === "ALL" || l.state === salesStateFilter) && (salesHqFilter === "ALL" || l.parent_master_id?.toString() === salesHqFilter)).map((c: any) => <option key={c.id} value={c.id.toString()}>{c.center_name}</option>)}
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
              <p className="text-[10px] font-black text-slate-500 uppercase">Total Collected</p>
              <p className="text-xl font-black text-emerald-600 mt-1">₹{cumColLedgerCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[10px] font-black text-slate-500 uppercase">Total Pending</p>
              <p className={`text-xl font-black mt-1 ${cumPendingLedgerCash > 0 ? 'text-red-600' : 'text-slate-800'}`}>
                ₹{cumPendingLedgerCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}
              </p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Paybull Component</p>
              <p className="text-xl font-black text-indigo-900 mt-1">₹{filteredSalesLedger.reduce((sum: number, s: any) => sum + Number(s.pb_cbp_amt||0) + Number(s.pb_ctop_amt||0) + Number(s.pb_frc_amt||0) + Number(s.pb_mnp_amt||0) + Number(s.pb_other_amt||0), 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 sticky top-0 border-b border-slate-200 shadow-sm z-10">
                <tr><th className="p-4">Month</th><th className="p-4">Center</th><th className="p-4 text-right">Gross Sales</th><th className="p-4 text-right">Collected</th><th className="p-4 text-right">Pending</th><th className="p-4 text-right border-l">Paybull Cash</th><th className="p-4 text-right">BSNL SIM Cash</th><th className="p-4 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSalesLedger.map((s: any) => {
                  const salesCash = calculateTotalSalesCash(s);
                  const col = rawCollections.find((c: any) => c.location_id === s.location_id && c.reporting_month === s.reporting_month);
                  const colCash = col ? Number(col.total_cash_collected || 0) : 0;
                  const pending = salesCash - colCash;

                  return (
                    <tr key={s.id} className="hover:bg-slate-50 transition">
                      <td className="p-4 font-black text-slate-800">{s.reporting_month}</td>
                      <td className="p-4 font-bold text-slate-800">
                        {s.locations?.center_name} <span className="text-[10px] text-blue-600 border px-1 rounded ml-2">{s.center_type}</span>
                        {s.is_edited_by_staff && <span className="block text-[9px] text-red-500 font-bold uppercase mt-1">Edited: {s.staff_edit_remarks}</span>}
                      </td>
                      <td className="p-4 text-right font-black text-indigo-700">₹{salesCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-black text-emerald-600">₹{colCash.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className={`p-4 text-right font-black ${pending > 0 ? 'text-red-600' : 'text-slate-800'}`}>₹{pending.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-medium text-indigo-600 border-l bg-indigo-50/20">₹{Number(Number(s.pb_cbp_amt||0)+Number(s.pb_ctop_amt||0)+Number(s.pb_frc_amt||0)+Number(s.pb_mnp_amt||0)+Number(s.pb_other_amt||0)).toLocaleString('en-IN')}</td>
                      <td className="p-4 text-right font-medium text-slate-500">₹{Number(Number(s.sim_postpaid_amt||0) + Number(s.sim_replace_cash||s.sim_replacement_amt||0) + Number(s.sim_fancy_cash||s.sim_fancy_amt||0) + Number(s.sim_other_cash||s.other_amt||0) + Number(s.frc_amt||0) + Number(s.mnp_amt||0)).toLocaleString('en-IN')}</td>
                      <td className="p-4 text-right">
                        <button onClick={() => handleEditSales(s)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black px-4 py-1.5 rounded border border-slate-300 text-[10px] uppercase tracking-widest transition shadow-sm">
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {filteredSalesLedger.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-500 font-bold">No sales records found for this criteria.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}