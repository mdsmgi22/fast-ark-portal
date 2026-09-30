"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function InfrastructureCommandCenter() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<any[]>([]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Auto-Fetch PIN State
  const [isFetchingPin, setIsFetchingPin] = useState(false);
  const [pinError, setPinError] = useState("");

  const initialForm = {
    center_code: "",
    center_name: "",
    ba: "",
    oa: "",
    pin_code: "",
    taluk: "",
    dist: "",
    state: "",
    role_cm: false,
    role_ocsc: false,
    role_aadhaar: false,
    role_partner: true, 
  };
  const [formData, setFormData] = useState(initialForm);

  // Filters
  const [filterRole, setFilterRole] = useState("ALL");

  useEffect(() => {
    fetchLocations();
  }, []);

  // AUTO-FETCH ENGINE: PIN -> Taluk, Dist, State
  useEffect(() => {
    const fetchLocationData = async () => {
      if (formData.pin_code.length === 6) {
        setIsFetchingPin(true);
        setPinError("");
        try {
          const res = await fetch(`https://api.postalpincode.in/pincode/${formData.pin_code}`);
          const data = await res.json();
          
          if (data && data[0] && data[0].Status === "Success") {
            const postOffice = data[0].PostOffice[0];
            setFormData(prev => ({
              ...prev,
              taluk: postOffice.Block || postOffice.Name || "",
              dist: postOffice.District || "",
              state: postOffice.State || "" 
            }));
          } else {
            setPinError("Invalid PIN Code. Please verify.");
          }
        } catch (err) {
          setPinError("Network error. Please enter details manually.");
        } finally {
          setIsFetchingPin(false);
        }
      } else {
        setPinError("");
      }
    };

    fetchLocationData();
  }, [formData.pin_code]);

  const fetchLocations = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .order("center_name", { ascending: true });

      if (error) throw error;
      setLocations(data || []);
    } catch (err: any) {
      console.error("Error fetching locations:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const openModalForNew = () => {
    setEditingId(null);
    setFormData(initialForm);
    setPinError("");
    setIsModalOpen(true);
  };

  const openModalForEdit = (loc: any) => {
    setEditingId(loc.id);
    setFormData({
      center_code: loc.center_code || "",
      center_name: loc.center_name || "",
      ba: loc.ba || "",
      oa: loc.oa || "",
      pin_code: loc.pin_code || "",
      taluk: loc.taluk || "",
      dist: loc.dist || "",
      state: loc.state || "",
      role_cm: loc.role_cm || false,
      role_ocsc: loc.role_ocsc || false,
      role_aadhaar: loc.role_aadhaar || false,
      role_partner: loc.role_partner || false
    });
    setPinError("");
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const payload = {
      ba: formData.ba,
      oa: formData.oa,
      pin_code: formData.pin_code,
      taluk: formData.taluk,
      dist: formData.dist,
      state: formData.state,
      role_cm: formData.role_cm,
      role_ocsc: formData.role_ocsc,
      role_aadhaar: formData.role_aadhaar,
      role_partner: formData.role_partner
    };

    try {
      if (editingId) {
        const { error } = await supabase.from("locations").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const insertPayload = { 
          ...payload, 
          center_name: formData.center_name.trim(),
          center_code: formData.center_code.trim().toUpperCase() 
        };
        const { error } = await supabase.from("locations").insert([insertPayload]);
        if (error) throw error;
      }
      setIsModalOpen(false);
      fetchLocations();
    } catch (err: any) {
      // =========================================================================
      // SECURITY FIX: Obfuscate Raw Database Errors
      // =========================================================================
      console.error("Database Transaction Failed:", err); // Safe internal logging

      if (err?.code === '23505') {
        // Postgres Code: unique_violation
        alert("Validation Error: The Center Name or Center Code already exists in the database. These must be uniquely identifiable.");
      } else if (err?.code === '23503') {
        // Postgres Code: foreign_key_violation
        alert("Validation Error: Cannot process this request due to linked relational records.");
      } else {
        // Generic Fallback for all other unhandled schema constraints or timeouts
        alert("An unexpected system error occurred while saving the location. Please try again or contact IT support.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Strict Filter Engine
  const filteredLocations = locations.filter(loc => {
    if (filterRole === "ALL") return true;
    if (filterRole === "CM") return loc.role_cm;
    if (filterRole === "OCSC") return loc.role_ocsc;
    if (filterRole === "AADHAAR") return loc.role_aadhaar;
    if (filterRole === "PARTNER") return loc.role_partner;
    return true;
  });

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-slate-50 min-h-screen">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Infrastructure & Locations</h1>
          <p className="text-slate-500 font-medium mt-1">Manage physical centers, BA/OA mapping, and operational roles.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline bg-blue-50 px-4 py-2.5 rounded-lg border border-blue-200 shadow-sm transition">
            &larr; Admin
          </Link>
          <button onClick={openModalForNew} className="bg-slate-900 hover:bg-slate-800 text-white font-black px-5 py-2.5 rounded-lg shadow-md transition flex gap-2 items-center">
            <span>+</span> Deploy New Center
          </button>
        </div>
      </div>

      {/* FILTER RIBBON */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => setFilterRole('ALL')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'ALL' ? 'bg-slate-800 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
          All Grid ({locations.length})
        </button>
        <button onClick={() => setFilterRole('PARTNER')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'PARTNER' ? 'bg-purple-600 text-white border-purple-700 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
          Franchises ({locations.filter(l => l.role_partner).length})
        </button>
        <button onClick={() => setFilterRole('OCSC')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'OCSC' ? 'bg-blue-600 text-white border-blue-700 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
          OCSC ({locations.filter(l => l.role_ocsc).length})
        </button>
        <button onClick={() => setFilterRole('CM')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'CM' ? 'bg-emerald-600 text-white border-emerald-700 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
          CM ({locations.filter(l => l.role_cm).length})
        </button>
        <button onClick={() => setFilterRole('AADHAAR')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'AADHAAR' ? 'bg-amber-600 text-white border-amber-700 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
          Aadhaar ({locations.filter(l => l.role_aadhaar).length})
        </button>
      </div>

      {/* LOCATIONS GRID */}
      {filteredLocations.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-xl border border-slate-200 shadow-sm">
          <div className="text-5xl mb-4">🌍</div>
          <h2 className="text-xl font-black text-slate-700">No Locations Found</h2>
          <p className="text-slate-500 font-medium mt-2">No physical centers match this operational role.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4">
          {filteredLocations.map(loc => (
            <div key={loc.id} className="bg-white rounded-xl shadow-sm border-2 border-slate-200 hover:border-blue-300 overflow-hidden flex flex-col transition-all">
              
              <div className="p-5 flex-1 border-b border-slate-100">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-black text-lg text-slate-900 leading-tight">
                    {loc.center_name}
                  </h3>
                  <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200 uppercase tracking-widest">
                    {loc.center_code || "NO-CODE"}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 mb-5 bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <div className={`px-2 py-1.5 rounded flex justify-between items-center text-[9px] font-black uppercase tracking-wider border ${loc.role_partner ? 'bg-purple-100 border-purple-200 text-purple-800 shadow-sm' : 'bg-white border-slate-200 text-slate-400'}`}>
                    <span>Partner</span>
                    <span>{loc.role_partner ? '🟢 ON' : '🔴 OFF'}</span>
                  </div>
                  <div className={`px-2 py-1.5 rounded flex justify-between items-center text-[9px] font-black uppercase tracking-wider border ${loc.role_ocsc ? 'bg-blue-100 border-blue-200 text-blue-800 shadow-sm' : 'bg-white border-slate-200 text-slate-400'}`}>
                    <span>OCSC</span>
                    <span>{loc.role_ocsc ? '🟢 ON' : '🔴 OFF'}</span>
                  </div>
                  <div className={`px-2 py-1.5 rounded flex justify-between items-center text-[9px] font-black uppercase tracking-wider border ${loc.role_cm ? 'bg-emerald-100 border-emerald-200 text-emerald-800 shadow-sm' : 'bg-white border-slate-200 text-slate-400'}`}>
                    <span>CM</span>
                    <span>{loc.role_cm ? '🟢 ON' : '🔴 OFF'}</span>
                  </div>
                  <div className={`px-2 py-1.5 rounded flex justify-between items-center text-[9px] font-black uppercase tracking-wider border ${loc.role_aadhaar ? 'bg-amber-100 border-amber-200 text-amber-800 shadow-sm' : 'bg-white border-slate-200 text-slate-400'}`}>
                    <span>Aadhaar</span>
                    <span>{loc.role_aadhaar ? '🟢 ON' : '🔴 OFF'}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center text-sm">
                    <span className="w-6 text-slate-400">🏢</span>
                    <span className="font-bold text-slate-700 text-xs">BA: {loc.ba || "N/A"} | OA: {loc.oa || "N/A"}</span>
                  </div>
                  <div className="flex items-start text-sm">
                    <span className="w-6 text-slate-400 pt-0.5">📍</span>
                    <span className="font-bold text-slate-700 text-xs">{loc.taluk ? `${loc.taluk}, ` : ""}{loc.dist}, {loc.state} <br/><span className="text-slate-400">PIN: {loc.pin_code}</span></span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-3 flex justify-end items-center">
                <button onClick={() => openModalForEdit(loc)} className="text-xs font-black text-blue-600 bg-blue-50 px-4 py-1.5 rounded border border-blue-100 hover:bg-blue-100 hover:border-blue-200 transition shadow-sm">
                  Edit Geography & Roles
                </button>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* ADD/EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-2xl my-8 animate-in fade-in zoom-in-95">
            <div className="bg-slate-900 p-5 flex justify-between items-center rounded-t-xl text-white">
              <h3 className="font-black text-lg">{editingId ? "Update Center Configuration" : "Deploy New Center"}</h3>
              <button onClick={() => setIsModalOpen(false)} className="hover:opacity-70 font-black text-2xl">&times;</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              
              {/* SECTION 1: CORE IDENTITY */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest border-b pb-1 mb-4">1. Core Identity</h4>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-1">
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest block mb-2">Center Code *</label>
                      <input 
                        required 
                        disabled={!!editingId} 
                        type="text" 
                        placeholder="e.g. BLR-001" 
                        value={formData.center_code} 
                        onChange={e => setFormData({...formData, center_code: e.target.value})} 
                        className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600 uppercase disabled:opacity-60 disabled:bg-slate-100 disabled:cursor-not-allowed" 
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest block mb-2">Unique Center Name *</label>
                      <input 
                        required 
                        disabled={!!editingId}
                        type="text" 
                        placeholder="e.g. Jalahalli Main Branch" 
                        value={formData.center_name} 
                        onChange={e => setFormData({...formData, center_name: e.target.value})} 
                        className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600 disabled:opacity-60 disabled:bg-slate-100 disabled:cursor-not-allowed" 
                      />
                    </div>
                  </div>
                  {editingId && (
                    <p className="text-[10px] text-red-600 font-bold bg-red-50 p-2 rounded border border-red-100">
                      🔒 IMMUTABLE DATA: Center Code and Name are permanently locked to preserve historical auditing integrity.
                    </p>
                  )}
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest block mb-2">Business Area (BA)</label>
                      <input type="text" placeholder="e.g. BGT" value={formData.ba} onChange={e => setFormData({...formData, ba: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600 uppercase" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest block mb-2">Operations Area (OA)</label>
                      <input type="text" placeholder="e.g. NORTH" value={formData.oa} onChange={e => setFormData({...formData, oa: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600 uppercase" />
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: ROLES MAPPING */}
              <div>
                <div className="flex justify-between items-end border-b pb-1 mb-4">
                  <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest">2. Operational Roles (Enable/Disable)</h4>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Toggle operational status here.</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  
                  <label className={`flex items-center justify-between p-3 rounded border cursor-pointer transition ${formData.role_cm ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'}`}>
                    <div>
                      <span className="text-xs font-black uppercase text-slate-800 block">Consumer Mobility</span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase">CM Services</span>
                    </div>
                    <input type="checkbox" checked={formData.role_cm} onChange={e => setFormData({...formData, role_cm: e.target.checked})} className="w-5 h-5 accent-emerald-600" />
                  </label>

                  <label className={`flex items-center justify-between p-3 rounded border cursor-pointer transition ${formData.role_ocsc ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200'}`}>
                    <div>
                      <span className="text-xs font-black uppercase text-slate-800 block">OCSC</span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Customer Support</span>
                    </div>
                    <input type="checkbox" checked={formData.role_ocsc} onChange={e => setFormData({...formData, role_ocsc: e.target.checked})} className="w-5 h-5 accent-blue-600" />
                  </label>

                  <label className={`flex items-center justify-between p-3 rounded border cursor-pointer transition ${formData.role_aadhaar ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <div>
                      <span className="text-xs font-black uppercase text-slate-800 block">Aadhaar Center</span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Seva Kendra</span>
                    </div>
                    <input type="checkbox" checked={formData.role_aadhaar} onChange={e => setFormData({...formData, role_aadhaar: e.target.checked})} className="w-5 h-5 accent-amber-600" />
                  </label>

                  <label className={`flex items-center justify-between p-3 rounded border cursor-pointer transition ${formData.role_partner ? 'bg-purple-50 border-purple-300' : 'bg-white border-slate-200'}`}>
                    <div>
                      <span className="text-xs font-black uppercase text-slate-800 block">Franchise Partner</span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Base Operations</span>
                    </div>
                    <input type="checkbox" checked={formData.role_partner} onChange={e => setFormData({...formData, role_partner: e.target.checked})} className="w-5 h-5 accent-purple-600" />
                  </label>

                </div>
              </div>

              {/* SECTION 3: GEOGRAPHY */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest border-b pb-1 mb-4">3. Geographic Mapping</h4>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest block mb-2 flex justify-between">
                      <span>Postal PIN Code *</span>
                      {isFetchingPin && <span className="text-blue-600 animate-pulse">Auto-fetching...</span>}
                    </label>
                    <input 
                      required 
                      type="text" 
                      maxLength={6}
                      placeholder="e.g. 560013" 
                      value={formData.pin_code} 
                      onChange={e => setFormData({...formData, pin_code: e.target.value.replace(/\D/g, '')})} 
                      className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm font-bold outline-none focus:border-blue-600" 
                    />
                    {pinError && <p className="text-[10px] text-red-600 font-bold mt-1.5">{pinError}</p>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest block mb-2">Taluk / Block *</label>
                      <input required type="text" value={formData.taluk} onChange={e => setFormData({...formData, taluk: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest block mb-2">District *</label>
                      <input required type="text" value={formData.dist} onChange={e => setFormData({...formData, dist: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest block mb-2">State *</label>
                      <input required type="text" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})} className="w-full border-2 border-slate-200 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 rounded-lg font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2.5 bg-slate-900 text-white font-black rounded-lg shadow disabled:bg-slate-400 transition flex items-center gap-2">
                  {isSubmitting ? "Committing..." : editingId ? "Save Configurations" : "Deploy Center"}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}
    </div>
  );
}