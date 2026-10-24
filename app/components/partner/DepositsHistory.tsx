// FILE PATH: ./app/components/partner/DepositsHistory.tsx
"use client";
import React from "react";
import { formatToDDMMYYYY } from "../../lib/partnerUtils";

export default function DepositsHistory({ timeFilter, visibleDeposits }: any) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
      <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
        <h2 className="font-black text-slate-800 uppercase tracking-widest text-xs">
          Deposit of Sales ({timeFilter})
        </h2>
        <span className="text-[10px] font-black text-slate-500 uppercase">
          {visibleDeposits.length} Record(s)
        </span>
      </div>
      <div className="p-0">
        {visibleDeposits.length === 0 ? (
          <p className="p-8 text-center text-sm font-bold text-slate-400 bg-slate-50">
            No deposits submitted in this period.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {visibleDeposits.map((dep: any) => {
              const isAadhaar =
                dep.deposit_stream === "AADHAAR" ||
                String(dep.reference_no || "")
                  .toUpperCase()
                  .startsWith("AADHAAR_");
              const cleanUtr =
                dep.utr_number ||
                String(dep.reference_no || "").replace(/^AADHAAR_/i, "");
              const cleanTxn = dep.transaction_id || cleanUtr;
              const refCode =
                dep.reference_code ||
                `${isAadhaar ? "FA-ADH" : "FA-DEP"}-${String(dep.id || "")
                  .slice(0, 6)
                  .toUpperCase()}`;

              return (
                <li
                  key={dep.id}
                  className="p-4 hover:bg-slate-50 flex justify-between items-start transition gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-slate-900">
                        {formatToDDMMYYYY(
                          (dep.deposit_date || dep.created_at || "").split(
                            "T"
                          )[0]
                        )}
                      </p>
                      <span className="font-mono text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded">
                        {refCode}
                      </span>
                      {isAadhaar && (
                        <span className="text-[9px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded">
                          🆔 Aadhaar
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-bold text-slate-600 mt-1">
                      UTR: <strong className="text-slate-900">{cleanUtr}</strong>{" "}
                      &bull; Txn: {cleanTxn}
                    </p>
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest mt-1.5 inline-block border shadow-sm ${
                        dep.status === "Verified"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : dep.status === "Discrepancy"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {dep.status}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`font-black text-lg ${
                        dep.status === "Discrepancy"
                          ? "text-slate-400 line-through"
                          : "text-slate-800"
                      }`}
                    >
                      ₹{Number(dep.deposit_amount).toLocaleString("en-IN")}
                    </p>
                    <p className="text-[9px] text-blue-600 font-black uppercase tracking-widest mt-0.5">
                      {dep.deposit_method}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}