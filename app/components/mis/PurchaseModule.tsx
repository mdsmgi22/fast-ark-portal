"use client";
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function PurchaseModule({ hqLocations, mappedMasterCtops, rawPurchases, fetchArchitectureAndReports }: any) {
  const [purchaseMode, setPurchaseMode] = useState<'entry' | 'ledger'>('entry');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  
  const [purchaseForm, setPurchaseForm] = useState({
    purchase_date: new Date().toISOString().split('T')[0],
    master_ctop_id: "", 
    product_category: "CBP",
    qty: "",
    amount: "",
    commission_percent: "5.81",
    manual_qty_override: false, 
  });

  const [purMonthFilter, setPurMonthFilter] = useState(new Date().toISOString().substring(0, 7));
  const [purHqFilter, setPurHqFilter] = useState("ALL");

  useEffect(() => {
    if (purchaseForm.manual_qty_override) return; 

    const amt = parseFloat(purchaseForm.amount) || 0;

    if (purchaseForm.product_category === "CBP" || purchaseForm.product_category === "SIM_FREE" || purchaseForm.product_category === "SIM_PAID") {
      setPurchaseForm(prev => ({ ...prev, qty: amt.toString() }));
    } else if (purchaseForm.product_category === "CTOP") {
      const pct = parseFloat(purchaseForm.commission_percent) || 0;
      const comm = (amt * pct) / 100;
      const total = (amt + comm).toFixed(2); 
      setPurchaseForm(prev => ({ ...prev, qty: total.toString() }));
    }
  }, [purchaseForm.amount, purchaseForm.commission_percent, purchaseForm.product_category, purchaseForm.manual_qty_override]);

  const preventNegativeScroll = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') e.preventDefault();
  };
  
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseForm.master_ctop_id) return alert("You must select a Master CTOP to log procurement against.");
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const isCTOP = purchaseForm.product_category === 'CTOP';
      const amtDb = parseFloat(purchaseForm.amount) || 0;
      const pctDb = parseFloat(purchaseForm.commission_percent) || 0;
      const commValue = isCTOP ? (amtDb * pctDb) / 100 : 0;
      const selectedMaster = mappedMasterCtops.find((m: any) => m.id === purchaseForm.master_ctop_id);

      const payload = {
        purchase_date: purchaseForm.purchase_date,
        location_id: selectedMaster?.location_id || null, 
        master_ctop_id: purchaseForm.master_ctop_id,
        product_category: purchaseForm.product_category,
        qty: parseFloat(purchaseForm.qty) || 0,
        amount: amtDb,
        commission_percent: isCTOP ? pctDb : null,
        commission_value: commValue,
        logged_by: user.id
      };

      if (editingPurchaseId) {
        await supabase.from('mis_purchases').update(payload).eq('id', editingPurchaseId);
        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id, staff_email: user.email, action_type: 'MIS_EDIT', module: 'MANAGER_MIS',
          target_id: editingPurchaseId, details: `Modified Procurement.`
        }]);
        alert("✅ Central Purchase Ledger Updated.");
      } else {
        const { data: insertedRecord, error } = await supabase.from('mis_purchases').insert([payload]).select().single();
        if (error) throw error;

        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id, staff_email: user.email, action_type: 'MIS_ENTRY', module: 'MANAGER_MIS',
          target_id: insertedRecord.id, details: `Procured: ${payload.qty}x ${purchaseForm.product_category} into Master CTOP ${selectedMaster?.master_ctop_no}.`
        }]);
        alert("✅ Central Purchase Ledger Inserted.");
      }

      setEditingPurchaseId(null);
      setPurchaseForm({ 
        purchase_date: new Date().toISOString().split('T')[0], master_ctop_id: "", product_category: "CBP", 
        qty: "", amount: "", commission_percent: "5.81", manual_qty_override: false 
      }); 
      setPurchaseMode('ledger');
      fetchArchitectureAndReports(); 
    } catch (err: any) {
      alert("Error saving purchase: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditPurchase = (pur: any) => {
    setEditingPurchaseId(pur.id);
    setPurchaseForm({
      purchase_date: pur.purchase_date,
      master_ctop_id: pur.master_ctop_id,
      product_category: pur.product_category,
      qty: pur.qty?.toString() || "",
      amount: pur.amount?.toString() || "",
      commission_percent: pur.commission_percent?.toString() || "5.81",
      manual_qty_override: true, 
    });
    setPurchaseMode('entry');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelPurchaseEdit = () => {
    setEditingPurchaseId(null);
    setPurchaseForm({ 
      purchase_date: new Date().toISOString().split('T')[0], master_ctop_id: "", product_category: "CBP", 
      qty: "", amount: "", commission_percent: "5.81", manual_qty_override: false 
    });
  };

  const filteredPurchases = rawPurchases.filter((p: any) => {
    let mMatch = purMonthFilter === "ALL" || p.purchase_date.startsWith(purMonthFilter);
    let hMatch = purHqFilter === "ALL" || p.master_ctop_accounts?.location_id?.toString() === purHqFilter;
    return mMatch && hMatch;
  });

  const purTotalCBP = filteredPurchases.filter((p: any) => p.product_category === 'CBP').reduce((s: number, p: any) => s + Number(p.qty || 0), 0);
  const purTotalCTOP = filteredPurchases.filter((p: any) => p.product_category === 'CTOP').reduce((s: number, p: any) => s + Number(p.qty || 0), 0);
  const purTotalSIMFree = filteredPurchases.filter((p: any) => p.product_category === 'SIM_FREE').reduce((s: number, p: any) => s + Number(p.qty || 0), 0);
  const purTotalSIMPaid = filteredPurchases.filter((p: any) => p.product_category === 'SIM_PAID').reduce((s: number, p: any) => s + Number(p.qty || 0), 0);

  const downloadCSV = () => {
    if (filteredPurchases.length === 0) return alert("No data available to export.");
    const csvContent = "Date,Location,CTOP,Product,Qty,Amount_INR\n" + 
      filteredPurchases.map((r: any) => 
      `${r.purchase_date},${sanitizeCSV(r.master_ctop_accounts?.locations?.center_name || 'N/A')},${r.master_ctop_accounts?.master_ctop_no},${r.product_category},${r.qty},${r.amount}`
    ).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_MIS_Purchases_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const liveAmt = parseFloat(purchaseForm.amount) || 0;
  const livePct = parseFloat(purchaseForm.commission_percent) || 0;
  const liveComm = (liveAmt * livePct) / 100;

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex gap-2">
        <button onClick={() => setPurchaseMode('entry')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded transition ${purchaseMode === 'entry' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>📝 Log Procurement</button>
        <button onClick={() => setPurchaseMode('ledger')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded transition ${purchaseMode === 'ledger' ? 'bg-indigo-600 text-white shadow' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>📊 View Ledger & Reports</button>
      </div>

      {purchaseMode === 'entry' ? (
        <div className={`bg-white rounded-xl shadow-sm border p-6 animate-in fade-in ${editingPurchaseId ? 'border-amber-300' : 'border-slate-200'}`}>
          <div className={`p-4 rounded-lg mb-6 flex justify-between items-center ${editingPurchaseId ? 'bg-amber-100' : 'bg-slate-900 text-white'}`}>
            <div className="flex items-center gap-4">
              <span className="text-3xl">🏛️</span>
              <div>
                <h2 className={`font-black uppercase tracking-widest ${editingPurchaseId ? 'text-amber-900' : 'text-white'}`}>
                  {editingPurchaseId ? 'Edit Procurement Entry' : 'Master Procurement Entry'}
                </h2>
              </div>
            </div>
            {editingPurchaseId && <button onClick={cancelPurchaseEdit} className="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-2 rounded text-xs uppercase transition">Cancel Edit</button>}
          </div>

          <form onSubmit={handlePurchaseSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="md:col-span-3">
                <label className="block text-xs font-black text-indigo-600 uppercase tracking-widest mb-1.5">Target Master CTOP (HQ) *</label>
                <select required value={purchaseForm.master_ctop_id} onChange={e => setPurchaseForm({...purchaseForm, master_ctop_id: e.target.value})} className="w-full border-2 border-indigo-200 p-3 rounded-lg outline-none font-black text-indigo-900 focus:border-indigo-600 bg-indigo-50">
                  <option value="" disabled>-- Select Master CTOP --</option>
                  {mappedMasterCtops.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.master_ctop_no} {m.locations?.center_name ? `(${m.locations.center_name})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Purchase Date</label>
                <input required type="date" value={purchaseForm.purchase_date} onChange={e => setPurchaseForm({...purchaseForm, purchase_date: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none font-bold focus:border-indigo-500" />
              </div>
              
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Product Category</label>
                <select value={purchaseForm.product_category} onChange={e => setPurchaseForm({...purchaseForm, product_category: e.target.value, manual_qty_override: false})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none font-bold focus:border-indigo-500 bg-slate-50">
                  <option value="CBP">CBP</option>
                  <option value="CTOP">CTOP</option>
                  <option value="SIM_FREE">SIM (Free)</option>
                  <option value="SIM_PAID">SIM (Paid)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Purchase Amount (₹)</label>
                <input required type="number" step="0.01" min="0" value={purchaseForm.amount} onChange={e => setPurchaseForm({...purchaseForm, amount: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="Enter Amount" />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Final Quantity</label>
                  {(purchaseForm.product_category === 'CBP' || purchaseForm.product_category === 'CTOP') && (
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={purchaseForm.manual_qty_override} 
                        onChange={(e) => setPurchaseForm({...purchaseForm, manual_qty_override: e.target.checked})}
                        className="accent-indigo-600"
                      />
                      <span className="text-[9px] font-bold text-indigo-600 uppercase">Override</span>
                    </label>
                  )}
                </div>
                <input 
                  required type="number" step="0.01" min="0" 
                  value={purchaseForm.qty} 
                  onChange={e => setPurchaseForm({...purchaseForm, qty: e.target.value})} 
                  onKeyDown={preventNegativeScroll} onWheel={handleWheel}
                  disabled={(purchaseForm.product_category === 'CBP' || purchaseForm.product_category === 'CTOP') && !purchaseForm.manual_qty_override}
                  className={`${numInputClass} ${((purchaseForm.product_category === 'CBP' || purchaseForm.product_category === 'CTOP') && !purchaseForm.manual_qty_override) ? 'bg-slate-100 cursor-not-allowed opacity-80 border-dashed' : ''}`} 
                  placeholder={purchaseForm.product_category === 'CBP' || purchaseForm.product_category === 'CTOP' ? 'Auto-calculating...' : 'Enter Quantity'}
                />
              </div>

              {purchaseForm.product_category === 'CTOP' && (
                <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200 md:col-span-2 flex gap-4 items-center">
                  <div className="flex-1">
                    <label className="block text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-1.5">Manual Commission %</label>
                    <input required type="number" step="0.01" min="0" value={purchaseForm.commission_percent} onChange={e => setPurchaseForm({...purchaseForm, commission_percent: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className="w-full border border-indigo-300 p-2 rounded outline-none font-black text-indigo-900" />
                  </div>
                  <div className="flex-1 bg-white p-2 rounded text-center border border-indigo-100 shadow-sm">
                    <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">Calculated Payout</p>
                    <p className="text-xl text-indigo-600 font-black">₹{liveComm.toFixed(2)}</p>
                  </div>
                </div>
              )}
            </div>
            
            <button type="submit" disabled={isSubmitting || !purchaseForm.master_ctop_id} className={`w-full text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition mt-6 ${editingPurchaseId ? 'bg-amber-600' : 'bg-slate-900'}`}>
              {isSubmitting ? "Logging Procurement..." : editingPurchaseId ? "Update Ledger" : "Submit to Master Ledger"}
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
          <div className="bg-slate-900 p-4 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h3 className="font-black uppercase tracking-widest text-white text-sm">Stock Purchase Reports</h3>
            <div className="flex gap-3">
              <input type="month" value={purMonthFilter} onChange={(e) => setPurMonthFilter(e.target.value)} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded outline-none focus:border-indigo-400 transition" />
              <select value={purHqFilter} onChange={(e) => setPurHqFilter(e.target.value)} className="bg-slate-800 border border-slate-700 text-white text-xs font-bold p-2 rounded max-w-[200px] outline-none focus:border-indigo-400 transition">
                <option value="ALL">All HQ Locations</option>
                {hqLocations.map((h: any) => <option key={h.id} value={h.id}>{h.center_name}</option>)}
              </select>
              <button onClick={downloadCSV} className="bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded text-[10px] font-black text-white uppercase shadow transition">📥 Full CSV</button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 border-b border-slate-200">
            <div className="bg-white p-4 text-center"><p className="text-[10px] font-black text-slate-500 uppercase">CBP Purchased</p><p className="text-xl font-black text-indigo-700">{purTotalCBP.toLocaleString()}</p></div>
            <div className="bg-white p-4 text-center"><p className="text-[10px] font-black text-slate-500 uppercase">CTOP Purchased</p><p className="text-xl font-black text-indigo-700">{purTotalCTOP.toLocaleString()}</p></div>
            <div className="bg-white p-4 text-center"><p className="text-[10px] font-black text-slate-500 uppercase">SIM (Free) Purchased</p><p className="text-xl font-black text-indigo-700">{purTotalSIMFree.toLocaleString()}</p></div>
            <div className="bg-white p-4 text-center"><p className="text-[10px] font-black text-slate-500 uppercase">SIM (Paid) Purchased</p><p className="text-xl font-black text-indigo-700">{purTotalSIMPaid.toLocaleString()}</p></div>
          </div>
          
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 sticky top-0 border-b border-slate-200 shadow-sm z-10">
                <tr><th className="p-4">Date</th><th className="p-4">Location & CTOP</th><th className="p-4">Product</th><th className="p-4 text-right">Qty</th><th className="p-4 text-right">Amount (₹)</th><th className="p-4 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPurchases.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-black text-slate-800">{p.purchase_date}</td>
                    <td className="p-4 font-bold text-indigo-700">{p.master_ctop_accounts?.locations?.center_name} <span className="text-slate-500 block text-xs">{p.master_ctop_accounts?.master_ctop_no}</span></td>
                    <td className="p-4 font-black text-slate-700">{p.product_category}</td>
                    <td className="p-4 text-right font-black text-slate-800">{p.qty}</td>
                    <td className="p-4 text-right font-black text-slate-800">₹{Number(p.amount).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td className="p-4 text-right">
                      <button onClick={() => handleEditPurchase(p)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black px-4 py-1.5 rounded border border-slate-300 text-[10px] uppercase tracking-widest transition shadow-sm">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredPurchases.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500 font-bold">No purchase records found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}