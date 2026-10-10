"use client";
import React, { useState } from "react";

export default function InfrastructureAccordions({
  partner,
  partnerCtops,
  virtualAccounts,
  upiIds
}: any) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  return (
    <div className="space-y-3 pt-2">
      {/* Accordion 1: Partner Profile */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <button onClick={() => setExpandedCard(expandedCard === 'profile' ? null : 'profile')} className="w-full p-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition focus:outline-none">
          <div className="flex items-center gap-3">
            <span className="text-xl">👤</span>
            <div className="text-left">
              <h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Partner Profile & Center</h3>
              <p className="text-[10px] font-bold text-slate-500 uppercase">{partner?.locations?.center_name || "Unassigned Center"}</p>
            </div>
          </div>
          <span className={`text-slate-400 font-black text-lg transition-transform duration-300 ${expandedCard === 'profile' ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {expandedCard === 'profile' && (
          <div className="p-5 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-6 bg-white animate-in slide-in-from-top-2">
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest border-b pb-1">Personal Details</p>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Full Name</p><p className="font-black text-slate-800">{partner?.partner_name}</p></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Email ID</p><p className="font-bold text-slate-800 text-sm break-all">{partner?.email}</p></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Mobile No</p><p className="font-bold text-slate-800 text-sm">{partner?.mobile || partner?.phone || "N/A"}</p></div>
            </div>
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase text-emerald-600 tracking-widest border-b pb-1">Assigned Center Details</p>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Center Code</p><p className="font-black text-slate-800 bg-slate-100 inline-block px-2 py-0.5 rounded">{partner?.locations?.center_code || "NO-CODE"}</p></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Role</p><p className="font-black text-slate-800">{partner?.role}</p></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Geographic Zone</p><p className="text-sm font-bold text-slate-700 leading-relaxed">{partner?.locations?.taluk ? `${partner?.locations.taluk}, ` : ""}{partner?.locations?.dist}<br/>{partner?.locations?.state} - {partner?.locations?.pin_code}</p></div>
            </div>
          </div>
        )}
      </div>

      {/* Accordion 2: Telecom & OCSC */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <button onClick={() => setExpandedCard(expandedCard === 'telecom' ? null : 'telecom')} className="w-full p-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition focus:outline-none">
          <div className="flex items-center gap-3">
            <span className="text-xl">📡</span>
            <div className="text-left">
              <h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Telecom & OCSC Credentials</h3>
              <p className="text-[10px] font-bold text-slate-500 uppercase">{partnerCtops.length} Mapped Agents</p>
            </div>
          </div>
          <span className={`text-slate-400 font-black text-lg transition-transform duration-300 ${expandedCard === 'telecom' ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {expandedCard === 'telecom' && (
          <div className="p-5 border-t border-slate-200 bg-white animate-in slide-in-from-top-2">
            {partnerCtops.length === 0 ? (
              <p className="text-xs font-bold text-slate-400 text-center py-4 bg-slate-50 rounded-lg border border-slate-100">No CTOP credentials mapped to this account.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* FIX APPLIED: explicitly typed 'ctop' and 'idx' */}
                {partnerCtops.map((ctop: any, idx: number) => (
                  <div key={idx} className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 shadow-sm relative overflow-hidden">
                    <div className="absolute right-0 top-0 text-4xl opacity-10 mt-2 mr-2">🔐</div>
                    <p className="text-[9px] font-black text-blue-800 uppercase tracking-widest mb-3 border-b border-blue-200 pb-2">Master: {ctop.master_ctop_accounts?.master_ctop_no}</p>
                    <div className="mb-3">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Partner CTOP No</p>
                      <p className="font-black text-xl text-slate-900 tracking-wider">{ctop.agent_ctop_no}</p>
                    </div>
                    {ctop.agent_ocsc_login_id && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">OCSC Login ID</p>
                        <p className="font-bold text-slate-800 break-all">{ctop.agent_ocsc_login_id}</p>
                      </div>
                    )}
                    {!ctop.is_active && <div className="mt-3 bg-red-100 border border-red-200 p-1.5 rounded text-center"><p className="text-[9px] font-black text-red-700 uppercase tracking-widest">⚠️ Suspended</p></div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Accordion 3: Treasury (Virtual & UPI) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <button onClick={() => setExpandedCard(expandedCard === 'treasury' ? null : 'treasury')} className="w-full p-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition focus:outline-none">
          <div className="flex items-center gap-3">
            <span className="text-xl">🏦</span>
            <div className="text-left">
              <h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Bank Treasury Channels</h3>
              <p className="text-[10px] font-bold text-slate-500 uppercase">{virtualAccounts.length} CMS Accts | {upiIds.length} UPIs</p>
            </div>
          </div>
          <span className={`text-slate-400 font-black text-lg transition-transform duration-300 ${expandedCard === 'treasury' ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {expandedCard === 'treasury' && (
          <div className="p-5 border-t border-slate-200 bg-white grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2">
            <div>
              <p className="text-[10px] font-black uppercase text-amber-700 tracking-widest border-b border-amber-200 pb-1 mb-3">Virtual Accounts (CMS)</p>
              {virtualAccounts.length === 0 ? <p className="text-xs font-bold text-slate-400 bg-slate-50 p-4 rounded text-center border border-slate-100">No virtual accounts assigned.</p> : (
                <div className="space-y-3">
                  {/* FIX APPLIED: explicitly typed 'va' and 'idx' */}
                  {virtualAccounts.map((va: any, idx: number) => (
                    <div key={idx} className={`p-3 rounded-lg border ${va.is_active ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50 opacity-70 grayscale'}`}>
                      <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-1">{va.master_banks?.bank_name}</p>
                      <p className="font-black text-lg text-slate-900 tracking-wider">{va.virtual_account_no}</p>
                      <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase">IFSC: <span className="text-slate-800">{va.virtual_ifsc}</span></p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-purple-700 tracking-widest border-b border-purple-200 pb-1 mb-3">Digital UPI Channels</p>
              {upiIds.length === 0 ? <p className="text-xs font-bold text-slate-400 bg-slate-50 p-4 rounded text-center border border-slate-100">No UPI channels assigned.</p> : (
                <div className="space-y-3">
                  {/* FIX APPLIED: explicitly typed 'upi' and 'idx' */}
                  {upiIds.map((upi: any, idx: number) => (
                    <div key={idx} className={`p-3 rounded-lg border ${upi.is_active ? 'border-purple-200 bg-purple-50/50' : 'border-slate-200 bg-slate-50 opacity-70 grayscale'}`}>
                      <p className="text-[10px] font-black text-purple-700 uppercase tracking-widest mb-1">{upi.master_banks?.bank_name}</p>
                      <p className="font-black text-base text-slate-900 break-all">{upi.upi_id}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Accordion 4: Store Assets */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <button onClick={() => setExpandedCard(expandedCard === 'assets' ? null : 'assets')} className="w-full p-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition focus:outline-none">
          <div className="flex items-center gap-3">
            <span className="text-xl">🖨️</span>
            <div className="text-left">
              <h3 className="font-black text-sm uppercase tracking-widest text-slate-800">Store Assets & Printables</h3>
              <p className="text-[10px] font-bold text-slate-500 uppercase">Official Center QR Code</p>
            </div>
          </div>
          <span className={`text-slate-400 font-black text-lg transition-transform duration-300 ${expandedCard === 'assets' ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {expandedCard === 'assets' && (
          <div className="p-6 border-t border-slate-200 bg-white animate-in slide-in-from-top-2 text-center">
            {partner?.locations?.qr_asset_url ? (
              <div className="inline-block p-5 border-2 border-dashed border-blue-200 bg-blue-50 rounded-2xl w-full max-w-sm mx-auto shadow-sm">
                <div className="text-5xl mb-3 animate-bounce">🖼️</div>
                <h4 className="font-black text-blue-900 text-base mb-1 uppercase tracking-widest">Official Store QR Code</h4>
                <p className="text-[10px] text-blue-700 font-bold mb-5 uppercase">Mapped specifically to {partner?.locations?.center_name}</p>
                <a 
                  href={partner.locations.qr_asset_url} 
                  target="_blank" 
                  rel="noreferrer"
                  download={`FastArk_QR_${partner?.locations?.center_code || 'Asset'}.png`}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-black py-3 px-6 rounded-xl shadow-md text-xs uppercase tracking-widest transition block w-full"
                >
                  Download Asset
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 opacity-70 bg-slate-50 rounded-2xl border border-slate-200 w-full max-w-sm mx-auto">
                <div className="text-4xl mb-3">🚫</div>
                <p className="text-sm font-black text-slate-700 uppercase tracking-widest">No Custom QR Mapped</p>
                <p className="text-[10px] text-slate-500 mt-1 font-bold uppercase">Please Contact Corporate Admin</p>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}