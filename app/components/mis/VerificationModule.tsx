"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

export default function VerificationModule() {
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchPendingRequests = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('daily_sales_reports')
        .select('*, active_partners(partner_name, locations(center_name))')
        .eq('edit_request_status', 'Pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPendingRequests(data || []);
    } catch (err: any) {
      console.error("Audit Fetch Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingRequests();
  }, []);

  const handleDecision = async (id: string, decision: 'Approved' | 'Rejected') => {
    if (!confirm(`Are you sure you want to ${decision.toUpperCase()} this ledger backdate request?`)) return;
    setProcessingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const { error } = await supabase
        .from('daily_sales_reports')
        .update({ 
          edit_request_status: decision,
          status: decision === 'Rejected' ? 'Rejected' : 'Pending Deposit' 
        })
        .eq('id', id);

      if (error) throw error;

      await supabase.from('staff_activity_logs').insert([{
        staff_id: session?.user.id,
        staff_email: session?.user.email,
        action_type: 'SALES_AUDIT',
        module: 'MANAGER_MIS',
        target_id: id,
        details: `Manager ${decision} a franchisee backdate request.`
      }]);

      alert(`✅ Request successfully ${decision}.`);
      fetchPendingRequests();
    } catch (err: any) {
      alert("Error processing request: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <div className="p-12 text-center text-red-600 font-bold animate-pulse">Loading Audit Queue...</div>;

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
        <div className="p-5 bg-red-900 border-b border-red-800 text-white flex justify-between items-center">
          <div>
            <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2"><span>🛡️</span> Franchisee Backdate Approvals</h3>
            <p className="text-[10px] text-red-200 font-bold mt-1 uppercase tracking-widest">Locked ledgers requiring Manager override</p>
          </div>
          <span className="bg-red-950 px-3 py-1 rounded border border-red-700 text-xs font-black">{pendingRequests.length} Pending</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
              <tr>
                <th className="p-4 font-black">Partner & Center</th>
                <th className="p-4 font-black">Requested Date</th>
                <th className="p-4 font-black">Request Reason</th>
                <th className="p-4 font-black text-right">Audit Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendingRequests.length === 0 ? (
                <tr><td colSpan={4} className="p-12 text-center font-bold text-slate-400">All caught up. No pending backdate requests.</td></tr>
              ) : (
                pendingRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-red-50/30 transition">
                    <td className="p-4">
                      <p className="font-black text-slate-900">{req.active_partners?.partner_name}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">📍 {req.active_partners?.locations?.center_name}</p>
                    </td>
                    <td className="p-4">
                      <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-black tracking-wider border border-amber-200">
                        {req.report_date}
                      </span>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-bold text-slate-600 truncate max-w-xs">{req.edit_request_reason || "Missing sales log"}</p>
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <button 
                        onClick={() => handleDecision(req.id, 'Approved')} 
                        disabled={processingId === req.id}
                        className="bg-green-600 hover:bg-green-500 text-white font-black px-4 py-2 rounded text-[10px] uppercase tracking-widest shadow-sm transition disabled:opacity-50"
                      >
                        ✅ Approve Unlock
                      </button>
                      <button 
                        onClick={() => handleDecision(req.id, 'Rejected')} 
                        disabled={processingId === req.id}
                        className="bg-red-100 hover:bg-red-200 text-red-700 border border-red-300 font-black px-4 py-2 rounded text-[10px] uppercase tracking-widest transition disabled:opacity-50"
                      >
                        ❌ Reject
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}