"use client";
import React from "react";
import { formatToDDMMYYYY } from "../../lib/partnerUtils";

export default function DepositsHistory({
  timeFilter,
  visibleDeposits
}: any) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
      <div className="p-4 border-b bg-slate-50"><h2 className="font-black text-slate-800 uppercase tracking-widest text-xs">Deposit of Sales ({timeFilter})</h2></div>
      <div className="p-0">
        {visibleDeposits.length === 0 ? (
          <p className="p-8 text-center text-sm font-bold text-slate-400 bg-slate-50">No deposits submitted in this period.</p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {visibleDeposits.map((dep: any) => (
              <li key={dep.id} className="p-4 hover:bg-slate-50 flex justify-between items-center transition">
                <div>
                  <p className="font-black text-slate-900">{formatToDDMMYYYY(dep.created_at)}</p>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest mt-1.5 inline-block border shadow-sm ${dep.status === 'Verified' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : dep.status === 'Discrepancy' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {dep.status}
                  </span>
                </div>
                <div className="text-right">
                  <p className={`font-black text-lg ${dep.status === 'Discrepancy' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>₹{Number(dep.deposit_amount).toLocaleString('en-IN')}</p>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{dep.deposit_method}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}