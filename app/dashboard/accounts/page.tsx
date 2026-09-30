"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// --- Security: CSV Sanitizer to prevent Macro Injection Vulnerabilities ---
const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
  // Prefix formulas with a single quote to prevent Macro execution in Excel
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
};

export default function AccountantVerificationDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // --- STATE 1: Data Engine ---
  const [rawDeposits, setRawDeposits] = useState<any[]>([]);
  const [filteredDeposits, setFilteredDeposits] = useState<any[]>([]);
  
  // --- STATE 2: Filtering Engine ---
  const [statusFilter, setStatusFilter] = useState("Pending"); // Default to actionable items
  const [geoFilter, setGeoFilter] = useState({ state: "All", dist: "All", location: "All" });
  const [dropdowns, setDropdowns] = useState({ states: [] as string[], dists: [] as string[], locations: [] as string[] });

  // --- STATE 3: Action Engine ---
  const [processingId, setProcessingId] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    fetchDeposits();
  }, []);

  const fetchDeposits = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      // Apply a 90-day time bound to prevent "Select *" browser memory crashes
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data, error } = await supabase
        .from("partner_deposits")
        .select(`
          *,
          active_partners ( partner_name, email, locations (state, dist, center_name) )
        `)
        .gte("created_at", ninetyDaysAgo.toISOString())
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      
      const deposits = data || [];
      setRawDeposits(deposits);

      // Extract unique geographical filters for dynamic dropdowns
      const states = new Set<string>();
      const dists = new Set<string>();
      const locs = new Set<string>();

      deposits.forEach(d => {
        const l = d.active_partners?.locations;
        if (l) {
          if (l.state) states.add(l.state);
          if (l.dist) dists.add(l.dist);
          if (l.center_name) locs.add(l.center_name);
        }
      });

      setDropdowns({
        states: Array.from(states).sort(),
        dists: Array.from(dists).sort(),
        locations: Array.from(locs).sort()
      });

    } catch (err: any) {
      console.error("Error fetching deposits:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // Run filtering engine whenever data or filters change
  useEffect(() => {
    let result = rawDeposits;

    // Filter by Status (Safely handles both 'Pending' and 'Pending Verification' variants)
    if (statusFilter !== "All") {
      if (statusFilter === "Pending") {
        result = result.filter(d => d.status?.includes("Pending"));
      } else {
        result = result.filter(d => d.status === statusFilter);
      }
    }

    // Filter by Geography
    if (geoFilter.state !== "All") {
      result = result.filter(d => d.active_partners?.locations?.state === geoFilter.state);
    }
    if (geoFilter.dist !== "All") {
      result = result.filter(d => d.active_partners?.locations?.dist === geoFilter.dist);
    }
    if (geoFilter.location !== "All") {
      result = result.filter(d => d.active_partners?.locations?.center_name === geoFilter.location);
    }

    setFilteredDeposits(result);
  }, [rawDeposits, statusFilter, geoFilter]);

  // --- SECURE VAULT DOCUMENT VIEWER ---
  const handleViewSecureSlip = async (path: string) => {
    if (!path) return;
    if (path.startsWith("http")) {
      window.open(path, "_blank");
      return;
    }

    const { data, error } = await supabase.storage.from("deposit-slips").createSignedUrl(path, 60);
    
    if (error || !data) {
      alert("Security Error: Unauthorized access or document missing.");
      return;
    }
    
    window.open(data.signedUrl, "_blank");
  };

  // --- CORE ACTION ENGINE ---
  const handleUpdateStatus = async (dep: any, newStatus: 'Verified' | 'Discrepancy') => {
    if (newStatus === 'Verified' && !confirm(`Confirm verification of ₹${dep.deposit_amount}? This will permanently clear this amount from the partner's pending ledger.`)) return;
    if (newStatus === 'Discrepancy' && rejectionReason.trim().length < 5) return alert("You must provide a detailed reason for flagging a discrepancy.");
    
    setProcessingId(dep.id);
    
    try {
      const updatePayload: any = { status: newStatus };
      if (newStatus === 'Discrepancy') {
        updatePayload.rejection_reason = rejectionReason;
      }

      // 1. Execute Core Ledger Update
      const { error } = await supabase.from("partner_deposits").update(updatePayload).eq("id", dep.id);
      if (error) throw error;
      
      // 2. PHASE 2 TELEMETRY: Insert Staff Activity Log
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.from('staff_activity_logs').insert([{
          staff_id: session.user.id,
          staff_email: session.user.email,
          action_type: newStatus === 'Verified' ? 'VERIFICATION' : 'DISCREPANCY',
          module: 'DEPOSITS',
          target_id: dep.id,
          details: newStatus === 'Verified' 
            ? `Cleared ₹${dep.deposit_amount} remittance` 
            : `Flagged discrepancy: ${rejectionReason}`
        }]);
      }

      // 3. Dispatch Alert to Partner Dashboard
      if (newStatus === 'Discrepancy') {
        await supabase.from("partner_messages").insert([{
          partner_id: dep.partner_id,
          subject: `🚨 Remittance Discrepancy: ${dep.deposit_date}`,
          body: `Your cash deposit of ₹${dep.deposit_amount} via ${dep.deposit_method} has been flagged by Accounts. Reason: ${rejectionReason}. Please contact the back office immediately.`
        }]);
      }

      // 4. Update UI: Modify the local state so the filter engine handles it instantly
      setRawDeposits(current => current.map(d => d.id === dep.id ? { ...d, status: newStatus, rejection_reason: newStatus === 'Discrepancy' ? rejectionReason : null } : d));
      setRejectingId(null);
      setRejectionReason("");
      
    } catch (err: any) {
      alert("Error updating status: " + err.message);
    } finally {
      setProcessingId("");
    }
  };

  const downloadCSV = () => {
    if (filteredDeposits.length === 0) return alert("No data to export for the current filters.");

    const headers = ["Date", "Partner Name", "State", "District", "Center", "Amount", "Method", "Reference No", "Status", "Remarks"];
    
    const csvContent = [
      headers.join(","),
      ...filteredDeposits.map(d => {
        const p = d.active_partners;
        const l = p?.locations;
        return [
          sanitizeCSV(new Date(d.created_at).toLocaleDateString('en-IN')),
          sanitizeCSV(p?.partner_name || 'N/A'),
          sanitizeCSV(l?.state || 'N/A'),
          sanitizeCSV(l?.dist || 'N/A'),
          sanitizeCSV(l?.center_name || 'N/A'),
          sanitizeCSV(d.deposit_amount),
          sanitizeCSV(d.deposit_method),
          sanitizeCSV(d.reference_no || 'N/A'),
          sanitizeCSV(d.status),
          sanitizeCSV(d.rejection_reason || d.exemption_reason || '')
        ].join(",");
      })
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FastArk_Deposits_${statusFilter}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  const totalFilteredAmount = filteredDeposits.reduce((sum, d) => sum + Number(d.deposit_amount || 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto bg-slate-50 min-h-screen font-sans">
      
      {/* HEADER & EXPORT */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-slate-200 pb-6">
        <div>
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline mb-2 inline-block">
            &larr; Back to Command Center
          </Link>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <span className="text-4xl">🏦</span> Accountant Portal
          </h1>
          <p className="text-slate-500 font-medium mt-1">Audit remittances, view history, and export ledger data.</p>
        </div>
        <button 
          onClick={downloadCSV}
          className="bg-slate-900 hover:bg-slate-800 text-white font-black px-6 py-3 rounded-lg shadow transition flex items-center gap-2"
        >
          📥 Export {statusFilter} CSV
        </button>
      </div>

      {/* MASTER FILTER ENGINE */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
        <div>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Deposit Status</label>
          <select 
            value={statusFilter} 
            onChange={e => setStatusFilter(e.target.value)} 
            className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2.5 outline-none focus:border-amber-500"
          >
            <option value="All">All Statuses</option>
            <option value="Pending">⏳ Pending Audit</option>
            <option value="Verified">✅ Verified (Approved)</option>
            <option value="Discrepancy">❌ Discrepancy (Rejected)</option>
          </select>
        </div>
        {(['state', 'dist', 'location'] as const).map(field => (
          <div key={field}>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
              Filter by {field === 'dist' ? 'District' : field === 'location' ? 'Center' : field}
            </label>
            <select 
              value={geoFilter[field]} 
              onChange={e => setGeoFilter({...geoFilter, [field]: e.target.value})} 
              className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2.5 outline-none focus:border-amber-500"
            >
              <option value="All">All {field}s</option>
              {(dropdowns as any)[field + 's'].map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* METRICS BANNER */}
      <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 flex justify-between items-center text-white shadow-md mb-8">
        <div>
          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Currently Viewing</p>
          <p className="font-black text-lg">{filteredDeposits.length} Records</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-amber-500 font-black uppercase tracking-widest">Filtered Cash Total</p>
          <p className="font-black text-3xl">₹{totalFilteredAmount.toLocaleString('en-IN')}</p>
        </div>
      </div>

      {/* RICH CARD LIST RENDER */}
      {filteredDeposits.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-xl border border-slate-200 shadow-sm">
          <div className="text-5xl mb-4">☕</div>
          <h2 className="text-2xl font-black text-slate-700">No Records Found</h2>
          <p className="text-slate-500 font-medium mt-2">No deposits match your current filters.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {filteredDeposits.map((dep) => (
            <div key={dep.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col lg:flex-row gap-6 hover:border-amber-300 transition-colors">
              
              {/* SECURE SLIP PREVIEW BLOCK */}
              <div className="w-full lg:w-64 shrink-0 flex flex-col justify-center items-center rounded-lg p-2">
                {dep.is_exempted ? (
                  <div className="text-center p-4 bg-slate-50 border border-slate-200 rounded-lg w-full h-full flex flex-col justify-center items-center">
                    <span className="text-4xl">⚠️</span>
                    <p className="text-[10px] font-black text-amber-600 mt-2 uppercase tracking-widest">Slip Exempted</p>
                  </div>
                ) : (
                  <button 
                    onClick={() => handleViewSecureSlip(dep.deposit_slip_url)} 
                    title="Generate Token & View"
                    className="block w-full h-full group relative bg-slate-50 rounded-lg p-6 border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50 transition"
                  >
                    <div className="flex flex-col items-center">
                      <span className="text-4xl mb-2 opacity-80 group-hover:opacity-100 transition">🔒</span>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-hover:text-blue-700 transition">Encrypted Vault</p>
                      <p className="text-[11px] font-black text-blue-600 mt-3 bg-blue-100 px-4 py-1.5 rounded-full uppercase tracking-wider">Decrypt & View ↗</p>
                    </div>
                  </button>
                )}
              </div>

              {/* Data Review Block */}
              <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-6 items-center">
                <div className="col-span-2 md:col-span-1">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Partner Profile</p>
                  <p className="font-black text-slate-900 text-lg leading-tight">{dep.active_partners?.partner_name || 'N/A'}</p>
                  <p className="text-xs text-slate-500 font-medium">{dep.active_partners?.locations?.center_name || 'N/A'}</p>
                  <p className="text-[10px] text-slate-400 uppercase mt-1">{dep.active_partners?.locations?.dist}, {dep.active_partners?.locations?.state}</p>
                </div>
                
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Date & Channel</p>
                  <p className="font-bold text-slate-900">{dep.deposit_date ? new Date(dep.deposit_date).toLocaleDateString('en-IN') : new Date(dep.created_at).toLocaleDateString('en-IN')}</p>
                  <p className="text-xs font-black text-blue-600 uppercase mt-0.5">{dep.deposit_method}</p>
                  <p className="text-[10px] text-slate-500 mt-1 font-bold">Ref: {dep.reference_no || 'N/A'}</p>
                </div>
                
                <div className="col-span-2 md:col-span-1 text-left lg:text-right">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Declared Amount</p>
                  <p className={`text-3xl font-black ${dep.status === 'Discrepancy' ? 'text-slate-400 line-through' : 'text-green-600'}`}>
                    ₹{Number(dep.deposit_amount).toLocaleString('en-IN')}
                  </p>
                </div>

                {dep.is_exempted && (
                  <div className="col-span-2 md:col-span-3 bg-amber-50 p-4 rounded-lg border border-amber-200">
                    <p className="text-[10px] text-amber-800 font-black uppercase tracking-widest mb-1">Missing Slip Exemption Claim</p>
                    <p className="text-sm font-medium text-amber-900">"{dep.exemption_reason}"</p>
                  </div>
                )}
              </div>

              {/* Dynamic Action & Status Block */}
              <div className="flex flex-col gap-3 shrink-0 w-full lg:w-56 justify-center border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6">
                
                {dep.status === 'Verified' ? (
                  <div className="flex flex-col items-center justify-center h-full text-green-600 p-4 bg-green-50 rounded-lg border border-green-200">
                    <span className="text-3xl mb-1">✅</span>
                    <p className="font-black uppercase tracking-widest text-xs">Verified & Cleared</p>
                  </div>
                ) : dep.status === 'Discrepancy' ? (
                  <div className="flex flex-col items-center justify-center h-full text-red-600 p-4 bg-red-50 rounded-lg border border-red-200">
                    <span className="text-3xl mb-1">❌</span>
                    <p className="font-black uppercase tracking-widest text-xs">Rejected</p>
                    <p className="text-[9px] mt-2 font-bold text-center text-red-800 border-t border-red-200 pt-2 w-full">Reason: {dep.rejection_reason || 'N/A'}</p>
                  </div>
                ) : rejectingId === dep.id ? (
                  <div className="animate-in fade-in zoom-in-95">
                    <label className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1 block">Reason for Flagging</label>
                    <textarea 
                      required 
                      rows={2} 
                      placeholder="e.g. Amount mismatch, blurry slip..."
                      className="w-full border-2 border-red-300 rounded p-2 text-sm outline-none focus:border-red-600 mb-2 bg-white"
                      value={rejectionReason} 
                      onChange={(e) => setRejectionReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleUpdateStatus(dep, 'Discrepancy')} 
                        disabled={processingId === dep.id} 
                        className="flex-1 bg-red-600 text-white font-bold py-2 rounded shadow-sm text-xs hover:bg-red-700 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button 
                        onClick={() => setRejectingId(null)} 
                        className="flex-1 bg-slate-200 text-slate-700 font-bold py-2 rounded text-xs hover:bg-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button 
                      onClick={() => handleUpdateStatus(dep, 'Verified')}
                      disabled={processingId === dep.id}
                      className="w-full bg-green-500 hover:bg-green-600 text-white font-black py-3.5 rounded-lg shadow-md transition disabled:opacity-50"
                    >
                      {processingId === dep.id ? "Processing..." : "Verify & Clear Ledger"}
                    </button>
                    <button 
                      onClick={() => setRejectingId(dep.id)}
                      disabled={processingId === dep.id}
                      className="w-full bg-white hover:bg-red-50 text-red-600 border-2 border-red-200 hover:border-red-600 font-black py-2.5 rounded-lg transition shadow-sm disabled:opacity-50"
                    >
                      Reject / Flag Discrepancy
                    </button>
                  </>
                )}
              </div>
              
            </div>
          ))}
        </div>
      )}
    </div>
  );
}