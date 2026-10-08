"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function InfrastructureCommandCenter() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // Data States
  const [locations, setLocations] = useState<any[]>([]);
  const [supervisors, setSupervisors] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);

  // Location Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Supervisor Mapping Modal State (UPGRADED)
  const [isSupModalOpen, setIsSupModalOpen] = useState(false);
  const [currentLocForSup, setCurrentLocForSup] = useState<any>(null);
  const [selectedSupId, setSelectedSupId] = useState("");
  const [supRoles, setSupRoles] = useState({ cm: false, ocsc: false, aadhaar: false, partner: false });
  const [isSubmittingSup, setIsSubmittingSup] = useState(false);

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
    is_master_node: false, 
    parent_master_id: "",  
  };
  const [formData, setFormData] = useState(initialForm);

  // TRIPLE-AXIS CASCADING FILTERS
  const [filterRole, setFilterRole] = useState("ALL");
  const [filterState, setFilterState] = useState("ALL");
  const [filterMasterHQ, setFilterMasterHQ] = useState("ALL");

  useEffect(() => {
    fetchDataArchitecture();
  }, []);

  useEffect(() => {
    setFilterMasterHQ("ALL");
  }, [filterState]);

  // AUTO-FETCH ENGINE: PIN -> Taluk, Dist, State
  useEffect(() => {
    if (formData.pin_code.length !== 6) {
      setPinError("");
      return;
    }

    const timer = setTimeout(async () => {
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
    }, 500); 

    return () => clearTimeout(timer);
  }, [formData.pin_code]);

  // --- CORE DATA FETCHING ENGINE ---
  const fetchDataArchitecture = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const [locsRes, supRes, allocRes] = await Promise.all([
        supabase.from("locations").select("*, parent_master:locations(center_name)").order("center_name", { ascending: true }),
        supabase.from("back_office_staff").select("id, name, email").eq("role", "Supervisor").eq("status", "Active"),
        supabase.from("supervisor_allocations").select("*")
      ]);

      if (locsRes.error) throw locsRes.error;

      setLocations(locsRes.data || []);
      setSupervisors(supRes.data || []);
      setAllocations(allocRes.data || []);
    } catch (err: any) {
      console.error("Error fetching architecture data:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- LOCATION FORM ACTIONS ---
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
      role_partner: loc.role_partner || false,
      is_master_node: loc.is_master_node || false,
      parent_master_id: loc.parent_master_id || "",
    });
    setPinError("");
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.is_master_node && !formData.parent_master_id) {
      return alert("A Franchise Center (Spoke) must be tethered to a Master HQ.");
    }

    setIsSubmitting(true);

    const payload = {
      ba: formData.ba,
      oa: formData.oa,
      pin_code: formData.pin_code,
      taluk: formData.taluk,
      dist: formData.dist,
      state: formData.state,
      is_master_node: formData.is_master_node,
      parent_master_id: formData.is_master_node ? null : parseInt(formData.parent_master_id),
      role_cm: formData.is_master_node ? false : formData.role_cm,
      role_ocsc: formData.is_master_node ? false : formData.role_ocsc,
      role_partner: formData.is_master_node ? false : formData.role_partner,
      role_aadhaar: formData.role_aadhaar 
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
      fetchDataArchitecture();
    } catch (err: any) {
      if (err?.code === '23505') {
        alert("Validation Error: The Center Name or Center Code already exists in the database. These must be uniquely identifiable.");
      } else if (err?.code === '23503') {
        alert("Validation Error: Cannot process this request due to linked relational records.");
      } else {
        alert("An unexpected system error occurred while saving the location. Please try again or contact IT support.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- SUPERVISOR MAPPING ACTIONS (UPGRADED) ---
  const openSupModal = (loc: any) => {
    setCurrentLocForSup(loc);
    setSelectedSupId("");
    // Reset roles
    setSupRoles({ cm: false, ocsc: false, aadhaar: false, partner: false });
    setIsSupModalOpen(true);
  };

  const handleAssignSupervisor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupId || !currentLocForSup) return;
    
    // Validation: They must select at least one role
    if (!supRoles.cm && !supRoles.ocsc && !supRoles.aadhaar && !supRoles.partner) {
      return alert("You must select at least one role for this Supervisor to manage.");
    }
    
    setIsSubmittingSup(true);
    try {
      const { error } = await supabase.from('supervisor_allocations').insert([{
        supervisor_id: selectedSupId,
        location_id: currentLocForSup.id,
        manage_cm: supRoles.cm,
        manage_ocsc: supRoles.ocsc,
        manage_aadhaar: supRoles.aadhaar,
        manage_partner: supRoles.partner
      }]);
      
      if (error) throw error;
      
      const { data: { session } } = await supabase.auth.getSession();
      const supName = supervisors.find(s => s.id === selectedSupId)?.name;
      await supabase.from('staff_activity_logs').insert([{
        staff_id: session?.user?.id,
        staff_email: session?.user?.email,
        action_type: 'MAPPING',
        module: 'INFRASTRUCTURE',
        target_id: currentLocForSup.id,
        details: `Assigned Supervisor [${supName}] to Center: ${currentLocForSup.center_name} with specific role scoping.`
      }]);

      setSelectedSupId("");
      fetchDataArchitecture(); 
    } catch (err: any) {
      if (err.message.includes('unique_supervisor_location') || err.code === '23505') {
         alert("This supervisor is already assigned to this center. Revoke their access first if you want to change their roles.");
      } else {
         alert("Error mapping supervisor: " + err.message);
      }
    } finally {
      setIsSubmittingSup(false);
    }
  };

  const handleRemoveSupervisor = async (allocId: string, supName: string) => {
    if (!confirm(`Are you sure you want to revoke ${supName}'s access to this center?`)) return;
    try {
      const { error } = await supabase.from('supervisor_allocations').delete().eq('id', allocId);
      if (error) throw error;

      const { data: { session } } = await supabase.auth.getSession();
      await supabase.from('staff_activity_logs').insert([{
        staff_id: session?.user?.id,
        staff_email: session?.user?.email,
        action_type: 'REVOCATION',
        module: 'INFRASTRUCTURE',
        target_id: currentLocForSup.id,
        details: `Revoked Supervisor [${supName}] from Center: ${currentLocForSup.center_name}`
      }]);

      fetchDataArchitecture();
    } catch (err: any) {
      alert("Error removing supervisor: " + err.message);
    }
  };

  // DYNAMIC DATA EXTRACTION
  const uniqueStates = Array.from(new Set(locations.map(loc => loc.state).filter(Boolean))).sort();
  const masterHQs = locations.filter(loc => loc.is_master_node);
  
  const masterHQsForFilter = masterHQs
    .filter(hq => filterState === "ALL" || hq.state === filterState)
    .sort((a, b) => a.center_name.localeCompare(b.center_name));

  // TRIPLE-AXIS STRICT FILTER ENGINE
  const filteredLocations = locations.filter(loc => {
    let roleMatch = true;
    if (filterRole === "HQ") roleMatch = loc.is_master_node;
    else if (filterRole === "CM") roleMatch = loc.role_cm;
    else if (filterRole === "OCSC") roleMatch = loc.role_ocsc;
    else if (filterRole === "AADHAAR") roleMatch = loc.role_aadhaar;
    else if (filterRole === "PARTNER") roleMatch = loc.role_partner;

    let stateMatch = filterState === "ALL" || loc.state === filterState;

    let hqMatch = true;
    if (filterMasterHQ !== "ALL") {
      hqMatch = loc.parent_master_id?.toString() === filterMasterHQ || loc.id.toString() === filterMasterHQ;
    }

    return roleMatch && stateMatch && hqMatch;
  });

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-slate-50 min-h-screen font-sans">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Infrastructure & Locations</h1>
          <p className="text-slate-500 font-medium mt-1">Manage physical centers, assign field supervisors, and map operational roles.</p>
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

      {/* TRIPLE-AXIS FILTER CONSOLE */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        
        {/* AXIS 1: ROLE */}
        <div className="flex flex-wrap gap-2 w-full xl:w-auto">
          <button onClick={() => setFilterRole('ALL')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'ALL' ? 'bg-slate-800 text-white border-slate-900 shadow-md' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
            All Roles
          </button>
          <button onClick={() => setFilterRole('HQ')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'HQ' ? 'bg-indigo-600 text-white border-indigo-700 shadow-md' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
            Master HQs
          </button>
          <button onClick={() => setFilterRole('PARTNER')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'PARTNER' ? 'bg-purple-600 text-white border-purple-700 shadow-md' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
            Franchises
          </button>
          <button onClick={() => setFilterRole('OCSC')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'OCSC' ? 'bg-blue-600 text-white border-blue-700 shadow-md' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
            OCSC
          </button>
          <button onClick={() => setFilterRole('CM')} className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg border transition ${filterRole === 'CM' ? 'bg-emerald-600 text-white border-emerald-700 shadow-md' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
            CM
          </button>
        </div>

        {/* AXIS 2 & 3: GEOGRAPHY & TOPOLOGY */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full xl:w-auto pt-4 xl:pt-0 border-t xl:border-t-0 border-slate-100">
          
          <div className="flex flex-col w-full sm:w-auto">
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">State Level Filter:</label>
            <select 
              value={filterState} 
              onChange={(e) => setFilterState(e.target.value)} 
              className="w-full sm:w-48 border-2 border-slate-200 bg-slate-50 p-2 rounded-lg text-xs font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-white transition"
            >
              <option value="ALL">All States</option>
              {uniqueStates.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col w-full sm:w-auto">
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Hub Level Filter:</label>
            <select 
              value={filterMasterHQ} 
              onChange={(e) => setFilterMasterHQ(e.target.value)} 
              disabled={filterRole === 'HQ' || masterHQsForFilter.length === 0}
              className="w-full sm:w-56 border-2 border-slate-200 bg-slate-50 p-2 rounded-lg text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition disabled:opacity-50 disabled:bg-slate-100"
            >
              <option value="ALL">All Master HQs</option>
              {masterHQsForFilter.map(hq => (
                <option key={hq.id} value={hq.id}>{hq.center_name}</option>
              ))}
            </select>
          </div>

        </div>
      </div>

      <div className="mb-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
        Showing {filteredLocations.length} Results
      </div>

      {/* LOCATIONS GRID */}
      {filteredLocations.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-xl border border-slate-200 shadow-sm">
          <div className="text-5xl mb-4">🌍</div>
          <h2 className="text-xl font-black text-slate-700">No Locations Found</h2>
          <p className="text-slate-500 font-medium mt-2">No physical centers match the selected role and geographic filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4">
          {filteredLocations.map(loc => {
            // Find assigned supervisors for this specific location
            const locAllocs = allocations.filter(a => a.location_id === loc.id);
            const assignedSups = locAllocs.map(a => {
               const sup = supervisors.find(s => s.id === a.supervisor_id);
               return sup ? { ...sup, allocData: a } : null;
            }).filter(Boolean);

            return (
              <div key={loc.id} className={`bg-white rounded-xl shadow-sm border-2 hover:border-blue-300 overflow-hidden flex flex-col transition-all ${loc.is_master_node ? 'border-indigo-400' : 'border-slate-200'}`}>
                
                <div className="p-5 flex-1 border-b border-slate-100">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-black text-lg text-slate-900 leading-tight">
                      {loc.center_name}
                    </h3>
                    <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200 uppercase tracking-widest">
                      {loc.center_code || "NO-CODE"}
                    </span>
                  </div>
                  
                  {/* ARCHITECTURE BADGE */}
                  <div className="mb-4">
                    {loc.is_master_node ? (
                      <span className="inline-block bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded">
                        🏛️ Master HQ (Hub)
                      </span>
                    ) : (
                      <span className="inline-block bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded">
                        🔗 Tethered to: {loc.parent_master?.center_name || 'N/A'}
                      </span>
                    )}
                  </div>
                  
                  {!loc.is_master_node && (
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
                  )}

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

                  {/* ISOLATED SUPERVISOR RENDERER (UPGRADED) */}
                  <div className="mt-5 pt-4 border-t border-slate-100">
                    <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-2">Assigned Supervisor(s)</p>
                    {assignedSups.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {assignedSups.map((s: any) => {
                          const roles = [];
                          if (s.allocData.manage_cm) roles.push('CM');
                          if (s.allocData.manage_ocsc) roles.push('OCSC');
                          if (s.allocData.manage_aadhaar) roles.push('AADHAAR');
                          if (s.allocData.manage_partner) roles.push('PARTNER');

                          return (
                            <div key={s.allocData.id} className="bg-slate-900 text-white text-xs p-2 rounded shadow-sm flex flex-col gap-1 border border-slate-800">
                              <span className="font-black truncate">👤 {s.name}</span>
                              <div className="flex flex-wrap gap-1">
                                {roles.map(r => (
                                  <span key={r} className="text-[8px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-black tracking-widest uppercase border border-slate-600">
                                    {r}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unassigned</span>
                    )}
                  </div>

                </div>

                <div className="bg-slate-50 p-3 flex justify-between items-center">
                  <button onClick={() => openSupModal(loc)} className="text-xs font-black text-emerald-600 bg-emerald-50 px-4 py-1.5 rounded border border-emerald-100 hover:bg-emerald-100 hover:border-emerald-200 transition shadow-sm">
                    👤 Assign Supervisor
                  </button>
                  <button onClick={() => openModalForEdit(loc)} className="text-xs font-black text-blue-600 bg-blue-50 px-4 py-1.5 rounded border border-blue-100 hover:bg-blue-100 hover:border-blue-200 transition shadow-sm">
                    Edit Location
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* --- SUPERVISOR ALLOCATION MODAL (UPGRADED) --- */}
      {isSupModalOpen && currentLocForSup && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-md my-8 animate-in fade-in zoom-in-95">
            <div className="bg-emerald-600 p-5 flex justify-between items-center rounded-t-xl text-white">
              <h3 className="font-black text-lg flex items-center gap-2"><span>👤</span> Map Field Supervisor</h3>
              <button onClick={() => setIsSupModalOpen(false)} className="hover:opacity-70 font-black text-2xl">&times;</button>
            </div>
            
            <div className="p-6">
              <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg mb-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800 mb-1">Target Center</p>
                <p className="font-black text-emerald-900 text-lg">{currentLocForSup.center_name}</p>
                <p className="text-xs font-bold text-emerald-700">{currentLocForSup.dist}, {currentLocForSup.state}</p>
              </div>

              {/* List Current Mappings */}
              <div className="mb-6 space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest block mb-2 border-b pb-1">Currently Assigned</label>
                {allocations.filter(a => a.location_id === currentLocForSup.id).map(alloc => {
                  const sup = supervisors.find(s => s.id === alloc.supervisor_id);
                  return (
                    <div key={alloc.id} className="flex justify-between items-center bg-slate-50 p-3 rounded border border-slate-200">
                      <span className="font-black text-sm text-slate-800 tracking-wider">👤 {sup?.name || 'Unknown User'}</span>
                      <button onClick={() => handleRemoveSupervisor(alloc.id, sup?.name || 'Unknown')} className="text-[10px] uppercase tracking-widest font-black text-red-600 hover:underline border border-transparent hover:border-red-200 px-2 py-1 rounded transition">Revoke</button>
                    </div>
                  );
                })}
                {allocations.filter(a => a.location_id === currentLocForSup.id).length === 0 && (
                  <p className="text-xs font-bold text-slate-500 italic p-3 text-center bg-slate-50 rounded border border-slate-100">No supervisors currently mapped to this center.</p>
                )}
              </div>

              {/* Assign New Form (UPGRADED WITH ROLE CHECKBOXES) */}
              <form onSubmit={handleAssignSupervisor} className="space-y-4 border-t border-slate-200 pt-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-2">Assign New Supervisor</label>
                  <select required value={selectedSupId} onChange={(e) => setSelectedSupId(e.target.value)} className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm font-bold bg-white outline-none focus:border-emerald-600">
                    <option value="" disabled>-- Select Supervisor from Directory --</option>
                    {supervisors.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                    ))}
                  </select>
                </div>

                {/* THE FINE-GRAINED ROLE SELECTOR */}
                {selectedSupId && (
                  <div className="bg-slate-50 p-4 border border-slate-200 rounded-lg animate-in fade-in">
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-3">Which roles can they manage here?</label>
                    <div className="grid grid-cols-2 gap-3">
                      {currentLocForSup.role_cm && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={supRoles.cm} onChange={e => setSupRoles({...supRoles, cm: e.target.checked})} className="w-4 h-4 accent-emerald-600" />
                          <span className="text-xs font-bold text-slate-700 uppercase">Manage CM</span>
                        </label>
                      )}
                      {currentLocForSup.role_ocsc && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={supRoles.ocsc} onChange={e => setSupRoles({...supRoles, ocsc: e.target.checked})} className="w-4 h-4 accent-emerald-600" />
                          <span className="text-xs font-bold text-slate-700 uppercase">Manage OCSC</span>
                        </label>
                      )}
                      {currentLocForSup.role_aadhaar && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={supRoles.aadhaar} onChange={e => setSupRoles({...supRoles, aadhaar: e.target.checked})} className="w-4 h-4 accent-emerald-600" />
                          <span className="text-xs font-bold text-slate-700 uppercase">Manage Aadhaar</span>
                        </label>
                      )}
                      {currentLocForSup.role_partner && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={supRoles.partner} onChange={e => setSupRoles({...supRoles, partner: e.target.checked})} className="w-4 h-4 accent-emerald-600" />
                          <span className="text-xs font-bold text-slate-700 uppercase">Manage Partner</span>
                        </label>
                      )}
                    </div>
                  </div>
                )}

                <button type="submit" disabled={isSubmittingSup || !selectedSupId} className="w-full bg-slate-900 text-white font-black py-4 rounded-lg shadow disabled:bg-slate-300 disabled:text-slate-500 transition hover:bg-emerald-600 uppercase tracking-widest text-sm">
                  {isSubmittingSup ? "Mapping..." : "Link to Center"}
                </button>
              </form>
            </div>

          </div>
        </div>
      )}

      {/* --- ADD / EDIT LOCATION MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-2xl my-8 animate-in fade-in zoom-in-95">
            <div className="bg-slate-900 p-5 flex justify-between items-center rounded-t-xl text-white">
              <h3 className="font-black text-lg">{editingId ? "Update Center Configuration" : "Deploy New Center"}</h3>
              <button onClick={() => setIsModalOpen(false)} className="hover:opacity-70 font-black text-2xl">&times;</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              
              {/* SECTION 1: TOPOLOGY MAPPING (HUB VS SPOKE) */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest border-b pb-1 mb-4">1. Network Topology</h4>
                
                <div className="flex gap-4 mb-4">
                  <label className={`flex-1 flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition ${formData.is_master_node ? 'bg-indigo-50 border-indigo-500' : 'bg-slate-50 border-slate-300 hover:border-indigo-300'}`}>
                    <input 
                      type="radio" 
                      name="nodeType" 
                      checked={formData.is_master_node}
                      onChange={() => setFormData({...formData, is_master_node: true, role_ocsc: false, role_cm: false, role_partner: false, parent_master_id: ""})} 
                      className="accent-indigo-600"
                    />
                    <div>
                      <span className="font-black text-slate-800 text-sm block leading-tight">Master HQ (Hub)</span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Procurement Node</span>
                    </div>
                  </label>
                  <label className={`flex-1 flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition ${!formData.is_master_node ? 'bg-emerald-50 border-emerald-500' : 'bg-slate-50 border-slate-300 hover:border-emerald-300'}`}>
                    <input 
                      type="radio" 
                      name="nodeType" 
                      checked={!formData.is_master_node}
                      onChange={() => setFormData({...formData, is_master_node: false})} 
                      className="accent-emerald-600"
                    />
                    <div>
                      <span className="font-black text-slate-800 text-sm block leading-tight">Franchise (Spoke)</span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Retail / Ops Center</span>
                    </div>
                  </label>
                </div>

                {!formData.is_master_node && (
                  <div className="bg-emerald-50 p-4 border border-emerald-200 rounded-lg animate-in fade-in">
                    <label className="text-[10px] font-black text-emerald-800 uppercase tracking-widest block mb-2">Tether to Master HQ *</label>
                    <select 
                      required 
                      value={formData.parent_master_id} 
                      onChange={e => setFormData({...formData, parent_master_id: e.target.value})} 
                      className="w-full bg-white border-2 border-emerald-300 text-slate-800 font-bold text-sm rounded-lg p-2.5 outline-none focus:border-emerald-600"
                    >
                      <option value="" disabled>-- Select Hub --</option>
                      {masterHQs.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* SECTION 2: CORE IDENTITY */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest border-b pb-1 mb-4">2. Core Identity</h4>
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

              {/* SECTION 3: ROLES MAPPING */}
              <div>
                <div className="flex justify-between items-end border-b pb-1 mb-4">
                  <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest">3. Operational Roles</h4>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Toggle operational status here.</span>
                </div>
                
                {formData.is_master_node ? (
                  <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-lg">
                    <p className="text-xs font-bold text-indigo-800">
                      🏛️ Master HQs handle bulk procurement and administration. Retail operations (OCSC, CM) are disabled at this level.
                    </p>
                  </div>
                ) : (
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
                )}
              </div>

              {/* SECTION 4: GEOGRAPHY */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest border-b pb-1 mb-4">4. Geographic Mapping</h4>
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