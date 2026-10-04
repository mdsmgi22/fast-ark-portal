"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// --- CSV Sanitizer to prevent macro injection ---
const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

export default function ManagerMISDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Secure Role State for Strict UI Redaction
  const [userRole, setUserRole] = useState("staff");
  
  // Tabs expanded to include Commissions
  const [activeTab, setActiveTab] = useState<'balances' | 'purchase' | 'sales' | 'collection' | 'commissions' | 'report'>('balances');

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
    location_id: "", master_ctop_id: "", entry_type: "Opening Balance",
    cbp_qty: "", ctop_qty: "", sim_qty: "" // SIM Stock Fully Integrated
  });

  // ==========================================
  // TAB 2: PURCHASE STATE
  // ==========================================
  const [rawPurchases, setRawPurchases] = useState<any[]>([]);
  const [purchaseForm, setPurchaseForm] = useState({
    purchase_date: new Date().toISOString().split('T')[0],
    master_ctop_id: "", product_category: "CBP", qty: "", amount: "",
    commission_percent: "5.81", manual_qty_override: false, 
  });

  // ==========================================
  // TAB 3: SALES STATE
  // ==========================================
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [ocscSales, setOcscSales] = useState({
    cbp_landline_qty: "", cbp_landline_cash: "", cbp_gsm_qty: "", cbp_gsm_cash: "", 
    ctop_recharge_qty: "", ctop_recharge_cash: "",
    sim_new_qty: "", sim_upgrade_qty: "", sim_postpaid_qty: "", sim_postpaid_amt: "",
    sim_replace_qty: "", sim_replace_cash: "", sim_fancy_qty: "", sim_fancy_cash: "",
    sim_other_qty: "", sim_other_cash: "",
  });
  const [cmSales, setCmSales] = useState<{agent_ctop_no: string, qty: string}[]>([]);

  // ==========================================
  // TAB 4: COLLECTION STATE
  // ==========================================
  const [rawCollections, setRawCollections] = useState<any[]>([]);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [collectionForm, setCollectionForm] = useState({
    total_cash_collected: "", remarks: "", edit_remarks: ""
  });

  // ==========================================
  // TAB 5: COMMISSIONS STATE (NEW)
  // ==========================================
  const [rawCommissions, setRawCommissions] = useState<any[]>([]);
  const [commissionForm, setCommissionForm] = useState({
    master_ctop_id: "", instant_commission: "", pending_commission: ""
  });

  // ==========================================
  // TAB 6: REPORTING STATE
  // ==========================================
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

      const { data: currentUser } = await supabase.from('back_office_staff').select('role').eq('email', session.user.email).single();
      setUserRole(currentUser?.role?.trim().toLowerCase() || 'staff');

      const [locRes, masterRes, agentRes, purRes, salesRes, colRes, balRes, commRes] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"), 
        supabase.from("master_ctop_accounts").select("*, locations(center_name)"),
        supabase.from("agent_ctop_mappings").select("*, active_partners(locations(id))"),
        supabase.from("mis_purchases").select("*, master_ctop_accounts(master_ctop_no, location_id)").order("purchase_date", {ascending: false}),
        supabase.from("mis_monthly_sales").select("*, locations(center_name, parent_master_id)").order("reporting_month", {ascending: false}),
        supabase.from("mis_monthly_collections").select("*, locations(center_name, parent_master_id)").order("reporting_month", {ascending: false}),
        supabase.from("mis_balances").select("*, locations(center_name), master_ctop_accounts(master_ctop_no)").order("report_date", {ascending: false}),
        supabase.from("mis_commissions").select("*, locations(center_name), master_ctop_accounts(master_ctop_no)").order("reporting_month", {ascending: false})
      ]);

      setAllLocations(locRes.data || []);
      setMasterCtops(masterRes.data || []);
      setAgentMappings(agentRes.data || []);
      setRawPurchases(purRes.data || []);
      setRawSales(salesRes.data || []);
      setRawCollections(colRes.data || []);
      setRawBalances(balRes.data || []);
      setRawCommissions(commRes.data || []);
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

  useEffect(() => {
    if (purchaseForm.manual_qty_override) return; 
    const amt = parseFloat(purchaseForm.amount) || 0;
    if (purchaseForm.product_category === "CBP" || purchaseForm.product_category === "SIM_FREE" || purchaseForm.product_category === "SIM_PAID") {
      setPurchaseForm(prev => ({ ...prev, qty: amt.toString() }));
    } else if (purchaseForm.product_category === "CTOP") {
      const pct = parseFloat(purchaseForm.commission_percent) || 0;
      const comm = (amt * pct) / 100;
      setPurchaseForm(prev => ({ ...prev, qty: (amt + comm).toFixed(2) }));
    }
  }, [purchaseForm.amount, purchaseForm.commission_percent, purchaseForm.product_category, purchaseForm.manual_qty_override]);

  // GLOBAL SAFETY HANDLERS
  const preventNegativeScroll = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') e.preventDefault();
  };
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).blur();
  };

  // --- SUBMISSION ENGINES ---

  const handleBalanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!balanceForm.location_id || !balanceForm.master_ctop_id) return alert("Select both Location and CTOP.");
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        report_date: balanceForm.report_date, location_id: parseInt(balanceForm.location_id),
        master_ctop_id: balanceForm.master_ctop_id, entry_type: balanceForm.entry_type,
        cbp_qty: parseFloat(balanceForm.cbp_qty) || 0, ctop_qty: parseFloat(balanceForm.ctop_qty) || 0,
        sim_qty: parseFloat(balanceForm.sim_qty) || 0, logged_by: session?.user?.id
      };

      if (editingBalanceId) {
        await supabase.from('mis_balances').update(payload).eq('id', editingBalanceId);
        alert("✅ Balance Updated.");
      } else {
        await supabase.from('mis_balances').insert([payload]);
        alert("✅ Balance Saved.");
      }
      setBalanceForm({...balanceForm, cbp_qty: "", ctop_qty: "", sim_qty: ""});
      setEditingBalanceId(null);
      fetchArchitectureAndReports();
    } catch (err: any) { alert("Error: " + err.message); } finally { setIsSubmitting(false); }
  };

  const handleEditBalance = (bal: any) => {
    setEditingBalanceId(bal.id);
    setBalanceForm({
      report_date: bal.report_date, location_id: bal.location_id.toString(), master_ctop_id: bal.master_ctop_id,
      entry_type: bal.entry_type, cbp_qty: bal.cbp_qty?.toString() || "", ctop_qty: bal.ctop_qty?.toString() || "", sim_qty: bal.sim_qty?.toString() || "" 
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseForm.master_ctop_id) return alert("Select Master CTOP.");
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const isCTOP = purchaseForm.product_category === 'CTOP';
      const amtDb = parseFloat(purchaseForm.amount) || 0;
      const pctDb = parseFloat(purchaseForm.commission_percent) || 0;
      const selectedMaster = masterCtops.find(m => m.id === purchaseForm.master_ctop_id);

      await supabase.from('mis_purchases').insert([{
        purchase_date: purchaseForm.purchase_date, location_id: selectedMaster?.location_id, 
        master_ctop_id: purchaseForm.master_ctop_id, product_category: purchaseForm.product_category,
        qty: parseFloat(purchaseForm.qty) || 0, amount: amtDb, commission_percent: isCTOP ? pctDb : null,
        commission_value: isCTOP ? (amtDb * pctDb) / 100 : 0, logged_by: session?.user?.id
      }]);
      alert("✅ Procurement Saved.");
      setPurchaseForm({ ...purchaseForm, qty: "", amount: "", manual_qty_override: false }); 
      fetchArchitectureAndReports(); 
    } catch (err: any) { alert("Error: " + err.message); } finally { setIsSubmitting(false); }
  };

  const handleSalesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChildLocKey || !reportingMonth) return alert("Select child center and month.");
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const centerType = selectedChildLocKey.split('-')[1];

      const parentPayload = {
        reporting_month: `${reportingMonth}-01`, location_id: parseInt(selectedChildLocKey.split('-')[0]), 
        center_type: centerType, logged_by: session?.user?.id,
        ...(centerType === 'OCSC' ? {
          cbp_landline_qty: parseInt(ocscSales.cbp_landline_qty)||0, cbp_landline_cash: parseFloat(ocscSales.cbp_landline_cash)||0, 
          cbp_gsm_qty: parseInt(ocscSales.cbp_gsm_qty)||0, cbp_gsm_cash: parseFloat(ocscSales.cbp_gsm_cash)||0,
          ctop_recharge_qty: parseInt(ocscSales.ctop_recharge_qty)||0, ctop_recharge_cash: parseFloat(ocscSales.ctop_recharge_cash)||0, 
          sim_new_qty: parseInt(ocscSales.sim_new_qty)||0, sim_upgrade_qty: parseInt(ocscSales.sim_upgrade_qty)||0,
          sim_postpaid_qty: parseInt(ocscSales.sim_postpaid_qty)||0, sim_postpaid_amt: parseFloat(ocscSales.sim_postpaid_amt)||0,
          sim_replace_qty: parseInt(ocscSales.sim_replace_qty)||0, sim_replace_cash: parseFloat(ocscSales.sim_replace_cash)||0, 
          sim_fancy_qty: parseInt(ocscSales.sim_fancy_qty)||0, sim_fancy_cash: parseFloat(ocscSales.sim_fancy_cash)||0, 
          sim_other_qty: parseInt(ocscSales.sim_other_qty)||0, sim_other_cash: parseFloat(ocscSales.sim_other_cash)||0,
        } : {}) 
      };

      const { data: parentRecord, error } = await supabase.from('mis_monthly_sales').insert([parentPayload]).select().single();
      if (error) throw error;

      if (centerType === 'CM' && cmSales.length > 0) {
        const childPayloads = cmSales.map(a => ({ monthly_sales_id: parentRecord.id, agent_ctop_no: a.agent_ctop_no, qty: parseFloat(a.qty)||0 })).filter(p => p.qty > 0); 
        if (childPayloads.length > 0) await supabase.from('mis_cm_agent_sales').insert(childPayloads);
      }
      alert(`✅ Center Sales Locked.`);
      fetchArchitectureAndReports(); 
    } catch (err: any) { alert("Error: " + err.message); } finally { setIsSubmitting(false); }
  };

  const handleCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChildLocKey || !reportingMonth) return alert("Select child center and month.");
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        reporting_month: `${reportingMonth}-01`, location_id: parseInt(selectedChildLocKey.split('-')[0]), 
        total_cash_collected: parseFloat(collectionForm.total_cash_collected) || 0, remarks: collectionForm.remarks,
        logged_by: session?.user?.id
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
        alert("✅ Collection Overwritten.");
      } else {
        await supabase.from('mis_monthly_collections').insert([payload]);
        alert("✅ Collection Logged.");
      }
      setCollectionForm({ total_cash_collected: "", remarks: "", edit_remarks: "" });
      setEditingCollectionId(null);
      fetchArchitectureAndReports(); 
    } catch (err: any) { alert("Error: " + err.message); } finally { setIsSubmitting(false); }
  };

  const handleEditCollection = (col: any) => {
    setEditingCollectionId(col.id);
    setCollectionForm({
      total_cash_collected: col.total_cash_collected?.toString() || "", 
      remarks: col.remarks || "", 
      edit_remarks: ""
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCommissionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryMasterLocId || !commissionForm.master_ctop_id) return alert("Select Master Location and CTOP.");
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        reporting_month: `${reportingMonth}-01`, location_id: parseInt(entryMasterLocId), 
        master_ctop_id: commissionForm.master_ctop_id,
        instant_commission: parseFloat(commissionForm.instant_commission) || 0,
        pending_commission: parseFloat(commissionForm.pending_commission) || 0,
        logged_by: session?.user?.id
      };
      await supabase.from('mis_commissions').insert([payload]);
      alert("✅ Commission Ledger Updated.");
      setCommissionForm({ master_ctop_id: "", instant_commission: "", pending_commission: "" });
      fetchArchitectureAndReports();
    } catch (err: any) { alert("Error: " + err.message); } finally { setIsSubmitting(false); }
  };

  // --- CSV EXPORT ENGINE ---
  const downloadCSV = (type: string, data: any[]) => {
    if (data.length === 0) return alert("No data available to export.");
    let csvContent = "";
    
    if (type === 'balances') {
      csvContent = "Date,Type,Location,CTOP,CBP_Qty,CTOP_Qty,SIM_Qty\n" + data.map(r => 
        `${r.report_date},${r.entry_type},${sanitizeCSV(r.locations?.center_name)},${r.master_ctop_accounts?.master_ctop_no},${r.cbp_qty},${r.ctop_qty},${r.sim_qty}`
      ).join("\n");
    } else if (type === 'purchases') {
      csvContent = "Date,Location,CTOP,Product,Qty,Amount_INR\n" + data.map(r => 
        `${r.purchase_date},${sanitizeCSV(r.locations?.center_name || 'N/A')},${r.master_ctop_accounts?.master_ctop_no},${r.product_category},${r.qty},${r.amount}`
      ).join("\n");
    } else if (type === 'sales') {
      csvContent = "Month,Location,Type,CBP_Landline_Cash,CBP_GSM_Cash,CTOP_Cash,SIM_New_Qty,SIM_Upgrade_Qty\n" + data.map(r => 
        `${r.reporting_month},${sanitizeCSV(r.locations?.center_name)},${r.center_type},${r.cbp_landline_cash||0},${r.cbp_gsm_cash||0},${r.ctop_recharge_cash||0},${r.sim_new_qty||0},${r.sim_upgrade_qty||0}`
      ).join("\n");
    } else if (type === 'collections') {
      csvContent = "Month,Location,Collected_INR,Remarks,Edited,Audit_Remarks\n" + data.map(r => 
        `${r.reporting_month},${sanitizeCSV(r.locations?.center_name)},${r.total_cash_collected},${sanitizeCSV(r.remarks)},${r.is_edited_by_staff?'YES':'NO'},${sanitizeCSV(r.staff_edit_remarks)}`
      ).join("\n");
    } else if (type === 'commissions') {
      csvContent = "Month,Location,CTOP,Instant_Comm,Pending_Comm\n" + data.map(r => 
        `${r.reporting_month},${sanitizeCSV(r.locations?.center_name)},${r.master_ctop_accounts?.master_ctop_no},${r.instant_commission},${r.pending_commission}`
      ).join("\n");
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_MIS_${type}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // --- REPORTING LOGIC & EXACT MATH ENGINE ---
  const getFilteredReports = () => {
    let fPurchases = [...rawPurchases];
    let fSales = [...rawSales];
    let fCollections = [...rawCollections];
    let fBalances = [...rawBalances];
    let fComms = [...rawCommissions];

    const today = new Date();
    let startDate = new Date("2000-01-01");

    if (repTimeFilter === "today") startDate = new Date(today.setHours(0,0,0,0));
    else if (repTimeFilter === "this_week") startDate = new Date(today.setDate(today.getDate() - today.getDay()));
    else if (repTimeFilter === "this_month") startDate = new Date(today.getFullYear(), today.getMonth(), 1);

    const startStr = startDate.toISOString().split('T')[0];

    if (repTimeFilter !== "all") {
      fPurchases = fPurchases.filter(p => p.purchase_date >= startStr);
      fSales = fSales.filter(s => s.reporting_month >= startStr);
      fCollections = fCollections.filter(c => c.reporting_month >= startStr);
      fBalances = fBalances.filter(b => b.report_date >= startStr);
      fComms = fComms.filter(c => c.reporting_month >= startStr);
    }

    if (repMasterFilter !== "ALL") {
      const masterId = parseInt(repMasterFilter);
      fPurchases = fPurchases.filter(p => p.location_id === masterId);
      fSales = fSales.filter(s => s.locations?.parent_master_id === masterId);
      fCollections = fCollections.filter(c => c.locations?.parent_master_id === masterId);
      fBalances = fBalances.filter(b => b.location_id === masterId);
      fComms = fComms.filter(c => c.location_id === masterId);
    }

    // Master HQ Aggregation Engine
    const hqMap: Record<string, any> = {};
    const filteredHQs = repMasterFilter !== "ALL" ? hqLocations.filter(h => h.id.toString() === repMasterFilter) : hqLocations;

    filteredHQs.forEach(hq => {
      // 1. Snapshot Balances
      const hqBals = fBalances.filter(b => b.location_id === hq.id);
      const openBals = hqBals.filter(b => b.entry_type === 'Opening Balance');
      const closeBals = hqBals.filter(b => b.entry_type === 'Closing Balance');
      
      const openCBP = openBals.reduce((sum, b) => sum + Number(b.cbp_qty||0), 0);
      const closeCBP = closeBals.reduce((sum, b) => sum + Number(b.cbp_qty||0), 0);
      const openCTOP = openBals.reduce((sum, b) => sum + Number(b.ctop_qty||0), 0);
      const closeCTOP = closeBals.reduce((sum, b) => sum + Number(b.ctop_qty||0), 0);
      const openSIM = openBals.reduce((sum, b) => sum + Number(b.sim_qty||0), 0);
      const closeSIM = closeBals.reduce((sum, b) => sum + Number(b.sim_qty||0), 0);

      // 2. Sum Purchases
      const hqPurchases = fPurchases.filter(p => p.location_id === hq.id);
      const pCBP = hqPurchases.filter(p => p.product_category === 'CBP').reduce((sum, p) => sum + Number(p.qty||0), 0);
      const pCTOP = hqPurchases.filter(p => p.product_category === 'CTOP').reduce((sum, p) => sum + Number(p.qty||0), 0);
      const pSIM = hqPurchases.filter(p => p.product_category === 'SIM_FREE' || p.product_category === 'SIM_PAID').reduce((sum, p) => sum + Number(p.qty||0), 0);

      // 3. Sum Sales
      const hqSales = fSales.filter(s => s.locations?.parent_master_id === hq.id);
      const sCBP = hqSales.reduce((sum, s) => sum + Number(s.cbp_landline_qty||0) + Number(s.cbp_gsm_qty||0), 0);
      const sCTOP = hqSales.reduce((sum, s) => sum + Number(s.ctop_recharge_cash||0), 0);
      const sSIM = hqSales.reduce((sum, s) => sum + Number(s.sim_new_qty||0) + Number(s.sim_upgrade_qty||0) + Number(s.sim_replace_qty||0) + Number(s.sim_fancy_qty||0) + Number(s.sim_postpaid_qty||0), 0);

      // 4. Sum Commissions
      const hqComms = fComms.filter(c => c.location_id === hq.id);
      const cInst = hqComms.reduce((sum, c) => sum + Number(c.instant_commission||0), 0);
      const cPend = hqComms.reduce((sum, c) => sum + Number(c.pending_commission||0), 0);

      // 5. Variance Math: Open - Close + Purchase + Comm(Inst) + Comm(Pend) - Sales = Variance
      const vCBP = (openCBP - closeCBP) + pCBP - sCBP;
      const vCTOP = (openCTOP - closeCTOP) + pCTOP + cInst + cPend - sCTOP;
      const vSIM = (openSIM - closeSIM) + pSIM - sSIM;

      hqMap[hq.id] = {
        name: hq.center_name,
        cbp: { open: openCBP, close: closeCBP, purch: pCBP, sales: sCBP, variance: vCBP },
        ctop: { open: openCTOP, close: closeCTOP, purch: pCTOP, comm: cInst + cPend, sales: sCTOP, variance: vCTOP },
        sim: { open: openSIM, close: closeSIM, purch: pSIM, sales: sSIM, variance: vSIM }
      };
    });

    return { 
      fPurchases, fSales, fCollections, fBalances, fComms, hqMap 
    };
  };

  const { fPurchases, fSales, fCollections, fBalances, fComms, hqMap } = getFilteredReports();
  const numInputClass = "w-full border border-slate-300 p-2.5 rounded-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div></div>;

  const hqLocations = allLocations.filter(l => l.is_master_node);
  const entryFilteredFranchises = allLocations.filter(l => !l.is_master_node && (entryMasterLocId === "" || l.parent_master_id === parseInt(entryMasterLocId)));
  const mappedMasterCtopsForBalance = masterCtops.filter(m => m.location_id?.toString() === balanceForm.location_id);
  const mappedMasterCtopsForComms = masterCtops.filter(m => m.location_id?.toString() === entryMasterLocId);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-slate-50 min-h-screen font-sans">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-slate-200 pb-6 gap-4">
        <div>
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline mb-2 inline-block text-sm">&larr; Back to Command Center</Link>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3"><span className="text-4xl">📊</span> Manager MIS Dashboard</h1>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-px">
        <button onClick={() => setActiveTab('balances')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'balances' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>1. Master Balances</button>
        {userRole !== 'staff' && (
          <>
            <button onClick={() => setActiveTab('purchase')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'purchase' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>2. Procurement</button>
            <button onClick={() => setActiveTab('sales')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'sales' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>3. Center Sales</button>
            <button onClick={() => setActiveTab('collection')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'collection' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>4. Collections</button>
            <button onClick={() => setActiveTab('commissions')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'commissions' ? 'bg-white text-amber-600 border-t-2 border-l border-r border-amber-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>5. Commissions</button>
            <button onClick={() => setActiveTab('report')} className={`px-5 py-3 font-black text-xs md:text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'report' ? 'bg-white text-emerald-600 border-t-2 border-l border-r border-emerald-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>6. Live Reports</button>
          </>
        )}
      </div>

      {/* ========================================== */}
      {/* TAB 1: BALANCES */}
      {/* ========================================== */}
      {activeTab === 'balances' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className={`p-4 rounded-lg mb-6 flex gap-4 items-center justify-between ${editingBalanceId ? 'bg-amber-100 border border-amber-300' : 'bg-slate-900'}`}>
              <div className="flex gap-4 items-center">
                <span className="text-3xl">⚖️️</span>
                <div>
                  <h2 className={`font-black uppercase tracking-widest ${editingBalanceId ? 'text-amber-900' : 'text-white'}`}>
                    {editingBalanceId ? 'Editing Balance Record' : 'Log Daily Balances'}
                  </h2>
                </div>
              </div>
              {editingBalanceId && <button onClick={() => { setEditingBalanceId(null); setBalanceForm({...balanceForm, cbp_qty: "", ctop_qty: "", sim_qty: ""}); }} className="bg-amber-600 hover:bg-amber-700 text-white font-black px-4 py-2 rounded text-xs uppercase tracking-widest transition">Cancel Edit</button>}
            </div>

            <form onSubmit={handleBalanceSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div><label className="block text-[10px] font-black text-slate-500 uppercase">Record Date</label><input required type="date" value={balanceForm.report_date} onChange={e => setBalanceForm({...balanceForm, report_date: e.target.value})} className={numInputClass} /></div>
                <div><label className="block text-[10px] font-black text-indigo-600 uppercase">Master Location</label><select required value={balanceForm.location_id} onChange={e => setBalanceForm({...balanceForm, location_id: e.target.value, master_ctop_id: ""})} className={numInputClass}><option value="" disabled>-- Select HQ --</option>{hqLocations.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}</select></div>
                <div><label className="block text-[10px] font-black text-indigo-600 uppercase">Master CTOP No.</label><select required disabled={!balanceForm.location_id} value={balanceForm.master_ctop_id} onChange={e => setBalanceForm({...balanceForm, master_ctop_id: e.target.value})} className={numInputClass}><option value="" disabled>-- Select CTOP --</option>{mappedMasterCtopsForBalance.map(m => <option key={m.id} value={m.id}>{m.master_ctop_no}</option>)}</select></div>
                <div><label className="block text-[10px] font-black text-slate-500 uppercase">Entry Type</label><select value={balanceForm.entry_type} onChange={e => setBalanceForm({...balanceForm, entry_type: e.target.value})} className={numInputClass}><option>Opening Balance</option><option>Closing Balance</option></select></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-5 bg-slate-50 rounded-xl border border-slate-200">
                <div><label className="block text-[10px] font-black text-slate-500 uppercase">CBP Qty</label><input required type="number" step="0.01" min="0" value={balanceForm.cbp_qty} onChange={e => setBalanceForm({...balanceForm, cbp_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0.00" /></div>
                <div><label className="block text-[10px] font-black text-slate-500 uppercase">CTOP Qty</label><input required type="number" step="0.01" min="0" value={balanceForm.ctop_qty} onChange={e => setBalanceForm({...balanceForm, ctop_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0.00" /></div>
                <div><label className="block text-[10px] font-black text-slate-500 uppercase">SIM Qty</label><input required type="number" step="0.01" min="0" value={balanceForm.sim_qty} onChange={e => setBalanceForm({...balanceForm, sim_qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} placeholder="0.00" /></div>
              </div>
              <button type="submit" disabled={isSubmitting} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl uppercase tracking-widest">{isSubmitting ? "Committing..." : "Lock Balance Entry"}</button>
            </form>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 bg-slate-900 flex justify-between items-center text-white"><h3 className="font-black uppercase text-xs">Recent Master Balances</h3><button onClick={() => downloadCSV('balances', rawBalances)} className="bg-slate-700 px-3 py-1 rounded text-[10px] font-bold">📥 CSV</button></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b"><tr><th className="p-4">Date & Type</th><th className="p-4">Location & CTOP</th><th className="p-4 text-right">CBP Qty</th><th className="p-4 text-right">CTOP Qty</th><th className="p-4 text-right">SIM Qty</th><th className="p-4 text-right">Action</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rawBalances.slice(0, 50).map(bal => (
                    <tr key={bal.id} className="hover:bg-slate-50">
                      <td className="p-4"><p className="font-black">{bal.report_date}</p><span className="text-[9px] uppercase px-2 py-0.5 rounded border">{bal.entry_type}</span></td>
                      <td className="p-4"><p className="font-bold text-indigo-700">{bal.locations?.center_name}</p><p className="text-xs text-slate-500">{bal.master_ctop_accounts?.master_ctop_no}</p></td>
                      <td className="p-4 text-right font-black">{Number(bal.cbp_qty).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-black">{Number(bal.ctop_qty).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-black">{Number(bal.sim_qty||0).toLocaleString('en-IN')}</td>
                      <td className="p-4 text-right"><button onClick={() => handleEditBalance(bal)} className="bg-slate-100 px-3 py-1 rounded text-[10px] uppercase font-bold border">Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* REDACTION BARRIER FOR UPPER TABS */}
      {/* ========================================== */}
      {userRole !== 'staff' && (
        <>
          {activeTab === 'purchase' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="font-black uppercase tracking-widest text-lg mb-6">Master Procurement</h2>
                <form onSubmit={handlePurchaseSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-3"><label className="block text-[10px] font-black uppercase">Master CTOP *</label><select required value={purchaseForm.master_ctop_id} onChange={e => setPurchaseForm({...purchaseForm, master_ctop_id: e.target.value})} className={numInputClass}><option value="" disabled>-- Select --</option>{masterCtops.map(m => <option key={m.id} value={m.id}>{m.master_ctop_no} {m.locations?.center_name ? `(${m.locations.center_name})` : ''}</option>)}</select></div>
                    <div><label className="block text-[10px] font-black uppercase">Date</label><input required type="date" value={purchaseForm.purchase_date} onChange={e => setPurchaseForm({...purchaseForm, purchase_date: e.target.value})} className={numInputClass} /></div>
                    <div><label className="block text-[10px] font-black uppercase">Category</label><select value={purchaseForm.product_category} onChange={e => setPurchaseForm({...purchaseForm, product_category: e.target.value})} className={numInputClass}><option value="CBP">CBP</option><option value="CTOP">CTOP</option><option value="SIM_FREE">SIM (Free)</option><option value="SIM_PAID">SIM (Paid)</option></select></div>
                    <div><label className="block text-[10px] font-black uppercase">Amount (₹)</label><input required type="number" step="0.01" min="0" value={purchaseForm.amount} onChange={e => setPurchaseForm({...purchaseForm, amount: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                    <div><label className="block text-[10px] font-black uppercase">Final Qty</label><input required type="number" step="0.01" min="0" value={purchaseForm.qty} onChange={e => setPurchaseForm({...purchaseForm, qty: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} disabled={!purchaseForm.manual_qty_override} className={numInputClass} /></div>
                    {purchaseForm.product_category === 'CTOP' && (
                      <div className="md:col-span-2 flex gap-4"><div className="flex-1"><label className="block text-[10px] font-black uppercase">Comm %</label><input required type="number" step="0.01" min="0" value={purchaseForm.commission_percent} onChange={e => setPurchaseForm({...purchaseForm, commission_percent: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div></div>
                    )}
                  </div>
                  <button type="submit" disabled={isSubmitting} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl uppercase tracking-widest">Submit</button>
                </form>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 bg-slate-900 flex justify-between items-center text-white"><h3 className="font-black uppercase text-xs">Procurement Ledger</h3><button onClick={() => downloadCSV('purchases', rawPurchases)} className="bg-slate-700 px-3 py-1 rounded text-[10px] font-bold">📥 CSV</button></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b"><tr><th className="p-4">Date</th><th className="p-4">Location & CTOP</th><th className="p-4">Product</th><th className="p-4 text-right">Qty</th><th className="p-4 text-right">Amount (₹)</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {rawPurchases.slice(0, 50).map(p => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="p-4 font-black">{p.purchase_date}</td>
                          <td className="p-4 font-bold text-indigo-700">{p.master_ctop_accounts?.locations?.center_name} <span className="text-slate-500 block text-xs">{p.master_ctop_accounts?.master_ctop_no}</span></td>
                          <td className="p-4 font-black">{p.product_category}</td>
                          <td className="p-4 text-right font-black">{p.qty}</td>
                          <td className="p-4 text-right font-black">₹{Number(p.amount).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {(activeTab === 'sales' || activeTab === 'collection' || activeTab === 'commissions') && (
            <div className="bg-slate-900 p-5 rounded-xl grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
              <div><label className="text-[10px] font-black text-indigo-400 uppercase">Master HQ</label><select value={entryMasterLocId} onChange={(e) => {setEntryMasterLocId(e.target.value); setSelectedChildLocKey("");}} className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold p-2.5 rounded-lg outline-none"><option value="">-- All HQs --</option>{hqLocations.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}</select></div>
              {activeTab !== 'commissions' && (
                <div><label className="text-[10px] font-black text-emerald-400 uppercase">Child Center (Sales/Coll)</label><select value={selectedChildLocKey} onChange={(e) => setSelectedChildLocKey(e.target.value)} className="w-full bg-slate-800 border-2 border-emerald-500 text-white font-bold p-2.5 rounded-lg outline-none"><option value="" disabled>-- Select --</option>{entryFilteredFranchises.flatMap(l => { const opts = []; if (l.role_ocsc) opts.push(<option key={`${l.id}-OCSC`} value={`${l.id}-OCSC`}>{l.center_name} (OCSC)</option>); if (l.role_cm) opts.push(<option key={`${l.id}-CM`} value={`${l.id}-CM`}>{l.center_name} (CM)</option>); return opts;})}</select></div>
              )}
              <div><label className="text-[10px] font-black text-slate-400 uppercase">Reporting Month</label><input type="month" value={reportingMonth} onChange={(e) => setReportingMonth(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold p-2.5 rounded-lg outline-none" /></div>
            </div>
          )}

          {activeTab === 'sales' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="font-black uppercase text-lg mb-6">Sales Entry ({reportingMonth})</h2>
                {!selectedChildLocKey ? (
                  <p className="text-center font-bold text-slate-400 py-8">Select a Child Center above.</p>
                ) : (
                  <form onSubmit={handleSalesSubmit} className="space-y-6">
                    {selectedChildLocKey.includes('OCSC') && (
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold uppercase">CBP LL Qty</label><input type="number" value={ocscSales.cbp_landline_qty} onChange={e => setOcscSales({...ocscSales, cbp_landline_qty: e.target.value})} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold uppercase">CBP LL Cash (₹)</label><input type="number" step="0.01" value={ocscSales.cbp_landline_cash} onChange={e => setOcscSales({...ocscSales, cbp_landline_cash: e.target.value})} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold uppercase">CBP GSM Qty</label><input type="number" value={ocscSales.cbp_gsm_qty} onChange={e => setOcscSales({...ocscSales, cbp_gsm_qty: e.target.value})} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold uppercase">CBP GSM Cash (₹)</label><input type="number" step="0.01" value={ocscSales.cbp_gsm_cash} onChange={e => setOcscSales({...ocscSales, cbp_gsm_cash: e.target.value})} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold uppercase">CTOP Qty</label><input type="number" value={ocscSales.ctop_recharge_qty} onChange={e => setOcscSales({...ocscSales, ctop_recharge_qty: e.target.value})} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold uppercase">CTOP Cash (₹)</label><input type="number" step="0.01" value={ocscSales.ctop_recharge_cash} onChange={e => setOcscSales({...ocscSales, ctop_recharge_cash: e.target.value})} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold uppercase">SIM New Qty</label><input type="number" value={ocscSales.sim_new_qty} onChange={e => setOcscSales({...ocscSales, sim_new_qty: e.target.value})} className={numInputClass} /></div>
                        <div><label className="text-[10px] font-bold uppercase">SIM Upgrd Qty</label><input type="number" value={ocscSales.sim_upgrade_qty} onChange={e => setOcscSales({...ocscSales, sim_upgrade_qty: e.target.value})} className={numInputClass} /></div>
                      </div>
                    )}
                    {selectedChildLocKey.includes('CM') && (
                      <div className="space-y-3">
                        {cmSales.map((a, idx) => (
                          <div key={a.agent_ctop_no} className="flex justify-between items-center bg-slate-50 p-3 rounded border">
                            <span className="font-bold text-slate-800">{a.agent_ctop_no}</span>
                            <input type="number" value={a.qty} onChange={(e) => { const n = [...cmSales]; n[idx].qty = e.target.value; setCmSales(n); }} className="border p-2 rounded w-32" />
                          </div>
                        ))}
                      </div>
                    )}
                    <button type="submit" disabled={isSubmitting} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl uppercase">Lock Center Sales</button>
                  </form>
                )}
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 bg-slate-900 flex justify-between items-center text-white"><h3 className="font-black uppercase text-xs">Sales Ledger</h3><button onClick={() => downloadCSV('sales', rawSales)} className="bg-slate-700 px-3 py-1 rounded text-[10px] font-bold">📥 CSV</button></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b"><tr><th className="p-4">Month</th><th className="p-4">Center</th><th className="p-4 text-right">CBP Cash</th><th className="p-4 text-right">CTOP Cash</th><th className="p-4 text-right">SIM Qty (New)</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {rawSales.slice(0, 50).map(s => (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="p-4 font-black">{s.reporting_month}</td>
                          <td className="p-4 font-bold text-slate-800">{s.locations?.center_name} <span className="text-[10px] text-blue-600 border px-1 rounded ml-2">{s.center_type}</span></td>
                          <td className="p-4 text-right font-black">₹{Number(s.cbp_landline_cash||0) + Number(s.cbp_gsm_cash||0)}</td>
                          <td className="p-4 text-right font-black">₹{Number(s.ctop_recharge_cash||0)}</td>
                          <td className="p-4 text-right font-black">{s.sim_new_qty||0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'collection' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-white rounded-xl shadow-sm border p-6 max-w-2xl mx-auto">
                <div className="flex justify-between items-center mb-6"><h2 className="font-black uppercase text-lg">Declare Collection</h2><button onClick={() => downloadCSV('collections', rawCollections)} className="bg-slate-100 border px-3 py-1 text-xs font-bold rounded">📥 CSV</button></div>
                {!selectedChildLocKey ? (
                  <p className="text-center font-bold text-slate-400 py-8">Select a Child Center above.</p>
                ) : (
                  <form onSubmit={handleCollectionSubmit} className="space-y-6">
                    <div><label className="block text-[10px] font-black uppercase">Collected (₹)</label><input required type="number" step="0.01" min="0" value={collectionForm.total_cash_collected} onChange={e => setCollectionForm({...collectionForm, total_cash_collected: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                    <div><label className="block text-[10px] font-black uppercase">Remarks</label><input type="text" value={collectionForm.remarks} onChange={e => setCollectionForm({...collectionForm, remarks: e.target.value})} className={numInputClass} /></div>
                    {editingCollectionId && <div><label className="block text-[10px] text-red-600 font-black uppercase">Audit Remarks (Mandatory for Edits)</label><input required type="text" value={collectionForm.edit_remarks} onChange={e => setCollectionForm({...collectionForm, edit_remarks: e.target.value})} className={numInputClass} /></div>}
                    <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-600 text-white font-black py-4 rounded-xl uppercase">Submit Collection</button>
                  </form>
                )}
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 bg-slate-900 flex justify-between items-center text-white"><h3 className="font-black uppercase text-xs">Collections Ledger</h3><button onClick={() => downloadCSV('collections', rawCollections)} className="bg-slate-700 px-3 py-1 rounded text-[10px] font-bold">📥 CSV</button></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b"><tr><th className="p-4">Month</th><th className="p-4">Center</th><th className="p-4 text-right">Collected (₹)</th><th className="p-4">Remarks</th><th className="p-4 text-right">Action</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {rawCollections.slice(0, 50).map(c => (
                        <tr key={c.id} className={`hover:bg-slate-50 ${editingCollectionId === c.id ? 'bg-amber-50' : ''}`}>
                          <td className="p-4 font-black">{c.reporting_month}</td>
                          <td className="p-4 font-bold text-slate-800">{c.locations?.center_name}</td>
                          <td className="p-4 text-right font-black text-emerald-600">₹{Number(c.total_cash_collected).toLocaleString('en-IN')}</td>
                          <td className="p-4 text-xs text-slate-500">{c.remarks} {c.is_edited_by_staff && <span className="text-red-500 ml-1 font-bold">(Edited: {c.staff_edit_remarks})</span>}</td>
                          <td className="p-4 text-right"><button onClick={() => handleEditCollection(c)} className="bg-slate-100 px-3 py-1 rounded text-[10px] uppercase font-bold border">Edit</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'commissions' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-white rounded-xl shadow-sm border p-6 max-w-2xl mx-auto">
                <h2 className="font-black uppercase text-lg mb-6">Log Commissions</h2>
                {!entryMasterLocId ? (
                  <p className="text-center font-bold text-slate-400 py-8">Select a Master HQ above.</p>
                ) : (
                  <form onSubmit={handleCommissionSubmit} className="space-y-6">
                    <div><label className="block text-[10px] font-black uppercase">Master CTOP</label><select required value={commissionForm.master_ctop_id} onChange={e => setCommissionForm({...commissionForm, master_ctop_id: e.target.value})} className={numInputClass}><option value="" disabled>-- Select --</option>{mappedMasterCtopsForComms.map(m => <option key={m.id} value={m.id}>{m.master_ctop_no}</option>)}</select></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="block text-[10px] font-black uppercase">Instant (₹)</label><input required type="number" step="0.01" min="0" value={commissionForm.instant_commission} onChange={e => setCommissionForm({...commissionForm, instant_commission: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                      <div><label className="block text-[10px] font-black uppercase">Pending (₹)</label><input required type="number" step="0.01" min="0" value={commissionForm.pending_commission} onChange={e => setCommissionForm({...commissionForm, pending_commission: e.target.value})} onKeyDown={preventNegativeScroll} onWheel={handleWheel} className={numInputClass} /></div>
                    </div>
                    <button type="submit" disabled={isSubmitting} className="w-full bg-amber-600 text-white font-black py-4 rounded-xl uppercase">Log Commission</button>
                  </form>
                )}
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 bg-slate-900 flex justify-between items-center text-white"><h3 className="font-black uppercase text-xs">Commission Ledger</h3><button onClick={() => downloadCSV('commissions', rawCommissions)} className="bg-slate-700 px-3 py-1 rounded text-[10px] font-bold">📥 CSV</button></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b"><tr><th className="p-4">Month</th><th className="p-4">Location & CTOP</th><th className="p-4 text-right">Instant (₹)</th><th className="p-4 text-right">Pending (₹)</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {rawCommissions.slice(0, 50).map(c => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="p-4 font-black">{c.reporting_month}</td>
                          <td className="p-4 font-bold text-slate-800">{c.locations?.center_name} <span className="text-xs text-slate-500 ml-2">{c.master_ctop_accounts?.master_ctop_no}</span></td>
                          <td className="p-4 text-right font-black text-amber-600">₹{Number(c.instant_commission).toLocaleString('en-IN')}</td>
                          <td className="p-4 text-right font-black text-amber-600">₹{Number(c.pending_commission).toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'report' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-slate-900 p-5 rounded-xl grid grid-cols-3 gap-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Time Context</label>
                  <select value={repTimeFilter} onChange={(e) => setRepTimeFilter(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold p-2.5 rounded-lg">
                    <option value="this_month">This Month</option><option value="all">All Time</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-indigo-400 uppercase block mb-1">Master HQ (Hub)</label>
                  <select value={repMasterFilter} onChange={(e) => setRepMasterFilter(e.target.value)} className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold p-2.5 rounded-lg">
                    <option value="ALL">-- All HQ Hubs --</option>{hqLocations.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
                  </select>
                </div>
              </div>

              {/* MATHEMATICAL LIVE REPORT TABLE */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
                  <h3 className="font-black uppercase text-sm tracking-widest flex items-center gap-2"><span>🧮</span> Master Reconciliation Matrix</h3>
                  <button onClick={() => {
                    const csvRows = ["Location,Item,Opening,Purchases,Commissions,Sales,Closing,Variance"];
                    Object.values(hqMap).forEach((hq: any) => {
                      csvRows.push(`${sanitizeCSV(hq.name)},CBP Qty,${hq.cbp.open},${hq.cbp.purch},0,${hq.cbp.sales},${hq.cbp.close},${hq.cbp.variance}`);
                      csvRows.push(`${sanitizeCSV(hq.name)},CTOP Cash,${hq.ctop.open},${hq.ctop.purch},${hq.ctop.comm},${hq.ctop.sales},${hq.ctop.close},${hq.ctop.variance}`);
                      csvRows.push(`${sanitizeCSV(hq.name)},SIM Qty,${hq.sim.open},${hq.sim.purch},0,${hq.sim.sales},${hq.sim.close},${hq.sim.variance}`);
                    });
                    const blob = new Blob([csvRows.join("\n")], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "FastArk_Reconciliation.csv"; link.click();
                  }} className="bg-emerald-600 px-4 py-1.5 rounded font-black text-xs">📥 Download Matrix CSV</button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-100 text-[10px] uppercase tracking-widest text-slate-600 border-b border-slate-300">
                      <tr>
                        <th className="p-4 font-black">Location (HQ)</th>
                        <th className="p-4 font-black">Ledger Item</th>
                        <th className="p-4 font-black text-right text-slate-400">Opening (+)</th>
                        <th className="p-4 font-black text-right text-slate-400">Purchases (+)</th>
                        <th className="p-4 font-black text-right text-slate-400">Commissions (+)</th>
                        <th className="p-4 font-black text-right text-red-400">Total Sales (-)</th>
                        <th className="p-4 font-black text-right text-red-400">Closing (-)</th>
                        <th className="p-4 font-black text-right bg-emerald-50 text-emerald-800 border-l border-slate-300">Variance (=)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {Object.keys(hqMap).length === 0 ? (
                        <tr><td colSpan={8} className="p-8 text-center text-slate-500 font-bold">No data matches the selected filters.</td></tr>
                      ) : (
                        Object.values(hqMap).map((hq: any, idx) => (
                          <React.Fragment key={idx}>
                            {/* CBP ROW */}
                            <tr className="hover:bg-slate-50">
                              <td className="p-4 font-black text-slate-900 border-b-0" rowSpan={3}>{hq.name}</td>
                              <td className="p-4 font-bold text-slate-700 bg-slate-50">CBP Qty</td>
                              <td className="p-4 text-right font-medium">{hq.cbp.open}</td>
                              <td className="p-4 text-right font-medium">{hq.cbp.purch}</td>
                              <td className="p-4 text-right font-medium">-</td>
                              <td className="p-4 text-right font-medium">{hq.cbp.sales}</td>
                              <td className="p-4 text-right font-medium">{hq.cbp.close}</td>
                              <td className={`p-4 text-right font-black border-l border-slate-200 ${hq.cbp.variance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {hq.cbp.variance}
                              </td>
                            </tr>
                            {/* CTOP ROW */}
                            <tr className="hover:bg-slate-50">
                              <td className="p-4 font-bold text-blue-700 bg-blue-50/30 border-y border-slate-100">CTOP Cash</td>
                              <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.open.toLocaleString()}</td>
                              <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.purch.toLocaleString()}</td>
                              <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.comm.toLocaleString()}</td>
                              <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.sales.toLocaleString()}</td>
                              <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.close.toLocaleString()}</td>
                              <td className={`p-4 text-right font-black border-l border-slate-200 border-y border-y-slate-100 ${hq.ctop.variance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ₹{hq.ctop.variance.toLocaleString()}
                              </td>
                            </tr>
                            {/* SIM ROW */}
                            <tr className="border-b-4 border-slate-300 hover:bg-slate-50">
                              <td className="p-4 font-bold text-slate-700 bg-slate-50">SIM Qty</td>
                              <td className="p-4 text-right font-medium">{hq.sim.open}</td>
                              <td className="p-4 text-right font-medium">{hq.sim.purch}</td>
                              <td className="p-4 text-right font-medium">-</td>
                              <td className="p-4 text-right font-medium">{hq.sim.sales}</td>
                              <td className="p-4 text-right font-medium">{hq.sim.close}</td>
                              <td className={`p-4 text-right font-black border-l border-slate-200 ${hq.sim.variance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {hq.sim.variance}
                              </td>
                            </tr>
                          </React.Fragment>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="bg-emerald-50 p-4 border-t border-emerald-200 text-center">
                  <p className="text-[10px] text-emerald-800 font-bold uppercase tracking-widest">Formula applied: (Open - Close) + Purchase + Commissions - Sales = Variance</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}