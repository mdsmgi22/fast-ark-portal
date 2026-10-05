"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function OcscDataCommand() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'masters' | 'agents'>('masters');

  const [masters, setMasters] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  
  // NEW: State to hold Master Locations (Hubs) for tethering
  const [masterLocations, setMasterLocations] = useState<any[]>([]);

  // Modals & Forms
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingMasterId, setEditingMasterId] = useState<string | null>(null);

  // UPGRADED: Added location_id to the Master Form
  const initialMasterForm = { location_id: "", master_ctop_no: "", master_ocsc_user_id: "", sanchar_soft_user_id: "", mpin: "" };
  const initialAgentForm = { partner_id: "", master_ctop_id: "", agent_ctop_no: "", agent_ocsc_login_id: "" };
  
  const [masterForm, setMasterForm] = useState(initialMasterForm);
  const [agentForm, setAgentForm] = useState(initialAgentForm);

  useEffect(() => {
    fetchArchitecture();
  }, []);

  const fetchArchitecture = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      const [mastersRes, agentsRes, partnersRes, hqRes] = await Promise.all([
        // Added locations(center_name) to fetch the anchored HQ name
        supabase.from("master_ctop_accounts").select("*, locations(center_name)").order("created_at", { ascending: false }),
        supabase.from("agent_ctop_mappings").select("*, active_partners(partner_name, locations(center_name)), master_ctop_accounts(master_ctop_no)").order("created_at", { ascending: false }),
        supabase.from("active_partners").select("id, partner_name, locations(center_name)").eq("status", "Active").order("partner_name", { ascending: true }),
        // Fetch only Master Nodes (Hubs) for the dropdown
        supabase.from("locations").select("id, center_name").eq("is_master_node", true).order("center_name", { ascending: true })
      ]);

      setMasters(mastersRes.data || []);
      setAgents(agentsRes.data || []);
      setPartners(partnersRes.data || []);
      setMasterLocations(hqRes.data || []);
    } catch (err: any) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openEditMasterModal = (m: any) => {
    setEditingMasterId(m.id);
    setMasterForm({
      location_id: m.location_id ? m.location_id.toString() : "",
      master_ctop_no: m.master_ctop_no || "",
      master_ocsc_user_id: m.master_ocsc_user_id || "",
      sanchar_soft_user_id: m.sanchar_soft_user_id || "",
      mpin: m.mpin || ""
    });
    setIsModalOpen(true);
  };

  const openNewModal = () => {
    setEditingMasterId(null);
    setMasterForm(initialMasterForm);
    setAgentForm(initialAgentForm);
    setIsModalOpen(true);
  };

  const handleMasterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Strict Validations
    if (!masterForm.location_id) return alert("Validation Error: You must anchor this Master CTOP to a physical Master HQ.");
    if (masterForm.master_ctop_no.length !== 10) return alert("Validation Error: Master CTOP Number must be exactly 10 digits.");
    if (masterForm.mpin.length !== 6) return alert("Validation Error: MPIN must be exactly 6 digits.");
    
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Cast the location_id to a BIGINT for the database relation
      const payload = {
        ...masterForm,
        location_id: parseInt(masterForm.location_id)
      };

      if (editingMasterId) {
        // UPDATE EXISTING RECORD
        const { error } = await supabase.from("master_ctop_accounts").update(payload).eq("id", editingMasterId);
        if (error) throw error;
        
        // Audit Telemetry
        if (session?.user) {
          await supabase.from('staff_activity_logs').insert([{
            staff_id: session.user.id,
            staff_email: session.user.email,
            action_type: 'UPDATE',
            module: 'TELECOM_OCSC',
            target_id: editingMasterId,
            details: `Updated and Re-Assigned Master CTOP: ${payload.master_ctop_no}`
          }]);
        }
      } else {
        // INSERT NEW RECORD
        const { error } = await supabase.from("master_ctop_accounts").insert([payload]);
        if (error) throw error;
      }
      
      setIsModalOpen(false);
      setMasterForm(initialMasterForm);
      setEditingMasterId(null);
      fetchArchitecture();
    } catch (err: any) {
      if (err.message.includes("unique constraint")) {
        alert("CRITICAL BLOCK: This Master CTOP Number already exists in the system.");
      } else {
        alert("Error: " + err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Strict 10-Digit validation for Agent CTOP
    if (agentForm.agent_ctop_no.length !== 10) return alert("Validation Error: Agent CTOP Number must be exactly 10 digits.");
    
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("agent_ctop_mappings").insert([agentForm]);
      if (error) throw error;
      setIsModalOpen(false);
      setAgentForm(initialAgentForm);
      fetchArchitecture();
    } catch (err: any) {
      if (err.message.includes("unique constraint")) {
        alert("CRITICAL BLOCK: That Agent CTOP Number is already mapped. You cannot duplicate mappings.");
      } else {
        alert("Error: " + err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleStatus = async (table: string, id: string, currentStatus: boolean) => {
    await supabase.from(table).update({ is_active: !currentStatus }).eq("id", id);
    fetchArchitecture();
  };

  if (loading) return <div className="p-20 text-center font-bold">Loading OCSC Architecture...</div>;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto bg-slate-50 min-h-screen">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Telecom & OCSC Architecture</h1>
          <p className="text-slate-500 font-medium mt-1">Manage Master CTOP accounts and strictly map Agent credentials.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-blue-600 font-bold hover:underline bg-blue-50 px-4 py-2.5 rounded-lg border border-blue-200">
            &larr; Admin
          </Link>
          <button onClick={openNewModal} className="bg-slate-900 hover:bg-slate-800 text-white font-black px-5 py-2.5 rounded-lg shadow-md transition flex gap-2 items-center">
            <span>+</span> {activeTab === 'masters' ? "Add Master CTOP" : "Map Agent CTOP"}
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 border-b border-slate-200 pb-px">
        <button onClick={() => setActiveTab('masters')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'masters' ? 'bg-white text-blue-600 border-t-2 border-l border-r border-blue-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>1. Master CTOPs</button>
        <button onClick={() => setActiveTab('agents')} className={`px-6 py-3 font-black text-sm uppercase tracking-widest rounded-t-lg transition ${activeTab === 'agents' ? 'bg-white text-emerald-600 border-t-2 border-l border-r border-emerald-600 mb-[-1px]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>2. Agent Mappings</button>
      </div>

      {activeTab === 'masters' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {masters.length === 0 ? (
            <div className="col-span-3 p-12 text-center text-slate-400 font-bold border-2 border-dashed rounded-xl">No Master CTOPs Configured.</div>
          ) : (
            masters.map(m => (
              <div key={m.id} className="bg-white rounded-xl shadow-sm border-2 border-slate-200 overflow-hidden">
                <div className="p-4 bg-slate-900 flex justify-between items-center text-white">
                  <h3 className="font-black text-lg">Master: {m.master_ctop_no}</h3>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => openEditMasterModal(m)} 
                      className="text-[10px] px-3 py-1 font-black uppercase tracking-widest rounded bg-blue-600 hover:bg-blue-500 transition shadow-sm border border-blue-400"
                    >
                      Edit / Re-Assign
                    </button>
                    <button onClick={() => toggleStatus('master_ctop_accounts', m.id, m.is_active)} className={`text-[10px] px-2 py-1 font-black uppercase rounded ${m.is_active ? 'bg-green-500' : 'bg-red-500'}`}>{m.is_active ? "Live" : "Off"}</button>
                  </div>
                </div>
                <div className="p-5 space-y-4 text-sm font-bold text-slate-700">
                  <div className="flex justify-between items-center border-b pb-2">
                    <span className="text-slate-400">Anchored HQ</span>
                    <span className="text-xs font-black uppercase tracking-widest bg-indigo-50 text-indigo-700 px-2 py-1 rounded border border-indigo-200">
                      {m.locations?.center_name || "UNASSIGNED"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b pb-2"><span className="text-slate-400">Master OCSC ID</span><span>{m.master_ocsc_user_id}</span></div>
                  <div className="flex justify-between border-b pb-2"><span className="text-slate-400">Sanchar Soft ID</span><span>{m.sanchar_soft_user_id}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">MPIN</span><span className="text-blue-600 font-black tracking-widest">{m.mpin}</span></div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'agents' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-4">Partner Details</th>
                  <th className="p-4">Under Master CTOP</th>
                  <th className="p-4">Agent CTOP No</th>
                  <th className="p-4">OCSC Login ID</th>
                  <th className="p-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400 font-bold">No Agent Mappings Found.</td>
                  </tr>
                ) : (
                  agents.map(a => (
                    <tr key={a.id} className={`hover:bg-slate-50 transition ${!a.is_active ? 'opacity-50 grayscale' : ''}`}>
                      <td className="p-4"><p className="font-black text-slate-800">{a.active_partners?.partner_name}</p><p className="text-xs text-slate-500">{a.active_partners?.locations?.center_name}</p></td>
                      <td className="p-4 font-bold text-slate-600">{a.master_ctop_accounts?.master_ctop_no}</td>
                      <td className="p-4 font-black text-blue-700 text-lg">{a.agent_ctop_no}</td>
                      <td className="p-4 font-bold text-slate-800">{a.agent_ocsc_login_id}</td>
                      <td className="p-4 text-right">
                        <button onClick={() => toggleStatus('agent_ctop_mappings', a.id, a.is_active)} className={`text-[10px] px-3 py-1.5 font-black uppercase rounded ${a.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{a.is_active ? "Active" : "Suspended"}</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95">
            <div className={`p-5 flex justify-between items-center text-white ${activeTab === 'masters' ? 'bg-blue-600' : 'bg-emerald-600'}`}>
              <h3 className="font-black text-lg">
                {activeTab === 'masters' ? (editingMasterId ? "Edit / Re-Assign Master" : "New Master Credentials") : "Map Agent to Partner"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="hover:opacity-70 text-2xl">&times;</button>
            </div>
            
            <form onSubmit={activeTab === 'masters' ? handleMasterSubmit : handleAgentSubmit} className="p-6 space-y-4">
              
              {activeTab === 'masters' ? (
                <>
                  <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg mb-2">
                    <label className="text-[10px] font-black text-blue-800 uppercase block mb-1 tracking-widest">Anchor to Master HQ (Hub) *</label>
                    <select required value={masterForm.location_id} onChange={e => setMasterForm({...masterForm, location_id: e.target.value})} className="w-full border-2 border-blue-300 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600 bg-white">
                      <option value="" disabled>-- Select Physical HQ --</option>
                      {masterLocations.length === 0 ? (
                        <option value="" disabled>No Master HQs Found in Infrastructure</option>
                      ) : (
                        masterLocations.map(hq => <option key={hq.id} value={hq.id}>{hq.center_name}</option>)
                      )}
                    </select>
                  </div>

                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Master CTOP No (10 Digits) *</label><input required type="text" maxLength={10} placeholder="10-digit numeric" value={masterForm.master_ctop_no} onChange={e => setMasterForm({...masterForm, master_ctop_no: e.target.value.replace(/\D/g, '')})} className="w-full border-2 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600" /></div>
                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Master OCSC User ID *</label><input required type="text" value={masterForm.master_ocsc_user_id} onChange={e => setMasterForm({...masterForm, master_ocsc_user_id: e.target.value})} className="w-full border-2 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600" /></div>
                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Sanchar Soft User ID *</label><input required type="text" value={masterForm.sanchar_soft_user_id} onChange={e => setMasterForm({...masterForm, sanchar_soft_user_id: e.target.value})} className="w-full border-2 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-blue-600" /></div>
                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">MPIN (6 Digits) *</label><input required type="text" maxLength={6} placeholder="6-digit numeric" value={masterForm.mpin} onChange={e => setMasterForm({...masterForm, mpin: e.target.value.replace(/\D/g, '')})} className="w-full border-2 p-2.5 rounded-lg text-sm font-black text-blue-600 tracking-widest outline-none focus:border-blue-600" /></div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Select Partner *</label>
                    <select required value={agentForm.partner_id} onChange={e => setAgentForm({...agentForm, partner_id: e.target.value})} className="w-full border-2 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-emerald-600">
                      <option value="" disabled>-- Select Franchise Partner --</option>
                      {partners.map(p => <option key={p.id} value={p.id}>{p.partner_name} ({p.locations?.center_name})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Select Parent Master CTOP *</label>
                    <select required value={agentForm.master_ctop_id} onChange={e => setAgentForm({...agentForm, master_ctop_id: e.target.value})} className="w-full border-2 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-emerald-600">
                      <option value="" disabled>-- Anchor to Master Account --</option>
                      {masters.map(m => <option key={m.id} value={m.id}>{m.master_ctop_no} {m.locations?.center_name ? `(${m.locations.center_name})` : ''}</option>)}
                    </select>
                  </div>
                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Agent CTOP No (10 Digits) *</label><input required type="text" maxLength={10} placeholder="10-digit numeric" value={agentForm.agent_ctop_no} onChange={e => setAgentForm({...agentForm, agent_ctop_no: e.target.value.replace(/\D/g, '')})} className="w-full border-2 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-emerald-600" /></div>
                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Agent OCSC Login ID *</label><input required type="text" value={agentForm.agent_ocsc_login_id} onChange={e => setAgentForm({...agentForm, agent_ocsc_login_id: e.target.value})} className="w-full border-2 p-2.5 rounded-lg text-sm font-bold outline-none focus:border-emerald-600" /></div>
                </>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 font-bold text-slate-500 hover:bg-slate-100 rounded">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-slate-900 text-white font-black rounded shadow disabled:bg-slate-400">
                  {isSubmitting ? "Processing..." : (activeTab === 'masters' && editingMasterId ? "Update Configuration" : "Save Securely")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}