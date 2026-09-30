"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function PartnerTermsWall() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // State for the 4 mandatory checkboxes
  const [terms, setTerms] = useState({
    allotment: false,
    nonRefundable: false,
    commercial: false,
    jurisdiction: false
  });

  // The button only activates if ALL four are true
  const allAccepted = terms.allotment && terms.nonRefundable && terms.commercial && terms.jurisdiction;

  const handleAcceptTerms = async () => {
    setIsSubmitting(true);
    try {
      // 1. Get the securely logged-in partner's session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session found.");

      // 2. Update their record in the database
      const { error } = await supabase
        .from('active_partners')
        .update({ tc_accepted: true, tc_accepted_at: new Date().toISOString() })
        .eq('email', session.user.email); // Matches the partner by their login email

      if (error) throw error;

      // 3. Unlock the dashboard
      router.push("/partner/dashboard");
    } catch (error: any) {
      alert("Authentication Error: " + error.message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        
        <div className="bg-slate-900 p-8 text-center border-b-4 border-blue-600">
          <h1 className="text-3xl font-black text-white mb-2">Fast Ark Partner Portal</h1>
          <p className="text-blue-200 font-medium">Action Required: Mandatory Terms & Conditions</p>
        </div>

        <div className="p-8">
          <p className="text-slate-600 mb-6 font-medium">
            Welcome to the Fast Ark network. Before accessing your operational dashboard and stock request systems, you must read and accept the following corporate guidelines.
          </p>

          <div className="space-y-4 mb-8">
            
            {/* Term 1 */}
            <label className={`flex items-start gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${terms.allotment ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
              <input type="checkbox" className="mt-1 w-5 h-5 accent-blue-600" checked={terms.allotment} onChange={(e) => setTerms({...terms, allotment: e.target.checked})} />
              <div>
                <h3 className="font-bold text-slate-800">1. Allotment Rights</h3>
                <p className="text-sm text-slate-600 mt-1">Fast Ark Private Limited reserves the sole and absolute right to approve, allot, or decline the IRCTC Agent ID creation upon review of applicant credentials and compliance documents.</p>
              </div>
            </label>

            {/* Term 2 */}
            <label className={`flex items-start gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${terms.nonRefundable ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
              <input type="checkbox" className="mt-1 w-5 h-5 accent-blue-600" checked={terms.nonRefundable} onChange={(e) => setTerms({...terms, nonRefundable: e.target.checked})} />
              <div>
                <h3 className="font-bold text-slate-800">2. Non-Refundable Policy</h3>
                <p className="text-sm text-slate-600 mt-1">Any application processing fee or commercial charges deposited are strictly non-refundable under all circumstances once submitted.</p>
              </div>
            </label>

            {/* Term 3 */}
            <label className={`flex items-start gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${terms.commercial ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
              <input type="checkbox" className="mt-1 w-5 h-5 accent-blue-600" checked={terms.commercial} onChange={(e) => setTerms({...terms, commercial: e.target.checked})} />
              <div>
                <h3 className="font-bold text-slate-800">3. Commercial Terms</h3>
                <p className="text-sm text-slate-600 mt-1">The authorized commission structure and operational commercial guidelines will be shared upon successful verification and ID issuance.</p>
              </div>
            </label>

            {/* Term 4 (Jurisdiction) */}
            <label className={`flex items-start gap-4 p-5 rounded-lg border-2 transition-colors cursor-pointer ${terms.jurisdiction ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-200'}`}>
              <input type="checkbox" className="mt-1 w-6 h-6 accent-green-600" checked={terms.jurisdiction} onChange={(e) => setTerms({...terms, jurisdiction: e.target.checked})} />
              <div>
                <h3 className="font-black text-slate-900 uppercase">4. Final Acceptance & Jurisdiction</h3>
                <p className="text-sm text-slate-800 font-medium mt-1">
                  I ACCEPT ALL THE TERMS AND CONDITIONS AND WILL FOLLOW THE SOP AS PER THE COMPANY NORMS. IF I FAIL TO DO SO, THE COMPANY HAS ALL RIGHTS TO TAKE ACTION AS PER NORMS. LEGAL JURISDICTION IS BANGALORE, KARNATAKA.
                </p>
              </div>
            </label>

          </div>

          <button 
            onClick={handleAcceptTerms}
            disabled={!allAccepted || isSubmitting}
            className={`w-full py-4 rounded-xl font-black text-lg transition-all shadow-md ${
              allAccepted 
                ? 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg transform hover:-translate-y-0.5' 
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? "Registering Acceptance..." : allAccepted ? "Accept & Enter Dashboard" : "Please Accept All Terms to Continue"}
          </button>

        </div>
      </div>
    </div>
  );
}