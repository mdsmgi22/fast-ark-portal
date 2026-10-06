"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

export default function PartnersDirectory() {
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // --- NEW: Compliance Vault State ---
  const [loadingDocId, setLoadingDocId] = useState<string | null>(null);

  useEffect(() => {
    fetchPartners();
  }, []);

  const fetchPartners = async () => {
    setLoading(true);
    try {
      // Fetch partners and magically JOIN the locations table to get the center name
      const { data, error } = await supabase
        .from('active_partners')
        .select(`
          *,
          locations ( center_name, taluk, dist )
        `)
        .order('joined_at', { ascending: false });

      if (error) throw error;
      if (data) setPartners(data);
    } catch (error: any) {
      console.error("Error fetching partners:", error.message);
    } finally {
      setLoading(false);
    }
  };

  // Toggle Suspend / Active status for operational control
  const togglePartnerStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Active' ? 'Suspended' : 'Active';
    
    // Optional confirmation prompt before suspending a partner
    if (newStatus === 'Suspended' && !confirm("Are you sure you want to suspend this partner's access?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from('active_partners')
        .update({ status: newStatus })
        .eq('id', id);
        
      if (error) throw error;
      fetchPartners(); // Refresh list to show new status
    } catch (error: any) {
      alert("Error updating status: " + error.message);
    }
  };

  // --- NEW: SECURE COMPLIANCE VIEWER ENGINE ---
  const handleViewCompliance = async (partnerId: string, path: string | null) => {
    if (!path) {
      return alert("No compliance documents have been submitted by this partner yet.");
    }

    setLoadingDocId(partnerId);
    try {
      // Fallback for older public URLs
      if (path.startsWith("http")) {
        window.open(path, "_blank");
        return;
      }

      // Generate a temporary 1-hour authenticated token to view the private bucket file
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

  const filteredPartners = partners.filter(p => 
    p.partner_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.mobile?.includes(searchTerm) ||
    p.locations?.center_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto">
        
        <div className="flex justify-between items-end mb-8">
          <div>
            <Link href="/dashboard" className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-flex items-center gap-1">
              &larr; Back to Command Center
            </Link>
            <h1 className="text-3xl font-black text-slate-900">Active Partners Directory</h1>
            <p className="text-slate-500 mt-1 font-medium">Manage operational status, details, and audit compliance files for all official Fast Ark personnel.</p>
          </div>
          
          <button onClick={fetchPartners} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-bold hover:bg-gray-50 shadow-sm transition">
            ↻ Refresh Directory
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          
          {/* Search Toolbar */}
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex gap-4">
            <input 
              type="text" 
              placeholder="Search by Partner Name, Mobile, or Center Name..." 
              className="w-full max-w-md border border-gray-300 p-2.5 rounded outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium shadow-inner"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Data Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-gray-200 text-xs uppercase tracking-wider text-slate-600">
                  <th className="p-4 font-bold">Partner Name</th>
                  <th className="p-4 font-bold">Contact</th>
                  <th className="p-4 font-bold">Role</th>
                  <th className="p-4 font-bold">Mapped Center</th>
                  <th className="p-4 font-bold text-center">Compliance Vault</th>
                  <th className="p-4 font-bold text-right">Operational Status</th>
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
                      No active partners found.
                    </td>
                  </tr>
                ) : (
                  filteredPartners.map((partner) => (
                    <tr key={partner.id} className={`hover:bg-slate-50 transition-colors ${partner.status === 'Suspended' ? 'bg-red-50/50' : ''}`}>
                      <td className="p-4">
                        <div className="font-bold text-slate-800">{partner.partner_name}</div>
                        <div className="text-xs text-gray-400 font-normal mt-1">Joined: {new Date(partner.joined_at).toLocaleDateString()}</div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-700">{partner.mobile}</div>
                        <div className="text-xs text-gray-500">{partner.email}</div>
                      </td>
                      <td className="p-4 text-blue-700 font-black text-xs uppercase">{partner.role}</td>
                      <td className="p-4">
                        <div className="font-bold text-slate-700">{partner.locations?.center_name || "Unassigned"}</div>
                        <div className="text-xs text-gray-500">{partner.locations?.taluk}, {partner.locations?.dist}</div>
                      </td>
                      
                      {/* --- COMPLIANCE VAULT BUTTON --- */}
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
                        <button 
                          onClick={() => togglePartnerStatus(partner.id, partner.status)}
                          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors border shadow-sm ${
                            partner.status === 'Active' 
                              ? 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200' 
                              : 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200'
                          }`}
                        >
                          {partner.status === 'Active' ? '🟢 ACTIVE (Click to Suspend)' : '🔴 SUSPENDED (Click to Activate)'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
                
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  );
}