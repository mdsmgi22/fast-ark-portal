"use client";
import React from "react";
import Link from "next/link";
import { formatToDDMMYYYY } from "../../lib/partnerUtils";

export default function SalesHistory({
  timeFilter,
  visibleSales,
  expandedSaleId,
  setExpandedSaleId,
  requestingEditId,
  setRequestingEditId,
  editReason,
  setEditReason,
  handleRequestEdit,
  downloadCSV
}: any) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
      <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
        <h2 className="font-black text-slate-800 uppercase tracking-widest text-xs">Sales Reports ({timeFilter})</h2>
        <button onClick={downloadCSV} className="text-[9px] bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded font-black uppercase tracking-widest hover:bg-blue-100 transition shadow-sm">
          📥 Export CSV
        </button>
      </div>
      <div className="p-0">
        {visibleSales.length === 0 ? (
          <p className="p-8 text-center text-sm font-bold text-slate-400 bg-slate-50">No sales submitted in this period.</p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {visibleSales.map((sale: any) => {
              const totalCash = Number(sale.cbp_landline_amt || 0) + Number(sale.cbp_gsm_amt || 0) + 
                                Number(sale.ctop_recharge_amt || 0) + Number(sale.sim_replacement_amt || 0) + 
                                Number(sale.sim_fancy_amt || 0) + Number(sale.sim_postpaid_amt || 0) + 
                                Number(sale.other_amt || 0) + Number(sale.frc_amt || 0) + Number(sale.mnp_amt || 0) + 
                                Number(sale.pb_cbp_amt || 0) + Number(sale.pb_ctop_amt || 0) + 
                                Number(sale.pb_frc_amt || 0) + Number(sale.pb_mnp_amt || 0) + Number(sale.pb_other_amt || 0);

              const totalSims = Number(sale.sim_new_qty || 0) + Number(sale.sim_upgrade_qty || 0) + 
                                Number(sale.sim_replacement_qty || 0) + Number(sale.sim_fancy_qty || 0) + 
                                Number(sale.sim_postpaid_qty || 0) + Number(sale.mnp_qty || 0) + Number(sale.frc_qty || 0);

              const pbCash = Number(sale.pb_cbp_amt || 0) + Number(sale.pb_ctop_amt || 0) + 
                             Number(sale.pb_frc_amt || 0) + Number(sale.pb_mnp_amt || 0) + Number(sale.pb_other_amt || 0);

              const isExpanded = expandedSaleId === sale.id;

              return (
                <li key={sale.id} className="transition">
                  <div className="p-4 hover:bg-slate-50 flex justify-between items-center cursor-pointer" onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}>
                    <div>
                      <p className="font-black text-slate-900 text-base">{formatToDDMMYYYY(sale.report_date)}</p>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {sale.is_edited_by_staff ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-widest rounded border border-amber-200">Audited</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-widest rounded border border-emerald-200">Original</span>
                        )}
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-black uppercase tracking-widest rounded border border-blue-200">{totalSims} SIMs</span>
                        {pbCash > 0 && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase tracking-widest rounded border border-indigo-200">PB: ₹{pbCash}</span>}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <p className="font-black text-slate-800 text-lg">₹{totalCash.toLocaleString('en-IN')}</p>
                      <span className="text-[10px] text-blue-600 font-bold uppercase mt-1 flex items-center hover:underline">
                        {isExpanded ? 'Hide Details ▲' : 'View Details ▼'}
                      </span>
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="bg-slate-800 p-5 border-t border-slate-700 animate-in fade-in slide-in-from-top-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-y-5 gap-x-3">
                        <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CBP LL</p><p className="text-sm font-bold text-white">₹{sale.cbp_landline_amt || 0}</p></div>
                        <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CBP GSM</p><p className="text-sm font-bold text-white">₹{sale.cbp_gsm_amt || 0}</p></div>
                        <div><p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">CTOP</p><p className="text-sm font-bold text-blue-300">₹{sale.ctop_recharge_amt || 0}</p></div>
                        <div><p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">FRC</p><p className="text-sm font-bold text-emerald-300">₹{sale.frc_amt || 0}</p></div>
                        <div><p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Cheque</p><p className="text-sm font-bold text-amber-500">₹{sale.cheque_amt || 0}</p></div>
                        
                        <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">New SIM</p><p className="text-sm font-bold text-white">{sale.sim_new_qty || 0}</p></div>
                        <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Upgrade</p><p className="text-sm font-bold text-white">{sale.sim_upgrade_qty || 0}</p></div>
                        <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Replace</p><p className="text-sm font-bold text-white">{sale.sim_replacement_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_replacement_amt || 0})</span></p></div>
                        <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fancy</p><p className="text-sm font-bold text-white">{sale.sim_fancy_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_fancy_amt || 0})</span></p></div>
                        <div><p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">MNP</p><p className="text-sm font-bold text-white">{sale.mnp_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.mnp_amt || 0})</span></p></div>
                        <div><p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">Postpaid</p><p className="text-sm font-bold text-white">{sale.sim_postpaid_qty || 0} <span className="text-slate-500 text-[10px] font-normal">(₹{sale.sim_postpaid_amt || 0})</span></p></div>
                        
                        {pbCash > 0 && (
                          <div className="col-span-2 sm:col-span-3 md:col-span-5 pt-4 mt-2 border-t border-slate-700 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-3">Paybull Platform Cash</p>
                            <div className="flex flex-wrap gap-4">
                              {sale.pb_cbp_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">CBP</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_cbp_amt}</p></div>}
                              {sale.pb_ctop_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">CTOP</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_ctop_amt}</p></div>}
                              {sale.pb_frc_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">FRC</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_frc_amt}</p></div>}
                              {sale.pb_mnp_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">MNP</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_mnp_amt}</p></div>}
                              {sale.pb_other_amt > 0 && <div><p className="text-[9px] text-slate-500 uppercase font-black">Other</p><p className="text-xs font-bold text-indigo-200">₹{sale.pb_other_amt}</p></div>}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-4 border-t border-slate-700">
                        {sale.edit_request_status === 'Pending' ? (
                          <div className="bg-amber-900/30 border border-amber-800 p-3 rounded-lg flex items-center justify-between">
                            <span className="text-amber-500 font-bold text-[10px] uppercase tracking-widest">⏳ Edit Request Pending</span>
                            <span className="text-slate-400 text-[10px] truncate max-w-[150px]">Reason: {sale.edit_request_reason}</span>
                          </div>
                        ) : sale.edit_request_status === 'Approved' ? (
                          <div className="bg-emerald-900/30 border border-emerald-800 p-3 rounded-lg flex items-center justify-between">
                            <span className="text-emerald-500 font-bold text-[10px] uppercase tracking-widest">✅ Edit Request Approved</span>
                            <Link href={`/partner/sales`} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded font-black text-[10px] uppercase tracking-widest transition shadow">Edit Now</Link>
                          </div>
                        ) : sale.edit_request_status === 'Rejected' ? (
                          <div className="bg-red-900/30 border border-red-800 p-3 rounded-lg flex flex-col">
                            <span className="text-red-500 font-black text-[10px] uppercase tracking-widest mb-1">❌ Edit Request Rejected</span>
                            <span className="text-slate-400 text-[10px]">Your request to edit was declined by the back-office.</span>
                          </div>
                        ) : (
                          requestingEditId === sale.id ? (
                            <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                              <label className="text-[10px] text-amber-500 font-black uppercase tracking-widest block mb-2">Reason for Edit Request *</label>
                              <input 
                                type="text" value={editReason} onChange={(e) => setEditReason(e.target.value)} 
                                placeholder="e.g. Typo in CTOP cash amount..." 
                                className="w-full bg-slate-800 text-white border-2 border-slate-600 rounded-lg p-3 text-xs outline-none mb-3 focus:border-amber-500 font-bold"
                              />
                              <div className="flex gap-2">
                                <button onClick={() => handleRequestEdit(sale.id)} className="flex-1 bg-amber-600 hover:bg-amber-700 text-slate-900 font-black py-2.5 rounded-lg text-[10px] uppercase tracking-widest transition shadow-sm">Submit Request</button>
                                <button onClick={() => setRequestingEditId(null)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-black py-2.5 rounded-lg text-[10px] uppercase tracking-widest transition shadow-sm">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => setRequestingEditId(sale.id)} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-black px-4 py-3 rounded-xl text-[10px] uppercase tracking-widest transition border border-slate-600 flex justify-center items-center gap-2 shadow-sm">
                              <span>⚠</span> Request Permission to Edit Report
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}