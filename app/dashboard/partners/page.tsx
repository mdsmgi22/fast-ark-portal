"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

export default function PartnersDirectory() {
  const [partners, setPartners] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // 4-Tier Cascading Filters
  const [fState, setFState] = useState("ALL");
  const [fHq, setFHq] = useState("ALL");
  const [fCenter, setFCenter] = useState("ALL");
  const [fRole, setFRole] = useState("ALL");

  // Compliance Vault State
  const [loadingDocId, setLoadingDocId] = useState<string | null>(null);

  // Inline Aadhaar & Center Mapping Modal State
  const [mappingPartner, setMappingPartner] = useState<any | null>(null);
  const [mapForm, setMapForm] = useState({
    center_id: "",
    role_aadhaar: false,
    aadhaar_operator_id: "",
    aadhaar_station_id: "",
  });
  const [isSavingMap, setIsSavingMap] = useState(false);

  useEffect(() => {
    fetchPartners();
  }, []);

  const fetchPartners = async () => {
    setLoading(true);
    try {
      const [partRes, locRes] = await Promise.all([
        supabase
          .from('active_partners')
          .select(`
            *,
            locations ( id, center_name, center_code, taluk, dist, state, parent_master_id )
          `)
          .order('joined_at', { ascending: false }),
        supabase
          .from('locations')
          .select('*')
          .order('center_name', { ascending: true })
      ]);

      if (partRes.error) throw partRes.error;
      setPartners(partRes.data || []);
      setLocations(locRes.data || []);
    } catch (error: any) {
      console.error("Error fetching partners:", error.message);
    } finally {
      setLoading(false);
    }
  };

  // 4-Tier Cascading Options
  const uniqueStates = useMemo(
    () => Array.from(new Set(locations.map(l => l.state).filter(Boolean))).sort(),
    [locations]
  );

  const hqOptions = useMemo(
    () => locations.filter(l => l.is_master_node && (fState === "ALL" || l.state === fState)),
    [locations, fState]
  );

  const centerOptions = useMemo(
    () =>
      locations.filter(
        l =>
          !l.is_master_node &&
          (fState === "ALL" || l.state === fState) &&
          (fHq === "ALL" || l.parent_master_id?.toString() === fHq)
      ),
    [locations, fState, fHq]
  );

  const togglePartnerStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Active' ? 'Suspended' : 'Active';
    if (newStatus === 'Suspended' && !confirm("Are you sure you want to suspend this partner's access?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from('active_partners')
        .update({ status: newStatus })
        .eq('id', id);
        
      if (error) throw error;
      fetchPartners();
    } catch (error: any) {
      alert("Error updating status: " + error.message);
    }
  };

  const handleViewCompliance = async (partnerId: string, path: string | null) => {
    if (!path) {
      return alert("No compliance documents have been submitted by this partner yet.");
    }

    setLoadingDocId(partnerId);
    try {
      if (path.startsWith("http")) {
        window.open(path, "_blank");
        return;
      }

      const { data, error } = await supabase.storage
        .from("application_documents")
        .createSignedUrl(path, 3600);

      if (error || !data?.signedUrl) {
        throw error || new Error("Failed to generate cryptographic signed URL.");
      }

      window.open(data.signedUrl, "_blank");
    } catch (err: any) {
      alert("Error loading compliance document: " + err.message);
    } finally {
      setLoadingDocId(null);
    }
  };

  const openMappingModal = (p: any) => {
    setMappingPartner(p);
    setMapForm({
      center_id: p.center_id?.toString() || "",
      role_aadhaar: Boolean(p.role_aadhaar || String(p.role || "").toUpperCase().includes("AADHAAR")),
      aadhaar_operator_id: p.aadhaar_operator_id || "",
      aadhaar_station_id: p.aadhaar_station_id || "",
    });
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mappingPartner) return;
    if (mapForm.role_aadhaar && (!mapForm.aadhaar_operator_id.trim() || mapForm.aadhaar_station_id.trim().length !== 5)) {
      return alert("Please enter a valid UIDAI Operator ID and 5-digit Station ID when Aadhaar Role is enabled.");
    }

    setIsSavingMap(true);
    try {
      const { error } = await supabase
        .from('active_partners')
        .update({
          center_id: mapForm.center_id ? parseInt(mapForm.center_id) : mappingPartner.center_id,
          role_aadhaar: mapForm.role_aadhaar,
          aadhaar_operator_id: mapForm.aadhaar_operator_id.trim().toUpperCase() || null,
          aadhaar_station_id: mapForm.aadhaar_station_id.trim() || null,
        })
        .eq('id', mappingPartner.id);

      if (error) throw error;

      if (mapForm.role_aadhaar && mapForm.center_id) {
        await supabase.from('locations').update({ role_aadhaar: true }).eq('id', parseInt(mapForm.center_id));
      }

      alert("✅ Partner Center & Aadhaar Station credentials updated!");
      setMappingPartner(null);
      fetchPartners();
    } catch (err: any) {
      alert("Error saving mapping: " + err.message);
    } finally {
      setIsSavingMap(false);
    }
  };

  const filteredPartners = useMemo(() => {
    return partners.filter(p => {
      const loc = p.locations;
      if (fState !== "ALL" && loc?.state !== fState) return false;
      if (fHq !== "ALL" && loc?.parent_master_id?.toString() !== fHq) return false;
      if (fCenter !== "ALL" && loc?.id?.toString() !== fCenter && p.center_id?.toString() !== fCenter) return false;

      if (fRole !== "ALL") {
        const r = String(p.role || "").toUpperCase();
        if (fRole === "AADHAAR" && !p.role_aadhaar && !r.includes("AADHAAR")) return false;
        if (fRole === "OCSC" && !r.includes("OCSC")) return false;
        if (fRole === "CM" && !r.includes("CM")) return false;
        if (fRole === "PARTNER" && r !== "PARTNER" && !r.includes("IRCTC")) return false;
      }

      const q = searchTerm.toLowerCase();
      if (!q) return true;
      return (
        p.partner_name?.toLowerCase().includes(q) ||
        p.mobile?.includes(q) ||
        p.aadhaar_operator_id?.toLowerCase().includes(q) ||
        p.aadhaar_station_id?.includes(q) ||
        loc?.center_name?.toLowerCase().includes(q) ||
        loc?.center_code?.toLowerCase().includes(q)
      );
    });
  }, [partners, fState, fHq, fCenter, fRole, searchTerm]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <Link href="/dashboard" className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-flex items-center gap-1">
              &larr; Back to Command Center
            </Link>
            <h1 className="text-3xl font-black text-slate-900">Active Partners &amp; Field Associates Directory</h1>
            <p className="text-slate-500 mt-1 font-medium">Manage operational status, Center Codes, Aadhaar Operator/Station IDs, and compliance files.</p>
          </div>
          
          <button onClick={fetchPartners} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-bold hover:bg-gray-50 shadow-sm transition">
            ↻ Refresh Directory
          </button>
        </div>

        {/* 4-TIER CASCADING FILTER & SEARCH CONSOLE */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">1. State</label>
              <select
                value={fState}
                onChange={e => { setFState(e.target.value); setFHq("ALL"); setFCenter("ALL"); }}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              >
                <option value="ALL">All States</option>
                {uniqueStates.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">2. Master HQ</label>
              <select
                value={fHq}
                onChange={e => { setFHq(e.target.value); setFCenter("ALL"); }}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              >
                <option value="ALL">All Master HQs</option>
                {hqOptions.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">3. Location (Center)</label>
              <select
                value={fCenter}
                onChange={e => setFCenter(e.target.value)}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              >
                <option value="ALL">All Centers</option>
                {centerOptions.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.center_name} [{c.center_code || "NO-CODE"}]
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">4. Operational Role</label>
              <select
                value={fRole}
                onChange={e => setFRole(e.target.value)}
                className="w-full border-2 border-slate-200 bg-slate-50 p-2.5 rounded-lg text-xs font-bold outline-none focus:border-blue-600"
              >
                <option value="ALL">All Roles ({filteredPartners.length})</option>
                <option value="AADHAAR">🆔 Aadhaar Kendra Operators</option>
                <option value="OCSC">📡 OCSC Associates</option>
                <option value="CM">📱 Consumer Mobility (CM)</option>
                <option value="PARTNER">🏢 Franchise Partners</option>
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <input 
              type="text" 
              placeholder="Search by Partner Name, Mobile, Center Code, UIDAI Operator ID, or Station ID..." 
              className="w-full border-2 border-slate-200 p-2.5 rounded-lg outline-none focus:border-blue-500 text-sm font-bold bg-slate-50 focus:bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-slate-900 text-white text-[10px] uppercase tracking-wider">
                  <th className="p-4 font-black">Partner Name</th>
                  <th className="p-4 font-black">Contact</th>
                  <th className="p-4 font-black">Role &amp; Aadhaar IDs</th>
                  <th className="p-4 font-black">Mapped Center &amp; Code</th>
                  <th className="p-4 font-black text-center">Compliance Vault</th>
                  <th className="p-4 font-black text-right">Actions &amp; Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-16">
                      <div className="flex justify-center items-center">
                        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                      </div>
                    </td>
                  </tr>
                ) : filteredPartners.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-gray-500 font-bold text-lg bg-slate-50">
                      No active partners match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredPartners.map((partner) => (
                    <tr key={partner.id} className={`hover:bg-slate-50 transition-colors ${partner.status === 'Suspended' ? 'bg-red-50/50' : ''}`}>
                      <td className="p-4">
                        <div className="font-black text-slate-900">{partner.partner_name}</div>
                        <div className="text-[11px] text-gray-400 font-bold mt-0.5">Joined: {new Date(partner.joined_at).toLocaleDateString('en-IN')}</div>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-700">{partner.mobile}</div>
                        <div className="text-xs text-gray-500">{partner.email}</div>
                      </td>
                      <td className="p-4">
                        <span className="text-blue-700 font-black text-xs uppercase block">{partner.role}</span>
                        {(partner.role_aadhaar || partner.aadhaar_operator_id || partner.aadhaar_station_id) && (
                          <div className="mt-1 inline-flex items-center gap-1.5 bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded text-[10px] font-black">
                            <span>🆔 {partner.aadhaar_operator_id || "NO-OP"}</span>
                            <span>|</span>
                            <span>Stn: {partner.aadhaar_station_id || "N/A"}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black bg-slate-200 text-slate-800 px-2 py-0.5 rounded uppercase">
                            {partner.locations?.center_code || "NO-CODE"}
                          </span>
                          <span className="font-bold text-slate-800">{partner.locations?.center_name || "Unassigned"}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{partner.locations?.taluk}, {partner.locations?.dist} ({partner.locations?.state})</div>
                      </td>
                      
                      {/* COMPLIANCE VAULT BUTTON */}
                      <td className="p-4 text-center">
                        {partner.compliance_docs_url ? (
                          <button
                            onClick={() => handleViewCompliance(partner.id, partner.compliance_docs_url)}
                            disabled={loadingDocId === partner.id}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-black text-xs px-3 py-1.5 rounded-lg shadow-sm transition inline-flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <span>📑</span>
                            {loadingDocId === partner.id ? "Opening..." : "View PDF"}
                          </button>
                        ) : (
                          <span className="text-[10px] uppercase tracking-widest font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                            Pending
                          </span>
                        )}
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex justify-end items-center gap-2">
                          <button
                            onClick={() => openMappingModal(partner)}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 shadow-sm transition"
                          >
                            🆔 Map ID / Center
                          </button>
                          <button 
                            onClick={() => togglePartnerStatus(partner.id, partner.status)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors border shadow-sm ${
                              partner.status === 'Active' 
                                ? 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200' 
                                : 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200'
                            }`}
                          >
                            {partner.status === 'Active' ? '🟢 Active' : '🔴 Suspended'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
                
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* INLINE AADHAAR & CENTER CODE MAPPING MODAL */}
      {mappingPartner && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl border max-w-md w-full overflow-hidden animate-in zoom-in-95">
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div>
                <h3 className="font-black text-base">Map Center &amp; Aadhaar Credentials</h3>
                <p className="text-xs text-amber-400 font-bold mt-0.5">{mappingPartner.partner_name}</p>
              </div>
              <button onClick={() => setMappingPartner(null)} className="text-2xl font-black text-slate-400 hover:text-white">&times;</button>
            </div>
            <form onSubmit={handleSaveMapping} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Assigned Center [Center Code] *</label>
                <select
                  required
                  value={mapForm.center_id}
                  onChange={e => setMapForm({...mapForm, center_id: e.target.value})}
                  className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-bold bg-slate-50"
                >
                  <option value="" disabled>-- Select Center --</option>
                  {locations.filter(l => !l.is_master_node).map(loc => (
                    <option key={loc.id} value={loc.id}>
                      [{loc.center_code || "NO-CODE"}] {loc.center_name} ({loc.state})
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                <div>
                  <span className="font-black text-amber-950 uppercase block">Enable Aadhaar Seva Kendra Role</span>
                  <span className="text-[10px] font-bold text-amber-700">Allows CSV/HTML daily report uploads</span>
                </div>
                <input
                  type="checkbox"
                  checked={mapForm.role_aadhaar}
                  onChange={e => setMapForm({...mapForm, role_aadhaar: e.target.checked})}
                  className="w-5 h-5 accent-amber-600"
                />
              </label>

              {mapForm.role_aadhaar && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">UIDAI Operator ID *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. MYS_FAAFREEN"
                      value={mapForm.aadhaar_operator_id}
                      onChange={e => setMapForm({...mapForm, aadhaar_operator_id: e.target.value.toUpperCase()})}
                      className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">UIDAI Station ID (5 Digits) *</label>
                    <input
                      type="text"
                      required
                      maxLength={5}
                      placeholder="e.g. 21505"
                      value={mapForm.aadhaar_station_id}
                      onChange={e => setMapForm({...mapForm, aadhaar_station_id: e.target.value.replace(/\D/g, '')})}
                      className="w-full border-2 border-slate-200 p-2.5 rounded-lg font-black"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setMappingPartner(null)} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-lg">Cancel</button>
                <button type="submit" disabled={isSavingMap} className="flex-1 py-3 bg-slate-900 hover:bg-blue-600 text-white font-black uppercase tracking-wider rounded-lg shadow">
                  {isSavingMap ? "Saving..." : "Save Mapping"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}