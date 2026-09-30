"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// Formats YYYY-MM-DD strictly to DD/MM/YYYY for Indian locale UI Display
const formatToDDMMYYYY = (dateStr: string) => {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
};

export default function PartnerSalesReport() {
  const router = useRouter();
  const [partner, setPartner] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncError, setSyncError] = useState("");

  // Edit Mode State
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    report_date: new Date().toISOString().split("T")[0],
    cbp_landline_qty: 0, cbp_landline_amt: 0,
    cbp_gsm_qty: 0, cbp_gsm_amt: 0,
    ctop_recharge_qty: 0, ctop_recharge_amt: 0,
    sim_new_qty: 0,
    sim_postpaid_qty: 0, sim_postpaid_amt: 0,
    sim_upgrade_qty: 0,
    sim_replacement_qty: 0, sim_replacement_amt: 0,
    sim_fancy_qty: 0, sim_fancy_amt: 0,
    other_details: "", other_amt: 0,
    cheque_qty: 0, cheque_amt: 0,
    zero_business_reason: "", // Track reason for 0 business
  });

  useEffect(() => {
    const initialize = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.push("/partner/login");
          return;
        }
        
        // [FIX APPLIED]: Reverted to email-based query matching the Dashboard's bulletproof logic
        const { data: partnerData, error: partnerError } = await supabase
          .from("active_partners")
          .select("id, partner_name, role, center_id, locations(center_name)")
          .ilike("email", session.user.email || "")
          .maybeSingle();
          
        // The Hard Screen Lock. Prevents null 'id' rendering.
        if (!partnerData) {
          setSyncError("DATABASE DESYNC: Your partner profile could not be loaded. Please sign out and contact administration.");
          setLoading(false);
          return;
        }

        setPartner(partnerData);
        
        // AUTO-DETECT APPROVED EDITS: Forces partner to resolve approved edits before doing anything else
        const { data: approvedEdit } = await supabase
          .from("daily_sales_reports")
          .select("*")
          .eq("partner_id", partnerData.id)
          .eq("edit_request_status", "Approved")
          .limit(1)
          .maybeSingle();

        if (approvedEdit) {
          setIsEditMode(true);
          setEditingId(approvedEdit.id);
          setForm({
            report_date: approvedEdit.report_date,
            cbp_landline_qty: approvedEdit.cbp_landline_qty, cbp_landline_amt: approvedEdit.cbp_landline_amt,
            cbp_gsm_qty: approvedEdit.cbp_gsm_qty, cbp_gsm_amt: approvedEdit.cbp_gsm_amt,
            ctop_recharge_qty: approvedEdit.ctop_recharge_qty, ctop_recharge_amt: approvedEdit.ctop_recharge_amt,
            sim_new_qty: approvedEdit.sim_new_qty,
            sim_postpaid_qty: approvedEdit.sim_postpaid_qty, sim_postpaid_amt: approvedEdit.sim_postpaid_amt,
            sim_upgrade_qty: approvedEdit.sim_upgrade_qty,
            sim_replacement_qty: approvedEdit.sim_replacement_qty, sim_replacement_amt: approvedEdit.sim_replacement_amt,
            sim_fancy_qty: approvedEdit.sim_fancy_qty, sim_fancy_amt: approvedEdit.sim_fancy_amt,
            other_details: approvedEdit.other_details || "", other_amt: approvedEdit.other_amt,
            cheque_qty: approvedEdit.cheque_qty, cheque_amt: approvedEdit.cheque_amt,
            zero_business_reason: approvedEdit.zero_business_reason || "",
          });
        }
      } catch (err: any) {
        console.error("Init Error:", err.message);
      } finally {
        setLoading(false);
      }
    };
    initialize();
  }, [router]);

  const handleInputChange = (field: string, value: string) => {
    const isQtyField = field.includes('qty');
    const num = isQtyField ? parseInt(value, 10) : parseFloat(value);
    setForm(prev => ({ ...prev, [field]: isNaN(num) || num < 0 ? 0 : num }));
  };

  // --- AUTOMATED MASTER CALCULATIONS ---
  const totalCBP = form.cbp_landline_amt + form.cbp_gsm_amt;
  const totalCTOP = form.ctop_recharge_amt;
  const totalSimCash = form.sim_replacement_amt + form.sim_fancy_amt + form.sim_postpaid_amt;
  const totalOther = form.other_amt;
  
  const totalSimQty = form.sim_new_qty + form.sim_upgrade_qty + form.sim_postpaid_qty + form.sim_replacement_qty + form.sim_fancy_qty;
  const totalCashCollection = totalCBP + totalCTOP + totalSimCash + totalOther;

  // [ZERO ENTRY BLOCKER LOGIC]
  const isZeroBusiness = totalCashCollection === 0 && totalSimQty === 0 && form.cheque_amt === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!partner) return alert("System Error: Partner profile not loaded.");
    
    // Strict Verification: Prevents blank zero-submissions
    if (isZeroBusiness && !form.zero_business_reason) {
      return alert("Validation Error: You are attempting to submit a '0' entry. You must select a valid reason from the dropdown menu.");
    }

    setSubmitting(true);
    try {
      const reportDate = new Date(form.report_date);
      const today = new Date();
      const diffDays = Math.ceil(Math.abs(today.getTime() - reportDate.getTime()) / (1000 * 60 * 60 * 24)); 
      
      if (!isEditMode && diffDays > 7) throw new Error("You cannot submit a new report older than 7 days.");

      const finalStatus = isZeroBusiness ? 'No Deposit Required' : 'Pending Deposit';
      
      const payload = {
        partner_id: partner.id,
        center_id: partner.center_id,
        ...form,
        zero_business_reason: isZeroBusiness ? form.zero_business_reason : null,
        status: finalStatus
      };

      if (isEditMode && editingId) {
        // OVERWRITE PREVIOUS DATA & REMOVE THE EDIT LOCK
        const { error } = await supabase.from("daily_sales_reports").update({
          ...payload,
          edit_request_status: null,
          edit_request_reason: null
        }).eq("id", editingId);
        if (error) throw error;
        alert("✅ Sales Report Corrected Successfully! The ledger has been updated.");
      } else {
        // CREATE NEW DATA
        const { error } = await supabase.from("daily_sales_reports").insert([payload]);
        if (error) throw error;
        alert(isZeroBusiness 
          ? "✅ Zero Business Day Logged. No deposit required." 
          : "✅ Sales Report Saved! Please proceed to 'Deposit of Sales' to clear your ledger."
        );
      }
      
      router.push("/partner/dashboard");
    } catch (err: any) {
      alert("Error saving report: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => { 
    await supabase.auth.signOut(); 
    router.push("/partner/login"); 
  };

  if (loading) return <div className="p-20 text-center font-bold text-blue-600 animate-pulse">Loading System...</div>;

  // Render Error Lock Screen if DB desyncs
  if (syncError) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="bg-red-50 p-8 rounded-2xl shadow-sm border-2 border-red-200 max-w-lg w-full text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-black text-red-800 mb-3 uppercase tracking-widest">System Load Error</h2>
        <p className="text-sm font-bold text-red-900 mb-6 leading-relaxed">{syncError}</p>
        <button onClick={handleSignOut} className="bg-red-600 hover:bg-red-700 text-white font-black px-6 py-3 rounded-lg shadow transition w-full">
          Sign Out & Reset Session
        </button>
      </div>
    </div>
  );

  const numInputClass = "w-full border border-slate-300 p-2.5 rounded-md bg-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 font-bold text-slate-800 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        <div className="flex justify-between items-center border-b pb-4">
          <div>
            <Link href="/partner/dashboard" className="text-blue-600 font-bold text-sm mb-1 hover:underline block">
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900">{isEditMode ? "Correct Sales Report" : "Daily Sales Entry"}</h1>
            <p className="text-slate-500 font-medium">Center: {partner?.locations?.center_name}</p>
          </div>
        </div>

        {isEditMode && (
          <div className="bg-amber-100 border border-amber-300 p-4 rounded-xl shadow-sm animate-pulse">
            <h3 className="font-black text-amber-900 uppercase tracking-widest text-xs flex items-center gap-2"><span>⚠️</span> Action Required</h3>
            <p className="text-amber-800 text-sm font-bold mt-1">You are editing an approved correction for <span className="font-black text-lg bg-white px-2 py-0.5 rounded">{formatToDDMMYYYY(form.report_date)}</span>. You must submit this correction before doing anything else.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <label className="block text-slate-700 font-bold mb-1 text-sm uppercase">Report Date</label>
              <input 
                type="date" 
                required 
                disabled={isEditMode}
                value={form.report_date} 
                onChange={(e) => setForm({...form, report_date: e.target.value})} 
                className="w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500" 
              />
              <p className="text-xs text-red-600 font-bold mt-2">Reports older than 3 days may incur a ₹500/day penalty.</p>
            </div>
            <div className="flex-1 bg-slate-50 border border-slate-200 p-4 rounded-lg flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-500 tracking-widest">Format: DD/MM/YYYY</span>
              <span className="text-2xl font-black text-blue-700">{formatToDDMMYYYY(form.report_date)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            <div className="lg:col-span-8 space-y-6">
              
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-black text-slate-800 border-b border-slate-200 pb-2 mb-4">1. CBP Head Sales</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div><label className="text-xs font-bold text-slate-500">Landline Qty</label><input type="number" step="1" value={form.cbp_landline_qty || ''} onChange={(e) => handleInputChange('cbp_landline_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Landline ₹</label><input type="number" step="0.01" value={form.cbp_landline_amt || ''} onChange={(e) => handleInputChange('cbp_landline_amt', e.target.value)} placeholder="0.00" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">GSM Qty</label><input type="number" step="1" value={form.cbp_gsm_qty || ''} onChange={(e) => handleInputChange('cbp_gsm_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">GSM ₹</label><input type="number" step="0.01" value={form.cbp_gsm_amt || ''} onChange={(e) => handleInputChange('cbp_gsm_amt', e.target.value)} placeholder="0.00" className={numInputClass} /></div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-black text-slate-800 border-b border-slate-200 pb-2 mb-4">2. CTOP & SIM Tracking</h3>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div><label className="text-xs font-bold text-slate-500">CTOP Qty</label><input type="number" step="1" value={form.ctop_recharge_qty || ''} onChange={(e) => handleInputChange('ctop_recharge_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">CTOP ₹</label><input type="number" step="0.01" value={form.ctop_recharge_amt || ''} onChange={(e) => handleInputChange('ctop_recharge_amt', e.target.value)} placeholder="0.00" className={`${numInputClass} bg-blue-50 border-blue-200`} /></div>
                  <div><label className="text-xs font-bold text-slate-500">New SIM Qty</label><input type="number" step="1" value={form.sim_new_qty || ''} onChange={(e) => handleInputChange('sim_new_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Upgrade Qty</label><input type="number" step="1" value={form.sim_upgrade_qty || ''} onChange={(e) => handleInputChange('sim_upgrade_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div><label className="text-xs font-bold text-slate-500">Postpaid Qty</label><input type="number" step="1" value={form.sim_postpaid_qty || ''} onChange={(e) => handleInputChange('sim_postpaid_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Postpaid ₹</label><input type="number" step="0.01" value={form.sim_postpaid_amt || ''} onChange={(e) => handleInputChange('sim_postpaid_amt', e.target.value)} placeholder="0.00" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Replace Qty</label><input type="number" step="1" value={form.sim_replacement_qty || ''} onChange={(e) => handleInputChange('sim_replacement_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Replace ₹</label><input type="number" step="0.01" value={form.sim_replacement_amt || ''} onChange={(e) => handleInputChange('sim_replacement_amt', e.target.value)} placeholder="0.00" className={`${numInputClass} bg-blue-50 border-blue-200`} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Fancy Qty</label><input type="number" step="1" value={form.sim_fancy_qty || ''} onChange={(e) => handleInputChange('sim_fancy_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Fancy ₹</label><input type="number" step="0.01" value={form.sim_fancy_amt || ''} onChange={(e) => handleInputChange('sim_fancy_amt', e.target.value)} placeholder="0.00" className={`${numInputClass} bg-blue-50 border-blue-200`} /></div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-black text-slate-800 border-b border-slate-200 pb-2 mb-4">3. Cheque & Other Adjustments</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div><label className="text-xs font-bold text-slate-500">Cheque Qty</label><input type="number" step="1" value={form.cheque_qty || ''} onChange={(e) => handleInputChange('cheque_qty', e.target.value)} placeholder="0" className={numInputClass} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Total Cheque ₹</label><input type="number" step="0.01" value={form.cheque_amt || ''} onChange={(e) => handleInputChange('cheque_amt', e.target.value)} placeholder="0.00" className={`${numInputClass} bg-amber-50 border-amber-200 text-amber-900`} /></div>
                  <div><label className="text-xs font-bold text-slate-500">Other Details</label><input type="text" value={form.other_details} onChange={(e) => setForm({...form, other_details: e.target.value})} placeholder="Remarks..." className="w-full border border-slate-300 p-2.5 rounded-md bg-white outline-none focus:ring-2 focus:ring-blue-200" /></div>
                  <div><label className="text-xs font-bold text-slate-500">Other Cash ₹</label><input type="number" step="0.01" value={form.other_amt || ''} onChange={(e) => handleInputChange('other_amt', e.target.value)} placeholder="0.00" className={numInputClass} /></div>
                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: The Master Dashboard & Submit */}
            <div className="lg:col-span-4">
              <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden sticky top-8">
                <div className="bg-slate-950 p-4 border-b border-slate-800">
                  <h3 className="font-black text-white text-lg tracking-wide">Live Sales Summary</h3>
                </div>
                
                <div className="p-5 space-y-4">
                  
                  <div className="bg-slate-800 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-center text-sm"><span className="text-slate-400 font-bold">CBP Cash:</span><span className="text-white font-black">₹{totalCBP.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between items-center text-sm"><span className="text-slate-400 font-bold">CTOP Cash:</span><span className="text-white font-black">₹{totalCTOP.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between items-center text-sm"><span className="text-slate-400 font-bold">SIM Cash:</span><span className="text-white font-black">₹{totalSimCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                    {totalOther > 0 && <div className="flex justify-between items-center text-sm text-yellow-400"><span className="font-bold">Other Cash:</span><span className="font-black">₹{totalOther.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-900/40 border border-blue-800/50 rounded-lg p-3 text-center"><p className="text-[10px] text-blue-300 font-black uppercase tracking-widest">Total SIMs</p><p className="text-xl text-blue-100 font-black">{totalSimQty} <span className="text-sm font-medium">Qty</span></p></div>
                    <div className="bg-amber-900/40 border border-amber-800/50 rounded-lg p-3 text-center"><p className="text-[10px] text-amber-300 font-black uppercase tracking-widest">Cheque Value</p><p className="text-lg text-amber-100 font-black">₹{form.cheque_amt.toLocaleString('en-IN')}</p></div>
                  </div>

                  <div className="pt-4 border-t border-slate-700 text-center">
                    <p className="text-green-400 font-black uppercase text-xs tracking-widest mb-1">Total Cash Generated</p>
                    <h2 className="text-4xl font-black text-white">₹{totalCashCollection.toLocaleString('en-IN')}</h2>
                  </div>

                  {/* ZERO BUSINESS MENU TRIGGER */}
                  {isZeroBusiness && (
                    <div className="mt-4 bg-amber-50 p-4 rounded-lg border-2 border-amber-400 animate-in fade-in zoom-in-95">
                      <label className="block text-[10px] font-black uppercase tracking-widest text-amber-900 mb-2">⚠️ '0' Entry Detected - Select Reason *</label>
                      <select 
                        required 
                        value={form.zero_business_reason} 
                        onChange={(e) => setForm({...form, zero_business_reason: e.target.value})}
                        className="w-full border-2 border-amber-300 p-2.5 rounded text-sm font-bold bg-white text-amber-900 outline-none focus:border-amber-600"
                      >
                        <option value="" disabled>-- Select Reason --</option>
                        <option value="ABSENT">1. ABSENT</option>
                        <option value="NO BUSINESS">2. NO BUSINESS</option>
                        <option value="TECHNICAL ISSUES">3. TECHNICAL ISSUES</option>
                        <option value="OTHER REASONS">4. OTHER REASONS</option>
                      </select>
                    </div>
                  )}

                </div>

                <div className="p-4 bg-slate-950">
                  <button 
                    type="submit" 
                    disabled={submitting || (isZeroBusiness && !form.zero_business_reason)} 
                    className="w-full py-4 bg-green-500 hover:bg-green-600 text-slate-900 font-black text-lg rounded-xl transition shadow-md disabled:bg-slate-600 disabled:text-slate-400"
                  >
                    {submitting ? "Saving Data..." : isEditMode ? "Update Sales Report" : isZeroBusiness ? "Submit Zero Business Day" : "Submit Sales Report"}
                  </button>
                </div>
              </div>
            </div>

          </div>
        </form>

        <div className="flex gap-4 justify-center mt-8">
          <Link href="/partner/stock" className="text-slate-500 font-bold text-sm hover:text-blue-600 hover:underline">📦 Stock Requisitions</Link>
          <span className="text-slate-300">|</span>
          <Link href="/partner/deposit" className="text-slate-500 font-bold text-sm hover:text-blue-600 hover:underline">💳 Deposit of Sales</Link> 
        </div>

      </div>
    </div>
  );
}