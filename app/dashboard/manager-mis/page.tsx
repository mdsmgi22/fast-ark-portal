"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function ManagerMISDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Secure Role State for Strict Hard-Code Redaction
  const [userRole, setUserRole] = useState("staff");
  const [activeTab, setActiveTab] = useState<'balances' | 'purchase' | 'sales' | 'collection' | 'report'>('balances');

  // Architecture Data
  const [allLocations, setAllLocations] = useState<any[]>([]); 
  const [masterCtops, setMasterCtops] = useState<any[]>([]); 
  const [agentMappings, setAgentMappings] = useState<any[]>([]);

  // Tab Context States
  const [reportingMonth, setReportingMonth] = useState(new Date().toISOString().substring(0, 7)); 
  const [entryMasterLocId, setEntryMasterLocId] = useState("");
  const [selectedChildLocKey, setSelectedChildLocKey] = useState("");

  // ==========================================
  // TAB 1: MASTER BALANCES STATE
  // ==========================================
  const [rawBalances, setRawBalances] = useState<any[]>([]);
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  
  const [balanceForm, setBalanceForm] = useState({
    report_date: new Date().toISOString().split('T')[0],
    location_id: "",
    master_ctop_id: "",
    entry_type: "Opening Balance",
    cbp_qty: "", 
    ctop_qty: "" // STRICT FIX: Changed from Amount/₹ to Qty.
  });

  // Tab 2: Purchase Form State
  const [purchaseForm, setPurchaseForm] = useState({
    purchase_date: new Date().toISOString().split('T')[0],
    master_ctop_id: "", 
    product_category: "CBP",
    qty: "",
    amount: "",
    commission_percent: "5.81",
    manual_qty_override: false, 
  });

  // Tab 3: Sales Form State (OCSC)
  const [ocscSales, setOcscSales] = useState({
    cbp_landline_cash: "", cbp_gsm_cash: "", ctop_recharge_cash: "",
    sim_replace_qty: "", sim_replace_cash: "",
    sim_fancy_qty: "", sim_fancy_cash: "",
    sim_other_qty: "", sim_other_cash: "",
  });

  // Tab 3: Sales Form State (CM)
  const [cmSales, setCmSales] = useState<{agent_ctop_no: string, qty: string}[]>([]);

  // Tab 4: Collection Form State
  const [collectionForm, setCollectionForm] = useState({
    total_cash_collected: "", remarks: ""
  });

  // ==========================================
  // TAB 5: REPORTING ENGINE STATES
  // ==========================================
  const [rawPurchases, setRawPurchases] = useState<any[]>([]);
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawCollections, setRawCollections] = useState<any[]>([]);
  
  const [repTimeFilter, setRepTimeFilter] = useState("this_month");
  const [repMasterFilter, setRepMasterFilter] = useState("ALL");
  const [repChildFilter, setRepChildFilter] = useState("ALL");

  useEffect(() => {
    fetchArchitectureAndReports();
  }, []);

  const fetchArchitectureAndReports = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      // [STRICT DATABASE ROLE FETCH]: Resolves the true identity for UI Redaction
      const { data: currentUser } = await supabase
        .from('back_office_staff')
        .select('role')
        .eq('email', session.user.email)
        .single();
        
      const safeRole = currentUser?.role?.trim().toLowerCase() || 'staff';
      setUserRole(safeRole);

      const [locRes, masterRes, agentRes, purRes, salesRes, colRes, balRes] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"), 
        supabase.from("master_ctop_accounts").select("*, locations(center_name)"),
        supabase.from("agent_ctop_mappings").select("*, active_partners(locations(id))"),
        supabase.from("mis_purchases").select("*, master_ctop_accounts(master_ctop_no, location_id)").order("purchase_date", {ascending: false}),
        supabase.from("mis_monthly_sales").select("*, locations(center_name, parent_master_id)").order("reporting_month", {ascending: false}),
        supabase.from("mis_monthly_collections").select("*, locations(center_name, parent_master_id)").order("reporting_month", {ascending: false}),
        supabase.from("mis_balances").select("*, locations(center_name), master_ctop_accounts(master_ctop_no)").order("report_date", {ascending: false})
      ]);

      setAllLocations(locRes.data || []);
      setMasterCtops(masterRes.data || []);
      setAgentMappings(agentRes.data || []);
      setRawPurchases(purRes.data || []);
      setRawSales(salesRes.data || []);
      setRawCollections(colRes.data || []);
      setRawBalances(balRes.data || []);
    } catch (err: any) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedChildLocKey && selectedChildLocKey.includes('-CM')) {
      const locIdInt = parseInt(selectedChildLocKey.split('-')[0]); 
      const filteredAgents = agentMappings.filter(a => a.active_partners?.locations?.id === locIdInt);
      setCmSales(filteredAgents.map(a => ({ agent_ctop_no: a.agent_ctop_no, qty: "" })));
    } else {
      setCmSales([]);
    }
  }, [selectedChildLocKey, agentMappings]);

  // Intelligent Auto-Calculation Engine (Procurement)
  useEffect(() => {
    if (purchaseForm.manual_qty_override) return; 

    const amt = parseFloat(purchaseForm.amount) || 0;

    if (purchaseForm.product_category === "CBP") {
      setPurchaseForm(prev => ({ ...prev, qty: amt.toString() }));
    } else if (purchaseForm.product_category === "CTOP") {
      const pct = parseFloat(purchaseForm.commission_percent) || 0;
      const comm = (amt * pct) / 100;
      const total = (amt + comm).toFixed(2); 
      setPurchaseForm(prev => ({ ...prev, qty: total.toString() }));
    }
  }, [purchaseForm.amount, purchaseForm.commission_percent, purchaseForm.product_category, purchaseForm.manual_qty_override]);

  const getActiveLocationType = () => {
    if (!selectedChildLocKey) return null;
    return selectedChildLocKey.split('-')[1]; 
  };

  // ==========================================
  // GLOBAL NUMERIC SAFETY HANDLERS
  // Prevents Negative Entries & Scroll Glitches
  // ==========================================
  const preventNegativeScroll = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') {
      e.preventDefault();
    }
  };
  
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  // --- SUBMISSION ENGINES ---

  // 1. BALANCE SUBMIT ENGINE (DECIMAL PARSE FLOAT)
  const handleBalanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!balanceForm.location_id || !balanceForm.master_ctop_id) {
      return alert("You must select both a Master Location and a Master CTOP.");
    }
    
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const payload = {
        report_date: balanceForm.report_date,
        location_id: parseInt(balanceForm.location_id),
        master_ctop_id: balanceForm.master_ctop_id,
        entry_type: balanceForm.entry_type,
        cbp_qty: parseFloat(balanceForm.cbp_qty) || 0, // Decimal Qty Support
        ctop_qty: parseFloat(balanceForm.ctop_qty) || 0, // Decimal Qty Support
        logged_by: user.id
      };

      if (editingBalanceId) {
        const { error } = await supabase.from('mis_balances').update(payload).eq('id', editingBalanceId);
        if (error) throw error;
        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id,
          staff_email: user.email,
          action_type: 'AUDIT',
          module: 'MANAGER_MIS',
          target_id: editingBalanceId,
          details: `Corrected ${payload.entry_type} for ${payload.report_date}.`
        }]);
        alert("✅ Balance Record Successfully Updated.");
      } else {
        const { data: insertedRecord, error } = await supabase.from('mis_balances').insert([payload]).select().single();
        if (error) throw error;
        await supabase.from('staff_activity_logs').insert([{
          staff_id: user.id,
          staff_email: user.email,
          action_type: 'MIS_ENTRY',
          module: 'MANAGER_MIS',
          target_id: insertedRecord.id,
          details: `Logged ${payload.entry_type} for ${payload.report_date}.`
        }]);
        alert("✅ Balance Record Successfully Saved.");
      }

      setBalanceForm({
        ...balanceForm,
        cbp_qty: "",
        ctop_qty: ""
      });
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
      cbp_qty: bal.cbp_qty?.toString() || "", 
      ctop_qty: bal.ctop_qty?.toString() || "" 
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 2. PROCUREMENT SUBMIT ENGINE
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

      const selectedMaster = masterCtops.find(m => m.id === purchaseForm.master_ctop_id);

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

      const { data: insertedRecord, error } = await supabase.from('mis_purchases').insert([payload]).select().single();
      if (error) throw error;

      await supabase.from('staff_activity_logs').insert([{
        staff_id: user.id,
        staff_email: user.email,
        action_type: 'MIS_ENTRY',
        module: 'MANAGER_MIS',
        target_id: insertedRecord.id,
        details: `Procured: ${payload.qty}x ${purchaseForm.product_category} into Master CTOP ${selectedMaster?.master_ctop_no}.`
      }]);

      alert("✅ Central Purchase Ledger Updated.");
      setPurchaseForm({ ...purchaseForm, qty: "", amount: "", manual_qty_override: false }); 
      fetchArchitectureAndReports(); 
    } catch (err: any) {
      alert("Error saving purchase: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. SALES SUBMIT ENGINE
  const handleSalesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChildLocKey || !reportingMonth) return alert("Select child center and month.");
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Auth drop.");

      const centerType = getActiveLocationType();
      const dbReportingMonth = `${reportingMonth}-01`;

      const cleanOcscSales = {
        cbp_landline_cash: parseFloat(ocscSales.cbp_landline_cash) || 0,
        cbp_gsm_cash: parseFloat(ocscSales.cbp_gsm_cash) || 0,
        ctop_recharge_cash: parseFloat(ocscSales.ctop_recharge_cash) || 0,
        sim_replace_qty: parseInt(ocscSales.sim_replace_qty) || 0,
        sim_replace_cash: parseFloat(ocscSales.sim_replace_cash) || 0,
        sim_fancy_qty: parseInt(ocscSales.sim_fancy_qty) || 0,
        sim_fancy_cash: parseFloat(ocscSales.sim_fancy_cash) || 0,
        sim_other_qty: parseInt(ocscSales.sim_other_qty) || 0,
        sim_other_cash: parseFloat(ocscSales.sim_other_cash) || 0,
      };

      const parentPayload = {
        reporting_month: dbReportingMonth,
        location_id: parseInt(selectedChildLocKey.split('-')[0]), 
        center_type: centerType,
        logged_by: user.id,
        ...(centerType === 'OCSC' ? cleanOcscSales : {}) 
      };

      const { data: parentRecord, error: parentError } = await supabase.from('mis_monthly_sales').insert([parentPayload]).select().single();
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
        staff_id: user.id,
        staff_email: user.email,
        action_type: 'MIS_CLOSURE',
        module: 'MANAGER_MIS',
        target_id: parentRecord.id,
        details: `Locked Center Sales for ${centerType} location. Month: ${reportingMonth}`
      }]);

      alert(`✅ Center Sales for ${reportingMonth} successfully locked.`);
      fetchArchitectureAndReports(); 
    } catch (err: any) {
      if (err.message.includes('unique constraint')) alert("❌ Blocked: Sales for this Center Type and Month are already locked.");
      else alert("Error saving sales: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. COLLECTION SUBMIT ENGINE
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

      const { data: colRecord, error } = await supabase.from('mis_monthly_collections').insert([payload]).select().single();
      if (error) throw error;

      await supabase.from('staff_activity_logs').insert([{
        staff_id: user.id,
        staff_email: user.email,
        action_type: 'MIS_CLOSURE',
        module: 'MANAGER_MIS',
        target_id: colRecord.id,
        details: `Declared Collection of ₹${payload.total_cash_collected} for ${reportingMonth}.`
      }]);

      alert(`✅ Collection for ${reportingMonth} successfully logged.`);
      setCollectionForm({ total_cash_collected: "", remarks: "" });
      fetchArchitectureAndReports(); 
    } catch (err: any) {
      if (err.message.includes('unique constraint')) alert("❌ Blocked: Collection for this center and month is already locked.");
      else alert("Error saving collection: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==========================================
  // REPORTING ENGINE LOGIC
  // ==========================================
  const getFilteredReports = () => {
    let fPurchases = [...rawPurchases];
    let fSales = [...rawSales];
    let fCollections = [...rawCollections];

    const today = new Date();
    let startDate = new Date("2000-01-01");

    if (repTimeFilter === "today") {
      startDate = new Date(today.setHours(0,0,0,0));
    } else if (repTimeFilter === "this_week") {
      startDate = new Date(today.setDate(today.getDate() - today.getDay()));
    } else if (repTimeFilter === "this_month") {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    const startStr = startDate.toISOString().split('T')[0];

    if (repTimeFilter !== "all") {
      fPurchases = fPurchases.filter(p => p.purchase_date >= startStr);
      fSales = fSales.filter(s => s.reporting_month >= startStr);
      fCollections = fCollections.filter(c => c.reporting_month >= startStr);
    }

    if (repMasterFilter !== "ALL") {
      const masterId = parseInt(repMasterFilter);
      fPurchases = fPurchases.filter(p => p.location_id === masterId);
      fSales = fSales.filter(s => s.locations?.parent_master_id === masterId);
      fCollections = fCollections.filter(c => c.locations?.parent_master_id === masterId);
    }

    if (repChildFilter !== "ALL") {
      const childId = parseInt(repChildFilter);
      fPurchases = []; 
      fSales = fSales.filter(s => s.location_id === childId);
      fCollections = fCollections.filter(c => c.location_id === childId);
    }

    const totalPurchasedValue = fPurchases.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalSalesCash = fSales.reduce((sum, s) => sum + 
      Number(s.cbp_landline_cash || 0) + Number(s.cbp_gsm_cash || 0) + Number(s.ctop_recharge_cash || 0) +
      Number(s.sim_replace_cash || 0) + Number(s.sim_fancy_cash || 0) + Number(s.sim_other_cash || 0), 0);
    const totalCollected = fCollections.reduce((sum, c) => sum + Number(c.total_cash_collected), 0);

    return { fPurchases, fSales, fCollections, totalPurchasedValue, totalSalesCash, totalCollected };
  };

  const { fPurchases, fSales, fCollections, totalPurchasedValue, totalSalesCash, totalCollected } = getFilteredReports();

  const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
    </div>
  );

  const locType = getActiveLocationType();
  const liveAmt = parseFloat(purchaseForm.amount) || 0;
  const livePct = parseFloat(purchaseForm.commission_percent) || 0;
  const liveComm = (liveAmt * livePct) / 100;

  const hqLocations = allLocations.filter(l => l.is_master_node);
  const entryFilteredFranchises = allLocations.filter(l => !l.is_master_node && (entryMasterLocId === "" || l.parent_master_id === parseInt(entryMasterLocId)));
  const childFranchisesForReports = allLocations.filter(l => !l.is_master_node && (repMasterFilter === "ALL" || l.parent_master_id === parseInt(repMasterFilter)));
  const mappedMasterCtops = masterCtops.filter(m => m.location_id?.toString() === balanceForm.location_id);

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
          <p className="text-slate-500 font-medium mt-1">Hierarchical MIS Pipeline: Master Procurement & Center Operations.</p>
        </div>
      </div>

      {/* TAB NAVIGATION [STRICT RBAC REDACTION] */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-px">
        <button onClick={() => setActiveTab('balances')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'balances' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>1. Master Balances</button>
        
        {/* HARD REDACTION: Hide all upper-level modules from Staff role natively */}
        {userRole !== 'staff' && (
          <>
            <button onClick={() => setActiveTab('purchase')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'purchase' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>2. Central Procurement</button>
            <button onClick={() => setActiveTab('sales')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'sales' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>3. Center Sales</button>
            <button onClick={() => setActiveTab('collection')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'collection' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>4. Center Collection</button>
            <button onClick={() => setActiveTab('report')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'report' ? 'bg-white text-emerald-600 border-t-2 border-l border-r border-emerald-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>5. Live Reports</button>
          </>
        )}
      </div>

      {/* ========================================== */}
      {/* TAB 1: MASTER BALANCES ENGINE */}
      {/* ========================================== */}
      {activeTab === 'balances' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className={`p-4 rounded-lg mb-6 flex gap-4 items-center justify-between ${editingBalanceId ? 'bg-amber-100 border border-amber-300' : 'bg-slate-900'}`}>
              <div className="flex gap-4 items-center">
                <span className="text-3xl">⚖️</span>
                <div>
                  <h2 className={`font-black uppercase tracking-widest ${editingBalanceId ? 'text-amber-900' : 'text-white'}`}>
                    {editingBalanceId ? 'Editing Balance Record' : 'Log Daily Balances'}
                  </h2>
                  <p className={`text-xs font-bold mt-1 ${editingBalanceId ? 'text-amber-700' : 'text-slate-400'}`}>
                    Declare your Opening and Closing balances for CBP and CTOP accurately.
                  </p>
                </div>
              </div>
              {editingBalanceId && (
                <button onClick={() => { setEditingBalanceId(null); setBalanceForm({...balanceForm, cbp_qty: "", ctop_qty: ""}); }} className="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-2 rounded text-xs uppercase tracking-widest transition">
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
                    {hqLocations.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1.5">Master CTOP No. *</label>
                  <select required disabled={!balanceForm.location_id} value={balanceForm.master_ctop_id} onChange={e => setBalanceForm({...balanceForm, master_ctop_id: e.target.value})} className="w-full border-2 border-indigo-200 p-2.5 rounded-lg outline-none font-black text-indigo-900 focus:border-indigo-600 bg-indigo-50 disabled:opacity-50">
                    <option value="" disabled>-- Select Assigned CTOP --</option>
                    {mappedMasterCtops.map(m => <option key={m.id} value={m.id}>{m.master_ctop_no}</option>)}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">CBP Quantity *</label>
                  <input required type="number" step="0.01" min="0" value={balanceForm.cbp_qty} onChange={e => setBalanceForm({...balanceForm, cbp_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">CTOP Quantity *</label>
                  <input required type="number" step="0.01" min="0" value={balanceForm.ctop_qty} onChange={e => setBalanceForm({...balanceForm, ctop_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0.00" />
                </div>
              </div>
              
              <button type="submit" disabled={isSubmitting} className={`w-full text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition mt-6 ${editingBalanceId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-900 hover:bg-slate-800'}`}>
                {isSubmitting ? "Committing..." : editingBalanceId ? "Update Balance Ledger" : "Lock Balance Entry"}
              </button>
            </form>
          </div>

          {/* Balance Ledger History */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
              <h3 className="font-black tracking-widest uppercase text-xs">Recent Master Balances</h3>
              <span className="bg-slate-800 text-slate-400 font-bold px-3 py-1 rounded text-[10px] uppercase tracking-widest border border-slate-700">
                {rawBalances.length} Records
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-4 font-black">Date & Type</th>
                    <th className="p-4 font-black">Master Location & CTOP</th>
                    <th className="p-4 font-black text-right">CBP (Qty)</th>
                    <th className="p-4 font-black text-right">CTOP (Qty)</th>
                    <th className="p-4 font-black text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rawBalances.length === 0 ? (
                    <tr><td colSpan={5} className="p-12 text-center text-slate-400 font-bold">No balance records logged yet.</td></tr>
                  ) : (
                    rawBalances.slice(0, 50).map(bal => (
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
                        <td className="p-4 text-right font-black text-slate-800">{Number(bal.cbp_qty).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                        <td className="p-4 text-right font-black text-slate-800">{Number(bal.ctop_qty).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
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
      )}

      {/* HARD REDACTION: Stop the remaining render engine entirely for Staff */}
      {userRole !== 'staff' && (
        <>
          {/* TAB 2: MASTER PURCHASE ENGINE (PROCUREMENT) */}
          {activeTab === 'purchase' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="bg-slate-900 p-4 rounded-lg mb-6 flex gap-4 items-center">
                <span className="text-3xl">🏛️</span>
                <div>
                  <h2 className="text-white font-black uppercase tracking-widest">Master Procurement</h2>
                  <p className="text-slate-400 text-xs font-bold mt-1">Log inventory purchases directly against a Master CTOP Account.</p>
                </div>
              </div>

              <form onSubmit={handlePurchaseSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  <div className="md:col-span-3">
                    <label className="block text-xs font-black text-indigo-600 uppercase tracking-widest mb-1.5">Target Master CTOP (HQ) *</label>
                    <select required value={purchaseForm.master_ctop_id} onChange={e => setPurchaseForm({...purchaseForm, master_ctop_id: e.target.value})} className="w-full border-2 border-indigo-200 p-3 rounded-lg outline-none font-black text-indigo-900 focus:border-indigo-600 bg-indigo-50">
                      <option value="" disabled>-- Select Master CTOP --</option>
                      {masterCtops.map(m => (
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

                  {/* DYNAMIC QTY RENDERER WITH OVERRIDE CHECKBOX */}
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
                
                <button type="submit" disabled={isSubmitting || !purchaseForm.master_ctop_id} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition mt-6">
                  {isSubmitting ? "Logging Procurement..." : "Submit to Master Ledger"}
                </button>
              </form>
            </div>
          )}

          {/* TAB 3 & 4 SHARED CENTER SELECTION RIBBON */}
          {(activeTab === 'sales' || activeTab === 'collection') && (
            <div className="bg-slate-900 p-5 rounded-xl shadow-lg border border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-6 mb-6 animate-in fade-in">
              
              <div className="col-span-1">
                <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1.5">1. Filter by Master HQ</label>
                <select 
                  value={entryMasterLocId} 
                  onChange={(e) => {
                    setEntryMasterLocId(e.target.value); 
                    setSelectedChildLocKey(""); 
                  }}
                  className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-400 transition"
                >
                  <option value="">-- All Master HQs --</option>
                  {hqLocations.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
                </select>
              </div>

              <div className="col-span-1">
                <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest block mb-1.5">2. Target Child Center *</label>
                <select 
                  value={selectedChildLocKey} 
                  onChange={(e) => setSelectedChildLocKey(e.target.value)}
                  className="w-full bg-slate-800 border-2 border-emerald-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-emerald-400 transition"
                >
                  <option value="" disabled>-- Select Franchise Center --</option>
                  {entryFilteredFranchises.flatMap(l => {
                    const options = [];
                    if (l.role_ocsc) options.push(<option key={`${l.id}-OCSC`} value={`${l.id}-OCSC`}>{l.center_name} (OCSC)</option>);
                    if (l.role_cm) options.push(<option key={`${l.id}-CM`} value={`${l.id}-CM`}>{l.center_name} (CM)</option>);
                    return options;
                  })}
                </select>
              </div>

              <div className="col-span-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Reporting Month Context</label>
                <input 
                  type="month" 
                  value={reportingMonth} 
                  onChange={(e) => setReportingMonth(e.target.value)}
                  className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div className="col-span-1 flex flex-col justify-end">
                <div className="bg-slate-800 px-4 py-2.5 rounded-lg border border-slate-700 text-center h-full flex flex-col justify-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Center Mode</p>
                  <p className={`font-black tracking-widest uppercase ${locType === 'OCSC' ? 'text-blue-400' : locType === 'CM' ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {locType || 'NONE'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MONTHLY SALES ENGINE (CENTER LEVEL) */}
          {activeTab === 'sales' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex justify-between items-end border-b pb-2 mb-6">
                <div>
                  <h2 className="text-lg font-black text-slate-800">Monthly Center Sales Ledger</h2>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Closing Month: {reportingMonth}</p>
                </div>
              </div>

              {!locType ? (
                <div className="text-center p-8 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="font-bold text-slate-500">Please select an OCSC or CM Child Center from the ribbon above.</p>
                </div>
              ) : (
                <form onSubmit={handleSalesSubmit} className="space-y-6">
                  
                  {/* OCSC DYNAMIC GRID */}
                  {locType === 'OCSC' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded">CBP & CTOP Cash</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP Landline Cash</label><input type="number" step="0.01" min="0" value={ocscSales.cbp_landline_cash} onChange={e => setOcscSales({...ocscSales, cbp_landline_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                          <div><label className="text-[10px] font-bold text-slate-500 uppercase">CBP GSM Cash</label><input type="number" step="0.01" min="0" value={ocscSales.cbp_gsm_cash} onChange={e => setOcscSales({...ocscSales, cbp_gsm_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                          <div className="col-span-2"><label className="text-[10px] font-bold text-slate-500 uppercase">CTOP Recharge Cash</label><input type="number" step="0.01" min="0" value={ocscSales.ctop_recharge_cash} onChange={e => setOcscSales({...ocscSales, ctop_recharge_cash: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={`${numInputClass} bg-indigo-50 border-indigo-200`} /></div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded">SIM Cash & Qty</h3>
                        <div className="grid grid-cols-2 gap-4">
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

                  {/* CM DYNAMIC AGENT GRID */}
                  {locType === 'CM' && (
                    <div>
                      <h3 className="font-black text-slate-700 uppercase text-xs tracking-widest bg-slate-100 p-2 rounded mb-4">Mapped Agent CTOP Volumes</h3>
                      {cmSales.length === 0 ? (
                        <p className="text-sm font-bold text-red-600 bg-red-50 p-4 border border-red-200 rounded">No agents mapped to this Child Center.</p>
                      ) : (
                        <div className="space-y-3">
                          {cmSales.map((agent, idx) => (
                            <div key={agent.agent_ctop_no} className="flex justify-between items-center bg-slate-50 p-3 rounded border border-slate-200">
                              <span className="font-black text-slate-800 tracking-wider">Agent: {agent.agent_ctop_no}</span>
                              <div className="flex items-center gap-3">
                                <label className="text-[10px] font-bold uppercase text-slate-500">Sales Qty</label>
                                <input 
                                  type="number" min="0" step="0.01" value={agent.qty} 
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
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <button type="submit" disabled={isSubmitting || (locType === 'CM' && cmSales.length === 0)} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition mt-6">
                    {isSubmitting ? "Locking Ledger..." : "Finalize & Lock Center Sales"}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* TAB 4: COLLECTION ENGINE (CENTER LEVEL) */}
          {activeTab === 'collection' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4">
              <h2 className="text-lg font-black text-slate-800 border-b pb-2 mb-6 text-center">Declare Monthly Center Collection</h2>
              
              {!locType ? (
                <div className="text-center p-8 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="font-bold text-slate-500">Please select an OCSC or CM Child Center from the ribbon above.</p>
                </div>
              ) : (
                <form onSubmit={handleCollectionSubmit} className="space-y-6">
                  <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-200 text-center">
                    <label className="block text-xs font-black text-emerald-800 uppercase tracking-widest mb-3">Total Actual Cash Collected (₹) *</label>
                    <input 
                      required type="number" step="0.01" min="0"
                      value={collectionForm.total_cash_collected} 
                      onChange={e => setCollectionForm({...collectionForm, total_cash_collected: e.target.value})} 
                      onKeyDown={preventNegativeScroll} onWheel={handleWheel}
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

                  <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-600 text-white font-black py-4 rounded-xl shadow-md uppercase tracking-widest disabled:opacity-50 transition hover:bg-emerald-700">
                    {isSubmitting ? "Logging Collection..." : "Submit Collection Checkpoint"}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ========================================== */}
          {/* TAB 5: COMPREHENSIVE REPORTING ENGINE */}
          {/* ========================================== */}
          {activeTab === 'report' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6">
              
              <div className="bg-slate-900 p-5 rounded-xl shadow-lg border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Time Context</label>
                  <select value={repTimeFilter} onChange={(e) => setRepTimeFilter(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-emerald-500">
                    <option value="today">Today</option>
                    <option value="this_week">This Week</option>
                    <option value="this_month">This Month</option>
                    <option value="all">All Time</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1.5">Master HQ (Hub)</label>
                  <select value={repMasterFilter} onChange={(e) => {setRepMasterFilter(e.target.value); setRepChildFilter("ALL");}} className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-indigo-400">
                    <option value="ALL">-- All HQ Hubs --</option>
                    {hqLocations.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest block mb-1.5">Child Center (Spoke)</label>
                  <select value={repChildFilter} onChange={(e) => setRepChildFilter(e.target.value)} className="w-full bg-slate-800 border-2 border-emerald-500 text-white font-bold text-sm rounded-lg p-2.5 outline-none focus:border-emerald-400">
                    <option value="ALL">-- All Tethered Centers --</option>
                    {childFranchisesForReports.map(c => <option key={c.id} value={c.id}>{c.center_name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total HQ Purchases</p>
                  <p className="text-2xl font-black text-indigo-600">₹{totalPurchasedValue.toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Center Sales</p>
                  <p className="text-2xl font-black text-blue-600">₹{totalSalesCash.toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Declared Collections</p>
                  <p className="text-2xl font-black text-emerald-600">₹{totalCollected.toLocaleString('en-IN')}</p>
                </div>
                <div className={`p-5 rounded-xl border shadow-sm text-center ${totalCollected >= totalSalesCash ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${totalCollected >= totalSalesCash ? 'text-emerald-700' : 'text-red-700'}`}>Net Variance</p>
                  <p className={`text-2xl font-black ${totalCollected >= totalSalesCash ? 'text-emerald-700' : 'text-red-700'}`}>₹{(totalCollected - totalSalesCash).toLocaleString('en-IN')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px]">
                  <div className="bg-indigo-50 border-b border-indigo-100 p-4">
                    <h3 className="font-black text-indigo-900 uppercase tracking-widest text-xs">Master HQ Procurement Ledger</h3>
                  </div>
                  <div className="overflow-y-auto flex-1">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="p-3 font-black">Date & Master CTOP</th>
                          <th className="p-3 font-black">Product & Qty</th>
                          <th className="p-3 font-black text-right">Amount (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {fPurchases.length === 0 ? <tr><td colSpan={3} className="p-8 text-center text-slate-400 font-bold">No bulk purchases found.</td></tr> : 
                          fPurchases.map(p => (
                            <tr key={p.id} className="hover:bg-slate-50">
                              <td className="p-3">
                                <p className="font-bold text-slate-900">{p.purchase_date}</p>
                                <p className="text-[10px] text-slate-500 uppercase">CTOP: {p.master_ctop_accounts?.master_ctop_no}</p>
                              </td>
                              <td className="p-3">
                                <p className="font-black text-indigo-700">{p.product_category}</p>
                                <p className="text-xs text-slate-600 font-bold">Qty: {p.qty}</p>
                              </td>
                              <td className="p-3 text-right font-black text-slate-800">₹{Number(p.amount).toLocaleString('en-IN')}</td>
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px]">
                  <div className="bg-emerald-50 border-b border-emerald-100 p-4">
                    <h3 className="font-black text-emerald-900 uppercase tracking-widest text-xs">Center Collections</h3>
                  </div>
                  <div className="overflow-y-auto flex-1">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="p-3 font-black">Center & Month</th>
                          <th className="p-3 font-black text-right">Collected (₹)</th>
                          <th className="p-3 font-black">Remarks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {fCollections.length === 0 ? <tr><td colSpan={3} className="p-8 text-center text-slate-400 font-bold">No collections found.</td></tr> : 
                          fCollections.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50">
                              <td className="p-3">
                                <p className="font-bold text-slate-900">{c.locations?.center_name}</p>
                                <p className="text-[10px] text-slate-500 uppercase">{c.reporting_month}</p>
                              </td>
                              <td className="p-3 text-right font-black text-emerald-700">₹{Number(c.total_cash_collected).toLocaleString('en-IN')}</td>
                              <td className="p-3 text-xs text-slate-500 max-w-[150px] truncate">{c.remarks || "No remarks"}</td>
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}