"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";

export default function ResubmitApplication() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [partnerDetails, setPartnerDetails] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    verifyRejectedStatus();
  }, []);

  const verifyRejectedStatus = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return router.push("/login");

    const { data, error } = await supabase
      .from('active_partners')
      .select('*')
      .eq('auth_id', session.user.id)
      .single();

    // Security Gate: Only 'Rejected' profiles can access this page
    if (error || !data || data.status !== 'Rejected') {
      router.push("/login");
      return;
    }

    setPartnerDetails(data);
    setLoading(false);
  };

  const handleResubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // OVERWRITE ENGINE: Update the existing row instead of creating a new one
      const { error } = await supabase
        .from('active_partners')
        .update({ 
          status: 'Pending',
          // Note: If you have file upload inputs here for corrected PAN/GST docs, 
          // you would append their new storage URLs to this update payload.
        })
        .eq('id', partnerDetails.id);

      if (error) throw error;

      alert("✅ Application successfully updated and resubmitted for corporate review.");
      
      // Log them out so they wait for the new approval
      await supabase.auth.signOut();
      router.push("/login");

    } catch (err: any) {
      alert("Error resubmitting application: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="max-w-xl w-full bg-white p-8 rounded-2xl shadow-xl border border-red-200">
        <div className="text-center mb-6">
          <span className="text-5xl">⚠️</span>
          <h1 className="text-2xl font-black text-slate-900 mt-4 uppercase tracking-widest">Application Rejected</h1>
          <p className="text-slate-500 font-bold mt-2">
            Your franchise application requires corrections before corporate approval.
          </p>
        </div>

        <div className="bg-red-50 border border-red-200 p-5 rounded-lg mb-6">
          <p className="text-[10px] font-black uppercase tracking-widest text-red-800 mb-2">Corporate Remarks</p>
          <p className="font-black text-red-900 text-sm">
            {partnerDetails.rejection_reason || "Invalid documents or missing mandatory operational information. Please verify your submitted details."}
          </p>
        </div>

        <form onSubmit={handleResubmit} className="space-y-4 border-t border-slate-200 pt-6">
          <div className="bg-slate-50 p-4 rounded border border-slate-200 mb-4">
            <p className="text-xs font-bold text-slate-600">
              Your email <span className="text-slate-900 font-black">{partnerDetails.email}</span> is currently locked to this application. Clicking resubmit will place your existing profile back into the corporate queue.
            </p>
          </div>
          
          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full bg-slate-900 text-white font-black py-4 rounded-lg shadow-md hover:bg-red-600 transition disabled:opacity-50 uppercase tracking-widest text-sm"
          >
            {isSubmitting ? "Processing Resubmission..." : "Resubmit Application"}
          </button>
        </form>
      </div>
    </div>
  );
}