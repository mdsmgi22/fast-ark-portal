"use client";
import React, { useState } from "react";
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

export default function CollectionModule({ 
  hqLocations, entryFilteredFranchises, allLocations,
  rawCollections, rawSales, fetchArchitectureAndReports,
  reportingMonth, setReportingMonth, entryMasterLocId, setEntryMasterLocId, selectedChildLocKey, setSelectedChildLocKey 
}: any) {
  const [collectionMode, setCollectionMode] = useState<'entry' | 'ledger' | 'correction'>('entry');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  
  const [collectionForm, setCollectionForm] = useState({ 
    total_cash_collected: "", remarks: "", edit_remarks: "" 
  });
  
  const [colMonthFilter, setColMonthFilter] = useState(new Date().toISOString().substring(0, 7));
  const [colHqFilter, setColHqFilter] = useState("ALL");

  const preventNegativeScroll = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') e.preventDefault();
  };
  
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handleCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChildLocKey || !reportingMonth) return alert("Select child center and month.");
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const dbReportingMonth = `${reportingMonth}-01`;
      const payload = {
        reporting_month: dbReportingMonth,
        location_id: parseInt(selectedChildLocKey.split('-')[0]), 
        total_cash_collected: parseFloat(collectionForm.total_cash_collected) || 0,
        remarks: collectionForm.remarks,
        logged_by: user.id
      };

      if (editingCollectionId) {
        if (!collectionForm.edit_remarks || collectionForm.edit_remarks.trim().length < 5) {
          setIsSubmitting(false);
          return alert("Audit log remarks are mandatory for modifying collections.");
        }
        await supabase.from('mis_monthly_collections').update({
          total_cash_collected: payload.total_cash_collected,
          remarks: payload.remarks,
          is_edited_by_staff: true,
          staff_edit_remarks: collectionForm.edit_remarks
        }).eq('id', editingCollectionId);

        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id, staff_email: user.email, action_type: 'MIS_EDIT', module: 'MANAGER_MIS',
          target_id: editingCollectionId, details: `Modified Collection for ${dbReportingMonth}. Remarks: ${collectionForm.edit_remarks}`
        }]);

        alert("✅ Collection Overwritten and Audited.");
      } else {
        const { data: rec, error } = await supabase.from('mis_monthly_collections').insert([payload]).select().single();
        if (error) throw error;

        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id, staff_email: user.email, action_type: 'MIS_ENTRY', module: 'MANAGER_MIS',
          target_id: rec.id, details: `Logged Collection for ${dbReportingMonth}.`
        }]);

        alert("✅ Collection Logged Successfully.");
      }

      setCollectionForm({ total_cash_collected: "", remarks: "", edit_remarks: "" });
      setEditingCollectionId(null);
      setCollectionMode('ledger');
      fetchArchitectureAndReports(); 
    } catch (err: any) {
      if (err.message.includes('unique constraint')) alert("❌ Blocked: Collection for this center and month is already locked.");
      else alert("Error saving collection: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditCollection = (col: any) => {
    setEditingCollectionId(col.id);
    setSelectedChildLocKey(`${col.location_id}-${col.locations?.role_ocsc ? 'OCSC' : 'CM'}`);
    setReportingMonth(col.reporting_month.substring(0, 7));
    setCollectionForm({
      total_cash_collected: col.total_cash_collected?.toString() || "", 
      remarks: col.remarks || "", 
      edit_remarks: ""
    });
    setCollectionMode('correction');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredCollectionsLedger = rawCollections.filter((c: any) => {
    let mMatch = colMonthFilter === "ALL" || c.reporting_month === `${colMonthFilter}-01`;
    let hMatch = colHqFilter === "ALL" || c.locations?.parent_master_id?.toString() === colHqFilter;
    return mMatch && hMatch;
  });

  const locationReconciliation = allLocations.filter((l: any) => !l.is_master_node && (colHqFilter === "ALL" || l.parent_master_id?.toString() === colHqFilter)).flatMap((loc: any) => {
    const s = rawSales.find((sale: any) => sale.location_id === loc.id && sale.reporting_month === `${colMonthFilter}-01`);
    const c = rawCollections.find((col: any) => col.location_id === loc.id && col.reporting_month === `${colMonthFilter}-01`);
    
    if (!s && !c) return []; 

    const salesCash = s ? calculateTotalSalesCash(s) : 0;
    const colCash = c ? Number(c.total_cash_collected || 0) : 0;
    const pending = salesCash - colCash;
    
    return [{ 
      id: loc.id, name: loc.center_name, type: loc.role_ocsc ? 'OCSC' : loc.role_cm ? 'CM' : 'Franchise', 
      sales: salesCash, collection: colCash, pending 
    }];
  });

  const downloadCSV = () => {
    if (filteredCollectionsLedger.length === 0) return alert("No data available to export.");
    const csvContent = "Month,Location,Collected_INR,Remarks,Edited,Audit_Remarks\n" + 
      filteredCollectionsLedger.map((r: any) => 
      `${r.reporting_month},${sanitizeCSV(r.locations?.center_name)},${r.total_cash_collected},${sanitizeCSV(r.remarks)},${r.is_edited_by_staff?'YES':'NO'},${sanitizeCSV(r.staff_edit_remarks)}`
    ).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_MIS_Collections_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={() => setCollectionMode('entry')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded transition ${collectionMode === 'entry' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>📝 Declare Collection</button>
        <button onClick={() => setCollectionMode('ledger')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded transition ${collectionMode === 'ledger' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>📊 Ledger & Reconciliation</button>
        <button onClick={() => setCollectionMode('correction')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded transition ${collectionMode === 'correction' ? 'bg-amber-600 text-white shadow' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>🛠️ Corrections Hub</button>
      </div>

      {collectionMode === 'entry' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-2xl mx-auto animate-in fade-in">
          <div className="bg-slate-900 p-5 rounded-xl shadow-lg border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1.5 block">HQ Scope</label>
              <select value={entryMasterLocId} onChange={(e) => { setEntryMasterLocId(e.target.value); setSelectedChildLocKey(""); }} className="w-full bg-slate-800 border-2 border-slate-700 text-white text-xs font-bold p-2 rounded outline-none focus:border-emerald-400 transition">
                <option value="">-- All Master HQs --</option>
                {hqLocations.map((hq: any) => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1.5 block">Target Center *</label>
              <select value={selectedChildLocKey} onChange={(e) => setSelectedChildLocKey(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white text-xs font-bold p-2 rounded outline-none focus:border-emerald-400 transition">
                <option value="" disabled>-- Select Center --</option>
                {entryFilteredFranchises.flatMap((l: any) => {
                  const options = [];
                  if (l.role_ocsc) options.push(<option key={`${l.id}-OCSC`} value={`${l.id}-OCSC`}>{l.center_name} (OCSC)</option>);
                  if (l.role_cm) options.push(<option key={`${l.id}-CM`} value={`${l.id}-CM`}>{l.center_name} (CM)</option>);
                  return options;
                })}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Month</label>
              <input type="month" value={reportingMonth} onChange={(e) => setReportingMonth(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white text-xs font-bold p-2 rounded outline-none focus:border-indigo-400 transition"/>
            </div>
          </div>

          <div className="border-b pb-4 mb-4 flex gap-3 items-center">
            <span className="text-2xl">💰</span>
            <h2 className="font-black uppercase text-lg text-slate-800">Declare Monthly Cash Collection</h2>
          </div>
            
          {!selectedChildLocKey ? (
            <p className="text-center font-bold text-slate-400 py-8">Select a Child Center from the dark ribbon above.</p>
          ) : (
            <form onSubmit={handleCollectionSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Collected (₹) *</label>
                <input required type="number" step="0.01" min="0" value={collectionForm.total_cash_collected} onChange={e => setCollectionForm({...collectionForm, total_cash_collected: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Remarks</label>
                <textarea rows={3} value={collectionForm.remarks} onChange={e => setCollectionForm({...collectionForm, remarks: e.target.value})} className={numInputClass} />
              </div>
              <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 rounded-xl uppercase tracking-widest mt-6 transition shadow-md">
                Commit Collection
              </button>
            </form>
          )}
        </div>
      )}

      {collectionMode === 'ledger' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
          <div className="bg-slate-900 p-5 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h3 className="font-black uppercase tracking-widest text-white text-sm">Collection Ledger & Reconciliation</h3>
            <div className="flex gap-3">
              <select value={colHqFilter} onChange={(e) => setColHqFilter(e.target.value)} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded max-w-[200px] outline-none focus:border-emerald-400 transition">
                <option value="ALL">All HQ Hubs</option>
                {hqLocations.map((h: any) => <option key={h.id} value={h.id}>{h.center_name}</option>)}
              </select>
              <input type="month" value={colMonthFilter} onChange={(e) => setColMonthFilter(e.target.value)} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded outline-none focus:border-emerald-400 transition" />
              <button onClick={downloadCSV} className="bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded text-[10px] font-black text-white uppercase shadow transition">📥 Full CSV</button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 sticky top-0 border-b border-slate-200 shadow-sm z-10">
                <tr><th className="p-4">Center</th><th className="p-4 text-right text-indigo-600">Total Sales (₹)</th><th className="p-4 text-right text-emerald-600">Total Collected (₹)</th><th className="p-4 text-right text-red-500">Pending Balance (₹)</th><th className="p-4 text-right">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {locationReconciliation.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-400 font-bold">No sales or collection activity found for the selected month/HQ context.</td></tr>
                ) : (
                  locationReconciliation.map((rec: any) => (
                    <tr key={`${rec.id}-${rec.type}`} className="hover:bg-slate-50 transition">
                      <td className="p-4"><p className="font-black text-slate-800">{rec.name}</p><span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">{rec.type}</span></td>
                      <td className="p-4 text-right font-black text-indigo-700">₹{rec.sales.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-black text-emerald-600">₹{rec.collection.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-black text-red-600">₹{rec.pending.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right">
                        {rec.pending <= 0 ? (
                          <span className="bg-emerald-50 text-emerald-600 border border-emerald-200 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest">Settled</span>
                        ) : (
                          <span className="bg-red-50 text-red-600 border border-red-200 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {collectionMode === 'correction' && (
        <div className="bg-white rounded-xl shadow-sm border border-amber-300 overflow-hidden animate-in fade-in">
          <div className="bg-amber-100 p-5 border-b border-amber-300 flex justify-between items-center">
            <div>
              <h3 className="font-black uppercase tracking-widest text-amber-900 text-sm">Collection Corrections Hub</h3>
              <p className="text-xs text-amber-700 font-bold mt-1">Audit logs are mandatory for all cash edits.</p>
            </div>
          </div>
          
          {editingCollectionId ? (
            <div className="p-6 bg-amber-50">
              <form onSubmit={handleCollectionSubmit} className="space-y-4 max-w-xl mx-auto bg-white p-6 rounded-xl border border-amber-200 shadow-sm">
                <h4 className="font-black text-amber-900 border-b pb-2 mb-4">Edit Locked Collection</h4>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1.5">Collected (₹) *</label>
                  <input required type="number" step="0.01" min="0" value={collectionForm.total_cash_collected} onChange={e => setCollectionForm({...collectionForm, total_cash_collected: e.target.value})} className={numInputClass} />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1.5">Standard Remarks</label>
                  <textarea rows={2} value={collectionForm.remarks} onChange={e => setCollectionForm({...collectionForm, remarks: e.target.value})} className={numInputClass} />
                </div>
                <div className="bg-red-50 p-4 border border-red-200 rounded-lg">
                  <label className="block text-[10px] text-red-600 font-black uppercase tracking-widest mb-1.5">Audit Remarks (Mandatory) *</label>
                  <input required type="text" value={collectionForm.edit_remarks} onChange={e => setCollectionForm({...collectionForm, edit_remarks: e.target.value})} className={numInputClass} placeholder="Reason for this financial edit..." />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => setEditingCollectionId(null)} className="w-1/3 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black py-3 rounded-lg uppercase tracking-widest transition">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="w-2/3 bg-amber-600 hover:bg-amber-700 text-white font-black py-3 rounded-lg uppercase tracking-widest shadow transition">Save Correction</button>
                </div>
              </form>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-amber-50 text-[10px] uppercase tracking-widest text-amber-800 sticky top-0 border-b border-amber-200 z-10">
                  <tr><th className="p-4">Month</th><th className="p-4">Center</th><th className="p-4 text-right">Collected (₹)</th><th className="p-4">Remarks</th><th className="p-4 text-right">Action</th></tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {rawCollections.map((c: any) => (
                    <tr key={c.id} className="hover:bg-amber-50/50 transition">
                      <td className="p-4 font-black text-slate-800">{c.reporting_month}</td>
                      <td className="p-4 font-bold text-slate-800">{c.locations?.center_name}</td>
                      <td className="p-4 text-right font-black text-emerald-600">₹{Number(c.total_cash_collected).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-xs text-slate-500">
                        {c.remarks} 
                        {c.is_edited_by_staff && <span className="block text-[9px] text-red-500 font-bold uppercase mt-1">Edited: {c.staff_edit_remarks}</span>}
                      </td>
                      <td className="p-4 text-right">
                        <button onClick={() => handleEditCollection(c)} className="bg-amber-100 hover:bg-amber-200 text-amber-800 font-black px-4 py-1.5 rounded border border-amber-300 text-[10px] uppercase tracking-widest shadow-sm transition">
                          Correct
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rawCollections.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-500 font-bold">No collections to correct.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}