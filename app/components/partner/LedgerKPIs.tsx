"use client";
import React from "react";

export default function LedgerKPIs({
  displayLedger,
  timeFilter,
  applyTimeFilter,
  lifetimePendingBalance
}: any) {
  const totalPrepaid = displayLedger.qNew + displayLedger.qUp + displayLedger.qRep + displayLedger.qFan + displayLedger.qMnp;

  return (
    <div className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden mt-8">
      <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-white font-black text-lg tracking-wide">Operational Ledger</h2>
          <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-900/50 text-emerald-400 px-3 py-1 rounded-full border border-emerald-800 mt-2 inline-block shadow-sm">
            Live Auditing
          </span>
        </div>
        
        <div className="flex bg-slate-800 rounded-lg p-1 overflow-x-auto w-full md:w-auto border border-slate-700">
          {['today', 'weekly', 'monthly', 'all'].map((mode: string) => (
            <button 
              key={mode} 
              onClick={() => applyTimeFilter(mode)} 
              className={`px-4 py-2 rounded-md text-[10px] font-black uppercase tracking-wider transition flex-1 text-center whitespace-nowrap ${timeFilter === mode ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-px bg-slate-800">
        <div className="col-span-1 lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-px bg-slate-800">
          <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">CBP Sales</p><p className="text-2xl font-black text-white">₹{displayLedger.totalCBP.toLocaleString('en-IN')}</p></div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">CTOP Sales</p><p className="text-2xl font-black text-white">₹{displayLedger.totalCTOP.toLocaleString('en-IN')}</p></div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">BSNL SIM Cash</p><p className="text-2xl font-black text-white">₹{displayLedger.totalSimCash.toLocaleString('en-IN')}</p></div>
          
          <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800"><p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">Paybull Platform Cash</p><p className="text-xl font-black text-blue-400">₹{displayLedger.totalPaybullCash.toLocaleString('en-IN')}</p></div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800"><p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-1">Other Adjustments</p><p className="text-xl font-black text-emerald-400">₹{displayLedger.totalOtherCash.toLocaleString('en-IN')}</p></div>
          <div className="bg-slate-900 p-5 flex flex-col justify-center border-t border-slate-800"><p className="text-[10px] text-amber-500/70 font-bold uppercase tracking-widest mb-1">Cheques Deposited</p><p className="text-xl font-black text-amber-500">₹{displayLedger.totalCheque.toLocaleString('en-IN')}</p></div>
        </div>
        
        <div className="col-span-1 bg-slate-900 p-6 flex flex-col justify-center border-t-4 lg:border-t-0 lg:border-l-4 border-blue-600 shadow-inner">
          <div className="mb-6"><p className="text-[10px] text-blue-400 font-black uppercase tracking-widest mb-1">Total Generated</p><p className="text-4xl font-black text-white">₹{displayLedger.totalCashSales.toLocaleString('en-IN')}</p></div>
          <div><p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-1">Total Remitted</p><p className="text-3xl font-black text-white">₹{displayLedger.totalDeposits.toLocaleString('en-IN')}</p></div>
        </div>
      </div>
      
      <div className="bg-slate-800 p-4 border-t border-b border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h3 className="font-black text-slate-200 text-sm uppercase tracking-widest flex items-center gap-2"><span>📱</span> SIM Activations ({timeFilter})</h3>
        <div className="flex flex-wrap gap-2 md:gap-4 w-full md:w-auto">
          <span className="bg-blue-900/50 text-blue-300 font-black px-3 py-1.5 rounded-lg text-[10px] border border-blue-800 uppercase tracking-widest flex-1 text-center">Prepaid: {totalPrepaid}</span>
          <span className="bg-purple-900/50 text-purple-300 font-black px-3 py-1.5 rounded-lg text-[10px] border border-purple-800 uppercase tracking-widest flex-1 text-center">Postpaid: {displayLedger.qPost}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-slate-700">
        <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">New</p><p className="text-xl font-black text-white">{displayLedger.qNew}</p></div>
        <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Upgrade</p><p className="text-xl font-black text-white">{displayLedger.qUp}</p></div>
        <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Replace</p><p className="text-xl font-black text-white">{displayLedger.qRep}</p></div>
        <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Fancy</p><p className="text-xl font-black text-white">{displayLedger.qFan}</p></div>
        <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">MNP</p><p className="text-xl font-black text-blue-300">{displayLedger.qMnp}</p></div>
        <div className="bg-slate-900 p-4 text-center"><p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1">Postpaid</p><p className="text-xl font-black text-purple-300">{displayLedger.qPost}</p></div>
      </div>

      <div className={`p-6 text-center ${lifetimePendingBalance > 0 ? 'bg-red-950 border-t border-red-900' : 'bg-emerald-950 border-t border-emerald-900'}`}>
        <span className={`font-black text-sm uppercase tracking-widest mr-2 block sm:inline ${lifetimePendingBalance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          {lifetimePendingBalance > 0 ? '⚠️ Total Pending Cash to Deposit:' : '✅ Ledger Settled:'}
        </span>
        <span className="text-3xl font-black text-white mt-1 sm:mt-0 inline-block">₹{Math.max(0, lifetimePendingBalance).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
        <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase tracking-widest">*Pending balance is calculated across lifetime operations (BSNL + Paybull).</p>
      </div>
    </div>
  );
}