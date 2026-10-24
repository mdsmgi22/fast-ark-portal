"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { formatToDDMMYYYY, getISTDateString } from "../../lib/aadhaarEngine";

export type AadhaarMenuTab = "overview" | "daily" | "deposit" | "weekly" | "history" | "upgrade";

interface SidebarProps {
  activeMenu: AadhaarMenuTab;
  setActiveMenu: (menu: AadhaarMenuTab) => void;
  partner: any;
  isAadhaarAuthorized: boolean;
  pendingReportCash: number;
  unpaidPenaltyTotal: number;
  overdueDaysCount: number;
  onSignOut: () => void;
}

export default function AadhaarSidebar({
  activeMenu,
  setActiveMenu,
  partner,
  isAadhaarAuthorized,
  pendingReportCash,
  unpaidPenaltyTotal,
  overdueDaysCount,
  onSignOut,
}: SidebarProps) {
  const [liveTimeIST, setLiveTimeIST] = useState<string>("");
  const [liveDateDDMMYYYY, setLiveDateDDMMYYYY] = useState<string>("");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setLiveDateDDMMYYYY(formatToDDMMYYYY(getISTDateString(0)));
      setLiveTimeIST(
        now
          .toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          })
          .toUpperCase()
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const totalPayable = pendingReportCash + unpaidPenaltyTotal;
  const isDepositUnlocked = isAadhaarAuthorized && totalPayable > 0;

  const menuItems: {
    id: AadhaarMenuTab;
    icon: string;
    shortLabel: string;
    label: string;
    sub: string;
    locked: boolean;
    badge?: string;
    badgeColor?: string;
  }[] = [
    {
      id: "overview",
      icon: "📊",
      shortLabel: "Counts",
      label: "1. Dashboard & Counts",
      sub: isAadhaarAuthorized ? "5-Category Live KPIs" : "Requires Admin Approval",
      locked: !isAadhaarAuthorized,
      badge: !isAadhaarAuthorized ? "🔒 Locked" : undefined,
      badgeColor: "bg-slate-800 text-red-400 border border-red-900/50",
    },
    {
      id: "daily",
      icon: "📤",
      shortLabel: "Daily",
      label: "2. Daily Report Upload",
      sub: isAadhaarAuthorized ? "CSV + HTML / Manual" : "Requires Admin Approval",
      locked: !isAadhaarAuthorized,
      badge: !isAadhaarAuthorized ? "🔒 Locked" : undefined,
      badgeColor: "bg-slate-800 text-red-400 border border-red-900/50",
    },
    {
      id: "deposit",
      icon: "💳",
      shortLabel: "Pay QR",
      label: "3. Instant Deposit (QR)",
      sub: !isAadhaarAuthorized
        ? "Requires Admin Approval"
        : isDepositUnlocked
        ? "Scan / Tap & Pay Now"
        : "Upload Daily Report First",
      locked: !isAadhaarAuthorized,
      badge: !isAadhaarAuthorized
        ? "🔒 Locked"
        : isDepositUnlocked
        ? `₹${totalPayable.toLocaleString("en-IN")}`
        : "Locked",
      badgeColor: !isAadhaarAuthorized
        ? "bg-slate-800 text-red-400 border border-red-900/50"
        : isDepositUnlocked
        ? "bg-emerald-500 text-slate-950 animate-pulse"
        : "bg-slate-800 text-slate-500",
    },
    {
      id: "weekly",
      icon: "📅",
      shortLabel: "Weekly",
      label: "4. Weekly Reconciliation",
      sub: isAadhaarAuthorized ? "Match Daily vs Weekly" : "Requires Admin Approval",
      locked: !isAadhaarAuthorized,
      badge: !isAadhaarAuthorized ? "🔒 Locked" : undefined,
      badgeColor: "bg-slate-800 text-red-400 border border-red-900/50",
    },
    {
      id: "history",
      icon: "📥",
      shortLabel: "Reports",
      label: "5. Reports & Downloads",
      sub: isAadhaarAuthorized ? "PDF / CSV & File Vault" : "Requires Admin Approval",
      locked: !isAadhaarAuthorized,
      badge: !isAadhaarAuthorized ? "🔒 Locked" : undefined,
      badgeColor: "bg-slate-800 text-red-400 border border-red-900/50",
    },
    {
      id: "upgrade",
      icon: "🗂️",
      shortLabel: "IDs",
      label: "6. Credentials & Upgrade",
      sub: isAadhaarAuthorized ? "Verified Station & IDs" : "Submit Request for Approval",
      locked: false,
      badge: isAadhaarAuthorized ? "✅ Active" : "Action Req",
      badgeColor: isAadhaarAuthorized
        ? "bg-emerald-950 text-emerald-400 border border-emerald-700"
        : "bg-amber-500 text-slate-950",
    },
  ];

  const handleSelectMenu = (id: AadhaarMenuTab, isLocked: boolean) => {
    if (isLocked) return;
    setActiveMenu(id);
    setMobileDrawerOpen(false);
  };

  return (
    <>
      {/* ===================================================================== */}
      {/* MOBILE TOP BAR (VISIBLE ONLY ON PHONES / TABLETS < LG)                */}
      {/* ===================================================================== */}
      <div className="lg:hidden bg-slate-950 text-white border-b border-slate-800 sticky top-0 z-40 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center font-black text-lg text-slate-950">
              🆔
            </div>
            <div>
              <h1 className="font-black text-sm tracking-wide text-white leading-none">AADHAAR HUB</h1>
              <p className="text-[9px] text-emerald-400 font-bold mt-0.5">
                📅 {liveDateDDMMYYYY} • 🕒 {liveTimeIST}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAadhaarAuthorized && totalPayable > 0 && (
              <button
                onClick={() => handleSelectMenu("deposit", false)}
                className="bg-emerald-500 text-slate-950 font-black text-[10px] uppercase px-2.5 py-1.5 rounded-lg shadow animate-pulse"
              >
                💳 Pay ₹{totalPayable.toLocaleString("en-IN")}
              </button>
            )}
            <button
              onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
              className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-black uppercase"
            >
              {mobileDrawerOpen ? "✕ Close" : "☰ Menu"}
            </button>
          </div>
        </div>

        {mobileDrawerOpen && (
          <div className="mt-3 pt-3 border-t border-slate-800 space-y-3 animate-in fade-in">
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="bg-slate-900 p-2 rounded border border-slate-800">
                <span className="text-slate-400 font-bold uppercase block">Operator ID</span>
                <span className="font-black text-white">{partner?.aadhaar_operator_id || "NOT APPROVED"}</span>
              </div>
              <div className="bg-slate-900 p-2 rounded border border-slate-800">
                <span className="text-slate-400 font-bold uppercase block">Station ID</span>
                <span className="font-black text-amber-400">{partner?.aadhaar_station_id || "NOT APPROVED"}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Link
                href="/partner/dashboard"
                className="flex-1 text-center py-2 bg-slate-800 text-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest border border-slate-700"
              >
                &larr; Main Partner Hub
              </Link>
              <button
                onClick={onSignOut}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* DESKTOP LEFT SIDEBAR (VISIBLE ON LG+ SCREENS)                         */}
      {/* ===================================================================== */}
      <aside className="hidden lg:flex lg:w-80 bg-slate-950 text-white flex-col justify-between border-r border-slate-800 shrink-0 min-h-screen select-none">
        <div>
          <div className="p-5 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center font-black text-xl text-slate-950 shadow">
                  🆔
                </div>
                <div>
                  <h1 className="font-black text-base tracking-wide text-white leading-none">AADHAAR HUB</h1>
                  <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest mt-1">
                    Fast Ark Seva Kendra
                  </p>
                </div>
              </div>
              <Link
                href="/partner/dashboard"
                className="text-[10px] font-black uppercase tracking-widest bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded border border-slate-700 transition"
              >
                &larr; Main Hub
              </Link>
            </div>

            {/* INDIAN STANDARD DATE (DD/MM/YYYY) & LIVE CLOCK */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span>📅</span>
                <span className="font-black text-emerald-400 tracking-wider">{liveDateDDMMYYYY || "DD/MM/YYYY"}</span>
              </div>
              <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2.5">
                <span>🕒</span>
                <span className="font-mono font-bold text-slate-200 text-[11px]">{liveTimeIST || "IST"}</span>
              </div>
            </div>

            {/* MAPPED OPERATOR, STATION & CENTER STATUS */}
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
              <div className="bg-slate-800/70 p-2 rounded border border-slate-700/70">
                <p className="text-slate-400 font-bold uppercase">Operator ID</p>
                <p className="font-black text-white truncate mt-0.5">
                  {isAadhaarAuthorized ? partner?.aadhaar_operator_id : "🔒 UNAPPROVED"}
                </p>
              </div>
              <div className="bg-slate-800/70 p-2 rounded border border-slate-700/70">
                <p className="text-slate-400 font-bold uppercase">Station ID</p>
                <p className="font-black text-amber-400 truncate mt-0.5">
                  {isAadhaarAuthorized ? partner?.aadhaar_station_id : "🔒 UNAPPROVED"}
                </p>
              </div>
            </div>
          </div>

          {/* SIDEBAR MENU LIST */}
          <nav className="p-3 space-y-1.5">
            {menuItems.map((item) => {
              const isActive = activeMenu === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.locked}
                  onClick={() => handleSelectMenu(item.id, item.locked)}
                  className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between border ${
                    item.locked
                      ? "bg-slate-900/30 text-slate-600 border-slate-900 cursor-not-allowed opacity-60"
                      : isActive
                      ? "bg-blue-600 text-white border-blue-500 shadow-lg"
                      : "bg-slate-900/60 text-slate-300 border-slate-800/80 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{item.icon}</span>
                    <div className="truncate">
                      <p className="font-black text-xs uppercase tracking-wider truncate">{item.label}</p>
                      <p
                        className={`text-[10px] font-bold truncate mt-0.5 ${
                          item.locked ? "text-red-400/70" : isActive ? "text-blue-200" : "text-slate-500"
                        }`}
                      >
                        {item.sub}
                      </p>
                    </div>
                  </div>
                  {item.badge && (
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded shrink-0 ml-2 ${item.badgeColor}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* PINNED BOTTOM LEDGER & ₹100/DAY LATE PENALTY TRACKER */}
        <div className="p-4 space-y-3 border-t border-slate-800 bg-slate-900/50">
          {isAadhaarAuthorized ? (
            <div
              className={`p-3.5 rounded-xl border ${
                totalPayable > 0 ? "bg-red-950/60 border-red-800" : "bg-emerald-950/40 border-emerald-800/60"
              }`}
            >
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Aadhaar Closing Ledger
              </p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">Report Cash Due:</span>
                  <span className="font-black text-white">
                    ₹{pendingReportCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-400 font-bold">Late Penalty (₹100/d):</span>
                  <span className="font-black text-red-400">
                    ₹{unpaidPenaltyTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })} ({overdueDaysCount}d)
                  </span>
                </div>
                <div className="border-t border-slate-800 pt-1.5 mt-1.5 flex justify-between items-baseline">
                  <span className="text-[10px] font-black uppercase text-amber-400">Total Payable:</span>
                  <span className="text-lg font-black text-white">
                    ₹{totalPayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              {totalPayable > 0 && (
                <button
                  type="button"
                  onClick={() => handleSelectMenu("deposit", false)}
                  className="mt-3 w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[10px] uppercase tracking-widest rounded-lg shadow transition"
                >
                  💳 Scan / Tap to Pay Now &rarr;
                </button>
              )}
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-amber-800/60 bg-amber-950/30 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                🔒 Dashboard Locked
              </p>
              <p className="text-[10px] font-bold text-slate-400 mt-1">
                Admin approval of your Aadhaar credentials &amp; Center mapping is required to unlock uploads.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={onSignOut}
            className="w-full py-2.5 bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white font-black text-xs uppercase tracking-widest rounded-lg transition"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* MOBILE STICKY BOTTOM TAB BAR (APP-STYLE NAVIGATION ON PHONES < LG)    */}
      {/* ===================================================================== */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950 border-t border-slate-800 grid grid-cols-6 gap-0.5 px-1 py-1.5 shadow-2xl">
        {menuItems.map((item) => {
          const isActive = activeMenu === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.locked}
              onClick={() => handleSelectMenu(item.id, item.locked)}
              className={`flex flex-col items-center justify-center py-1.5 rounded-lg transition ${
                item.locked
                  ? "text-slate-700 opacity-40 cursor-not-allowed"
                  : isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">{item.locked ? "🔒" : item.icon}</span>
              <span className="text-[9px] font-black uppercase tracking-tighter mt-1 truncate max-w-full px-0.5">
                {item.shortLabel}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}