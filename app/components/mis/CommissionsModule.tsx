"use client";
import React, { useState } from "react";
import { supabase } from "../../lib/supabase";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function CommissionsModule({ hqLocations, mappedMasterCtopsForComms, rawCommissions, fetchArchitectureAndReports, reportingMonth, setReportingMonth, entryMasterLocId, setEntryMasterLocId }: any) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [commissionForm, setCommissionForm] = useState({ master_ctop_id: "", instant_commission: "", pending_commission: "" });

  const preventNegativeScroll = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') e.preventDefault();
  };
  
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handleCommissionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryMasterLocId || !commissionForm.master_ctop_id) return alert("Select Master Location and CTOP.");
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const payload = {
        reporting_month: `${reportingMonth}-01`, 
        location_id: parseInt(entryMasterLocId), 
        master_ctop_id: commissionForm.master_ctop_id,
        instant_commission: parseFloat(commissionForm.instant_commission) || 0, 
        pending_commission: parseFloat(commissionForm.pending_commission) || 0, 
        logged_by: user.id
      };
      
      const { data: rec, error } = await supabase.from('mis_commissions').insert([payload]).select().single();
      if (error) throw error;

      await supabase.from('staff_activity_logs').insert([{ 
          staff_id: user.id, staff_email: user.email, action_type: 'MIS_ENTRY', module: 'MANAGER_MIS', target_id: rec.id, details: `Logged Commission: Instant ₹${payload.instant_commission}, Pending ₹${payload.pending_commission}.` 
      }]);
      
      alert("✅ Commission Ledger Updated.");
      setCommissionForm({ master_ctop_id: "", instant_commission: "", pending_commission: "" }); 
      fetchArchitectureAndReports();
    } catch (err: any) { 
      alert("Error: " + err.message); 
    } finally { 
      setIsSubmitting(false); 
    }
  };

  const downloadCSV = () => {
    if (rawCommissions.length === 0) return alert("No data available to export.");
    const csvContent = "Month,Location,CTOP,Instant_Comm,Pending_Comm\n" + 
      rawCommissions.map((r: any) => 
      `${r.reporting_month},${sanitizeCSV(r.locations?.center_name)},${r.master_ctop_accounts?.master_ctop_no},${r.instant_commission},${r.pending_commission}`
    ).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_MIS_Commissions_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-2xl mx-auto">
        <h2 className="font-black uppercase text-lg mb-6 border-b pb-4 text-slate-800">Log Commissions</h2>
        <div className="bg-slate-900 p-5 rounded-xl shadow-lg border border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
           <div>
             <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1.5 block">1. HQ Hub</label>
             <select value={entryMasterLocId} onChange={(e) => setEntryMasterLocId(e.target.value)} className="w-full bg-slate-800 border-2 border-indigo-500 text-white text-xs font-bold p-2.5 rounded-lg outline-none focus:border-indigo-400 transition">
               <option value="">-- Select --</option>
               {hqLocations.map((hq: any) => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
             </select>
           </div>
           <div>
             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">2. Month Context</label>
             <input type="month" value={reportingMonth} onChange={(e) => setReportingMonth(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white text-xs font-bold p-2.5 rounded-lg outline-none focus:border-indigo-400 transition"/>
           </div>
        </div>

        {!entryMasterLocId ? (
          <p className="text-center font-bold text-slate-400 py-8">Select a Master HQ above.</p>
        ) : (
          <form onSubmit={handleCommissionSubmit} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Master CTOP *</label>
              <select required value={commissionForm.master_ctop_id} onChange={e => setCommissionForm({...commissionForm, master_ctop_id: e.target.value})} className={numInputClass}>
                <option value="" disabled>-- Select --</option>
                {mappedMasterCtopsForComms.map((m: any) => <option key={m.id} value={m.id}>{m.master_ctop_no}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Instant Comm (₹) *</label>
                <input required type="number" step="0.01" min="0" value={commissionForm.instant_commission} onChange={e => setCommissionForm({...commissionForm, instant_commission: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Pending Comm (₹) *</label>
                <input required type="number" step="0.01" min="0" value={commissionForm.pending_commission} onChange={e => setCommissionForm({...commissionForm, pending_commission: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} />
              </div>
            </div>
            <button type="submit" disabled={isSubmitting} className="w-full bg-amber-600 hover:bg-amber-700 text-white font-black py-4 rounded-xl uppercase tracking-widest transition shadow-md mt-6">
              Log Commission
            </button>
          </form>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-900 flex justify-between items-center text-white">
          <h3 className="font-black uppercase tracking-widest text-xs">Commission Ledger</h3>
          <button onClick={downloadCSV} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-[10px] font-bold shadow transition">📥 CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
              <tr><th className="p-4">Month</th><th className="p-4">Location & CTOP</th><th className="p-4 text-right">Instant (₹)</th><th className="p-4 text-right">Pending (₹)</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rawCommissions.slice(0, 50).map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50 transition">
                  <td className="p-4 font-black text-slate-800">{c.reporting_month}</td>
                  <td className="p-4 font-bold text-slate-800">{c.locations?.center_name} <span className="text-[10px] font-black tracking-widest text-slate-400 ml-2">{c.master_ctop_accounts?.master_ctop_no}</span></td>
                  <td className="p-4 text-right font-black text-amber-600">₹{Number(c.instant_commission).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                  <td className="p-4 text-right font-black text-amber-600">₹{Number(c.pending_commission).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                </tr>
              ))}
              {rawCommissions.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-500 font-bold">No commissions logged.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}