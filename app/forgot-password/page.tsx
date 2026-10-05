"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [isError, setIsError] = useState(false);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatusMsg("");
    setIsError(false);

    const targetEmail = email.trim().toLowerCase();

    try {
      // =====================================================================
      // 1. STRICT DATABASE VERIFICATION (Security Fix)
      // Prevent unauthorized or suspended users from generating a reset token
      // =====================================================================
      const [staffRes, partnerRes] = await Promise.all([
        supabase.from("back_office_staff").select("status").eq("email", targetEmail).maybeSingle(),
        supabase.from("active_partners").select("status").eq("email", targetEmail).maybeSingle()
      ]);

      const staffData = staffRes.data;
      const partnerData = partnerRes.data;

      // Rule A: Identity must exist in our corporate directories
      if (!staffData && !partnerData) {
        throw new Error("Access Denied: This email is not registered in the corporate or partner directory.");
      }

      // Rule B: Identity must be currently Active (No suspensions)
      if ((staffData && staffData.status !== "Active") || (partnerData && partnerData.status !== "Active")) {
        throw new Error("Account Deactivated: Your clearance has been revoked. Password recovery is disabled.");
      }

      // =====================================================================
      // 2. DISPATCH RECOVERY EMAIL
      // =====================================================================
      const redirectUrl = `${window.location.origin}/update-password`;

      const { error: authError } = await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: redirectUrl,
      });

      if (authError) throw authError;

      // =====================================================================
      // 3. ENTERPRISE SECURITY TELEMETRY (Immutable Audit Log)
      // =====================================================================
      await supabase.from('staff_activity_logs').insert([{
        staff_id: 'SYSTEM',
        staff_email: targetEmail,
        action_type: 'SECURITY_AUDIT',
        module: 'AUTHENTICATION',
        target_id: 'PASSWORD_RESET_REQUEST',
        details: `Verified account status and dispatched password recovery link to ${targetEmail}.`
      }]);

      setIsError(false);
      setStatusMsg("✅ Password reset link has been securely dispatched to your email address.");
      setEmail("");
      
    } catch (err: any) {
      setIsError(true);
      setStatusMsg("❌ " + (err.message || "Failed to dispatch reset link."));
      
      // Optional: Log failed unauthorized attempts silently for security monitoring
      await supabase.from('staff_activity_logs').insert([{
        staff_id: 'SYSTEM',
        staff_email: targetEmail,
        action_type: 'SECURITY_BLOCKED',
        module: 'AUTHENTICATION',
        target_id: 'UNAUTHORIZED_RESET_ATTEMPT',
        details: `Blocked password reset attempt: ${err.message}`
      }]);
      
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-slate-950 p-8 rounded-2xl shadow-2xl border border-slate-800">
        
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-slate-800 border border-slate-700 rounded-xl flex items-center justify-center text-white font-black text-2xl mx-auto mb-3 shadow-md">
            🔑
          </div>
          <h1 className="text-2xl font-black text-white uppercase tracking-wider">Reset Password</h1>
          <p className="text-slate-400 text-xs font-bold mt-1">
            Enter your official registered email to receive an authorized recovery link.
          </p>
        </div>

        {statusMsg && (
          <div className={`mb-4 p-4 text-xs font-bold rounded-lg border leading-relaxed ${
            isError ? "bg-red-950/60 border-red-800 text-red-300" : "bg-emerald-950/60 border-emerald-800 text-emerald-300"
          }`}>
            {statusMsg}
          </div>
        )}

        <form onSubmit={handleResetRequest} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
              Registered Email Address *
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@fastark.in"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm font-bold text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition placeholder:text-slate-600"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition shadow-lg disabled:opacity-50 mt-2"
          >
            {loading ? "Verifying & Dispatching..." : "Send Password Reset Link"}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-800 text-center">
          <Link href="/login" className="text-xs font-bold text-slate-400 hover:text-white transition">
            &larr; Back to Login
          </Link>
        </div>

      </div>
    </div>
  );
}