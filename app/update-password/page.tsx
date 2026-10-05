"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (password.length < 8) {
      return setErrorMsg("Password must be at least 8 characters long.");
    }

    if (password !== confirmPassword) {
      return setErrorMsg("Passwords do not match.");
    }

    setLoading(true);

    try {
      // 1. Verify active session (from First-Login or Email Recovery Link)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("No active recovery session found. Please request a new reset link.");
      }

      // 2. Update password and wipe the must_change_password flag
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
        data: { must_change_password: false }
      });

      if (updateError) throw updateError;

      const userEmail = session.user.email || "Unknown";

      // 3. ENTERPRISE SECURITY TELEMETRY (Immutable Audit Log)
      await supabase.from('staff_activity_logs').insert([{
        staff_id: session.user.id,
        staff_email: userEmail.trim().toLowerCase(),
        action_type: 'SECURITY_AUDIT',
        module: 'AUTHENTICATION',
        target_id: session.user.id,
        details: `Credentials updated successfully. Password change locked.`
      }]);

      setSuccessMsg("✅ Password updated securely! Routing to your designated command center...");

      // 4. BULLETPROOF ROUTING FIX: Use case-insensitive matching (.ilike)
      // This prevents Staff from being accidentally routed to the Partner Dashboard
      const { data: staff } = await supabase
        .from("back_office_staff")
        .select("role")
        .ilike("email", userEmail.trim())
        .maybeSingle();

      setTimeout(() => {
        if (staff) {
          // It is a verified Staff member -> Route to Admin Hub
          router.push("/dashboard");
        } else {
          // It is a Franchise Partner -> Route to Partner Portal
          router.push("/partner/dashboard");
        }
      }, 2000);

    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 font-sans">
      <div className="max-w-md w-full bg-slate-950 p-8 rounded-2xl shadow-2xl border border-slate-800">
        
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-2xl mx-auto mb-3 shadow-md">
            🔒
          </div>
          <h1 className="text-2xl font-black text-white uppercase tracking-wider">Set New Password</h1>
          <p className="text-slate-400 text-xs font-bold mt-1">
            Please choose a strong password to secure your Fast Ark portal access.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-950/60 border border-red-800 text-red-300 text-xs font-bold rounded-lg leading-relaxed">
            ❌ {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs font-bold rounded-lg leading-relaxed">
            {successMsg}
          </div>
        )}

        <form onSubmit={handlePasswordUpdate} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
              New Password (Min 8 Characters) *
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm font-bold text-white outline-none focus:border-blue-500 transition"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
              Confirm New Password *
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm font-bold text-white outline-none focus:border-blue-500 transition"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition shadow-lg disabled:opacity-50 mt-2"
          >
            {loading ? "Updating Credentials & Routing..." : "Save & Continue"}
          </button>
        </form>

      </div>
    </div>
  );
}