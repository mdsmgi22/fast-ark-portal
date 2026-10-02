"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

const getLocalDateString = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

export default function StaffProductivityDashboard() {
  const [logs, setLogs] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // [FIX 3]: Initialize as an empty string to prevent SSR Hydration Crashes
  const [dateFilter, setDateFilter] = useState("");

  // Safely mount the current date strictly on the client side
  useEffect(() => {
    setDateFilter(getLocalDateString(new Date()));
  }, []);

  // Fetch only when dateFilter is safely populated
  useEffect(() => {
    if (dateFilter) fetchAnalytics();
  }, [dateFilter]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const { data: staff } = await supabase.from('back_office_staff').select('email, name, role');
      if (staff) setStaffList(staff);

      const { data: activityLogs } = await supabase
        .from('staff_activity_logs')
        .select('*')
        .gte('created_at', `${dateFilter}T00:00:00+05:30`)
        .lte('created_at', `${dateFilter}T23:59:59+05:30`);

      setLogs(activityLogs || []);
    } catch (err) {
      console.error("Error fetching telemetry:", err);
    } finally {
      setLoading(false);
    }
  };

  const chartData = staffList.map(staffMember => {
    const email = staffMember?.email || '';
    const name = staffMember?.name || 'Unknown';
    const staffLogs = logs.filter(log => log?.staff_email === email);
    
    return {
      name: name.split(' ')[0], 
      Onboarding: staffLogs.filter(l => l?.module === 'ONBOARDING' || l?.module === 'APPLICATIONS').length,
      Deposits: staffLogs.filter(l => l?.module === 'DEPOSITS').length,
      Audits: staffLogs.filter(l => l?.module === 'SALES' || l?.module === 'MANAGER_MIS').length, 
      Logistics: staffLogs.filter(l => l?.module === 'LOGISTICS').length,
      Messages: staffLogs.filter(l => l?.module === 'MESSAGES').length,
      total: staffLogs.length
    };
  }).filter(data => data.total > 0); 

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-slate-50 min-h-screen font-sans">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-slate-200 pb-6 gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Staff Productivity Matrix</h1>
          <p className="text-slate-500 font-medium mt-1">Real-time performance tracking across all enterprise modules.</p>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <input 
            type="date" 
            value={dateFilter} 
            onChange={(e) => setDateFilter(e.target.value)} 
            className="w-full md:w-auto border-2 border-slate-300 p-2.5 rounded-lg font-bold text-slate-700 outline-none focus:border-blue-600 bg-white"
          />
          <Link href="/dashboard" className="shrink-0 text-blue-600 font-bold hover:underline bg-blue-50 px-5 py-3 rounded-lg border border-blue-200 shadow-sm">
            &larr; Back
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* CHIEF KPI METRICS */}
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-slate-800">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Total Actions</p>
            <p className="text-3xl font-black text-slate-800">{loading ? "..." : logs.length}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Apps Processed</p>
            <p className="text-3xl font-black text-slate-800">{loading ? "..." : logs.filter(l => l.module === 'ONBOARDING' || l.module === 'APPLICATIONS').length}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-amber-500">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Deposits Audited</p>
            <p className="text-3xl font-black text-slate-800">{loading ? "..." : logs.filter(l => l.module === 'DEPOSITS').length}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-purple-500">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Ledger & MIS Audits</p>
            <p className="text-3xl font-black text-slate-800">{loading ? "..." : logs.filter(l => l.module === 'SALES' || l.module === 'MANAGER_MIS').length}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-pink-500">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Alerts Sent</p>
            <p className="text-3xl font-black text-slate-800">{loading ? "..." : logs.filter(l => l.module === 'MESSAGES').length}</p>
          </div>
        </div>

        {/* PERFORMANCE CHART */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-black text-slate-800">Staff Output by Module</h2>
            {loading && <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>}
          </div>
          
          {!loading && chartData.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-slate-400 font-bold">No activity recorded for this date.</div>
          ) : (
            <div className="w-full h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontWeight: 'bold' }} cursor={{fill: '#f8fafc'}} />
                  <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '20px', fontWeight: 'bold' }} />
                  <Bar dataKey="Onboarding" stackId="a" fill="#3b82f6" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="Deposits" stackId="a" fill="#f59e0b" />
                  <Bar dataKey="Audits" stackId="a" fill="#a855f7" />
                  <Bar dataKey="Logistics" stackId="a" fill="#22c55e" />
                  <Bar dataKey="Messages" stackId="a" fill="#ec4899" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* RAW AUDIT FEED */}
        <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[400px]">
          <div className="bg-slate-900 p-4 flex justify-between items-center shrink-0">
            <h2 className="text-sm font-black uppercase tracking-widest text-white">Live Audit Feed</h2>
            <span className="bg-slate-800 text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-700">{logs.length} Events</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {loading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-slate-200 animate-pulse rounded border border-slate-300"></div>)}
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <span className="text-3xl mb-2">☕</span>
                <p className="text-sm font-bold">System idle.</p>
                <p className="text-xs">No actions logged yet today.</p>
              </div>
            ) : (
              [...logs].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()).map(log => (
                <div key={log.id} className="bg-white border border-slate-200 p-3 rounded-lg shadow-sm hover:border-blue-300 transition">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-black text-slate-800 text-sm truncate pr-2">
                      {(log.staff_email || 'System').split('@')[0]}
                    </span>
                    <span className="text-[9px] font-black text-slate-400 uppercase shrink-0">
                      {new Date(log.created_at || 0).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase mb-1.5 border ${
                      log.action_type === 'APPROVAL' || log.action_type === 'VERIFICATION' || log.action_type === 'STOCK_APPROVED' || log.action_type === 'MIS_CLOSURE' ? 'bg-green-50 text-green-700 border-green-200' :
                      log.action_type === 'REJECTION' || log.action_type === 'DISCREPANCY' || log.action_type === 'STOCK_REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                      log.action_type === 'DISPATCH_ALERT' ? 'bg-pink-50 text-pink-700 border-pink-200' :
                      'bg-purple-50 text-purple-700 border-purple-200'
                    }`}>
                      {log.action_type} • {log.module}
                    </span>
                    <p className="text-xs text-slate-600 font-medium leading-relaxed break-words">{log.details}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}