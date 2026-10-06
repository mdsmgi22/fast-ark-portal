"use client";
import React, { useState } from "react";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

export default function ReportsModule({ uniqueStates, hqLocations, rawPurchases, rawSales, rawCollections, rawBalances, rawCommissions }: any) {
  const [repTimeFilter, setRepTimeFilter] = useState("this_month");
  const [repMonthFilter, setRepMonthFilter] = useState(new Date().toISOString().substring(0, 7)); 
  const [repStateFilter, setRepStateFilter] = useState("ALL");
  const [repMasterFilter, setRepMasterFilter] = useState("ALL");

  const getFilteredReports = () => {
    let fPurchases = [...rawPurchases]; 
    let fSales = [...rawSales]; 
    let fCollections = [...rawCollections]; 
    let fBalances = [...rawBalances]; 
    let fComms = [...rawCommissions];
    
    let startDate = new Date("2000-01-01"); 
    let endDate = new Date("2100-01-01");
    
    if (repTimeFilter === "this_month") { 
        startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1); 
    } else if (repTimeFilter === "specific_month") { 
        const sm = new Date(`${repMonthFilter}-01`); 
        startDate = sm; 
        endDate = new Date(sm.getFullYear(), sm.getMonth() + 1, 0); 
    }
    
    const startStr = startDate.toISOString().split('T')[0]; 
    const endStr = endDate.toISOString().split('T')[0];

    if (repTimeFilter !== "all") {
      fPurchases = fPurchases.filter(p => p.purchase_date >= startStr && p.purchase_date <= endStr);
      fSales = fSales.filter(s => s.reporting_month >= startStr && s.reporting_month <= endStr);
      fCollections = fCollections.filter(c => c.reporting_month >= startStr && c.reporting_month <= endStr);
      fBalances = fBalances.filter(b => b.report_date >= startStr && b.report_date <= endStr);
      fComms = fComms.filter(c => c.reporting_month >= startStr && c.reporting_month <= endStr);
    }
    
    if (repMasterFilter !== "ALL") {
      const mid = parseInt(repMasterFilter);
      fPurchases = fPurchases.filter(p => p.location_id === mid); 
      fSales = fSales.filter(s => s.locations?.parent_master_id === mid);
      fCollections = fCollections.filter(c => c.locations?.parent_master_id === mid); 
      fBalances = fBalances.filter(b => b.location_id === mid); 
      fComms = fComms.filter(c => c.location_id === mid);
    }

    const hqMap: Record<string, any> = {};
    const filteredHQs = hqLocations.filter((h: any) => (repStateFilter === "ALL" || h.state === repStateFilter) && (repMasterFilter === "ALL" || h.id.toString() === repMasterFilter));

    filteredHQs.forEach((hq: any) => {
      const hqBals = fBalances.filter(b => b.location_id === hq.id);
      const oBals = hqBals.filter(b => b.entry_type === 'Opening Balance'); 
      const cBals = hqBals.filter(b => b.entry_type === 'Closing Balance');
      const oCBP = oBals.reduce((s, b) => s + Number(b.cbp_landline_qty||0) + Number(b.cbp_gsm_qty||0), 0); 
      const cCBP = cBals.reduce((s, b) => s + Number(b.cbp_landline_qty||0) + Number(b.cbp_gsm_qty||0), 0);
      const oCTOP = oBals.reduce((s, b) => s + Number(b.ctop_qty||0), 0); 
      const cCTOP = cBals.reduce((s, b) => s + Number(b.ctop_qty||0), 0);
      const oSIM = oBals.reduce((s, b) => s + Number(b.sim_qty||0), 0); 
      const cSIM = cBals.reduce((s, b) => s + Number(b.sim_qty||0), 0);

      const hqPur = fPurchases.filter(p => p.location_id === hq.id);
      const pCBP = hqPur.filter(p => p.product_category === 'CBP').reduce((s, p) => s + Number(p.qty||0), 0);
      const pCTOP = hqPur.filter(p => p.product_category === 'CTOP').reduce((s, p) => s + Number(p.qty||0), 0);
      const pSIM = hqPur.filter(p => p.product_category === 'SIM_FREE' || p.product_category === 'SIM_PAID').reduce((s, p) => s + Number(p.qty||0), 0);

      const hqS = fSales.filter(s => s.locations?.parent_master_id === hq.id);
      const sCBP = hqS.reduce((s, sl) => s + Number(sl.cbp_landline_qty||0) + Number(sl.cbp_gsm_qty||0), 0);
      const sCTOP = hqS.reduce((s, sl) => s + Number(sl.ctop_recharge_cash||0), 0);
      const sSIM = hqS.reduce((s, sl) => s + Number(sl.sim_new_qty||0) + Number(sl.sim_upgrade_qty||0) + Number(sl.sim_replace_qty||0) + Number(sl.sim_fancy_qty||0) + Number(sl.sim_postpaid_qty||0), 0);

      const hqC = fComms.filter(c => c.location_id === hq.id);
      const cInst = hqC.reduce((s, c) => s + Number(c.instant_commission||0), 0); 
      const cPend = hqC.reduce((s, c) => s + Number(c.pending_commission||0), 0);

      hqMap[hq.id] = {
        name: hq.center_name,
        cbp: { open: oCBP, close: cCBP, purch: pCBP, sales: sCBP, variance: (oCBP - cCBP) + pCBP - sCBP },
        ctop: { open: oCTOP, close: cCTOP, purch: pCTOP, comm: cInst + cPend, sales: sCTOP, variance: (oCTOP - cCTOP) + pCTOP + cInst + cPend - sCTOP },
        sim: { open: oSIM, close: cSIM, purch: pSIM, sales: sSIM, variance: (oSIM - cSIM) + pSIM - sSIM }
      };
    });
    return { hqMap };
  };

  const { hqMap } = getFilteredReports();

  const downloadMatrixCSV = () => {
    const csvRows = ["Location,Item,Opening,Purchases,Commissions,Sales,Closing,Variance"];
    Object.values(hqMap).forEach((hq: any) => {
      csvRows.push(`${sanitizeCSV(hq.name)},CBP Qty,${hq.cbp.open},${hq.cbp.purch},0,${hq.cbp.sales},${hq.cbp.close},${hq.cbp.variance}`);
      csvRows.push(`${sanitizeCSV(hq.name)},CTOP Cash,${hq.ctop.open},${hq.ctop.purch},${hq.ctop.comm},${hq.ctop.sales},${hq.ctop.close},${hq.ctop.variance}`);
      csvRows.push(`${sanitizeCSV(hq.name)},SIM Qty,${hq.sim.open},${hq.sim.purch},0,${hq.sim.sales},${hq.sim.close},${hq.sim.variance}`);
    });
    const blob = new Blob([csvRows.join("\n")], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `FastArk_Reconciliation_${new Date().toISOString().split('T')[0]}.csv`; link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="bg-slate-900 p-5 rounded-xl grid grid-cols-1 md:grid-cols-4 gap-4 items-end shadow-md">
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Time Context</label>
          <select value={repTimeFilter} onChange={(e) => setRepTimeFilter(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white font-bold p-2.5 rounded-lg focus:border-emerald-500 outline-none transition">
            <option value="this_month">This Month</option>
            <option value="specific_month">Select Month</option>
            <option value="all">All Time</option>
          </select>
        </div>

        {repTimeFilter === "specific_month" && (
          <div className="animate-in fade-in">
            <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest block mb-1">Select Month</label>
            <input type="month" value={repMonthFilter} onChange={(e) => setRepMonthFilter(e.target.value)} className="w-full bg-slate-800 border-2 border-emerald-500 text-white font-bold p-2.5 rounded-lg outline-none transition"/>
          </div>
        )}

        <div>
          <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1">State Filter</label>
          <select value={repStateFilter} onChange={(e) => { setRepStateFilter(e.target.value); setRepMasterFilter("ALL"); }} className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold p-2.5 rounded-lg outline-none focus:border-indigo-400 transition">
            <option value="ALL">-- All States --</option>
            {uniqueStates.map((st: string) => <option key={st} value={st}>{st}</option>)}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-1">Master HQ Filter</label>
          <select value={repMasterFilter} onChange={(e) => setRepMasterFilter(e.target.value)} className="w-full bg-slate-800 border-2 border-indigo-500 text-white font-bold p-2.5 rounded-lg outline-none focus:border-indigo-400 transition">
            <option value="ALL">-- All HQ Hubs --</option>
            {hqLocations.filter((h: any) => repStateFilter === "ALL" || h.state === repStateFilter).map((hq: any) => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
          <h3 className="font-black uppercase text-sm tracking-widest flex items-center gap-2"><span>🧮</span> Master Reconciliation Matrix</h3>
          <button onClick={downloadMatrixCSV} className="bg-emerald-600 hover:bg-emerald-700 transition px-4 py-1.5 rounded font-black text-xs uppercase tracking-widest shadow-sm">📥 Download Matrix CSV</button>
        </div>
        
        <div className="overflow-x-auto max-h-[700px]">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-100 text-[10px] uppercase tracking-widest text-slate-600 border-b border-slate-300 sticky top-0 z-10 shadow-sm">
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
                    <tr className="hover:bg-slate-50 transition">
                      <td className="p-4 font-black text-slate-900 border-b-0" rowSpan={3}>{hq.name}</td>
                      <td className="p-4 font-bold text-slate-700 bg-slate-50">CBP Qty</td>
                      <td className="p-4 text-right font-medium">{hq.cbp.open}</td>
                      <td className="p-4 text-right font-medium">{hq.cbp.purch}</td>
                      <td className="p-4 text-right font-medium text-slate-300">-</td>
                      <td className="p-4 text-right font-medium text-red-500">{hq.cbp.sales}</td>
                      <td className="p-4 text-right font-medium">{hq.cbp.close}</td>
                      <td className={`p-4 text-right font-black border-l border-slate-200 ${hq.cbp.variance === 0 ? 'text-emerald-600 bg-emerald-50/30' : 'text-red-600 bg-red-50/30'}`}>
                        {hq.cbp.variance}
                      </td>
                    </tr>
                    {/* CTOP ROW */}
                    <tr className="hover:bg-slate-50 transition">
                      <td className="p-4 font-bold text-blue-700 bg-blue-50/30 border-y border-slate-100">CTOP Cash</td>
                      <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.open.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.purch.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.comm.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-medium border-y border-slate-100 text-red-500">₹{hq.ctop.sales.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-4 text-right font-medium border-y border-slate-100">₹{hq.ctop.close.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className={`p-4 text-right font-black border-l border-slate-200 border-y border-y-slate-100 ${hq.ctop.variance === 0 ? 'text-emerald-600 bg-emerald-50/30' : 'text-red-600 bg-red-50/30'}`}>
                        ₹{hq.ctop.variance.toLocaleString('en-IN', {minimumFractionDigits: 2})}
                      </td>
                    </tr>
                    {/* SIM ROW */}
                    <tr className="border-b-4 border-slate-300 hover:bg-slate-50 transition">
                      <td className="p-4 font-bold text-slate-700 bg-slate-50">SIM Qty</td>
                      <td className="p-4 text-right font-medium">{hq.sim.open}</td>
                      <td className="p-4 text-right font-medium">{hq.sim.purch}</td>
                      <td className="p-4 text-right font-medium text-slate-300">-</td>
                      <td className="p-4 text-right font-medium text-red-500">{hq.sim.sales}</td>
                      <td className="p-4 text-right font-medium">{hq.sim.close}</td>
                      <td className={`p-4 text-right font-black border-l border-slate-200 ${hq.sim.variance === 0 ? 'text-emerald-600 bg-emerald-50/30' : 'text-red-600 bg-red-50/30'}`}>
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
  );
}