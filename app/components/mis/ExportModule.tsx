"use client";
import React from "react";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

export default function ExportModule({ rawPurchases, rawSales, rawCollections, rawBalances, rawCommissions }: any) {

  const downloadData = (dataArray: any[], filenamePrefix: string, headers: string[], rowMapper: (row: any) => any[]) => {
    if (!dataArray || dataArray.length === 0) return alert("No data available to export for this ledger.");
    
    const csvData = dataArray.map(rowMapper);
    const csvContent = [headers.join(","), ...csvData.map(row => row.join(","))].join("\n");
    
    const istTime = new Date(new Date().getTime() + (330 * 60000)).toISOString().split('T')[0];
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_${filenamePrefix}_${istTime.replace(/\//g, '-')}.csv`;
    link.click();
  };

  const exportPurchases = () => {
    downloadData(rawPurchases, "Master_Purchases", 
      ["Purchase Date", "Location ID", "CTOP ID", "Product Category", "Qty", "Total Value (INR)", "Invoice No"],
      (r) => [r.purchase_date, r.location_id, sanitizeCSV(r.master_ctop_accounts?.master_ctop_no), r.product_category, r.qty, r.total_value, sanitizeCSV(r.invoice_no)]
    );
  };

  const exportSales = () => {
    downloadData(rawSales, "Master_Sales", 
      ["Month", "Location", "CBP Landline Qty", "CBP GSM Qty", "CTOP Recharge Cash", "SIM New Qty", "SIM Upgrade Qty", "Total Gross Value"],
      (r) => [r.reporting_month, sanitizeCSV(r.locations?.center_name), r.cbp_landline_qty, r.cbp_gsm_qty, r.ctop_recharge_cash, r.sim_new_qty, r.sim_upgrade_qty, r.total_gross_value]
    );
  };

  const exportBalances = () => {
    downloadData(rawBalances, "Master_Balances", 
      ["Report Date", "Entry Type", "Location", "CTOP", "CBP Qty", "CTOP Qty", "SIM Qty"],
      (r) => [r.report_date, r.entry_type, sanitizeCSV(r.locations?.center_name), sanitizeCSV(r.master_ctop_accounts?.master_ctop_no), r.cbp_qty, r.ctop_qty, r.sim_qty]
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center max-w-3xl mx-auto">
        <div className="text-5xl mb-4">🗄️</div>
        <h2 className="text-2xl font-black text-slate-900 mb-2 uppercase tracking-widest">Corporate MIS Export Hub</h2>
        <p className="text-slate-500 font-medium mb-8">Generate master CSV data dumps for offline finance reconciliation.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button onClick={exportBalances} className="bg-slate-900 hover:bg-slate-800 text-white p-6 rounded-xl shadow-md transition group">
            <span className="text-3xl block mb-3 group-hover:scale-110 transition-transform">⚖️</span>
            <span className="font-black uppercase tracking-widest text-xs">Export Master Balances</span>
          </button>
          
          <button onClick={exportPurchases} className="bg-indigo-600 hover:bg-indigo-700 text-white p-6 rounded-xl shadow-md transition group">
            <span className="text-3xl block mb-3 group-hover:scale-110 transition-transform">📦</span>
            <span className="font-black uppercase tracking-widest text-xs">Export Procurement</span>
          </button>
          
          <button onClick={exportSales} className="bg-emerald-600 hover:bg-emerald-700 text-white p-6 rounded-xl shadow-md transition group">
            <span className="text-3xl block mb-3 group-hover:scale-110 transition-transform">📈</span>
            <span className="font-black uppercase tracking-widest text-xs">Export Master Sales</span>
          </button>
        </div>
      </div>
    </div>
  );
}