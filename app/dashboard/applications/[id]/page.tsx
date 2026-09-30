"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link"; 
// [BULLETPROOF FIX]: Mathematically exact relative path (3 levels up to 'app')
import { supabase } from "../../../lib/supabase"; 

export default function ApplicationReview() {
  const params = useParams();
  const router = useRouter();
  const appId = params.id as string;

  const [app, setApp] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (appId) {
      fetchDetails();
    }
  }, [appId]);

  const fetchDetails = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push("/login");

      // Fetch the application
      const { data: appData, error: appError } = await supabase
        .from('pending_applications')
        .select('*')
        .eq('id', appId)
        .single();
      
      if (appError) throw appError;
      if (appData) setApp(appData);

      // Fetch ALL locations (Since physical locations are permanent, we fetch them all)
      const { data: locData, error: locError } = await supabase
        .from('locations')
        .select('*')
        .order('center_name', { ascending: true });
      
      if (locError) throw locError;
      if (locData) setLocations(locData);
      
    } catch (err: any) {
      console.error("Initialization Error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // Maps the legacy requested text string to the new Boolean database columns
  const getFilteredLocations = () => {
    if (!app) return [];
    return locations.filter((loc) => {
      const req = app.requested_role?.toUpperCase();
      if (req === "OCSC") return loc.role_ocsc === true;
      if (req === "AADHAAR CENTER" || req === "AADHAAR") return loc.role_aadhaar === true;
      if (req === "CM (CONSUMER MOBILITY)" || req === "CM") return loc.role_cm === true;
      // Default to returning franchise partners if the role is generic
      return loc.role_partner === true; 
    });
  };

  const getRoleIdentifier = (loc: any) => {
    if (!app) return "Partner";
    const req = app.requested_role?.toUpperCase();
    if (req === "OCSC") return "OCSC Center";
    if (req === "AADHAAR CENTER" || req === "AADHAAR") return "Aadhaar Kendra";
    if (req === "CM (CONSUMER MOBILITY)" || req === "CM") return "CM Center";
    return "Franchise Partner";
  };

  const handleViewKYC = async () => {
    try {
      const safeName = app.name.replace(/[^a-zA-Z0-9]/g, '_');
      const { data: files, error } = await supabase.storage
        .from('application_documents')
        .list('', { search: safeName });
        
      if (error || !files || files.length === 0) {
        return alert("No KYC documents found. They may have been deleted.");
      }

      const pdfFile = files.find(f => f.name.endsWith('.pdf'));
      if (!pdfFile) return alert("Generated PDF not found.");

      const { data: urlData, error: urlError } = await supabase.storage
        .from('application_documents')
        .createSignedUrl(pdfFile.name, 60 * 60); 
        
      if (urlError) throw urlError;
      window.open(urlData.signedUrl, '_blank');

    } catch (error: any) {
      alert("Error opening KYC document: " + error.message);
    }
  };

  // --- UPGRADED: APPROVAL + TELEMETRY ---
  const handleApprove = async () => {
    if (!selectedLocation) {
      return alert("Mandatory: You must assign an official infrastructure location to approve this applicant.");
    }
    
    setIsProcessing(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Authentication error. Please log in again.");

      // 1. Process Core Approval
      const response = await fetch('/api/approve-application', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}` 
        },
        body: JSON.stringify({
          appId: app.id,
          applicantName: app.name,
          applicantEmail: app.email,
          mobile: app.mobile,
          role: app.requested_role,
          locationId: selectedLocation
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to process approval.");

      // 2. PRODUCTIVITY MATRIX TELEMETRY
      const locDetails = locations.find(l => l.id === selectedLocation);
      await supabase.from('staff_activity_logs').insert([{
        staff_id: session.user.id,
        staff_email: session.user.email,
        action_type: 'APPROVAL',
        module: 'ONBOARDING',
        target_id: app.id,
        details: `Approved Franchise Application for ${app.name}. Assigned to: ${locDetails?.center_name || 'Unknown Center'}.`
      }]);

      alert("✅ Application Approved! The partner has been provisioned and the Welcome email dispatched.");
      router.push('/dashboard/applications');
      
    } catch (error: any) {
      console.error(error);
      alert("❌ Error approving application: " + error.message);
      setIsProcessing(false); 
    }
  };

  // --- UPGRADED: REJECTION + TELEMETRY ---
  const handleReject = async () => {
    if (!rejectReason.trim()) {
      return alert("You must provide a reason for rejecting the application.");
    }
    
    if (!window.confirm("Are you absolutely sure you want to REJECT this application? This cannot be undone.")) return;

    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Authentication error.");

      // 1. Process Core Rejection
      const response = await fetch('/api/reject-application', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          appId: app.id,
          applicantName: app.name,
          applicantEmail: app.email,
          rejectReason: rejectReason
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to process rejection.");

      // 2. PRODUCTIVITY MATRIX TELEMETRY
      await supabase.from('staff_activity_logs').insert([{
        staff_id: session.user.id,
        staff_email: session.user.email,
        action_type: 'REJECTION',
        module: 'ONBOARDING',
        target_id: app.id,
        details: `Rejected Application for ${app.name}. Reason: ${rejectReason}`
      }]);

      alert("Application declined. Documents emailed to ENQUIRY@FASTARK.IN and deleted securely.");
      router.push('/dashboard/applications');
      
    } catch (error: any) {
      console.error(error);
      alert("❌ Error rejecting application: " + error.message);
      setIsProcessing(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
    </div>
  );

  if (!app) return (
    <div className="min-h-screen bg-slate-50 p-8 flex flex-col items-center justify-center">
      <h2 className="text-2xl font-black text-slate-800 mb-2">Application Not Found</h2>
      <p className="text-slate-500 mb-6">The record you are looking for does not exist or was deleted.</p>
      <Link href="/dashboard/applications" className="bg-blue-600 text-white font-bold px-6 py-2.5 rounded-lg shadow hover:bg-blue-700 transition">Return to Grid</Link>
    </div>
  );

  const filteredLocations = getFilteredLocations();

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-6xl mx-auto">
        
        <button onClick={() => router.back()} className="text-blue-600 font-bold mb-6 hover:underline flex items-center gap-2">
          <span>&larr;</span> Back to Applications
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* APPLICANT DETAILS COLUMN */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-6 border-b pb-4">
                <div>
                  <h1 className="text-3xl font-black text-slate-900">{app.name}</h1>
                  <p className="text-sm text-gray-500 font-bold mt-1">Submitted from IP: {app.ip_address || "Unknown"}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`font-bold px-4 py-1 rounded-full text-sm uppercase tracking-widest ${app.status === 'Rejected' ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}`}>
                    Status: {app.status || 'Pending'}
                  </span>
                  <button onClick={handleViewKYC} className="text-sm bg-slate-800 text-white px-4 py-2 rounded font-bold shadow hover:bg-slate-700 transition flex items-center gap-2">
                    <span>📄</span> View Application & KYC
                  </button>
                </div>
              </div>
              
              {app.status === 'Rejected' && app.reject_reason && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-md mb-6">
                  <p className="text-sm text-red-600 font-bold uppercase mb-1">Rejection Reason:</p>
                  <p className="text-red-900 font-medium">{app.reject_reason}</p>
                </div>
              )}
              
              <h2 className="text-xl font-bold mb-4">Applicant Profile</h2>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6 text-sm mb-6 bg-slate-50 p-4 rounded-lg border border-gray-100">
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Gender</span><span className="font-bold text-slate-800">{app.gender || "N/A"}</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">DOB</span><span className="font-bold text-slate-800">{app.dob}</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">{app.father_name?.split(':')[0] || "Guardian"}</span><span className="font-bold text-slate-800">{app.father_name?.split(':')[1] || app.father_name}</span></div>
                
                {/* ID Digits dynamically masked by prompt strict rules */}
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Gov ID</span><span className="font-bold text-slate-800">[ID Redacted]</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">PAN No</span><span className="font-bold text-slate-800">{app.pan_number || "N/A"}</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Qualification</span><span className="font-bold text-slate-800">{app.qualification}</span></div>
                
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Primary Mobile</span><span className="font-bold text-slate-800">{app.mobile}</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Alt Mobile</span><span className="font-bold text-slate-800">{app.alt_mobile || "N/A"}</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Email Address</span><span className="font-bold text-slate-800">{app.email}</span></div>
              </div>

              <h2 className="text-xl font-bold mb-4 border-t pt-4">Location Request</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm bg-slate-50 p-4 rounded-lg border border-gray-100">
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Requested Role</span><span className="font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded">{app.requested_role}</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Requested Center</span><span className="font-bold text-slate-800">{app.center_name}</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">PIN Code</span><span className="font-bold text-slate-800">{app.pin_code}</span></div>
                <div><span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest block mb-1">Address</span><span className="font-bold text-slate-800 leading-relaxed">{app.address_1}, {app.address_2 ? `${app.address_2}, ` : ""}<br/>{app.taluk}, {app.dist}, {app.state}</span></div>
              </div>
            </div>
          </div>

          {/* ACTIONS COLUMN */}
          <div className="space-y-6">
            {app.status !== 'Rejected' && (
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 border-t-4 border-t-blue-600">
                <h2 className="text-xl font-black text-slate-900 mb-2">Official Mapping</h2>
                <p className="text-xs text-gray-500 font-bold mb-6">
                  Assign this user to an official master location before creating their account.
                </p>
                
                <label className="block text-[10px] font-black uppercase tracking-widest text-blue-800 mb-2">
                  Assign Master Location <span className="text-blue-600 bg-blue-100 px-1.5 rounded ml-1">({filteredLocations.length} Available)</span>
                </label>
                
                <select 
                  className="w-full border-2 border-blue-200 p-3 rounded-lg mb-4 outline-none focus:border-blue-600 font-bold text-sm bg-blue-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  disabled={isProcessing}
                >
                  <option value="" disabled>-- Select Official Center --</option>
                  {filteredLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      [{loc.center_code || "NO-CODE"}] {loc.center_name} ({loc.dist})
                    </option>
                  ))}
                </select>

                {filteredLocations.length === 0 && (
                  <p className="text-[10px] text-red-600 font-bold mt-2 mb-4 bg-red-50 p-2 rounded">
                    ⚠️ You have zero locations configured with this role. Go to the Locations module to configure one first.
                  </p>
                )}

                <button 
                  onClick={handleApprove}
                  disabled={isProcessing || !selectedLocation}
                  className="w-full bg-slate-900 text-white py-3.5 rounded-lg font-black hover:bg-slate-800 transition-colors shadow-md disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>
                      Provisioning Auth...
                    </>
                  ) : (
                    "✅ Approve & Provision Partner"
                  )}
                </button>

                {!showRejectForm ? (
                  <button 
                    onClick={() => setShowRejectForm(true)}
                    disabled={isProcessing}
                    className="w-full bg-red-50 text-red-700 py-3 rounded-lg font-bold mt-3 hover:bg-red-100 transition-colors border border-red-100 disabled:opacity-50"
                  >
                    Decline Application
                  </button>
                ) : (
                  <div className="mt-6 border-t border-gray-200 pt-6 animate-in fade-in slide-in-from-top-4">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-red-700 mb-2">Reason for Rejection *</label>
                    <textarea 
                      className="w-full border-2 border-red-200 p-3 rounded-lg outline-none focus:border-red-500 mb-4 text-sm font-medium"
                      rows={3}
                      placeholder="e.g. Background check failed, Invalid documents..."
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      disabled={isProcessing}
                    />
                    <div className="flex gap-2">
                      <button 
                        onClick={handleReject}
                        disabled={isProcessing}
                        className="flex-1 bg-red-600 text-white py-2.5 rounded-lg font-black shadow hover:bg-red-700 disabled:opacity-50 flex justify-center items-center"
                      >
                        {isProcessing ? "Processing..." : "Confirm Reject"}
                      </button>
                      <button 
                        onClick={() => setShowRejectForm(false)}
                        disabled={isProcessing}
                        className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-lg font-bold hover:bg-slate-200 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
          </div>
        </div>
      </div>
    </div>
  );
}