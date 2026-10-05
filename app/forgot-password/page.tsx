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
      const redirectUrl = `${window.location.origin}/update-password`;

      // 1. Dispatch Supabase Recovery Email
      const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: redirectUrl,
      });

      if (error) throw error;

      // 2. ENTERPRISE SECURITY TELEMETRY (Immutable Audit Log)
      // Logs the attempt even though the user isn't authenticated yet to track potential spam/attacks.
      await supabase.from('staff_activity_logs').insert([{
        staff_id: 'SYSTEM',
        staff_email: targetEmail,
        action_type: 'SECURITY_AUDIT',
        module: 'AUTHENTICATION',
        target_id: 'PASSWORD_RESET_REQUEST',
        details: `Password recovery link requested and dispatched to ${targetEmail}.`
      }]);

      setIsError(false);
      setStatusMsg("✅ Password reset link has been dispatched to your email address.");
      setEmail("");
    } catch (err: any) {
      setIsError(true);
      setStatusMsg("❌ " + (err.message || "Failed to dispatch reset link."));
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
          <div className={`mb-4 p-3 text-xs font-bold rounded-lg border leading-relaxed ${
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
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm font-bold text-white outline-none focus:border-blue-500 transition"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition shadow-lg disabled:opacity-50 mt-2"
          >
            {loading ? "Logging Request & Dispatching..." : "Send Password Reset Link"}
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