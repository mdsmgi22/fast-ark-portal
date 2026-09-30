"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

// --- Security: CSV Sanitizer ---
const sanitizeCSV = (val: unknown): string => {
  let str = String(val || "").replace(/"/g, '""');
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
  const [statusFilter, setStatusFilter] = useState("Pending"); 
  const [geoFilter, setGeoFilter] = useState({ state: "All", dist: "All", location: "All" });
  const [dropdowns, setDropdowns] = useState({ states: [] as string[], dists: [] as string[], locations: [] as string[] });

  // --- STATE 3: Parallel Viewer Engine ---
  const [selectedDeposit, setSelectedDeposit] = useState<any | null>(null);
  const [secureImageUrl, setSecureImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // --- STATE 4: Action Engine ---
  const [processingId, setProcessingId] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  useEffect(() => {
    fetchDeposits();
  }, []);

  const fetchDeposits = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

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

  useEffect(() => {
    let result = rawDeposits;
    if (statusFilter !== "All") {
      if (statusFilter === "Pending") {
        result = result.filter(d => d.status?.includes("Pending"));
      } else {
        result = result.filter(d => d.status === statusFilter);
      }
    }
    if (geoFilter.state !== "All") result = result.filter(d => d.active_partners?.locations?.state === geoFilter.state);
    if (geoFilter.dist !== "All") result = result.filter(d => d.active_partners?.locations?.dist === geoFilter.dist);
    if (geoFilter.location !== "All") result = result.filter(d => d.active_partners?.locations?.center_name === geoFilter.location);

    setFilteredDeposits(result);
  }, [rawDeposits, statusFilter, geoFilter]);

  // --- SECURE DECRYPTION ENGINE (Fires when a row is clicked) ---
  useEffect(() => {
    const decryptImage = async () => {
      setSecureImageUrl(null);
      setImageError(null); 
      
      if (!selectedDeposit) return;
      if (selectedDeposit.is_exempted || !selectedDeposit.deposit_slip_url) return;

      setImageLoading(true);
      try {
        if (selectedDeposit.deposit_slip_url.startsWith("http")) {
          setSecureImageUrl(selectedDeposit.deposit_slip_url);
          return;
        }

        const { data, error } = await supabase.storage
          .from("deposit-slips")
          .createSignedUrl(selectedDeposit.deposit_slip_url, 3600); 
        
        if (error) throw error; 
        if (!data) throw new Error("No data returned from vault.");
        
        setSecureImageUrl(data.signedUrl);
      } catch (err: any) {
        console.error("Failed to decrypt image:", err);
        setImageError(err.message || "Access Denied by Vault"); 
      } finally {
        setImageLoading(false);
      }
    };

    decryptImage();
  }, [selectedDeposit]);

  // --- CORE ACTION ENGINE ---
  const handleUpdateStatus = async (newStatus: 'Verified' | 'Discrepancy') => {
    if (!selectedDeposit) return;
    if (newStatus === 'Verified' && !confirm(`Confirm verification of ₹${selectedDeposit.deposit_amount}? This permanently clears this amount from the partner's ledger.`)) return;
    if (newStatus === 'Discrepancy' && rejectionReason.trim().length < 5) return alert("You must provide a detailed reason for flagging a discrepancy.");
    
    setProcessingId(selectedDeposit.id);
    
    try {
      const updatePayload: any = { status: newStatus };
      if (newStatus === 'Discrepancy') {
        updatePayload.rejection_reason = rejectionReason;
      }

      const { error } = await supabase.from("partner_deposits").update(updatePayload).eq("id", selectedDeposit.id);
      if (error) throw error;
      
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.from('staff_activity_logs').insert([{
          staff_id: session.user.id,
          staff_email: session.user.email,
          action_type: newStatus === 'Verified' ? 'VERIFICATION' : 'DISCREPANCY',
          module: 'DEPOSITS',
          target_id: selectedDeposit.id,
          details: newStatus === 'Verified' 
            ? `Cleared ₹${selectedDeposit.deposit_amount} remittance` 
            : `Flagged discrepancy: ${rejectionReason}`
        }]);
      }

      if (newStatus === 'Discrepancy') {
        await supabase.from("partner_messages").insert([{
          partner_id: selectedDeposit.partner_id,
          subject: `🚨 Remittance Discrepancy: ${selectedDeposit.deposit_date}`,
          body: `Your cash deposit of ₹${selectedDeposit.deposit_amount} via ${selectedDeposit.deposit_method} has been flagged by Accounts. Reason: ${rejectionReason}. Please contact the back office immediately.`
        }]);
      }

      setRawDeposits(current => current.map(d => d.id === selectedDeposit.id ? { ...d, status: newStatus, rejection_reason: newStatus === 'Discrepancy' ? rejectionReason : null } : d));
      
      setSelectedDeposit(null);
      setShowRejectInput(false);
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
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto bg-slate-50 min-h-screen font-sans">
      
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
            onChange={e => { setStatusFilter(e.target.value); setSelectedDeposit(null); }} 
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
              onChange={e => { setGeoFilter({...geoFilter, [field]: e.target.value}); setSelectedDeposit(null); }} 
              className="w-full bg-slate-50 border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-lg p-2.5 outline-none focus:border-amber-500"
            >
              <option value="All">All {field}s</option>
              {(dropdowns as any)[field + 's'].map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* LEFT PANE: QUEUE / LEDGER */}
        <div className="xl:col-span-5 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden sticky top-6" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
          <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white">
            <div>
              <h3 className="font-black tracking-widest uppercase text-sm">Action Queue</h3>
              <p className="text-[10px] text-slate-400 font-bold mt-1">Select a row to inspect.</p>
            </div>
            <div className="text-right">
              <p className="font-black text-lg">{filteredDeposits.length}</p>
              <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">₹{totalFilteredAmount.toLocaleString('en-IN')}</p>
            </div>
          </div>
          
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
            {filteredDeposits.length === 0 ? (
              <div className="p-12 text-center">
                <span className="text-4xl mb-3 block">☕</span>
                <p className="text-slate-500 font-bold">No records match your filters.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredDeposits.map(dep => {
                  const isSelected = selectedDeposit?.id === dep.id;
                  
                  return (
                    <li 
                      key={dep.id} 
                      onClick={() => { setSelectedDeposit(dep); setShowRejectInput(false); }}
                      className={`p-4 cursor-pointer transition border-l-4 ${isSelected ? "bg-amber-50 border-amber-500" : "hover:bg-slate-50 border-transparent"}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-black text-slate-900 leading-tight">{dep.active_partners?.partner_name}</p>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">{dep.active_partners?.locations?.center_name}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-lg font-black ${dep.status === 'Discrepancy' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                            ₹{Number(dep.deposit_amount).toLocaleString('en-IN')}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500">{new Date(dep.created_at).toLocaleDateString('en-IN')}</p>
                        </div>
                      </div>

                      <div className="flex justify-between items-center mt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-black bg-slate-200 text-slate-700 px-2 py-1 rounded uppercase tracking-widest">
                            {dep.deposit_method}
                          </span>
                          <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider truncate max-w-[120px]">
                            {dep.reference_no}
                          </span>
                        </div>
                        <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border ${
                          dep.status === 'Verified' ? 'bg-green-100 text-green-700 border-green-200' : 
                          dep.status === 'Discrepancy' ? 'bg-red-100 text-red-700 border-red-200' : 
                          'bg-amber-100 text-amber-700 border-amber-200'
                        }`}>
                          {dep.status}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT PANE: PARALLEL INSPECTION VIEWER */}
        <div className="xl:col-span-7 sticky top-6 flex flex-col gap-4" style={{ height: 'calc(100vh - 2rem)' }}>
          
          {!selectedDeposit ? (
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <span className="text-6xl mb-4 opacity-50">👈</span>
              <h2 className="text-xl font-black text-slate-600 uppercase tracking-widest">Select a Record</h2>
              <p className="font-bold mt-2 text-sm">Click any row in the left queue to inspect the deposit slip side-by-side.</p>
            </div>
          ) : (
            <>
              {/* Top Action Header */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Declared Remittance</p>
                  <div className="flex items-baseline gap-3">
                    <p className="text-3xl font-black text-slate-900">₹{Number(selectedDeposit.deposit_amount).toLocaleString('en-IN')}</p>
                    <p className="text-xs font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-1 rounded">{selectedDeposit.deposit_method}</p>
                  </div>
                  <p className="text-xs font-bold text-slate-600 mt-1">Ref: {selectedDeposit.reference_no}</p>
                </div>

                {selectedDeposit.status === 'Pending' || selectedDeposit.status === 'Pending Verification' ? (
                  showRejectInput ? (
                    <div className="flex-1 w-full bg-red-50 p-3 rounded-lg border border-red-200 animate-in fade-in">
                      <input 
                        autoFocus
                        type="text"
                        placeholder="Type discrepancy reason..."
                        className="w-full border-2 border-red-300 rounded p-2 text-sm outline-none focus:border-red-600 mb-2 font-bold"
                        value={rejectionReason} 
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdateStatus('Discrepancy')} disabled={!!processingId} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-2 rounded text-xs uppercase tracking-widest transition shadow">
                          {processingId ? "..." : "Confirm Reject"}
                        </button>
                        <button onClick={() => setShowRejectInput(false)} disabled={!!processingId} className="bg-white hover:bg-slate-100 border border-slate-300 text-slate-600 font-black px-4 py-2 rounded text-xs uppercase tracking-widest transition">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button 
                        onClick={() => handleUpdateStatus('Verified')} 
                        disabled={!!processingId} 
                        className="flex-1 sm:flex-none bg-green-500 hover:bg-green-600 text-white font-black px-6 py-3 rounded-lg shadow-md uppercase tracking-widest text-xs transition"
                      >
                        {processingId ? "..." : "✅ Approve"}
                      </button>
                      <button 
                        onClick={() => setShowRejectInput(true)} 
                        disabled={!!processingId} 
                        className="bg-white hover:bg-red-50 border-2 border-red-200 hover:border-red-500 text-red-600 font-black px-4 py-3 rounded-lg shadow-sm uppercase tracking-widest text-xs transition"
                      >
                        Reject
                      </button>
                    </div>
                  )
                ) : (
                  <div className={`px-6 py-3 rounded-lg border ${selectedDeposit.status === 'Verified' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    <p className="font-black uppercase tracking-widest text-xs">{selectedDeposit.status}</p>
                    {selectedDeposit.rejection_reason && <p className="text-[10px] font-bold mt-1">Reason: {selectedDeposit.rejection_reason}</p>}
                  </div>
                )}
              </div>

              {/* Bottom Image Viewer */}
              <div className="flex-1 bg-slate-900 rounded-xl shadow-inner border border-slate-800 flex items-center justify-center overflow-hidden p-2 relative">
                {selectedDeposit.is_exempted ? (
                  <div className="text-center p-8 bg-slate-800 border border-amber-500/50 rounded-2xl max-w-md shadow-2xl">
                    <span className="text-6xl">⚠️</span>
                    <h3 className="text-amber-500 font-black uppercase tracking-widest mt-4">Slip Exempted</h3>
                    <p className="text-slate-300 text-sm font-bold mt-3 p-4 bg-slate-900 rounded">"{selectedDeposit.exemption_reason}"</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-4 font-black">Audit manually via bank portal</p>
                  </div>
                ) : imageLoading ? (
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                    <p className="text-blue-400 font-bold text-xs uppercase tracking-widest animate-pulse">Decrypting Vault Image...</p>
                  </div>
                ) : imageError ? (
                  <div className="text-center p-6 bg-red-950/50 border border-red-900 rounded-2xl max-w-md shadow-2xl flex flex-col items-center">
                    <span className="text-4xl">🚫</span>
                    <h3 className="text-red-500 font-black uppercase tracking-widest mt-4">Storage Access Failed</h3>
                    <p className="text-red-300 text-xs font-bold mt-2 bg-red-950 p-3 rounded">{imageError}</p>
                    
                    {/* ADD THIS DEBUG BUTTON */}
                    {secureImageUrl && (
                      <a href={secureImageUrl} target="_blank" rel="noreferrer" className="mt-4 bg-white text-red-900 px-4 py-2 rounded text-xs font-black uppercase tracking-widest shadow-lg hover:bg-red-100 transition">
                        Open Raw URL to Expose Error ↗
                      </a>
                    )}

                  </div>

                ) : secureImageUrl ? (
                  <div className="w-full h-full flex justify-center items-center overflow-auto p-4 relative group">
                    {/* UPGRADE: Intelligently render PDFs in an iframe, and images in an img tag */}
                    {selectedDeposit.deposit_slip_url.toLowerCase().endsWith('.pdf') ? (
                      <iframe 
                        src={`${secureImageUrl}#toolbar=0`} 
                        className="w-full h-full rounded shadow-2xl border border-slate-700 bg-white"
                        title="Decrypted PDF Proof"
                      />
                    ) : (
                      <img 
                        src={secureImageUrl} 
                        alt="Decrypted Deposit Proof" 
                        className="max-w-full h-auto object-contain rounded shadow-2xl transition-transform duration-300 bg-white" 
                        style={{ maxHeight: '100%' }}
                        onError={() => {
                          setSecureImageUrl(null);
                          setImageError("BROWSER BLOCKED: The image failed to load. Check Supabase CORS settings or ensure the file is not corrupted.");
                        }}
                      />
                    )}
                    
                    <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                       <a href={secureImageUrl} target="_blank" rel="noreferrer" className="bg-slate-900/80 hover:bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest px-4 py-2 rounded shadow-lg backdrop-blur-sm transition border border-slate-700">
                         Open Full Screen ↗
                       </a>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-600 font-black text-sm uppercase tracking-widest">Image unavailable or deleted.</p>
                )}
              </div>
            </>
          )}
        </div>
        
      </div>
    </div>
  );
}