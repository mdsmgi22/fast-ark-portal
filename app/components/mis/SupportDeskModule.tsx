"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str}"`;
};

export default function SupportDeskModule({ currentUserRole, allLocations }: any) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  // Filter States
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [fState, setFState] = useState("ALL");
  const [fHq, setFHq] = useState("ALL");
  const [fCenter, setFCenter] = useState("ALL");
  const [fStatus, setFStatus] = useState("ALL");

  // Action Modal State
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [remarks, setRemarks] = useState("");

  const safeRole = (currentUserRole || 'staff').trim().toLowerCase();

  useEffect(() => {
    fetchTickets();
  }, [fromDate, toDate]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('complaints_log')
        .select(`*, active_partners(partner_name)`)
        .gte('created_at', `${fromDate}T00:00:00Z`)
        .lte('created_at', `${toDate}T23:59:59Z`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTickets(data || []);
    } catch (err: any) {
      console.error("Fetch Tickets Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const getLocationName = (id: number) => allLocations?.find((l: any) => l.id === id)?.center_name || "Unknown";
  
  // DYNAMIC FILTER ENGINE
  const uniqueStates = Array.from(new Set(tickets.map(t => t.state).filter(Boolean))).sort();
  const availableHQs = Array.from(new Set(tickets.filter(t => fState === "ALL" || t.state === fState).map(t => t.hq_id).filter(Boolean)));
  const availableCenters = Array.from(new Set(tickets.filter(t => (fState === "ALL" || t.state === fState) && (fHq === "ALL" || t.hq_id.toString() === fHq)).map(t => t.center_id).filter(Boolean)));

  const filteredTickets = tickets.filter(t => {
    if (fState !== "ALL" && t.state !== fState) return false;
    if (fHq !== "ALL" && t.hq_id?.toString() !== fHq) return false;
    if (fCenter !== "ALL" && t.center_id?.toString() !== fCenter) return false;
    if (fStatus !== "ALL") {
      if (fStatus === "RESOLVED" && t.status !== 'Resolved') return false;
      if (fStatus === "PENDING" && t.status === 'Resolved') return false;
      if (fStatus === "SLA_BREACH") {
        const hoursPending = (Date.now() - new Date(t.last_escalated_at).getTime()) / (1000 * 60 * 60);
        if (t.status === 'Resolved' || hoursPending <= 24) return false;
      }
    }
    return true;
  });

  const downloadCSV = () => {
    const headers = ["Ticket ID", "Date", "Partner", "State", "HQ", "Center", "Category", "Issue", "Status", "L1 Remarks", "L2 Remarks", "L3 Remarks", "Partner Complaint"];
    const csvData = filteredTickets.map(t => [
      t.ticket_number, new Date(t.created_at).toLocaleDateString('en-IN'), 
      sanitizeCSV(t.active_partners?.partner_name), sanitizeCSV(t.state), sanitizeCSV(getLocationName(t.hq_id)), sanitizeCSV(getLocationName(t.center_id)),
      t.category_type, sanitizeCSV(t.issue_type), t.status, 
      sanitizeCSV(t.l1_remarks), sanitizeCSV(t.l2_remarks), sanitizeCSV(t.l3_remarks), sanitizeCSV(t.complaint_text)
    ]);
    
    const csvContent = [headers.join(","), ...csvData.map(row => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Tickets_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // =========================================================================
  // RBAC ESCALATION & RESOLUTION ENGINE WITH AUDIT TRACKING
  // =========================================================================
  const handleAction = async (actionType: 'RESOLVE' | 'ESCALATE') => {
    if (!selectedTicket || !remarks.trim()) return alert("Remarks are mandatory.");
    setProcessing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      let payload: any = { last_escalated_at: new Date().toISOString() };
      
      if (safeRole === 'supervisor' || safeRole === 'staff') {
        if (selectedTicket.current_level !== 1) throw new Error("Unauthorized: Ticket is beyond your authorization level.");
        payload.l1_remarks = remarks;
        if (actionType === 'RESOLVE') {
          payload.status = 'Resolved';
          payload.resolved_at = new Date().toISOString();
        } else {
          payload.current_level = 2;
          payload.status = 'Escalated L2';
        }
      } 
      else if (safeRole === 'manager') {
        if (selectedTicket.current_level !== 2) throw new Error("Unauthorized: You can only action L2 tickets.");
        payload.l2_remarks = remarks;
        if (actionType === 'RESOLVE') {
          payload.status = 'Resolved';
          payload.resolved_at = new Date().toISOString();
        } else {
          payload.current_level = 3;
          payload.status = 'Escalated L3';
        }
      } 
      else if (safeRole === 'admin') {
        payload.l3_remarks = remarks;
        if (actionType === 'RESOLVE') {
          payload.status = 'Resolved';
          payload.resolved_at = new Date().toISOString();
        } else {
          throw new Error("Admin is the highest tier. You can only resolve tickets.");
        }
      }

      const { error: updateError } = await supabase.from('complaints_log').update(payload).eq('id', selectedTicket.id);
      if (updateError) throw updateError;

      const { error: logError } = await supabase.from('staff_activity_logs').insert([{
        staff_id: session?.user?.id,
        staff_email: session?.user?.email,
        action_type: actionType === 'RESOLVE' ? 'TICKET_RESOLVED' : 'TICKET_ESCALATED',
        module: 'SUPPORT_DESK',
        target_id: selectedTicket.id,
        details: `User (${safeRole}) ${actionType === 'RESOLVE' ? 'resolved' : 'escalated'} ticket ${selectedTicket.ticket_number} with remarks: "${remarks}"`
      }]);
      
      if (logError) console.error("Warning: Audit log failed to insert", logError.message);

      alert(`✅ Ticket ${selectedTicket.ticket_number} successfully ${actionType === 'RESOLVE' ? 'Resolved' : 'Escalated'}.`);
      setSelectedTicket(null);
      setRemarks("");
      fetchTickets(); 
    } catch (err: any) {
      alert("Action Error: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const getSlaStatus = (ticket: any) => {
    if (ticket.status === 'Resolved') return { text: "Resolved", color: "bg-emerald-100 text-emerald-800 border-emerald-200" };
    const hours = (Date.now() - new Date(ticket.last_escalated_at).getTime()) / (1000 * 60 * 60);
    if (hours > 24) return { text: "SLA BREACHED", color: "bg-red-100 text-red-800 border-red-300 animate-pulse" };
    return { text: "Active SLA", color: "bg-blue-100 text-blue-800 border-blue-200" };
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      
      {/* HEADER & FILTERS */}
      <div className="bg-slate-900 p-5 rounded-xl shadow-md border border-slate-800">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 pb-4 border-b border-slate-700 gap-4">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2"><span>🎧</span> Support & Escalation Desk</h2>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Manage partner infrastructure and queries</p>
          </div>
          <button onClick={downloadCSV} className="bg-indigo-600 hover:bg-indigo-500 text-white font-black px-4 py-2 rounded shadow text-xs uppercase tracking-widest transition">
            📥 Export CSV
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">From Date</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded p-2 outline-none" />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">To Date</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded p-2 outline-none" />
          </div>
          
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">State</label>
            <select value={fState} onChange={e => {setFState(e.target.value); setFHq("ALL"); setFCenter("ALL");}} className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded p-2 outline-none">
              <option value="ALL">All States</option>
              {uniqueStates.map((st: any) => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">HQ / Master Node</label>
            <select value={fHq} onChange={e => {setFHq(e.target.value); setFCenter("ALL");}} className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded p-2 outline-none">
              <option value="ALL">All HQs</option>
              {availableHQs.map((hqId: any) => <option key={hqId} value={hqId}>{getLocationName(hqId as number)}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Center</label>
            <select value={fCenter} onChange={e => setFCenter(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded p-2 outline-none">
              <option value="ALL">All Centers</option>
              {availableCenters.map((cid: any) => <option key={cid} value={cid}>{getLocationName(cid as number)}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Ticket Status</label>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded p-2 outline-none focus:border-indigo-500">
              <option value="ALL">All Tickets</option>
              <option value="PENDING">Action Required</option>
              {/* JSX FIX: Used &gt; instead of raw > symbol to prevent parsing crashes */}
              <option value="SLA_BREACH">SLA Breached (&gt;24h)</option>
              <option value="RESOLVED">Resolved Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* MOBILE-FIRST CARD GRID */}
      {loading ? (
        <div className="p-12 text-center text-slate-500 font-bold animate-pulse">Scanning Ticketing Database...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredTickets.length === 0 ? (
            <div className="col-span-full p-12 text-center bg-white rounded-xl border border-slate-200 shadow-sm text-slate-500 font-bold">
              No tickets match the selected criteria.
            </div>
          ) : (
            filteredTickets.map(ticket => {
              const sla = getSlaStatus(ticket);
              
              const canAct = ticket.status !== 'Resolved' && (
                (safeRole === 'admin') ||
                (safeRole === 'manager' && ticket.current_level === 2) ||
                ((safeRole === 'supervisor' || safeRole === 'staff') && ticket.current_level === 1)
              );

              return (
                <div key={ticket.id} className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col h-full">
                  <div className={`p-4 border-b flex justify-between items-start ${ticket.status === 'Resolved' ? 'bg-slate-50' : 'bg-white'}`}>
                    <div>
                      <span className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-slate-200">
                        {ticket.ticket_number}
                      </span>
                      <h3 className="font-black text-slate-900 mt-1.5 leading-tight">{ticket.issue_type}</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                        {ticket.category_type} CATEGORY
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-widest ${sla.color}`}>
                        {sla.text}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500">{new Date(ticket.created_at).toLocaleDateString('en-IN')}</span>
                    </div>
                  </div>

                  <div className="p-4 flex-1">
                    <p className="text-xs font-bold text-slate-800 bg-slate-50 p-3 rounded border border-slate-100 line-clamp-3 italic mb-3">
                      "{ticket.complaint_text}"
                    </p>
                    
                    <div className="space-y-1">
                      <p className="text-[11px] font-black text-slate-700">👤 {ticket.active_partners?.partner_name}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        📍 {getLocationName(ticket.center_id)} ({sanitizeCSV(ticket.state)})
                      </p>
                    </div>
                    
                    {ticket.attachments?.length > 0 && (
                      <p className="text-[10px] font-bold text-blue-600 mt-3 flex items-center gap-1 bg-blue-50 w-fit px-2 py-1 rounded">
                        📎 {ticket.attachments.length} Evidence Files Attached
                      </p>
                    )}
                  </div>

                  <div className="p-4 border-t border-slate-100 bg-slate-50">
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Current Status</p>
                      <p className="text-xs font-black text-slate-800">{ticket.status}</p>
                    </div>
                    
                    {canAct ? (
                      <button onClick={() => { setSelectedTicket(ticket); setRemarks(""); }} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs py-2.5 rounded shadow transition uppercase tracking-widest">
                        Review & Action Ticket
                      </button>
                    ) : ticket.status !== 'Resolved' ? (
                      <button disabled className="w-full bg-slate-200 text-slate-500 font-black text-xs py-2.5 rounded uppercase tracking-widest cursor-not-allowed">
                        Pending Other Department
                      </button>
                    ) : (
                      <button onClick={() => { setSelectedTicket(ticket); setRemarks(""); }} className="w-full bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200 font-black text-xs py-2.5 rounded transition uppercase tracking-widest">
                        View Resolution Log
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ACTION MODAL */}
      {/* ========================================================================= */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95">
            
            <div className="bg-slate-900 p-5 flex justify-between items-center text-white shrink-0">
              <div>
                <span className="bg-slate-800 text-slate-300 text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-widest border border-slate-700">
                  {selectedTicket.ticket_number}
                </span>
                <h2 className="text-lg font-black mt-1">{selectedTicket.issue_type}</h2>
              </div>
              <button onClick={() => setSelectedTicket(null)} className="text-slate-400 hover:text-white transition text-2xl font-black">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              {/* Partner Initial Complaint */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Partner's Original Complaint</p>
                <div className="bg-amber-50 border border-amber-100 p-4 rounded-lg">
                  <p className="text-sm font-bold text-slate-800 italic leading-relaxed">"{selectedTicket.complaint_text}"</p>
                  
                  {selectedTicket.attachments?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-amber-200/50 flex flex-wrap gap-2">
                      {selectedTicket.attachments.map((url: string, idx: number) => (
                        <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="bg-white border border-amber-200 text-[10px] font-black uppercase tracking-widest text-blue-600 px-3 py-1.5 rounded hover:bg-blue-50 transition shadow-sm flex items-center gap-1">
                          📎 View Evidence {idx + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* History Ledger (If Escalatd) */}
              {(selectedTicket.l1_remarks || selectedTicket.l2_remarks || selectedTicket.l3_remarks) && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Resolution & Escalation Ledger</p>
                  <div className="space-y-2">
                    {selectedTicket.l1_remarks && (
                      <div className="bg-slate-50 border border-slate-200 p-3 rounded text-xs">
                        <span className="font-black text-slate-500 uppercase tracking-widest text-[9px] block mb-1">Level 1 (Supervisor)</span>
                        <span className="font-bold text-slate-800">{selectedTicket.l1_remarks}</span>
                      </div>
                    )}
                    {selectedTicket.l2_remarks && (
                      <div className="bg-slate-50 border border-slate-200 p-3 rounded text-xs">
                        <span className="font-black text-indigo-500 uppercase tracking-widest text-[9px] block mb-1">Level 2 (Manager)</span>
                        <span className="font-bold text-slate-800">{selectedTicket.l2_remarks}</span>
                      </div>
                    )}
                    {selectedTicket.l3_remarks && (
                      <div className="bg-emerald-50 border border-emerald-200 p-3 rounded text-xs">
                        <span className="font-black text-emerald-600 uppercase tracking-widest text-[9px] block mb-1">Level 3 (Admin)</span>
                        <span className="font-bold text-slate-800">{selectedTicket.l3_remarks}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Form */}
              {selectedTicket.status !== 'Resolved' && (
                <div className="pt-4 border-t border-slate-200">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 flex justify-between">
                    <span>Enter Action Remarks *</span>
                    <span className="text-slate-400 font-normal normal-case">Max 500 Chars</span>
                  </label>
                  <textarea 
                    maxLength={500}
                    rows={4}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value.toUpperCase())}
                    placeholder={`DESCRIBE THE RESOLUTION OR REASON FOR ESCALATION...`}
                    className="w-full border-2 border-slate-300 p-3 rounded-lg font-bold text-slate-800 outline-none focus:border-indigo-500 transition resize-none uppercase"
                  />
                </div>
              )}
            </div>

            {/* ACTION BUTTONS */}
            {selectedTicket.status !== 'Resolved' && (
              <div className="bg-slate-50 p-5 border-t border-slate-200 flex gap-3 shrink-0">
                <button 
                  onClick={() => handleAction('RESOLVE')}
                  disabled={processing || !remarks.trim()} 
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs py-3.5 rounded-lg shadow-md transition uppercase tracking-widest disabled:opacity-50"
                >
                  {processing ? 'Processing...' : '✅ Mark as Resolved'}
                </button>
                
                {/* Admins cannot escalate further, they must resolve */}
                {safeRole !== 'admin' && (
                  <button 
                    onClick={() => handleAction('ESCALATE')}
                    disabled={processing || !remarks.trim()} 
                    className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-black text-xs py-3.5 rounded-lg shadow-md transition uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {processing ? 'Processing...' : `⚠️ Escalate to Level ${selectedTicket.current_level + 1}`}
                  </button>
                )}
              </div>
            )}
            
          </div>
        </div>
      )}
    </div>
  );
}