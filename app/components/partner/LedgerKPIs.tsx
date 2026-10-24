"use client";
import React from "react";
import { DatePresetMode, formatToDDMMYYYY, getDateRangeFromPreset } from "../../lib/aadhaarEngine";

export default function LedgerKPIs({
  displayLedger,
  timeFilter,
  datePreset,
  fromDate,
  toDate,
  onPresetChange,
  onCustomDateChange,
  lifetimePendingBalance,
  telecomPendingBalance = 0,
  aadhaarPendingBalance = 0,
  aadhaarPenaltyBalance = 0,
}: any) {
  const totalPrepaid =
    (displayLedger.qNew || 0) +
    (displayLedger.qUp || 0) +
    (displayLedger.qRep || 0) +
    (displayLedger.qFan || 0) +
    (displayLedger.qMnp || 0);

  return (
    <div className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden mt-8">
      {/* HEADER & 7-OPTION DATE PRESET FILTER BAR (DD/MM/YYYY) */}
      <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div>
          <h2 className="text-white font-black text-lg tracking-wide">Operational Ledger &amp; Revenue Matrix</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-900/50 text-emerald-400 px-3 py-1 rounded-full border border-emerald-800 shadow-sm">
              Live Auditing
            </span>
            {fromDate && toDate && (
              <span className="text-[11px] font-bold text-slate-400">
                Window: <strong className="text-blue-400">{formatToDDMMYYYY(fromDate)}</strong> to{" "}
                <strong className="text-blue-400">{formatToDDMMYYYY(toDate)}</strong>
              </span>
            )}
          </div>
        </div>

        {/* 7-OPTION DATE PRESET DROPDOWN + CUSTOM FROM/TO PICKERS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full xl:w-auto">
          <div>
            <label className="block text-[9px] font-black uppercase text-indigo-400 tracking-widest mb-1">
              Date Filter Preset
            </label>
            <select
              value={datePreset || "current_month"}
              onChange={(e) => onPresetChange && onPresetChange(e.target.value as DatePresetMode)}
              className="w-full bg-slate-800 border-2 border-indigo-500/60 text-white font-black text-xs rounded-lg p-2 outline-none focus:border-indigo-400"
            >
              <option value="today">1. Today ({formatToDDMMYYYY(getDateRangeFromPreset("today").start)})</option>
              <option value="yesterday">
                2. Yesterday ({formatToDDMMYYYY(getDateRangeFromPreset("yesterday").start)})
              </option>
              <option value="current_week">3. Current Week</option>
              <option value="current_month">4. Current Month</option>
              <option value="previous_month">5. Previous Month</option>
              <option value="all">6. All Time</option>
              <option value="custom">7. Custom Filter</option>
            </select>
          </div>

          <div>
            <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">
              From ({formatToDDMMYYYY(fromDate || "")})
            </label>
            <input
              type="date"
              value={fromDate || ""}
              onChange={(e) => onCustomDateChange && onCustomDateChange(e.target.value, toDate)}
              className="w-full bg-slate-800 border border-slate-700 text-white font-bold text-xs rounded-lg p-2 outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">
              To ({formatToDDMMYYYY(toDate || "")})
            </label>
            <input
              type="date"
              value={toDate || ""}
              onChange={(e) => onCustomDateChange && onCustomDateChange(fromDate, e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white font-bold text-xs rounded-lg p-2 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* REVENUE HEADS BREAKDOWN */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-px bg-slate-800">
        <div className="col-span-1 lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-800">
          <div className="bg-slate-900 p-5 flex flex-col justify-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">CBP Sales</p>
            <p className="text-2xl font-black text-white">
              ₹{Number(displayLedger.totalCBP || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">CTOP Sales</p>
            <p className="text-2xl font-black text-white">
              ₹{Number(displayLedger.totalCTOP || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">BSNL SIM Cash</p>
            <p className="text-2xl font-black text-white">
              ₹{Number(displayLedger.totalSimCash || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center">
            <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest mb-1">Aadhaar Kendra Cash</p>
            <p className="text-2xl font-black text-amber-400">
              ₹{Number(displayLedger.totalAadhaarCash || 0).toLocaleString("en-IN")}
            </p>
          </div>

          <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800">
            <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">Paybull Platform Cash</p>
            <p className="text-xl font-black text-blue-400">
              ₹{Number(displayLedger.totalPaybullCash || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800">
            <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-1">Other Adjustments</p>
            <p className="text-xl font-black text-emerald-400">
              ₹{Number(displayLedger.totalOtherCash || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800">
            <p className="text-[10px] text-amber-500/70 font-bold uppercase tracking-widest mb-1">Cheques Deposited</p>
            <p className="text-xl font-black text-amber-500">
              ₹{Number(displayLedger.totalCheque || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800">
            <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest mb-1">Aadhaar Late Fines</p>
            <p className="text-xl font-black text-red-400">
              ₹{Number(aadhaarPenaltyBalance || 0).toLocaleString("en-IN")}
            </p>
          </div>
        </div>

        <div className="col-span-1 bg-slate-900 p-6 flex flex-col justify-center border-t-4 lg:border-t-0 lg:border-l-4 border-blue-600 shadow-inner">
          <div className="mb-6">
            <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest mb-1">
              Total Cash Generated
            </p>
            <p className="text-4xl font-black text-white">
              ₹{Number(displayLedger.totalCashSales || 0).toLocaleString("en-IN")}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-1">Total Remitted</p>
            <p className="text-3xl font-black text-white">
              ₹{Number(displayLedger.totalDeposits || 0).toLocaleString("en-IN")}
            </p>
          </div>
        </div>
      </div>

      {/* SIM ACTIVATIONS BAR */}
      <div className="bg-slate-800 p-4 border-t border-b border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h3 className="font-black text-slate-200 text-sm uppercase tracking-widest flex items-center gap-2">
          <span>📱</span> SIM Activations ({timeFilter})
        </h3>
        <div className="flex flex-wrap gap-2 md:gap-4 w-full md:w-auto">
          <span className="bg-blue-900/50 text-blue-300 font-black px-3 py-1.5 rounded-lg text-[10px] border border-blue-800 uppercase tracking-widest flex-1 text-center">
            Prepaid: {totalPrepaid}
          </span>
          <span className="bg-purple-900/50 text-purple-300 font-black px-3 py-1.5 rounded-lg text-[10px] border border-purple-800 uppercase tracking-widest flex-1 text-center">
            Postpaid: {displayLedger.qPost || 0}
          </span>
          <span className="bg-amber-900/50 text-amber-300 font-black px-3 py-1.5 rounded-lg text-[10px] border border-amber-800 uppercase tracking-widest flex-1 text-center">
            Aadhaar Packets: {displayLedger.qAadhaarPkts || 0}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-slate-700">
        <div className="bg-slate-900 p-4 text-center">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">New</p>
          <p className="text-xl font-black text-white">{displayLedger.qNew || 0}</p>
        </div>
        <div className="bg-slate-900 p-4 text-center">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Upgrade</p>
          <p className="text-xl font-black text-white">{displayLedger.qUp || 0}</p>
        </div>
        <div className="bg-slate-900 p-4 text-center">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Replace</p>
          <p className="text-xl font-black text-white">{displayLedger.qRep || 0}</p>
        </div>
        <div className="bg-slate-900 p-4 text-center">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Fancy</p>
          <p className="text-xl font-black text-white">{displayLedger.qFan || 0}</p>
        </div>
        <div className="bg-slate-900 p-4 text-center">
          <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">MNP</p>
          <p className="text-xl font-black text-blue-300">{displayLedger.qMnp || 0}</p>
        </div>
        <div className="bg-slate-900 p-4 text-center">
          <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1">Postpaid</p>
          <p className="text-xl font-black text-purple-300">{displayLedger.qPost || 0}</p>
        </div>
      </div>

      {/* UNIFIED LIFETIME PENDING BALANCE FOOTER */}
      <div
        className={`p-6 text-center ${
          lifetimePendingBalance > 0 ? "bg-red-950 border-t border-red-900" : "bg-emerald-950 border-t border-emerald-900"
        }`}
      >
        <span
          className={`font-black text-sm uppercase tracking-widest mr-2 block sm:inline ${
            lifetimePendingBalance > 0 ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {lifetimePendingBalance > 0 ? "⚠️ Total Pending Cash to Deposit:" : "✅ Ledger Settled:"}
        </span>
        <span className="text-3xl font-black text-white mt-1 sm:mt-0 inline-block">
          ₹{Math.max(0, lifetimePendingBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
        </span>
        <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">
          Telecom/Paybull Due: ₹{Math.max(0, telecomPendingBalance).toLocaleString("en-IN")} &nbsp;|&nbsp; Aadhaar Cash
          Due: ₹{Math.max(0, aadhaarPendingBalance).toLocaleString("en-IN")} &nbsp;|&nbsp; Aadhaar Late Penalty: ₹
          {Math.max(0, aadhaarPenaltyBalance).toLocaleString("en-IN")}
        </p>
      </div>
    </div>
  );
}