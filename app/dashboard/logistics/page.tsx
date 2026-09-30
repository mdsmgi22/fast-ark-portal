"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// --- Date Normalizers (Strict IST Enforcement) ---
const getLocalDateString = (date: Date) => {
  // Force strictly to IST (+05:30) which is +330 minutes to prevent offset drift
  const istTime = new Date(date.getTime() + (330 * 60000));
  return istTime.toISOString().split('T')[0];
};

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes('-')) return dateStr.split('T')[0];
  return dateStr;
};

// --- Security: CSV Sanitizer to prevent Macro Injection Vulnerabilities ---
const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  // Prefix formulas with a single quote to force Excel to treat them as text
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

export default function LogisticsCommandCenter() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // Data States
  const [rawRequests, setRawRequests] = useState<any[]>([]);
  const [filteredRequests, setFilteredRequests] = useState<any[]>([]);
  
  // Filter States
  const [timeFilter, setTimeFilter] = useState("month"); 
  const [statusFilter, setStatusFilter] = useState("Pending"); 
  const [stateFilter, setStateFilter] = useState("All");
  const [distFilter, setDistFilter] = useState("All");
  const [partnerFilter, setPartnerFilter] = useState("All");
  
  const [dropdowns, setDropdowns] = useState({ states: [] as string[], dists: [] as string[], partners: [] as string[] });

  // Action States
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchLogisticsData();
  }, []);

  const fetchLogisticsData = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      // Fetch last 90 days to balance data load with historical access
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const { data, error } = await supabase
        .from("stock_requests")
        .select(`
          *,
          active_partners ( partner_name, locations (state, dist, center_name) )
        `)
        .gte("created_at", getLocalDateString(ninetyDaysAgo))
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      const requests = data || [];
      setRawRequests(requests);

      // Extract unique geographical and partner data
      const stNames = new Set<string>();
      const dtNames = new Set<string>();
      const pNames = new Set<string>();
      
      requests.forEach(r => {
        const l = r.active_partners?.locations;
        if (l?.state) stNames.add(l.state);
        if (l?.dist) dtNames.add(l.dist);
        if (r.active_partners?.partner_name) {
          pNames.add(`${r.active_partners.partner_name} (${l?.center_name})`);
        }
      });
      
      setDropdowns({ 
        states: Array.from(stNames).sort(),
        dists: Array.from(dtNames).sort(),
        partners: Array.from(pNames).sort() 
      });

      // Apply Initial Default Filters (Pending + This Month)
      applyFilters("month", "Pending", "All", "All", "All", requests);

    } catch (err: any) {
      console.error("Fetch Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- FILTER ENGINE ---
  const applyFilters = (time: string, status: string, state: string, dist: string, partner: string, data = rawRequests) => {
    let result = data;

    // 1. Time Filter
    let startDate = new Date();
    let endDate = new Date();

    if (time === "today") {
      // Keep today
    } else if (time === "yesterday") {
      startDate.setDate(startDate.getDate() - 1);
      endDate.setDate(endDate.getDate() - 1);
    } else if (time === "thisweek") {
      startDate.setDate(startDate.getDate() - startDate.getDay()); 
    } else if (time === "month") {
      startDate.setDate(1); 
    } else if (time === "all") {
      startDate = new Date("2000-01-01");
    }

    const startStr = getLocalDateString(startDate);
    const endStr = getLocalDateString(endDate);

    result = result.filter(r => {
      const d = normalizeToYYYYMMDD(r.created_at);
      return d >= startStr && d <= endStr;
    });

    // 2. Status Filter
    if (status !== "All") {
      result = result.filter(r => r.status === status);
    }

    // 3. Geo & Partner Filters
    if (state !== "All") {
      result = result.filter(r => r.active_partners?.locations?.state === state);
    }
    if (dist !== "All") {
      result = result.filter(r => r.active_partners?.locations?.dist === dist);
    }
    if (partner !== "All") {
      result = result.filter(r => `${r.active_partners?.partner_name} (${r.active_partners?.locations?.center_name})` === partner);
    }

    setTimeFilter(time);
    setStatusFilter(status);
    setStateFilter(state);
    setDistFilter(dist);
    setPartnerFilter(partner);
    setFilteredRequests(result);
  };

  // --- ACTION ENGINE & PRODUCTIVITY MATRIX TELEMETRY ---
  const handleAction = async (req: any, newStatus: 'Approved' | 'Dispatched' | 'Rejected') => {
    let reason = "";
    if (newStatus === 'Rejected') {
      const input = prompt("Please provide a reason for rejecting this stock request:");
      if (!input || input.trim().length < 4) return alert("A valid reason is required to reject a request.");
      reason = input;
    } else {
      if (!confirm(`Mark this ${req.stock_type} stock request as ${newStatus}?`)) return;
    }

    setProcessingId(req.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Authentication error.");

      // 1. Update Core Logistics Record
      const { error } = await supabase.from("stock_requests").update({ status: newStatus }).eq("id", req.id);
      if (error) throw error;

      // 2. PRODUCTIVITY MATRIX TELEMETRY
      let actionType = 'UPDATE';
      if (newStatus === 'Approved') actionType = 'APPROVAL';
      if (newStatus === 'Dispatched') actionType = 'DISPATCH';
      if (newStatus === 'Rejected') actionType = 'REJECTION';

      await supabase.from('staff_activity_logs').insert([{
        staff_id: user.id,
        staff_email: user.email,
        action_type: actionType,
        module: 'LOGISTICS',
        target_id: req.id,
        details: `Marked stock request for ${req.qty}x ${req.stock_type} as ${newStatus}.${reason ? ` Reason: ${reason}` : ''}`
      }]);

      // 3. Dispatch Partner Dashboard Alert
      const alertMsg = newStatus === 'Rejected' 
        ? `Your request for ${req.qty}x ${req.stock_type} was Rejected. Reason: ${reason}`
        : newStatus === 'Dispatched' 
        ? `Physical Inventory Alert: Your request for ${req.qty}x ${req.stock_type} has been DISPATCHED via courier.`
        : `Digital Transfer Alert: Your request for ${req.qty}x ${req.stock_type} balance has been APPROVED and transferred.`;

      await supabase.from("partner_messages").insert([{
        partner_id: req.partner_id,
        subject: `📦 Stock Update: ${req.stock_type} - ${newStatus}`,
        body: alertMsg
      }]);

      // 4. Optimistic UI Data Update
      const updatedRaw = rawRequests.map(r => r.id === req.id ? { ...r, status: newStatus } : r);
      setRawRequests(updatedRaw);
      applyFilters(timeFilter, statusFilter, stateFilter, distFilter, partnerFilter, updatedRaw);

    } catch (err: any) {
      alert("Error processing action: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  // --- CSV EXPORT ENGINE ---
  const downloadCSV = () => {
    if (filteredRequests.length === 0) return alert("No data to export.");

    const headers = ["Request Date", "State", "District", "Center / Partner", "Stock Type", "CTOP No", "Quantity", "Amount", "Comm %", "Status"];
    
    const csvContent = [
      headers.join(","),
      ...filteredRequests.map(r => {
        const p = r.active_partners;
        const loc = p?.locations;
        return [
          sanitizeCSV(new Date(r.created_at).toLocaleDateString('en-IN')),
          sanitizeCSV(loc?.state || 'N/A'),
          sanitizeCSV(loc?.dist || 'N/A'),
          sanitizeCSV(`${p?.partner_name} (${loc?.center_name || ''})`),
          sanitizeCSV(r.stock_type),
          sanitizeCSV(r.ctop_no || 'N/A'),
          sanitizeCSV(r.qty),
          sanitizeCSV(r.amount),
          sanitizeCSV(r.commission_percent || '0'),
          sanitizeCSV(r.status)
        ].join(",");
      })
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Logistics_${statusFilter}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-green-500 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-6 gap-4">
          <div>
            <Link href="/dashboard" className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-block">
              &larr; Back to Admin Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
              <span className="text-4xl">📦</span> Logistics & Supply Command
            </h1>
            <p className="text-slate-500 font-medium mt-1">Manage physical SIM dispatches and digital CBP/CTOP balance transfers.</p>
          </div>
          <button 
            onClick={downloadCSV}
            className="bg-slate-900 hover:bg-slate-800 text-white font-black px-6 py-3 rounded-lg shadow transition flex items-center gap-2"
          >
            📥 Export Logistics CSV
          </button>
        </div>

        {/* MASTER FILTER ENGINE */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          
          {/* Row 1: Time & Status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 flex bg-slate-100 rounded-lg p-1 overflow-x-auto border border-slate-200">
              {['today', 'yesterday', 'thisweek', 'month', 'all'].map(mode => (
                <button 
                  key={mode} 
                  onClick={() => applyFilters(mode, statusFilter, stateFilter, distFilter, partnerFilter)} 
                  className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-wider transition whitespace-nowrap flex-1 ${timeFilter === mode ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  {mode === 'thisweek' ? 'This Week' : mode}
                </button>
              ))}
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Stock Status</label>
              <select 
                value={statusFilter} 
                onChange={e => applyFilters(timeFilter, e.target.value, stateFilter, distFilter, partnerFilter)} 
                className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-green-500"
              >
                <option value="All">All Statuses</option>
                <option value="Pending">⏳ Pending Action</option>
                <option value="Approved">✅ Approved (Digital Transfer)</option>
                <option value="Dispatched">🚚 Dispatched (Physical Send)</option>
                <option value="Rejected">❌ Rejected</option>
              </select>
            </div>
          </div>

          {/* Row 2: Geo & Partner Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">State Filter</label>
              <select value={stateFilter} onChange={e => applyFilters(timeFilter, statusFilter, e.target.value, distFilter, partnerFilter)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-green-500">
                <option value="All">All States</option>
                {dropdowns.states.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">District Filter</label>
              <select value={distFilter} onChange={e => applyFilters(timeFilter, statusFilter, stateFilter, e.target.value, partnerFilter)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-green-500">
                <option value="All">All Districts</option>
                {dropdowns.dists.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Center / Partner Filter</label>
              <select value={partnerFilter} onChange={e => applyFilters(timeFilter, statusFilter, stateFilter, distFilter, e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-green-500">
                <option value="All">All Partners</option>
                {dropdowns.partners.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          </div>

        </div>

        {/* METRICS BANNER */}
        <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 flex justify-between items-center text-white shadow-md">
          <div>
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Currently Viewing</p>
            <p className="font-black text-lg">{filteredRequests.length} Requests</p>
          </div>
          <div className="flex gap-6">
            <div className="text-right">
              <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Digital Requests</p>
              <p className="font-black text-xl text-blue-400">{filteredRequests.filter(r => r.stock_type !== 'SIM').length}</p>
            </div>
            <div className="text-right border-l border-slate-700 pl-6">
              <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest">Physical SIMs</p>
              <p className="font-black text-xl text-emerald-400">{filteredRequests.filter(r => r.stock_type === 'SIM').reduce((acc, r) => acc + Number(r.qty), 0)} Qty</p>
            </div>
          </div>
        </div>

        {/* LOGISTICS DATA GRID */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-4 font-black">Date Requested</th>
                  <th className="p-4 font-black">Geography & Partner</th>
                  <th className="p-4 font-black">Stock Required</th>
                  <th className="p-4 font-black text-right">Value (₹)</th>
                  <th className="p-4 font-black text-center">Status</th>
                  <th className="p-4 font-black text-center">Action Engine</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-slate-400 font-bold">No requests match the current filters.</td>
                  </tr>
                ) : (
                  filteredRequests.map(req => {
                    const loc = req.active_partners?.locations;
                    const isSIM = req.stock_type === 'SIM';
                    
                    return (
                      <tr key={req.id} className="hover:bg-slate-50 transition">
                        
                        <td className="p-4">
                          <p className="font-black text-slate-900">{new Date(req.created_at).toLocaleDateString('en-IN')}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                            {new Date(req.created_at).toLocaleTimeString('en-IN', {hour: '2-digit', minute:'2-digit'})}
                          </p>
                        </td>
                        
                        <td className="p-4">
                          <p className="font-black text-blue-700">{req.active_partners?.partner_name}</p>
                          <p className="text-xs font-bold text-slate-500">{loc?.center_name}</p>
                          <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">{loc?.dist}, {loc?.state}</p>
                        </td>
                        
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className={`text-xl ${isSIM ? 'opacity-100' : 'opacity-50'}`}>{isSIM ? '📦' : '💻'}</span>
                            <div>
                              <p className="font-black text-lg text-slate-800">{req.qty}x <span className={isSIM ? 'text-emerald-600' : 'text-blue-600'}>{req.stock_type}</span></p>
                              {req.stock_type === 'CTOP' && req.ctop_no && (
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                  No: {req.ctop_no} {req.commission_percent > 0 ? <span className="text-amber-600">({req.commission_percent}%)</span> : null}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="p-4 text-right">
                          {req.amount > 0 ? (
                            <p className="text-lg font-black text-slate-800">₹{Number(req.amount).toLocaleString('en-IN')}</p>
                          ) : (
                            <span className="text-[10px] bg-slate-200 text-slate-600 font-black uppercase tracking-widest px-2 py-1 rounded border border-slate-300">
                              Pure Qty (OCSC)
                            </span>
                          )}
                        </td>

                        <td className="p-4 text-center">
                          <span className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest border ${
                            req.status === 'Approved' ? 'bg-blue-100 text-blue-700 border-blue-200' : 
                            req.status === 'Dispatched' ? 'bg-green-100 text-green-700 border-green-200' : 
                            req.status === 'Rejected' ? 'bg-red-100 text-red-700 border-red-200' : 
                            'bg-yellow-100 text-yellow-700 border-yellow-200'
                          }`}>
                            {req.status}
                          </span>
                        </td>

                        <td className="p-4">
                          {req.status === 'Pending' ? (
                            <div className="flex justify-center gap-2">
                              {/* Dynamic Button based on Physical vs Digital Stock */}
                              {isSIM ? (
                                <button 
                                  onClick={() => handleAction(req, 'Dispatched')}
                                  disabled={processingId === req.id}
                                  className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded font-black text-[10px] uppercase tracking-widest transition shadow-sm"
                                >
                                  Mark Dispatched
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleAction(req, 'Approved')}
                                  disabled={processingId === req.id}
                                  className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded font-black text-[10px] uppercase tracking-widest transition shadow-sm"
                                >
                                  Approve Top-Up
                                </button>
                              )}
                              
                              <button 
                                onClick={() => handleAction(req, 'Rejected')}
                                disabled={processingId === req.id}
                                className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded font-black text-[10px] uppercase tracking-widest transition shadow-sm"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">Locked</p>
                          )}
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}