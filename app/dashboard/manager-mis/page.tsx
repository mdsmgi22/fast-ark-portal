"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

import BalancesModule from "../../components/mis/BalancesModule";
import PurchaseModule from "../../components/mis/PurchaseModule";
import SalesModule from "../../components/mis/SalesModule";
import CollectionModule from "../../components/mis/CollectionModule";
import CommissionsModule from "../../components/mis/CommissionsModule";
import ReportsModule from "../../components/mis/ReportsModule";
import VerificationModule from "../../components/mis/VerificationModule";
import ExportModule from "../../components/mis/ExportModule";

export default function ManagerMISDashboard() {
  const router = useRouter();
  
  const [isMounted, setIsMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [userRole, setUserRole] = useState("staff");
  
  const [activeTab, setActiveTab] = useState<'balances' | 'purchase' | 'sales' | 'collection' | 'commissions' | 'report' | 'verification' | 'export'>('balances');

  const [reportingMonth, setReportingMonth] = useState(""); 
  const [entryMasterLocId, setEntryMasterLocId] = useState("");
  const [selectedChildLocKey, setSelectedChildLocKey] = useState("");

  const [allLocations, setAllLocations] = useState<any[]>([]); 
  const [masterCtops, setMasterCtops] = useState<any[]>([]); 
  const [agentMappings, setAgentMappings] = useState<any[]>([]);

  const [rawBalances, setRawBalances] = useState<any[]>([]);
  const [rawPurchases, setRawPurchases] = useState<any[]>([]);
  const [rawSales, setRawSales] = useState<any[]>([]);
  const [rawCollections, setRawCollections] = useState<any[]>([]);
  const [rawCommissions, setRawCommissions] = useState<any[]>([]);

  useEffect(() => { 
    setIsMounted(true);
    const istTime = new Date(new Date().getTime() + (330 * 60000));
    setReportingMonth(istTime.toISOString().substring(0, 7));
    
    fetchArchitectureAndReports(); 
  }, []);

  const fetchArchitectureAndReports = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const { data: currentUser } = await supabase
        .from('back_office_staff')
        .select('role')
        .eq('email', session.user.email)
        .single();
        
      setUserRole(currentUser?.role?.trim().toLowerCase() || 'staff');

      const [locRes, masterRes, agentRes, purRes, salesRes, colRes, balRes, commRes] = await Promise.all([
        supabase.from("locations").select("*").order("center_name"), 
        supabase.from("master_ctop_accounts").select("*, locations(center_name)"),
        supabase.from("agent_ctop_mappings").select("*, active_partners(locations(id))"),
        supabase.from("mis_purchases").select("*, master_ctop_accounts(master_ctop_no, location_id)").order("purchase_date", {ascending: false}),
        supabase.from("mis_monthly_sales").select("*, locations(center_name, parent_master_id, state)").order("reporting_month", {ascending: false}),
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

  if (!isMounted || loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
    </div>
  );

  const uniqueStates = Array.from(new Set(allLocations.map(l => l.state).filter(Boolean))).sort();
  const hqLocations = allLocations.filter(l => l.is_master_node);
  const entryFilteredFranchises = allLocations.filter(l => !l.is_master_node && (entryMasterLocId === "" || l.parent_master_id === parseInt(entryMasterLocId)));
  const mappedMasterCtops = masterCtops;

  const sharedProps = {
    hqLocations, uniqueStates, entryFilteredFranchises, allLocations, agentMappings, mappedMasterCtops,
    fetchArchitectureAndReports,
    reportingMonth, setReportingMonth, entryMasterLocId, setEntryMasterLocId, selectedChildLocKey, setSelectedChildLocKey
  };

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto bg-slate-50 min-h-screen font-sans">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-slate-200 pb-6 gap-4">
        <div>
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline mb-2 inline-block text-sm">&larr; Back to Command Center</Link>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3"><span className="text-4xl">📊</span> Manager MIS Dashboard</h1>
          <p className="text-slate-500 font-medium mt-1">Hierarchical MIS Pipeline: Master Procurement & Center Operations.</p>
        </div>
      </div>

      {/* TIER 1: MAIN NAVIGATION */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-px">
        <button onClick={() => setActiveTab('balances')} className={`px-4 py-3 font-black text-xs uppercase tracking-widest rounded-t-lg transition ${activeTab === 'balances' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>1. Balances</button>
        {userRole !== 'staff' && (
          <>
            <button onClick={() => setActiveTab('purchase')} className={`px-4 py-3 font-black text-xs uppercase tracking-widest rounded-t-lg transition ${activeTab === 'purchase' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>2. Procurement</button>
            <button onClick={() => setActiveTab('sales')} className={`px-4 py-3 font-black text-xs uppercase tracking-widest rounded-t-lg transition ${activeTab === 'sales' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>3. Sales</button>
            <button onClick={() => setActiveTab('collection')} className={`px-4 py-3 font-black text-xs uppercase tracking-widest rounded-t-lg transition ${activeTab === 'collection' ? 'bg-white text-indigo-600 border-t-2 border-l border-r border-indigo-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>4. Collection</button>
            <button onClick={() => setActiveTab('commissions')} className={`px-4 py-3 font-black text-xs uppercase tracking-widest rounded-t-lg transition ${activeTab === 'commissions' ? 'bg-white text-amber-600 border-t-2 border-l border-r border-amber-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>5. Commissions</button>
            <button onClick={() => setActiveTab('report')} className={`px-4 py-3 font-black text-xs uppercase tracking-widest rounded-t-lg transition ${activeTab === 'report' ? 'bg-white text-emerald-600 border-t-2 border-l border-r border-emerald-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>6. Live Reports</button>
            
            <button onClick={() => setActiveTab('verification')} className={`px-4 py-3 font-black text-xs uppercase tracking-widest rounded-t-lg transition ${activeTab === 'verification' ? 'bg-white text-red-600 border-t-2 border-l border-r border-red-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>7. Audit & Verify</button>
            <button onClick={() => setActiveTab('export')} className={`px-4 py-3 font-black text-xs uppercase tracking-widest rounded-t-lg transition ${activeTab === 'export' ? 'bg-white text-slate-900 border-t-2 border-l border-r border-slate-900 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>8. Corporate Export</button>
          </>
        )}
      </div>

      {/* DYNAMIC MODULAR RENDERING */}
      {activeTab === 'balances' && <BalancesModule {...sharedProps} rawBalances={rawBalances} />}
      {activeTab === 'purchase' && <PurchaseModule {...sharedProps} masterCtops={masterCtops} rawPurchases={rawPurchases} />}
      {activeTab === 'sales' && <SalesModule {...sharedProps} rawSales={rawSales} />}
      {activeTab === 'collection' && <CollectionModule {...sharedProps} rawCollections={rawCollections} rawSales={rawSales} />}
      {activeTab === 'commissions' && <CommissionsModule {...sharedProps} rawCommissions={rawCommissions} mappedMasterCtopsForComms={masterCtops.filter(m => m.location_id?.toString() === entryMasterLocId)} />}
      {activeTab === 'report' && <ReportsModule {...sharedProps} rawPurchases={rawPurchases} rawSales={rawSales} rawCollections={rawCollections} rawBalances={rawBalances} rawCommissions={rawCommissions} />}
      
      {/* ARCHITECTURAL FIX: Removed the conflicting {...sharedProps} so TypeScript stops crashing */}
      {activeTab === 'verification' && <VerificationModule />}
      {activeTab === 'export' && <ExportModule rawPurchases={rawPurchases} rawSales={rawSales} rawCollections={rawCollections} rawBalances={rawBalances} rawCommissions={rawCommissions} />}

    </div>
  );
}