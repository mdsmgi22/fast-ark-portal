"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function ManagerMISDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'purchase' | 'sales' | 'collection' | 'report'>('purchase');

  // Architecture Data
  const [locations, setLocations] = useState<any[]>([]);
  const [masterCtops, setMasterCtops] = useState<any[]>([]);
  const [agentMappings, setAgentMappings] = useState<any[]>([]);

  // Global Filter State
  const [selectedLocId, setSelectedLocId] = useState("");
  const [reportingMonth, setReportingMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM format
  
  // Tab 1: Purchase Form State
  const [purchaseForm, setPurchaseForm] = useState({
    purchase_date: new Date().toISOString().split('T')[0],
    master_ctop_id: "",
    product_category: "CBP",
    qty: 0,
    amount: 0,
    commission_percent: 5.81,
  });

  // Tab 2: Sales Form State (OCSC)
  const [ocscSales, setOcscSales] = useState({
    cbp_landline_cash: 0, cbp_gsm_cash: 0, ctop_recharge_cash: 0,
    sim_replace_qty: 0, sim_replace_cash: 0,
    sim_fancy_qty: 0, sim_fancy_cash: 0,
    sim_other_qty: 0, sim_other_cash: 0,
  });

  // Tab 2: Sales Form State (CM - Array of agents)
  const [cmSales, setCmSales] = useState<{agent_ctop_no: string, qty: number}[]>([]);

  // Tab 3: Collection Form State
  const [collectionForm, setCollectionForm] = useState({
    total_cash_collected: 0,
    remarks: ""
  });

  useEffect(() => {
    fetchArchitecture();
  }, []);

  // Fetch relevant CM agents when location changes
  useEffect(() => {
    if (selectedLocId) {
      const locIdInt = parseInt(selectedLocId); // BIGINT Casting
      const filteredAgents = agentMappings.filter(a => a.active_partners?.locations?.id === locIdInt);
      setCmSales(filteredAgents.map(a => ({ agent_ctop_no: a.agent_ctop_no, qty: 0 })));
    } else {
      setCmSales([]);
    }
  }, [selectedLocId, agentMappings]);

  const fetchArchitecture = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const [locRes, masterRes, agentRes] = await Promise.all([
        supabase.from("locations").select("*").or("role_ocsc.eq.true,role_cm.eq.true").order("center_name"),
        supabase.from("master_ctop_accounts").select("*"),
        supabase.from("agent_ctop_mappings").select("*, active_partners(locations(id))")
      ]);

      setLocations(locRes.data || []);
      setMasterCtops(masterRes.data || []);
      setAgentMappings(agentRes.data || []);
    } catch (err: any) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getActiveLocationType = () => {
    if (!selectedLocId) return null;
    const locIdInt = parseInt(selectedLocId);
    const loc = locations.find(l => l.id === locIdInt);
    if (!loc) return null;
    return loc.role_ocsc ? 'OCSC' : 'CM';
  };

  // --- TELEMETRY & SUBMISSION ENGINE ---

  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocId) return alert("Select a location first.");
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const isCTOP = purchaseForm.product_category === 'CTOP';
      const commValue = isCTOP ? (purchaseForm.amount * purchaseForm.commission_percent) / 100 : 0;

      const payload = {
        purchase_date: purchaseForm.purchase_date,
        location_id: parseInt(selectedLocId), // Safely cast to BIGINT
        master_ctop_id: purchaseForm.master_ctop_id || null, // FIXED: Left as UUID string
        product_category: purchaseForm.product_category,
        qty: purchaseForm.qty,
        amount: purchaseForm.amount,
        commission_percent: isCTOP ? purchaseForm.commission_percent : null,
        commission_value: commValue,
        logged_by: user.id
      };

      const { data: insertedRecord, error } = await supabase.from('mis_purchases').insert([payload]).select().single();
      if (error) throw error;

      // TELEMETRY LOGGING
      await supabase.from('staff_activity_logs').insert([{
        staff_id: user.id,
        staff_email: user.email,
        action_type: 'MIS_ENTRY',
        module: 'MANAGER_MIS',
        target_id: insertedRecord.id,
        details: `Logged MIS Purchase: ${purchaseForm.qty}x ${purchaseForm.product_category} valued at ₹${purchaseForm.amount}.`
      }]);

      alert("✅ Purchase Ledger Updated.");
      setPurchaseForm({ ...purchaseForm, qty: 0, amount: 0 }); // Reset amounts
    } catch (err: any) {
      alert("Error saving purchase: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSalesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocId || !reportingMonth) return alert("Select location and month.");
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const centerType = getActiveLocationType();
      const dbReportingMonth = `${reportingMonth}-01`;

      // 1. Insert Parent Monthly Record
      const parentPayload = {
        reporting_month: dbReportingMonth,
        location_id: parseInt(selectedLocId), // Safely cast to BIGINT
        center_type: centerType,
        logged_by: user.id,
        ...(centerType === 'OCSC' ? ocscSales : {}) 
      };

      const { data: parentRecord, error: parentError } = await supabase
        .from('mis_monthly_sales')
        .insert([parentPayload])
        .select()
        .single();

      if (parentError) throw parentError;

      // 2. Insert CM Child Records (If applicable)
      if (centerType === 'CM' && cmSales.length > 0) {
        const childPayloads = cmSales.map(agent => ({
          monthly_sales_id: parentRecord.id,
          agent_ctop_no: agent.agent_ctop_no,
          qty: agent.qty
        })).filter(payload => payload.qty > 0); 

        if (childPayloads.length > 0) {
          const { error: childError } = await supabase.from('mis_cm_agent_sales').insert(childPayloads);
          if (childError) throw childError;
        }
      }

      // 3. TELEMETRY LOGGING
      await supabase.from('staff_activity_logs').insert([{
        staff_id: user.id,
        staff_email: user.email,
        action_type: 'MIS_CLOSURE',
        module: 'MANAGER_MIS',
        target_id: parentRecord.id,
        details: `Submitted Consolidated MIS Sales for ${centerType} location. Month: ${reportingMonth}`
      }]);

      alert(`✅ Monthly Sales for ${reportingMonth} successfully locked.`);
    } catch (err: any) {
      if (err.message.includes('unique constraint')) {
        alert("❌ Blocked: Sales for this location and month have already been submitted.");
      } else {
        alert("Error saving sales: " + err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocId || !reportingMonth) return alert("Select location and month.");
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const dbReportingMonth = `${reportingMonth}-01`;

      const payload = {
        reporting_month: dbReportingMonth,
        location_id: parseInt(selectedLocId), // Safely cast to BIGINT
        total_cash_collected: collectionForm.total_cash_collected,
        remarks: collectionForm.remarks,
        logged_by: user.id
      };

      const { data: colRecord, error } = await supabase.from('mis_monthly_collections').insert([payload]).select().single();
      if (error) throw error;

      // TELEMETRY LOGGING
      await supabase.from('staff_activity_logs').insert([{
        staff_id: user.id,
        staff_email: user.email,
        action_type: 'MIS_CLOSURE',
        module: 'MANAGER_MIS',
        target_id: colRecord.id,
        details: `Declared Total Cash Collection of ₹${collectionForm.total_cash_collected} for ${reportingMonth}.`
      }]);

      alert(`✅ Collection for ${reportingMonth} successfully logged.`);
      setCollectionForm({ total_cash_collected: 0, remarks: "" });
    } catch (err: any) {
      if (err.message.includes('unique constraint')) {
        alert("❌ Blocked: Collection for this location and month has already been declared.");
      } else {
        alert("Error saving collection: " + err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
    </div>
  );

  const locType = getActiveLocationType();

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-slate-50 min-h-screen font-sans">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-slate-200 pb-6 gap-4">
        <div>
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline mb-2 inline-block text-sm">
            &larr; Back to Command Center
          </Link>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <span className="text-4xl">📊</span> Manager MIS Dashboard
          </h1>
          <p className="text-slate-500 font-medium mt-1">Internal Purchase, Sales, Commission, and Collection Modules.</p>
        </div>
      </div>

      {/* MASTER FILTER RIBBON */}
      <div className="bg-slate-900 p-5 rounded-xl shadow-lg border border-slate-800 flex flex-col md:flex-row gap-6 mb-8 animate-in fade-in">
        <div className="flex-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Target Location *</label>
          <select 
            value={selectedLocId} 
            onChange={(e) => setSelectedLocId(e.target.value)}
            className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-500 transition"
          >
            <option value="" disabled>-- Select OCSC or CM Center --</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.center_name} ({l.role_ocsc ? 'OCSC' : 'CM'})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Reporting Month Context</label>
          <input 
            type="month" 
            value={reportingMonth} 
            onChange={(e) => setReportingMonth(e.target.value)}
            className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-500 transition"
          />
        </div>
        <div className="flex flex-col justify-end">
          <div className="bg-slate-800 px-4 py-2.5 rounded-lg border border-slate-700 text-center">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Center Mode</p>
            <p className={`font-black tracking-widest uppercase ${locType === 'OCSC' ? 'text-blue-400' : locType === 'CM' ? 'text-emerald-400' : 'text-slate-600'}`}>
              {locType || 'NONE'}
            </p>
          </div>
        </div>
      </div>

      {/* TAB NAVIGATION */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-px">
        <button onClick={() => setActiveTab('purchase')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'purchase' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>1. Purchase</button>
        <button onClick={() => setActiveTab('sales')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'sales' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>2. Sales (Monthly)</button>
        <button onClick={() => setActiveTab('collection')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'collection' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>3. Collection</button>
      </div>

      {/* TAB 1: PURCHASE ENGINE */}
      {activeTab === 'purchase' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-in fade-in slide-in-from-bottom-4">
          <h2 className="text-lg font-black text-slate-800 border-b pb-2 mb-6">Ad-Hoc Purchase Entry</h2>
          <form onSubmit={handlePurchaseSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Purchase Date</label>
                <input required type="date" value={purchaseForm.purchase_date} onChange={e => setPurchaseForm({...purchaseForm, purchase_date: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none font-bold focus:border-indigo-500" />
              </div>
              
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Product Category</label>
                <select value={purchaseForm.product_category} onChange={e => setPurchaseForm({...purchaseForm, product_category: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none font-bold focus:border-indigo-500 bg-slate-50">
                  <option value="CBP">CBP</option>
                  <option value="CTOP">CTOP</option>
                  <option value="SIM_FREE">SIM (Free)</option>
                  <option value="SIM_PAID">SIM (Paid)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Master CTOP Anchor (Optional)</label>
                <select value={purchaseForm.master_ctop_id} onChange={e => setPurchaseForm({...purchaseForm, master_ctop_id: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none font-bold focus:border-indigo-500 bg-slate-50">
                  <option value="">-- No Anchor --</option>
                  {masterCtops.map(m => <option key={m.id} value={m.id}>{m.master_ctop_no}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Quantity</label>
                <input required type="number" min="0" value={purchaseForm.qty} onChange={e => setPurchaseForm({...purchaseForm, qty: Number(e.target.value)})} className={numInputClass} />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Amount (₹)</label>
                <input required type="number" step="0.01" min="0" value={purchaseForm.amount} onChange={e => setPurchaseForm({...purchaseForm, amount: Number(e.target.value)})} className={numInputClass} />
              </div>

              {purchaseForm.product_category === 'CTOP' && (
                <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                  <label className="block text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-1.5">Manual Commission %</label>
                  <input required type="number" step="0.01" value={purchaseForm.commission_percent} onChange={e => setPurchaseForm({...purchaseForm, commission_percent: Number(e.target.value)})} className="w-full border border-indigo-300 p-2 rounded outline-none font-black text-indigo-900" />
                  <p className="text-[10px] text-indigo-600 font-bold mt-2 uppercase">Instant Payout: ₹{((purchaseForm.amount * purchaseForm.commission_percent) / 100).toFixed(2)}</p>
                </div>
              )}
            </div>
            
            <button type="submit" disabled={isSubmitting || !selectedLocId} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition">
              {isSubmitting ? "Logging Purchase..." : "Submit to Purchase Ledger"}
            </button>
          </form>
        </div>
      )}

      {/* TAB 2: MONTHLY SALES ENGINE */}
      {activeTab === 'sales' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex justify-between items-end border-b pb-2 mb-6">
            <div>
              <h2 className="text-lg font-black text-slate-800">Monthly Sales Ledger</h2>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Closing Month: {reportingMonth}</p>
            </div>
            {locType && <span className={`px-3 py-1 rounded text-xs font-black uppercase border ${locType === 'OCSC' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200'}`}>{locType} Mode Active</span>}
          </div>

          {!locType ? (
            <div className="text-center p-8 bg-slate-50 rounded-xl border border-slate-200">
              <p className="font-bold text-slate-500">Please select an OCSC or CM Target Location from the top ribbon.</p>
            </div>
          ) : (
            <form onSubmit={handleSalesSubmit} className="space-y-6">
              
              {/* OCSC DYNAMIC GRID */}
              {locType === 'OCSC' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded">CBP & CTOP Cash</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP Landline Cash</label><input type="number" step="0.01" value={ocscSales.cbp_landline_cash} onChange={e => setOcscSales({...ocscSales, cbp_landline_cash: Number(e.target.value)})} className={numInputClass} /></div>
                      <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP GSM Cash</label><input type="number" step="0.01" value={ocscSales.cbp_gsm_cash} onChange={e => setOcscSales({...ocscSales, cbp_gsm_cash: Number(e.target.value)})} className={numInputClass} /></div>
                      <div className="col-span-2"><label className="text-[10px] font-bold text-slate-500 uppercase">CTOP Recharge Cash</label><input type="number" step="0.01" value={ocscSales.ctop_recharge_cash} onChange={e => setOcscSales({...ocscSales, ctop_recharge_cash: Number(e.target.value)})} className={`${numInputClass} bg-indigo-50 border-indigo-200`} /></div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded">SIM Cash & Qty</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-[10px] font-bold text-slate-500 uppercase">Replace Qty</label><input type="number" value={ocscSales.sim_replace_qty} onChange={e => setOcscSales({...ocscSales, sim_replace_qty: Number(e.target.value)})} className={numInputClass} /></div>
                      <div><label className="text-[10px] font-bold text-slate-500 uppercase">Replace Cash</label><input type="number" step="0.01" value={ocscSales.sim_replace_cash} onChange={e => setOcscSales({...ocscSales, sim_replace_cash: Number(e.target.value)})} className={numInputClass} /></div>
                      <div><label className="text-[10px] font-bold text-slate-500 uppercase">Fancy Qty</label><input type="number" value={ocscSales.sim_fancy_qty} onChange={e => setOcscSales({...ocscSales, sim_fancy_qty: Number(e.target.value)})} className={numInputClass} /></div>
                      <div><label className="text-[10px] font-bold text-slate-500 uppercase">Fancy Cash</label><input type="number" step="0.01" value={ocscSales.sim_fancy_cash} onChange={e => setOcscSales({...ocscSales, sim_fancy_cash: Number(e.target.value)})} className={numInputClass} /></div>
                      <div><label className="text-[10px] font-bold text-slate-500 uppercase">Other Qty</label><input type="number" value={ocscSales.sim_other_qty} onChange={e => setOcscSales({...ocscSales, sim_other_qty: Number(e.target.value)})} className={numInputClass} /></div>
                      <div><label className="text-[10px] font-bold text-slate-500 uppercase">Other Cash</label><input type="number" step="0.01" value={ocscSales.sim_other_cash} onChange={e => setOcscSales({...ocscSales, sim_other_cash: Number(e.target.value)})} className={numInputClass} /></div>
                    </div>
                  </div>
                </div>
              )}

              {/* CM DYNAMIC AGENT GRID */}
              {locType === 'CM' && (
                <div>
                  <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded mb-4">Mapped Agent CTOP Volumes</h3>
                  {cmSales.length === 0 ? (
                    <p className="text-sm font-bold text-red-600 bg-red-50 p-4 border border-red-200 rounded">No agents mapped to this location's Master CTOPs.</p>
                  ) : (
                    <div className="space-y-3">
                      {cmSales.map((agent, idx) => (
                        <div key={agent.agent_ctop_no} className="flex justify-between items-center bg-slate-50 p-3 rounded border border-slate-200">
                          <span className="font-black text-slate-800 tracking-wider">Agent: {agent.agent_ctop_no}</span>
                          <div className="flex items-center gap-3">
                            <label className="text-[10px] font-bold uppercase text-slate-500">Sales Qty</label>
                            <input 
                              type="number" 
                              min="0"
                              value={agent.qty} 
                              onChange={(e) => {
                                const newSales = [...cmSales];
                                newSales[idx].qty = Number(e.target.value);
                                setCmSales(newSales);
                              }} 
                              className="border border-slate-300 p-2 rounded font-bold outline-none focus:border-indigo-500 w-32" 
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button type="submit" disabled={isSubmitting || (locType === 'CM' && cmSales.length === 0)} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition mt-6">
                {isSubmitting ? "Locking Ledger..." : "Finalize & Lock Monthly Sales"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* TAB 3: COLLECTION ENGINE */}
      {activeTab === 'collection' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4">
          <h2 className="text-lg font-black text-slate-800 border-b pb-2 mb-6 text-center">Declare Monthly Collection</h2>
          <form onSubmit={handleCollectionSubmit} className="space-y-6">
            
            <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-200 text-center">
              <label className="block text-xs font-black text-emerald-800 uppercase tracking-widest mb-3">Total Actual Cash Collected (₹) *</label>
              <input 
                required 
                type="number" 
                step="0.01" 
                min="0"
                value={collectionForm.total_cash_collected || ''} 
                onChange={e => setCollectionForm({...collectionForm, total_cash_collected: Number(e.target.value)})} 
                className="w-full text-center text-4xl font-black text-emerald-900 bg-white border-2 border-emerald-300 p-4 rounded-lg outline-none focus:border-emerald-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Reconciliation Remarks (Optional)</label>
              <textarea 
                rows={3} 
                value={collectionForm.remarks} 
                onChange={e => setCollectionForm({...collectionForm, remarks: e.target.value})} 
                placeholder="Explain any shortfalls or surpluses..."
                className="w-full border-2 border-slate-200 p-3 rounded-lg outline-none font-medium focus:border-indigo-500" 
              />
            </div>

            <button type="submit" disabled={isSubmitting || !selectedLocId} className="w-full bg-emerald-600 text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition hover:bg-emerald-700">
              {isSubmitting ? "Logging Collection..." : "Submit Collection Checkpoint"}
            </button>
          </form>
        </div>
      )}

    </div>
  );
}