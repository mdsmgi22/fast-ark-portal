// FILE PATH: ./app/components/aadhaar/PartnerAadhaarHistoryVault.tsx
"use client";

import React, { useState } from "react";
import { formatToDDMMYYYY } from "../../lib/aadhaarEngine";

interface PartnerHistoryVaultProps {
  partner: any;
  dailyReports: any[];
  weeklyReports: any[];
  aadhaarDeposits: any[];
  penalties: any[];
  filterFromDate: string;
  filterToDate: string;
  fileModeFilter: "ALL" | "WITH_FILES" | "WITHOUT_FILES";
  onDownloadRawFile: (path: string | null) => void;
  onViewDepositSlip: (path: string | null) => void;
}

export default function PartnerAadhaarHistoryVault({
  partner,
  dailyReports,
  weeklyReports,
  aadhaarDeposits,
  penalties,
  filterFromDate,
  filterToDate,
  fileModeFilter,
  onDownloadRawFile,
  onViewDepositSlip,
}: PartnerHistoryVaultProps) {
  const [vaultTab, setVaultTab] = useState<"daily" | "weekly" | "deposits">("daily");

  // Filtered Lists by Selected Week / Month / Custom Date Range
  const filteredDaily = dailyReports.filter((r) => {
    const dMatch = r.report_date >= filterFromDate && r.report_date <= filterToDate;
    const mMatch =
      fileModeFilter === "ALL"
        ? true
        : fileModeFilter === "WITH_FILES"
        ? r.has_files === true
        : r.has_files === false;
    return dMatch && mMatch;
  });

  const filteredWeekly = weeklyReports.filter(
    (w) => w.end_date >= filterFromDate && w.start_date <= filterToDate
  );

  const filteredDeposits = aadhaarDeposits.filter((d) => {
    const dt = (d.deposit_date || d.created_at || "").split("T")[0];
    return dt >= filterFromDate && dt <= filterToDate;
  });

  // Lifetime & Filtered Period Deduction Formula: (Collection + Active Penalties) - Deposits = Balance Payable
  const lifetimeCollection = dailyReports.reduce(
    (s, r) => s + Number(r.total_cash_collected || 0),
    0
  );
  const activePenaltyTotal = penalties
    .filter((p) => !p.is_settled && !p.is_waived)
    .reduce((s, p) => s + Number(p.penalty_amount || 0), 0);
  const lifetimeDeposited = aadhaarDeposits
    .filter((d) => d.status !== "Discrepancy")
    .reduce((s, d) => s + Number(d.deposit_amount || 0), 0);
  const lifetimeBalancePayable = Math.max(
    0,
    lifetimeCollection + activePenaltyTotal - lifetimeDeposited
  );

  const periodCollection = filteredDaily.reduce(
    (s, r) => s + Number(r.total_cash_collected || 0),
    0
  );
  const periodDeposited = filteredDeposits
    .filter((d) => d.status !== "Discrepancy")
    .reduce((s, d) => s + Number(d.deposit_amount || 0), 0);
  const periodBalanceRemaining = Math.max(0, periodCollection - periodDeposited);

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* REQUIREMENT #4: COLLECTION DEDUCTED FROM DEPOSIT = BALANCE PAYABLE SUMMARY */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-xl border border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/90 p-4 rounded-xl border border-slate-700">
          <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">
            1. Total Aadhaar Collection
          </p>
          <p className="text-2xl font-black text-white mt-1">
            ₹{lifetimeCollection.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-slate-400 font-bold mt-1">
            Filtered Period: ₹{periodCollection.toLocaleString("en-IN")}
          </p>
        </div>

        <div className="bg-slate-800/90 p-4 rounded-xl border border-slate-700">
          <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">
            2. Less: Total Deposit Amount
          </p>
          <p className="text-2xl font-black text-emerald-400 mt-1">
            - ₹{lifetimeDeposited.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-slate-400 font-bold mt-1">
            Filtered Period: ₹{periodDeposited.toLocaleString("en-IN")}
          </p>
        </div>

        <div className="bg-slate-800/90 p-4 rounded-xl border border-slate-700">
          <p className="text-[10px] font-black uppercase text-red-400 tracking-widest">
            3. Unpaid Late Penalty
          </p>
          <p className="text-2xl font-black text-red-400 mt-1">
            + ₹{activePenaltyTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-slate-400 font-bold mt-1">
            Period Net Diff: ₹{periodBalanceRemaining.toLocaleString("en-IN")}
          </p>
        </div>

        <div
          className={`p-4 rounded-xl border-2 ${
            lifetimeBalancePayable > 0
              ? "bg-red-950/80 border-red-500"
              : "bg-emerald-950/80 border-emerald-500"
          }`}
        >
          <p className="text-[10px] font-black uppercase text-amber-300 tracking-widest">
            4. Remaining Balance Payable
          </p>
          <p className="text-3xl font-black text-white mt-1">
            ₹{lifetimeBalancePayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-slate-300 font-bold mt-1">
            (Collection + Penalty) - Deposits
          </p>
        </div>
      </div>

      {/* SUB-TAB SWITCHER: DAILY UPLOADS | WEEKLY UPLOADS | DEPOSIT LEDGER */}
      <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setVaultTab("daily")}
          className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-black uppercase tracking-wider transition ${
            vaultTab === "daily"
              ? "bg-slate-900 text-white shadow"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          📄 Uploaded Daily Reports ({filteredDaily.length})
        </button>
        <button
          type="button"
          onClick={() => setVaultTab("weekly")}
          className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-black uppercase tracking-wider transition ${
            vaultTab === "weekly"
              ? "bg-indigo-600 text-white shadow"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          📅 Uploaded Weekly Reports ({filteredWeekly.length})
        </button>
        <button
          type="button"
          onClick={() => setVaultTab("deposits")}
          className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-black uppercase tracking-wider transition ${
            vaultTab === "deposits"
              ? "bg-emerald-600 text-white shadow"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          💳 Deposit Verification Ledger ({filteredDeposits.length})
        </button>
      </div>

      {/* TAB 1: UPLOADED DAILY REPORTS */}
      {vaultTab === "daily" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
            <h3 className="font-black text-xs uppercase tracking-widest">
              Uploaded Daily Aadhaar Reports ({formatToDDMMYYYY(filterFromDate)} to{" "}
              {formatToDDMMYYYY(filterToDate)})
            </h3>
            <span className="text-[10px] font-bold text-amber-400 uppercase">
              Op: {partner?.aadhaar_operator_id} | Stn: {partner?.aadhaar_station_id}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                <tr>
                  <th className="p-3.5">Date (DD/MM/YYYY)</th>
                  <th className="p-3.5">Operator &amp; Station</th>
                  <th className="p-3.5">Mode</th>
                  <th className="p-3.5 text-center">New</th>
                  <th className="p-3.5 text-center">MBU Free</th>
                  <th className="p-3.5 text-center">MBU Paid</th>
                  <th className="p-3.5 text-center">Demo</th>
                  <th className="p-3.5 text-center">Bio</th>
                  <th className="p-3.5 text-center">Total Pkts</th>
                  <th className="p-3.5 text-right">Cash (₹)</th>
                  <th className="p-3.5 text-center">Uploaded Files</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredDaily.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-black text-slate-900">
                      {formatToDDMMYYYY(r.report_date)}
                    </td>
                    <td className="p-3.5 font-bold text-slate-700">
                      {r.operator_id} / {r.station_id}
                    </td>
                    <td className="p-3.5">
                      {r.has_files ? (
                        <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                          With CSV+HTML
                        </span>
                      ) : (
                        <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                          Without Files ({r.exemption_reason})
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-center font-bold">{r.cat1_new_qty}</td>
                    <td className="p-3.5 text-center font-bold">{r.cat2_mbu_free_qty}</td>
                    <td className="p-3.5 text-center font-bold">{r.cat3_mbu_chargeable_qty}</td>
                    <td className="p-3.5 text-center font-bold">{r.cat4_demographic_qty}</td>
                    <td className="p-3.5 text-center font-bold">{r.cat5_biometric_qty}</td>
                    <td className="p-3.5 text-center font-black">{r.total_packets_qty}</td>
                    <td className="p-3.5 text-right font-black text-slate-900">
                      ₹{Number(r.total_cash_collected).toLocaleString("en-IN")}
                    </td>
                    <td className="p-3.5 text-center">
                      {r.has_files ? (
                        <div className="flex justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onDownloadRawFile(r.csv_file_url)}
                            className="bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 rounded text-[9px] font-black uppercase"
                          >
                            ⬇ CSV
                          </button>
                          <button
                            type="button"
                            onClick={() => onDownloadRawFile(r.html_file_url)}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded text-[9px] font-black uppercase"
                          >
                            ⬇ HTML
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-bold">No Files</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredDaily.length === 0 && (
                  <tr>
                    <td colSpan={11} className="p-10 text-center text-slate-400 font-bold">
                      No daily uploaded reports match the selected date filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: UPLOADED WEEKLY RECONCILIATION REPORTS (REQUIREMENT #5) */}
      {vaultTab === "weekly" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
            <h3 className="font-black text-xs uppercase tracking-widest">
              Uploaded Weekly UIDAI Reports ({formatToDDMMYYYY(filterFromDate)} to{" "}
              {formatToDDMMYYYY(filterToDate)})
            </h3>
            <span className="text-[10px] font-bold text-indigo-300 uppercase">
              Monday-to-Sunday Reconciliations
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                <tr>
                  <th className="p-3.5">Week Window (Mon &rarr; Sun)</th>
                  <th className="p-3.5">Operator / Station</th>
                  <th className="p-3.5 text-center">New</th>
                  <th className="p-3.5 text-center">MBU(F)</th>
                  <th className="p-3.5 text-center">MBU(P)</th>
                  <th className="p-3.5 text-center">Demo</th>
                  <th className="p-3.5 text-center">Bio</th>
                  <th className="p-3.5 text-center">Total Pkts</th>
                  <th className="p-3.5 text-right">Weekly Cash (₹)</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-center">Uploaded Files</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredWeekly.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-black text-slate-900">
                      {formatToDDMMYYYY(w.start_date)} &rarr; {formatToDDMMYYYY(w.end_date)}
                    </td>
                    <td className="p-3.5 font-bold text-slate-700">
                      {w.operator_id} / {w.station_id}
                    </td>
                    <td className="p-3.5 text-center font-bold">{w.cat1_new_qty}</td>
                    <td className="p-3.5 text-center font-bold">{w.cat2_mbu_free_qty}</td>
                    <td className="p-3.5 text-center font-bold">{w.cat3_mbu_chargeable_qty}</td>
                    <td className="p-3.5 text-center font-bold">{w.cat4_demographic_qty}</td>
                    <td className="p-3.5 text-center font-bold">{w.cat5_biometric_qty}</td>
                    <td className="p-3.5 text-center font-black">{w.total_packets_qty}</td>
                    <td className="p-3.5 text-right font-black text-slate-900">
                      ₹{Number(w.total_cash_collected || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="p-3.5 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                          w.discrepancy_days_count === 0
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {w.reconciliation_status}
                      </span>
                    </td>
                    <td className="p-3.5 text-center">
                      <div className="flex justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onDownloadRawFile(w.csv_file_url)}
                          className="bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 rounded text-[9px] font-black uppercase"
                        >
                          ⬇ CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => onDownloadRawFile(w.html_file_url)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded text-[9px] font-black uppercase"
                        >
                          ⬇ HTML
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredWeekly.length === 0 && (
                  <tr>
                    <td colSpan={11} className="p-10 text-center text-slate-400 font-bold">
                      No weekly uploaded reports match the selected date filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: PARTNER DEPOSIT REMITTANCE LEDGER (REQUIREMENT #3) */}
      {vaultTab === "deposits" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
            <h3 className="font-black text-xs uppercase tracking-widest">
              Aadhaar Deposit Remittance Ledger ({formatToDDMMYYYY(filterFromDate)} to{" "}
              {formatToDDMMYYYY(filterToDate)})
            </h3>
            <span className="text-[10px] font-bold text-emerald-400 uppercase">
              Period Deposited: ₹{periodDeposited.toLocaleString("en-IN")}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-100 text-[10px] uppercase text-slate-600 border-b">
                <tr>
                  <th className="p-3.5">Deposit Date</th>
                  <th className="p-3.5">Reference Code</th>
                  <th className="p-3.5">Method</th>
                  <th className="p-3.5">Unique UTR No</th>
                  <th className="p-3.5">Transaction ID</th>
                  <th className="p-3.5 text-right">Deposit Amount (₹)</th>
                  <th className="p-3.5 text-center">Audit Status</th>
                  <th className="p-3.5 text-center">Receipt Slip</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredDeposits.map((d) => {
                  const cleanUtr =
                    d.utr_number || String(d.reference_no || "").replace(/^AADHAAR_/i, "");
                  const cleanTxn = d.transaction_id || cleanUtr;
                  const refCode =
                    d.reference_code ||
                    `FA-ADH-${String(d.id || "")
                      .slice(0, 6)
                      .toUpperCase()}`;

                  return (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-black text-slate-900">
                        {formatToDDMMYYYY((d.deposit_date || d.created_at || "").split("T")[0])}
                      </td>
                      <td className="p-3.5 font-mono font-black text-indigo-700">{refCode}</td>
                      <td className="p-3.5 font-bold text-blue-700">{d.deposit_method}</td>
                      <td className="p-3.5 font-black text-slate-900">{cleanUtr}</td>
                      <td className="p-3.5 font-bold text-slate-600">{cleanTxn}</td>
                      <td
                        className={`p-3.5 text-right font-black text-sm ${
                          d.status === "Discrepancy"
                            ? "text-slate-400 line-through"
                            : "text-emerald-700"
                        }`}
                      >
                        ₹{Number(d.deposit_amount || 0).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`px-2.5 py-1 rounded text-[9px] font-black uppercase ${
                            d.status === "Verified"
                              ? "bg-emerald-100 text-emerald-800"
                              : d.status === "Discrepancy"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {d.status}
                        </span>
                        {d.rejection_reason && (
                          <p className="text-[9px] text-red-600 font-bold mt-1">
                            {d.rejection_reason}
                          </p>
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        {d.deposit_slip_url ? (
                          <button
                            type="button"
                            onClick={() => onViewDepositSlip(d.deposit_slip_url)}
                            className="bg-slate-900 hover:bg-blue-600 text-white px-2.5 py-1 rounded text-[9px] font-black uppercase transition"
                          >
                            📎 View Slip
                          </button>
                        ) : (
                          <span className="text-[9px] text-amber-700 font-bold uppercase">
                            Exempted ({d.exemption_reason || "N/A"})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredDeposits.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-slate-400 font-bold">
                      No deposit records match the selected date filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}