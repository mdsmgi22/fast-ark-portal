"use client";
import React from "react";
import Link from "next/link";

export default function DashboardQuickActions({ hasSubmittedToday }: { hasSubmittedToday: boolean }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Link href="/partner/stock" className="bg-slate-900 p-5 rounded-xl shadow-md hover:shadow-lg transition-all border border-slate-800 hover:border-blue-500 group flex items-center gap-4 text-white">
        <div className="text-4xl shrink-0 group-hover:scale-110 transition duration-300">📦</div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-widest text-blue-400">Stock Requisitions</h3>
          <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase">Request CBP, CTOP, or SIMs</p>
        </div>
      </Link>
      
      {hasSubmittedToday ? (
        <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-200 flex items-center gap-4 opacity-80 cursor-not-allowed">
          <div className="text-4xl shrink-0">✅</div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-widest text-emerald-800">Sales Logged</h3>
            <p className="text-emerald-600 text-[10px] mt-1 font-bold uppercase">Today's report secured</p>
          </div>
        </div>
      ) : (
        <Link href="/partner/sales" className="bg-blue-600 p-5 rounded-xl shadow-lg hover:bg-blue-700 border border-blue-500 transition-all group flex items-center gap-4 text-white transform hover:-translate-y-1">
          <div className="text-4xl shrink-0 group-hover:scale-110 transition duration-300">📊</div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-widest">Daily Sales Entry</h3>
            <p className="text-blue-200 text-[10px] mt-1 font-bold uppercase">Log end-of-day revenue</p>
          </div>
        </Link>
      )}

      <Link href="/partner/deposit" className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all hover:border-emerald-500 group flex items-center gap-4">
        <div className="text-4xl shrink-0 group-hover:scale-110 transition duration-300">💳</div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-900 group-hover:text-emerald-600">Deposit of Sales</h3>
          <p className="text-slate-500 text-[10px] mt-1 font-bold uppercase">Settle balance & upload slips</p>
        </div>
      </Link>
    </div>
  );
}