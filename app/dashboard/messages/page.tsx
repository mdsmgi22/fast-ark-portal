"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// --- Date Normalizers (IST Safe) ---
const getLocalDateString = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

const normalizeToYYYYMMDD = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes('-')) return dateStr.split('T')[0];
  return dateStr;
};

export default function PartnerAlertsCommand() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // --- STATE 1: Data Engines ---
  const [activePartners, setActivePartners] = useState<any[]>([]);
  const [rawMessages, setRawMessages] = useState<any[]>([]);
  const [filteredMessages, setFilteredMessages] = useState<any[]>([]);
  
  // --- STATE 2: Form Engine ---
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    targetPartnerId: "",
    subjectCategory: "",
    customSubject: "",
    body: ""
  });

  // --- STATE 3: Filter Engine ---
  const [timeFilter, setTimeFilter] = useState("month"); 
  const [stateFilter, setStateFilter] = useState("All");
  const [distFilter, setDistFilter] = useState("All");
  const [partnerFilter, setPartnerFilter] = useState("All");
  
  const [dropdowns, setDropdowns] = useState({ states: [] as string[], dists: [] as string[], partners: [] as string[] });

  // Pre-defined strict subjects
  const SUBJECT_OPTIONS = [
    "Deposit pending notice",
    "Sales target not achieved",
    "SIM sales not happening",
    "Deposit slips missing",
    "Regular cash hold",
    "Other (Custom Subject)"
  ];

  useEffect(() => {
    fetchAlertsArchitecture();
  }, []);

  const fetchAlertsArchitecture = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      // 1. Fetch Active Partners for the Send Form
      const { data: partnersData } = await supabase
        .from("active_partners")
        .select("id, partner_name, locations(state, dist, center_name)")
        .eq("status", "Active")
        .order("partner_name", { ascending: true });

      if (partnersData) setActivePartners(partnersData);

      // 2. Fetch Historical Messages (Last 90 days for performance)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const { data: messagesData, error: msgError } = await supabase
        .from("partner_messages")
        .select(`
          *,
          active_partners ( partner_name, locations (state, dist, center_name) )
        `)
        .gte("created_at", getLocalDateString(ninetyDaysAgo))
        .order("created_at", { ascending: false });

      if (msgError) throw msgError;

      const messages = messagesData || [];
      setRawMessages(messages);

      // 3. Extract unique geographical data for filters
      const stNames = new Set<string>();
      const dtNames = new Set<string>();
      const pNames = new Set<string>();
      
      messages.forEach(m => {
        const l = m.active_partners?.locations;
        if (l?.state) stNames.add(l.state);
        if (l?.dist) dtNames.add(l.dist);
        if (m.active_partners?.partner_name) {
          pNames.add(`${m.active_partners.partner_name} (${l?.center_name})`);
        }
      });
      
      setDropdowns({ 
        states: Array.from(stNames).sort(),
        dists: Array.from(dtNames).sort(),
        partners: Array.from(pNames).sort() 
      });

      // Apply Initial Filters (This Month)
      applyFilters("month", "All", "All", "All", messages);

    } catch (err: any) {
      console.error("Fetch Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- FILTER ENGINE ---
  const applyFilters = (time: string, state: string, dist: string, partner: string, data = rawMessages) => {
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

    result = result.filter(m => {
      const d = normalizeToYYYYMMDD(m.created_at);
      return d >= startStr && d <= endStr;
    });

    // 2. Geo & Partner Filters
    if (state !== "All") {
      result = result.filter(m => m.active_partners?.locations?.state === state);
    }
    if (dist !== "All") {
      result = result.filter(m => m.active_partners?.locations?.dist === dist);
    }
    if (partner !== "All") {
      result = result.filter(m => `${m.active_partners?.partner_name} (${m.active_partners?.locations?.center_name})` === partner);
    }

    setTimeFilter(time);
    setStateFilter(state);
    setDistFilter(dist);
    setPartnerFilter(partner);
    setFilteredMessages(result);
  };

  // --- DISPATCH ENGINE & AUDIT LOGGING ---
  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.targetPartnerId) return alert("Select a partner or broadcast to all.");
    if (!form.subjectCategory) return alert("Select a subject heading.");
    if (form.subjectCategory === "Other (Custom Subject)" && form.customSubject.trim().length < 5) return alert("Enter a valid custom subject.");
    if (form.body.trim().length < 10) return alert("Message body must be at least 10 characters.");

    const finalSubject = form.subjectCategory === "Other (Custom Subject)" ? form.customSubject : form.subjectCategory;
    const isBroadcast = form.targetPartnerId === "BROADCAST_ALL";

    if (!confirm(`Are you sure you want to dispatch this alert to ${isBroadcast ? 'ALL ACTIVE PARTNERS' : 'the selected partner'}?`)) return;

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Staff authentication failed.");

      let payloads = [];

      if (isBroadcast) {
        payloads = activePartners.map(p => ({
          partner_id: p.id,
          subject: `📢 BROADCAST: ${finalSubject}`,
          body: form.body
        }));
      } else {
        payloads = [{
          partner_id: form.targetPartnerId,
          subject: `🚨 ALERT: ${finalSubject}`,
          body: form.body
        }];
      }

      // 1. Bulk Insert Messages
      const { error: msgError } = await supabase.from("partner_messages").insert(payloads);
      if (msgError) throw msgError;

      // 2. PRODUCTIVITY MATRIX TELEMETRY (Audit Log)
      await supabase.from('staff_activity_logs').insert([{
        staff_id: user.id,
        staff_email: user.email,
        action_type: 'DISPATCH_ALERT',
        module: 'MESSAGES',
        target_id: isBroadcast ? 'ALL' : form.targetPartnerId,
        details: `Dispatched alert [${finalSubject}] to ${isBroadcast ? 'ALL PARTNERS' : '1 Partner'}.`
      }]);

      alert("✅ Alert(s) Dispatched Successfully!");
      
      // Reset Form & Refresh Grid
      setForm({ targetPartnerId: "", subjectCategory: "", customSubject: "", body: "" });
      fetchAlertsArchitecture();

    } catch (err: any) {
      alert("Error dispatching alert: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-purple-600 rounded-full animate-spin"></div>
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
              <span className="text-4xl">💬</span> Partner Alerts Command
            </h1>
            <p className="text-slate-500 font-medium mt-1">Dispatch strict compliance notices and review alert history records.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT: DISPATCH FORM */}
          <div className="lg:col-span-4 bg-white rounded-xl shadow-sm border border-slate-200 p-6 sticky top-8">
            <h2 className="font-black text-lg text-slate-800 border-b border-slate-100 pb-3 mb-5">Dispatch New Alert</h2>
            
            <form onSubmit={handleDispatch} className="space-y-4">
              
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Recipient *</label>
                <select 
                  required 
                  value={form.targetPartnerId} 
                  onChange={e => setForm({...form, targetPartnerId: e.target.value})} 
                  className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2.5 outline-none focus:border-purple-500"
                >
                  <option value="" disabled>-- Select Franchise Partner --</option>
                  <option value="BROADCAST_ALL" className="font-black text-purple-700 bg-purple-50">📢 BROADCAST TO ALL ACTIVE PARTNERS</option>
                  {activePartners.map(p => (
                    <option key={p.id} value={p.id}>{p.partner_name} ({p.locations?.center_name})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Strict Subject Heading *</label>
                <select 
                  required 
                  value={form.subjectCategory} 
                  onChange={e => setForm({...form, subjectCategory: e.target.value, customSubject: ""})} 
                  className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2.5 outline-none focus:border-purple-500"
                >
                  <option value="" disabled>-- Select Notice Type --</option>
                  {SUBJECT_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              {form.subjectCategory === "Other (Custom Subject)" && (
                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="text-[10px] font-black text-purple-600 uppercase tracking-widest block mb-1.5">Custom Subject Line *</label>
                  <input 
                    required 
                    type="text" 
                    value={form.customSubject} 
                    onChange={e => setForm({...form, customSubject: e.target.value.toUpperCase()})} 
                    placeholder="ENTER CUSTOM HEADER..."
                    className="w-full border-2 border-purple-300 p-2.5 rounded-lg outline-none focus:border-purple-600 font-black uppercase text-sm" 
                  />
                </div>
              )}

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Alert Message Body *</label>
                <textarea 
                  required 
                  rows={5}
                  value={form.body} 
                  onChange={e => setForm({...form, body: e.target.value})} 
                  placeholder="Type the detailed compliance warning here..."
                  className="w-full border-2 border-slate-200 p-3 rounded-lg outline-none focus:border-purple-500 text-sm font-medium" 
                />
              </div>

              <button 
                type="submit" 
                disabled={isSubmitting} 
                className="w-full bg-slate-900 hover:bg-purple-600 text-white font-black py-3.5 rounded-lg shadow-md transition disabled:opacity-50 tracking-widest uppercase text-sm mt-2"
              >
                {isSubmitting ? "Dispatching..." : "Send Priority Alert"}
              </button>
            </form>
          </div>

          {/* RIGHT: HISTORY & REPORTING GRID */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* FILTER ENGINE */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex bg-slate-100 rounded-lg p-1 overflow-x-auto border border-slate-200">
                  {['today', 'yesterday', 'thisweek', 'month', 'all'].map(mode => (
                    <button 
                      key={mode} 
                      onClick={() => applyFilters(mode, stateFilter, distFilter, partnerFilter)} 
                      className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-wider transition whitespace-nowrap flex-1 ${timeFilter === mode ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:text-slate-900'}`}
                    >
                      {mode === 'thisweek' ? 'This Week' : mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">State Filter</label>
                  <select value={stateFilter} onChange={e => applyFilters(timeFilter, e.target.value, distFilter, partnerFilter)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-purple-500">
                    <option value="All">All States</option>
                    {dropdowns.states.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">District Filter</label>
                  <select value={distFilter} onChange={e => applyFilters(timeFilter, stateFilter, e.target.value, partnerFilter)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-purple-500">
                    <option value="All">All Districts</option>
                    {dropdowns.dists.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Center / Partner Filter</label>
                  <select value={partnerFilter} onChange={e => applyFilters(timeFilter, stateFilter, distFilter, e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2 outline-none focus:border-purple-500">
                    <option value="All">All Partners</option>
                    {dropdowns.partners.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* MESSAGE HISTORY DATA GRID */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
              <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
                <div>
                  <h3 className="font-black tracking-widest uppercase text-xs">Alerts Log & History</h3>
                  <p className="text-[9px] text-slate-400 font-bold mt-1 tracking-widest">PERMANENT RECORD OF SENT NOTICES</p>
                </div>
                <span className="bg-slate-800 text-purple-400 font-black px-3 py-1 rounded text-[10px] uppercase tracking-widest border border-slate-700">
                  {filteredMessages.length} Alerts Dispatched
                </span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-4 font-black">Date & Time</th>
                      <th className="p-4 font-black">Recipient Profile</th>
                      <th className="p-4 font-black">Notice Category & Content</th>
                      <th className="p-4 font-black text-center">Partner Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMessages.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-12 text-center text-slate-400 font-bold">No message records found for current filters.</td>
                      </tr>
                    ) : (
                      filteredMessages.map(msg => {
                        const loc = msg.active_partners?.locations;
                        
                        return (
                          <tr key={msg.id} className={`transition ${!msg.is_read ? 'bg-purple-50/20' : 'hover:bg-slate-50'}`}>
                            
                            <td className="p-4 align-top">
                              <p className="font-black text-slate-900">{new Date(msg.created_at).toLocaleDateString('en-IN')}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                {new Date(msg.created_at).toLocaleTimeString('en-IN', {hour: '2-digit', minute:'2-digit'})}
                              </p>
                            </td>
                            
                            <td className="p-4 align-top">
                              <p className="font-black text-blue-700">{msg.active_partners?.partner_name}</p>
                              <p className="text-xs font-bold text-slate-500">{loc?.center_name}</p>
                              <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">{loc?.dist}, {loc?.state}</p>
                            </td>
                            
                            <td className="p-4 whitespace-normal max-w-sm align-top">
                              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border mb-2 inline-block ${
                                msg.subject.includes('BROADCAST') ? 'bg-purple-100 text-purple-800 border-purple-200' : 'bg-red-50 text-red-700 border-red-200'
                              }`}>
                                {msg.subject}
                              </span>
                              <p className="text-xs text-slate-700 font-medium leading-relaxed bg-slate-50 p-3 border border-slate-100 rounded-lg">
                                {msg.body}
                              </p>
                            </td>

                            <td className="p-4 text-center align-top">
                              {msg.is_read ? (
                                <div className="flex flex-col items-center">
                                  <span className="text-green-500 text-lg">✅</span>
                                  <p className="text-[9px] font-black text-green-700 uppercase tracking-widest mt-1">Read / Seen</p>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center">
                                  <span className="text-amber-500 text-lg animate-pulse">⏳</span>
                                  <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mt-1">Unread by Partner</p>
                                </div>
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
      </div>
    </div>
  );
}