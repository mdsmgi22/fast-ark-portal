"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Updated to perfectly match the new Boolean Roles in the Locations Table
const CENTER_CATEGORIES = [
  { key: "ALL", label: "All Grid Centers (Safety Override)" },
  { key: "OCSC", label: "Outsourced Customer Service Center (OCSC)" },
  { key: "AADHAAR", label: "Aadhaar Seva Kendra" },
  { key: "CM", label: "Consumer Mobility (CM)" },
  { key: "PARTNER", label: "Franchise Partner" }
];

export default function RelationalBankingHub() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // Security State (Allows Admins & Managers)
  const [userRole, setUserRole] = useState<string | null>(null);

  // Tab Navigation State
  const [activeTab, setActiveTab] = useState<'masters' | 'virtuals' | 'upis' | 'qrs'>('masters');

  // Relational Data State
  const [masterBanks, setMasterBanks] = useState<any[]>([]);
  const [virtualAccounts, setVirtualAccounts] = useState<any[]>([]);
  const [upiIds, setUpiIds] = useState<any[]>([]);
  const [qrStickers, setQrStickers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  // Modal & Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // UPGRADED: Triple-Axis Cascading Filters for Mapping Modal
  const [modalFilterState, setModalFilterState] = useState<string>("ALL");
  const [modalFilterHQ, setModalFilterHQ] = useState<string>("ALL");
  const [modalFilterCategory, setModalFilterCategory] = useState<string>("ALL");

  const initialForm = {
    bank_name: "",
    actual_account_no: "",
    ifsc_code: "",
    master_bank_id: "",
    virtual_account_no: "",
    virtual_ifsc: "",
    assigned_location_id: "",
    upi_id: ""
  };
  const [formData, setFormData] = useState(initialForm);

  useEffect(() => {
    fetchAllArchitecture();
  }, []);

  // Smart Reset: Reset HQ filter when State changes
  useEffect(() => {
    setModalFilterHQ("ALL");
  }, [modalFilterState]);

  const fetchAllArchitecture = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      // Verify clearance level (Manager or Admin)
      const { data: staffData } = await supabase
        .from('back_office_staff')
        .select('role')
        .eq('email', session.user.email)
        .single();
      
      if (staffData) setUserRole(staffData.role);

      // [UPGRADED]: Fetching state and topology details to power the cascading filter
      const [mastersRes, virtualsRes, upisRes, qrsRes, locsRes] = await Promise.all([
        supabase.from("master_banks").select("*").order("created_at", { ascending: false }),
        supabase.from("virtual_accounts").select("*, master_banks(bank_name, actual_account_no), locations(center_name, center_code, role_partner, role_ocsc, role_cm, role_aadhaar)").order("created_at", { ascending: false }),
        supabase.from("upi_ids").select("*, master_banks(bank_name, actual_account_no), locations(center_name, center_code, role_partner, role_ocsc, role_cm, role_aadhaar)").order("created_at", { ascending: false }),
        supabase.from("qr_stickers").select("*, master_banks(bank_name, actual_account_no), locations(center_name, center_code)").order("created_at", { ascending: false }),
        supabase.from("locations").select("id, center_name, center_code, state, is_master_node, parent_master_id, role_partner, role_ocsc, role_cm, role_aadhaar").order("center_name", { ascending: true })
      ]);

      if (locsRes.error) console.error("Locations Fetch Error:", locsRes.error.message);

      setMasterBanks(mastersRes.data || []);
      setVirtualAccounts(virtualsRes.data || []);
      setUpiIds(upisRes.data || []);
      setQrStickers(qrsRes.data || []);
      setLocations(locsRes.data || []);
    } catch (err: any) {
      console.error("Fetch Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const canUpdate = userRole === 'Admin' || userRole === 'Manager';

  // --- TRIPLE-AXIS FILTER COMPUTATIONS ---
  const uniqueStates = Array.from(new Set(locations.map(loc => loc.state).filter(Boolean))).sort();
  const masterHQs = locations.filter(loc => loc.is_master_node);
  const masterHQsForFilter = masterHQs
    .filter(hq => modalFilterState === "ALL" || hq.state === modalFilterState)
    .sort((a, b) => a.center_name.localeCompare(b.center_name));

  const filteredLocations = useMemo(() => {
    return locations.filter((loc) => {
      // 1. Role Filter
      let roleMatch = true;
      if (modalFilterCategory === "PARTNER") roleMatch = loc.role_partner;
      else if (modalFilterCategory === "OCSC") roleMatch = loc.role_ocsc;
      else if (modalFilterCategory === "CM") roleMatch = loc.role_cm;
      else if (modalFilterCategory === "AADHAAR") roleMatch = loc.role_aadhaar;

      // 2. State Filter
      let stateMatch = modalFilterState === "ALL" || loc.state === modalFilterState;

      // 3. Topology (HQ) Filter
      let hqMatch = true;
      if (modalFilterHQ !== "ALL") {
        hqMatch = loc.parent_master_id?.toString() === modalFilterHQ || loc.id.toString() === modalFilterHQ;
      }

      return roleMatch && stateMatch && hqMatch;
    });
  }, [locations, modalFilterCategory, modalFilterState, modalFilterHQ]);

  // --- TOGGLE ENGINE WITH TELEMETRY ---
  const handleToggleStatus = async (table: string, id: string, currentStatus: boolean) => {
    if (!canUpdate) return alert("Unauthorized: Only Managers and Admins can perform this action.");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const { error } = await supabase.from(table).update({ is_active: !currentStatus }).eq("id", id);
      if (error) throw error;

      if (session?.user) {
        await supabase.from('staff_activity_logs').insert([{
          staff_id: session.user.id,
          staff_email: session.user.email,
          action_type: 'STATUS_UPDATE',
          module: 'TREASURY',
          target_id: id,
          details: `Toggled active status on ${table} to ${!currentStatus ? 'LIVE' : 'OFF'}`
        }]);
      }

      fetchAllArchitecture();
    } catch (err: any) {
      alert("Error updating status: " + err.message);
    }
  };

  const handleFileUpload = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `sticker_${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('deposit-slips').upload(`stickers/${fileName}`, file);
    if (uploadError) throw new Error(uploadError.message);
    const { data } = supabase.storage.from('deposit-slips').getPublicUrl(`stickers/${fileName}`);
    return data.publicUrl;
  };

  // --- SUBMISSION ENGINE WITH TELEMETRY & QR MAPPING ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if ((activeTab === 'virtuals' || activeTab === 'upis' || activeTab === 'qrs') && !formData.assigned_location_id) {
      return alert("Mandatory: You must select a mapped center from the dropdown.");
    }

    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      let logDetails = "";

      if (activeTab === 'masters') {
        const { error } = await supabase.from("master_banks").insert([{
          bank_name: formData.bank_name,
          actual_account_no: formData.actual_account_no,
          ifsc_code: formData.ifsc_code
        }]);
        if (error) throw error;
        logDetails = `Created Master Bank: ${formData.bank_name}`;
      } 
      else if (activeTab === 'virtuals') {
        const { error } = await supabase.from("virtual_accounts").insert([{
          master_bank_id: formData.master_bank_id,
          virtual_account_no: formData.virtual_account_no,
          virtual_ifsc: formData.virtual_ifsc,
          assigned_location_id: parseInt(formData.assigned_location_id) 
        }]);
        if (error) throw error;
        logDetails = `Deployed Virtual Account (${formData.virtual_account_no}) to Center ID: ${formData.assigned_location_id}`;
      } 
      else if (activeTab === 'upis') {
        const { error } = await supabase.from("upi_ids").insert([{
          master_bank_id: formData.master_bank_id,
          upi_id: formData.upi_id,
          assigned_location_id: parseInt(formData.assigned_location_id) 
        }]);
        if (error) throw error;
        logDetails = `Mapped UPI ID (${formData.upi_id}) to Center ID: ${formData.assigned_location_id}`;
      } 
      else if (activeTab === 'qrs') {
        if (!selectedFile) throw new Error("A file must be selected.");
        const qrUrl = await handleFileUpload(selectedFile);
        
        const { error: qrError } = await supabase.from("qr_stickers").insert([{
          master_bank_id: formData.master_bank_id,
          assigned_location_id: parseInt(formData.assigned_location_id),
          qr_file_url: qrUrl
        }]);
        if (qrError) throw qrError;

        const { error: locError } = await supabase.from("locations").update({
          qr_asset_url: qrUrl
        }).eq("id", formData.assigned_location_id);
        if (locError) throw locError;

        logDetails = `Uploaded and mapped QR Asset to Center ID: ${formData.assigned_location_id}`;
      }

      if (session?.user && logDetails) {
        await supabase.from('staff_activity_logs').insert([{
          staff_id: session.user.id,
          staff_email: session.user.email,
          action_type: 'CREATION',
          module: 'TREASURY',
          target_id: formData.assigned_location_id || 'MASTER_BANK',
          details: logDetails
        }]);
      }

      setIsModalOpen(false);
      setFormData(initialForm);
      setSelectedFile(null);
      fetchAllArchitecture();
    } catch (err: any) {
      alert("Error saving configuration: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openModal = () => {
    if (activeTab !== 'masters' && masterBanks.length === 0) {
      return alert("You must create at least one Master Bank Account before adding virtual channels or UPIs.");
    }
    setFormData({
      ...initialForm,
      master_bank_id: masterBanks.length > 0 ? masterBanks[0].id : "",
      assigned_location_id: "" 
    });
    setModalFilterState("ALL");
    setModalFilterHQ("ALL");
    setModalFilterCategory("ALL");
    setSelectedFile(null);
    setIsModalOpen(true);
  };

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
          <h1 className="text-3xl font-black text-slate-900">Corporate Treasury Hub</h1>
          <p className="text-slate-500 font-medium mt-1">Manage physical master accounts, location-mapped virtual accounts, and UPI routing.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline bg-blue-50 px-4 py-2.5 rounded-lg border border-blue-200 shadow-sm transition">
            &larr; Admin
          </Link>
          {canUpdate && (
            <button onClick={openModal} className="bg-slate-900 hover:bg-slate-800 text-white font-black px-5 py-2.5 rounded-lg shadow-md transition flex gap-2 items-center">
              <span>+</span> 
              {activeTab === 'masters' ? "Add Master Bank" : activeTab === 'virtuals' ? "Add Virtual Account" : activeTab === 'upis' ? "Add UPI ID" : "Upload QR Sticker"}
            </button>
          )}
        </div>
      </div>

      {/* TABBED NAVIGATION */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-px">
        <button onClick={() => setActiveTab('masters')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'masters' ? 'bg-white text-blue-600 border-t-2 border-l border-r border-blue-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>1. Master Banks ({masterBanks.length})</button>
        <button onClick={() => setActiveTab('virtuals')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'virtuals' ? 'bg-white text-amber-600 border-t-2 border-l border-r border-amber-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>2. Virtual Accounts ({virtualAccounts.length})</button>
        <button onClick={() => setActiveTab('upis')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'upis' ? 'bg-white text-purple-600 border-t-2 border-l border-r border-purple-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>3. Digital UPI ({upiIds.length})</button>
        <button onClick={() => setActiveTab('qrs')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'qrs' ? 'bg-white text-emerald-600 border-t-2 border-l border-r border-emerald-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>4. QR Assets ({qrStickers.length})</button>
      </div>

      {/* TAB CONTENT: MASTER BANKS */}
      {activeTab === 'masters' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4">
          {masterBanks.map(bank => (
            <div key={bank.id} className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden transition-all ${bank.is_active ? 'border-blue-200' : 'border-slate-200 grayscale opacity-70'}`}>
              <div className="p-4 bg-slate-50 flex justify-between items-center border-b">
                <h3 className="font-black text-lg text-slate-900">{bank.bank_name}</h3>
                {canUpdate && (
                  <button onClick={() => handleToggleStatus('master_banks', bank.id, bank.is_active)} className={`text-[10px] px-2 py-1 font-black uppercase rounded ${bank.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {bank.is_active ? "Active" : "Suspended"}
                  </button>
                )}
              </div>
              <div className="p-5 space-y-3">
                <div className="bg-red-50 border border-red-100 p-3 rounded">
                  <p className="text-[10px] font-black uppercase text-red-600 mb-1">Backend Actual Acct No (Hidden)</p>
                  <p className="font-black text-red-900">{bank.actual_account_no}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 p-3 rounded flex justify-between items-center">
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-500 mb-1">IFSC Code</p>
                    <p className="font-bold text-slate-800">{bank.ifsc_code}</p>
                  </div>
                  <span className="text-3xl opacity-20">🏦</span>
                </div>
              </div>
            </div>
          ))}
          {masterBanks.length === 0 && <div className="col-span-3 p-12 text-center text-slate-400 font-bold border-2 border-dashed rounded-xl">No Master Banks Configured.</div>}
        </div>
      )}

      {/* TAB CONTENT: VIRTUAL ACCOUNTS */}
      {activeTab === 'virtuals' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4">
          {virtualAccounts.map(v => (
            <div key={v.id} className={`bg-white rounded-xl shadow-sm border-l-8 overflow-hidden flex transition-all ${v.is_active ? 'border-l-amber-500 border-y border-r border-slate-200' : 'border-slate-300 grayscale opacity-70'}`}>
              <div className="p-5 flex-1 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                      Anchored: {v.master_banks?.bank_name} ({v.master_banks?.actual_account_no})
                    </p>
                    <h3 className="font-black text-xl text-slate-800">{v.virtual_account_no}</h3>
                    <p className="text-sm font-bold text-slate-600 mt-0.5">IFSC: {v.virtual_ifsc}</p>
                  </div>
                  {canUpdate && (
                    <button onClick={() => handleToggleStatus('virtual_accounts', v.id, v.is_active)} className={`text-[10px] px-2 py-1 font-black uppercase rounded ${v.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                      {v.is_active ? "Live" : "Off"}
                    </button>
                  )}
                </div>
                <div className="bg-amber-50 border border-amber-200 p-2 rounded flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📍</span>
                    <span className="text-xs font-black text-amber-900 uppercase truncate max-w-[200px]">
                      {v.locations?.center_name || "Unknown Center"}
                    </span>
                  </div>
                  <span className="text-[10px] bg-amber-200 text-amber-900 font-black px-2 py-0.5 rounded uppercase tracking-widest shrink-0">
                    {v.locations?.center_code || "NO-CODE"}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {virtualAccounts.length === 0 && <div className="col-span-2 p-12 text-center text-slate-400 font-bold border-2 border-dashed rounded-xl">No Virtual Accounts Generated.</div>}
        </div>
      )}

      {/* TAB CONTENT: UPI IDs */}
      {activeTab === 'upis' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4">
          {upiIds.map(u => (
            <div key={u.id} className={`bg-white rounded-xl p-5 shadow-sm border-t-4 transition-all flex flex-col justify-between ${u.is_active ? 'border-t-purple-500 border-x border-b border-slate-200' : 'border-slate-300 grayscale opacity-70'}`}>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex justify-between gap-2">
                  <span className="truncate">Bank: {u.master_banks?.bank_name} ({u.master_banks?.actual_account_no})</span>
                  {canUpdate && (
                    <button onClick={() => handleToggleStatus('upi_ids', u.id, u.is_active)} className={u.is_active ? 'text-green-600 font-black' : 'text-slate-400 font-black'}>{u.is_active ? 'LIVE' : 'OFF'}</button>
                  )}
                </p>
                <div className="bg-purple-50 border border-purple-100 p-3 rounded text-center mb-3">
                  <h3 className="font-black text-lg text-purple-900">{u.upi_id}</h3>
                </div>
                <div className="bg-slate-50 border border-slate-200 p-2 rounded flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 truncate">📍 {u.locations?.center_name || "Unknown"}</span>
                  <span className="text-[9px] bg-slate-200 text-slate-600 font-black px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0">
                    {u.locations?.center_code || "NO-CODE"}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {upiIds.length === 0 && <div className="col-span-3 p-12 text-center text-slate-400 font-bold border-2 border-dashed rounded-xl">No UPI Channels Added.</div>}
        </div>
      )}

      {/* TAB CONTENT: QR STICKERS */}
      {activeTab === 'qrs' && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6 animate-in fade-in slide-in-from-bottom-4">
          {qrStickers.map(qr => (
            <div key={qr.id} className={`bg-white rounded-xl p-3 shadow-sm border transition-all flex flex-col ${qr.is_active ? 'border-emerald-200' : 'border-slate-200 grayscale opacity-70'}`}>
              <div className="aspect-square bg-slate-100 rounded-lg overflow-hidden border border-slate-200 mb-3 relative group shrink-0">
                <img src={qr.qr_file_url} alt="QR Sticker" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <a href={qr.qr_file_url} target="_blank" rel="noreferrer" className="text-[10px] bg-white text-slate-900 font-black px-3 py-1 rounded uppercase shadow-md">View Raw</a>
                </div>
              </div>
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest text-center truncate mb-1" title={`${qr.master_banks?.bank_name} (${qr.master_banks?.actual_account_no})`}>
                    {qr.master_banks?.bank_name} ({qr.master_banks?.actual_account_no})
                  </p>
                  {qr.locations && (
                    <p className="text-[10px] font-bold text-slate-700 text-center truncate mb-2 px-1" title={qr.locations.center_name}>
                      📍 {qr.locations.center_name}
                    </p>
                  )}
                </div>
                {canUpdate && (
                  <button onClick={() => handleToggleStatus('qr_stickers', qr.id, qr.is_active)} className={`w-full text-[10px] py-1.5 font-black uppercase rounded mt-auto ${qr.is_active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'} transition`}>
                    {qr.is_active ? "Live Asset" : "Offline"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {qrStickers.length === 0 && <div className="col-span-5 p-12 text-center text-slate-400 font-bold border-2 border-dashed rounded-xl">No Counter Stickers Uploaded.</div>}
        </div>
      )}

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-xl my-8 animate-in fade-in zoom-in-95">
            <div className={`p-5 flex justify-between items-center rounded-t-xl text-white ${activeTab === 'masters' ? 'bg-blue-600' : activeTab === 'virtuals' ? 'bg-amber-600' : activeTab === 'upis' ? 'bg-purple-600' : 'bg-emerald-600'}`}>
              <h3 className="font-black text-lg">
                {activeTab === 'masters' ? "New Master Bank" : activeTab === 'virtuals' ? "Deploy Virtual Account" : activeTab === 'upis' ? "Map Digital UPI" : "Upload Counter Sticker"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="hover:opacity-70 font-black text-2xl">&times;</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {activeTab !== 'masters' && (
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Anchor to Master Bank *</label>
                  <select required value={formData.master_bank_id} onChange={e => setFormData({...formData, master_bank_id: e.target.value})} className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm font-bold outline-none focus:border-slate-800 transition">
                    <option value="" disabled>Select physical destination...</option>
                    {masterBanks.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.bank_name} (Acct: {m.actual_account_no})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeTab === 'masters' && (
                <>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Display Bank Name *</label>
                    <input required type="text" placeholder="e.g. HDFC Core Collections" value={formData.bank_name} onChange={e => setFormData({...formData, bank_name: e.target.value})} className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm font-bold transition focus:border-blue-600 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Actual Account Number (Hidden Backend) *</label>
                    <input required type="text" value={formData.actual_account_no} onChange={e => setFormData({...formData, actual_account_no: e.target.value})} className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm font-bold transition focus:border-blue-600 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Actual IFSC Code *</label>
                    <input required type="text" value={formData.ifsc_code} onChange={e => setFormData({...formData, ifsc_code: e.target.value})} className="w-full border-2 border-slate-200 p-3 rounded-lg text-sm font-bold uppercase transition focus:border-blue-600 outline-none" />
                  </div>
                </>
              )}

              {/* [UPGRADED] Triple-Axis Cascading Mapping (Virtuals, UPIs, QRs) */}
              {(activeTab === 'virtuals' || activeTab === 'upis' || activeTab === 'qrs') && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Filter 1: State */}
                    <div>
                      <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest block mb-2">
                        1. Filter by State
                      </label>
                      <select
                        value={modalFilterState}
                        onChange={(e) => {
                          setModalFilterState(e.target.value);
                          setFormData({ ...formData, assigned_location_id: "" });
                        }}
                        className="w-full border-2 border-slate-300 p-2.5 rounded-lg text-xs font-bold bg-white outline-none focus:border-slate-800 transition"
                      >
                        <option value="ALL">All States</option>
                        {uniqueStates.map(state => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                    </div>

                    {/* Filter 2: Master HQ */}
                    <div>
                      <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest block mb-2">
                        2. Filter by Master HQ
                      </label>
                      <select
                        value={modalFilterHQ}
                        onChange={(e) => {
                          setModalFilterHQ(e.target.value);
                          setFormData({ ...formData, assigned_location_id: "" });
                        }}
                        disabled={masterHQsForFilter.length === 0}
                        className="w-full border-2 border-slate-300 p-2.5 rounded-lg text-xs font-bold bg-white outline-none focus:border-slate-800 disabled:opacity-50 transition"
                      >
                        <option value="ALL">All Regional Hubs</option>
                        {masterHQsForFilter.map(hq => (
                          <option key={hq.id} value={hq.id}>{hq.center_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Filter 3: Category */}
                  <div>
                    <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest block mb-2">
                      3. Filter by Operational Role
                    </label>
                    <select
                      value={modalFilterCategory}
                      onChange={(e) => {
                        setModalFilterCategory(e.target.value);
                        setFormData({ ...formData, assigned_location_id: "" });
                      }}
                      className="w-full border-2 border-slate-300 p-2.5 rounded-lg text-xs font-bold bg-white outline-none focus:border-slate-800 transition"
                    >
                      {CENTER_CATEGORIES.map(cat => (
                        <option key={cat.key} value={cat.key}>{cat.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Target Center Selector */}
                  <div className="pt-2 border-t border-slate-200">
                    <label className="text-[10px] font-black text-red-600 uppercase tracking-widest block mb-2">
                      4. Select Target Mapped Center *
                    </label>
                    <select
                      required
                      disabled={filteredLocations.length === 0}
                      value={formData.assigned_location_id}
                      onChange={e => setFormData({ ...formData, assigned_location_id: e.target.value })}
                      className="w-full border-2 border-red-300 p-2.5 rounded-lg text-sm font-bold bg-white outline-none focus:border-red-600 disabled:opacity-50 disabled:bg-slate-100 transition"
                    >
                      <option value="" disabled>-- Assign to isolated center --</option>
                      {filteredLocations.map(loc => (
                        <option key={loc.id} value={loc.id}>
                          {loc.center_name} [{loc.center_code || "NO-CODE"}]
                        </option>
                      ))}
                    </select>

                    {filteredLocations.length === 0 && (
                      <div className="mt-3 bg-red-50 p-3 rounded-lg border border-red-200">
                        <p className="text-[11px] text-red-800 font-bold uppercase tracking-wide flex items-center gap-1">
                          <span>⚠️</span> No Centers Match Criteria
                        </p>
                        <p className="text-[10px] text-red-700 mt-1">
                          Zero active centers found in the selected region for the specified operational role.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'virtuals' && (
                <>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Virtual Account Number *</label>
                    <input required type="text" value={formData.virtual_account_no} onChange={e => setFormData({...formData, virtual_account_no: e.target.value})} className="w-full border-2 border-amber-200 p-3 rounded-lg text-sm font-bold outline-none focus:border-amber-600 transition" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Virtual IFSC Code *</label>
                    <input required type="text" value={formData.virtual_ifsc} onChange={e => setFormData({...formData, virtual_ifsc: e.target.value})} className="w-full border-2 border-amber-200 p-3 rounded-lg text-sm font-bold uppercase outline-none focus:border-amber-600 transition" />
                  </div>
                </>
              )}

              {activeTab === 'upis' && (
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Official UPI ID *</label>
                  <input required type="text" placeholder="e.g. centername@hdfc" value={formData.upi_id} onChange={e => setFormData({...formData, upi_id: e.target.value})} className="w-full border-2 border-purple-200 p-3 rounded-lg text-sm font-bold lowercase outline-none focus:border-purple-600 transition" />
                  <p className="text-[9px] text-slate-400 mt-2 font-bold uppercase">Dynamic screen QRs will be auto-generated from this ID.</p>
                </div>
              )}

              {activeTab === 'qrs' && (
                <div className="border-2 border-dashed border-emerald-300 bg-emerald-50 p-6 rounded-lg text-center relative hover:bg-emerald-100 transition">
                  <input required type="file" accept="image/*,application/pdf" onChange={e => { if(e.target.files) setSelectedFile(e.target.files[0]) }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                  <span className="text-3xl block mb-2">📱</span>
                  <p className="text-sm font-black text-emerald-800">{selectedFile ? selectedFile.name : "Click to attach PDF / Image"}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 rounded-lg font-bold text-slate-500 hover:bg-slate-100 transition">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2.5 bg-slate-900 text-white font-black rounded-lg shadow disabled:bg-slate-400 transition hover:bg-slate-800">
                  {isSubmitting ? "Committing..." : "Deploy Configuration"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}