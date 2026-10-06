"use client";
import React, { useState } from "react";
import { supabase } from "../../lib/supabase";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function BalancesModule({ hqLocations, mappedMasterCtops, rawBalances, fetchArchitectureAndReports }: any) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  
  const [balanceForm, setBalanceForm] = useState({
    report_date: new Date().toISOString().split('T')[0],
    location_id: "",
    master_ctop_id: "",
    entry_type: "Opening Balance",
    cbp_landline_qty: "", 
    cbp_gsm_qty: "",
    ctop_qty: "",
    sim_qty: ""
  });

  const preventNegativeScroll = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') e.preventDefault();
  };
  
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handleBalanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!balanceForm.location_id || !balanceForm.master_ctop_id) {
      return alert("You must select both a Master Location and a Master CTOP.");
    }
    
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Authentication error.");

      const payload = {
        report_date: balanceForm.report_date,
        location_id: parseInt(balanceForm.location_id),
        master_ctop_id: balanceForm.master_ctop_id,
        entry_type: balanceForm.entry_type,
        cbp_landline_qty: parseFloat(balanceForm.cbp_landline_qty) || 0,
        cbp_gsm_qty: parseFloat(balanceForm.cbp_gsm_qty) || 0,
        ctop_qty: parseFloat(balanceForm.ctop_qty) || 0,
        sim_qty: parseFloat(balanceForm.sim_qty) || 0,
        logged_by: user.id
      };

      if (editingBalanceId) {
        await supabase.from('mis_balances').update(payload).eq('id', editingBalanceId);
        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id, staff_email: user.email, action_type: 'AUDIT', module: 'MANAGER_MIS',
          target_id: editingBalanceId, details: `Corrected ${payload.entry_type} for ${payload.report_date}.`
        }]);
        alert("✅ Balance Record Successfully Updated.");
      } else {
        const { data: insertedRecord, error } = await supabase.from('mis_balances').insert([payload]).select().single();
        if (error) throw error;
        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id, staff_email: user.email, action_type: 'MIS_ENTRY', module: 'MANAGER_MIS',
          target_id: insertedRecord.id, details: `Logged ${payload.entry_type} for ${payload.report_date}.`
        }]);
        alert("✅ Balance Record Successfully Saved.");
      }

      setBalanceForm({...balanceForm, cbp_landline_qty: "", cbp_gsm_qty: "", ctop_qty: "", sim_qty: ""});
      setEditingBalanceId(null);
      fetchArchitectureAndReports();
    } catch (err: any) {
      alert("Error saving balance: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditBalance = (bal: any) => {
    setEditingBalanceId(bal.id);
    setBalanceForm({
      report_date: bal.report_date,
      location_id: bal.location_id.toString(),
      master_ctop_id: bal.master_ctop_id,
      entry_type: bal.entry_type,
      cbp_landline_qty: bal.cbp_landline_qty?.toString() || "", 
      cbp_gsm_qty: bal.cbp_gsm_qty?.toString() || "",
      ctop_qty: bal.ctop_qty?.toString() || "",
      sim_qty: bal.sim_qty?.toString() || ""
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const downloadCSV = () => {
    if (rawBalances.length === 0) return alert("No data available to export.");
    const csvContent = "Date,Type,Location,CTOP,CBP_Landline_Qty,CBP_GSM_Qty,CTOP_Qty,SIM_Qty\n" + 
      rawBalances.map((r: any) => 
      `${r.report_date},${r.entry_type},${sanitizeCSV(r.locations?.center_name)},${r.master_ctop_accounts?.master_ctop_no},${r.cbp_landline_qty},${r.cbp_gsm_qty},${r.ctop_qty},${r.sim_qty}`
    ).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_MIS_Balances_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const filteredMasterCtops = mappedMasterCtops.filter((m: any) => m.location_id?.toString() === balanceForm.location_id);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className={`p-4 rounded-lg mb-6 flex gap-4 items-center justify-between ${editingBalanceId ? 'bg-amber-100 border border-amber-300' : 'bg-slate-900'}`}>
          <div className="flex gap-4 items-center">
            <span className="text-3xl">⚖️</span>
            <div>
              <h2 className={`font-black uppercase tracking-widest ${editingBalanceId ? 'text-amber-900' : 'text-white'}`}>
                {editingBalanceId ? 'Editing Balance Record' : 'Log Daily Balances'}
              </h2>
            </div>
          </div>
          {editingBalanceId && (
            <button onClick={() => { setEditingBalanceId(null); setBalanceForm({...balanceForm, cbp_landline_qty: "", cbp_gsm_qty: "", ctop_qty: "", sim_qty: ""}); }} className="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-2 rounded text-xs uppercase tracking-widest transition">
              Cancel Edit
            </button>
          )}
        </div>

        <form onSubmit={handleBalanceSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Record Date *</label>
              <input required type="date" value={balanceForm.report_date} onChange={e => setBalanceForm({...balanceForm, report_date: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none font-bold focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1.5">Master Location (Hub) *</label>
              <select required value={balanceForm.location_id} onChange={e => setBalanceForm({...balanceForm, location_id: e.target.value, master_ctop_id: ""})} className="w-full border-2 border-indigo-200 p-2.5 rounded-lg outline-none font-black text-indigo-900 focus:border-indigo-600 bg-indigo-50">
                <option value="" disabled>-- Select HQ --</option>
                {hqLocations.map((hq: any) => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1.5">Master CTOP No. *</label>
              <select required disabled={!balanceForm.location_id} value={balanceForm.master_ctop_id} onChange={e => setBalanceForm({...balanceForm, master_ctop_id: e.target.value})} className="w-full border-2 border-indigo-200 p-2.5 rounded-lg outline-none font-black text-indigo-900 focus:border-indigo-600 bg-indigo-50 disabled:opacity-50">
                <option value="" disabled>-- Select Assigned CTOP --</option>
                {filteredMasterCtops.map((m: any) => <option key={m.id} value={m.id}>{m.master_ctop_no}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Entry Type *</label>
              <select value={balanceForm.entry_type} onChange={e => setBalanceForm({...balanceForm, entry_type: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none font-bold focus:border-indigo-500 bg-slate-50">
                <option value="Opening Balance">Opening Balance</option>
                <option value="Closing Balance">Closing Balance</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-5 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">CBP Landline (Qty) *</label>
              <input required type="number" step="0.01" min="0" value={balanceForm.cbp_landline_qty} onChange={e => setBalanceForm({...balanceForm, cbp_landline_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">CBP GSM (Qty) *</label>
              <input required type="number" step="0.01" min="0" value={balanceForm.cbp_gsm_qty} onChange={e => setBalanceForm({...balanceForm, cbp_gsm_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">CTOP Quantity *</label>
              <input required type="number" step="0.01" min="0" value={balanceForm.ctop_qty} onChange={e => setBalanceForm({...balanceForm, ctop_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">SIM Quantity *</label>
              <input required type="number" step="0.01" min="0" value={balanceForm.sim_qty} onChange={e => setBalanceForm({...balanceForm, sim_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0" />
            </div>
          </div>
          
          <button type="submit" disabled={isSubmitting} className={`w-full text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition mt-6 ${editingBalanceId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-900 hover:bg-slate-800'}`}>
            {isSubmitting ? "Committing..." : editingBalanceId ? "Update Balance Ledger" : "Lock Balance Entry"}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
          <h3 className="font-black tracking-widest uppercase text-xs">Recent Master Balances</h3>
          <button onClick={downloadCSV} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-[10px] font-bold shadow transition">📥 Export CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
              <tr>
                <th className="p-4 font-black">Date & Type</th>
                <th className="p-4 font-black">Master Location & CTOP</th>
                <th className="p-4 font-black text-right">CBP Landline (Qty)</th>
                <th className="p-4 font-black text-right">CBP GSM (Qty)</th>
                <th className="p-4 font-black text-right">CTOP (Qty)</th>
                <th className="p-4 font-black text-right">SIM (Qty)</th>
                <th className="p-4 font-black text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rawBalances.length === 0 ? (
                <tr><td colSpan={7} className="p-12 text-center text-slate-400 font-bold">No balance records logged yet.</td></tr>
              ) : (
                rawBalances.slice(0, 50).map((bal: any) => (
                  <tr key={bal.id} className={`transition ${editingBalanceId === bal.id ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                    <td className="p-4">
                      <p className="font-black text-slate-900">{bal.report_date}</p>
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border inline-block mt-1 ${bal.entry_type === 'Opening Balance' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                        {bal.entry_type}
                      </span>
                    </td>
                    <td className="p-4">
                      <p className="font-bold text-indigo-700">{bal.locations?.center_name}</p>
                      <p className="text-xs font-bold text-slate-500">CTOP: {bal.master_ctop_accounts?.master_ctop_no}</p>
                    </td>
                    <td className="p-4 text-right font-black text-slate-800">{Number(bal.cbp_landline_qty || 0).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-right font-black text-slate-800">{Number(bal.cbp_gsm_qty || 0).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-right font-black text-slate-800">{Number(bal.ctop_qty || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td className="p-4 text-right font-black text-slate-800">{Number(bal.sim_qty || 0).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-right">
                      <button onClick={() => handleEditBalance(bal)} disabled={isSubmitting} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black px-4 py-1.5 rounded border border-slate-300 text-[10px] uppercase tracking-widest transition shadow-sm">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}