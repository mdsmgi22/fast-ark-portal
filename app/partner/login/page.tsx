"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import Link from "next/link";
import Image from "next/image";

export default function PartnerLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      // 1. Authenticate with Supabase
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) throw new Error("Invalid email or password.");
      if (!authData.user) throw new Error("Authentication failed.");

      // 2. Verify they are an Active Partner in the database
      const { data: partnerData, error: partnerError } = await supabase
        .from('active_partners')
        .select('id, status, tc_accepted')
        .eq('email', email.trim().toLowerCase())
        .single();

      if (partnerError || !partnerData) {
        await supabase.auth.signOut();
        throw new Error("Unauthorized: You are not registered as an official Fast Ark partner.");
      }

      if (partnerData.status === 'Suspended') {
        await supabase.auth.signOut();
        throw new Error("Account Suspended: Please contact your Fast Ark manager.");
      }

      // =====================================================================
      // 3. SESSION CONCURRENCY & IP TRACKING ENGINE
      // =====================================================================
      const sessionToken = `PARTNER_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      let currentIp = "Unknown";
      
      try {
        const ipRes = await fetch("https://api.ipify.org?format=json");
        currentIp = (await ipRes.json()).ip;
      } catch (err) {
        console.warn("Could not fetch IP address for audit log.");
      }

      // Upsert the token to the database to enforce Single Active Session
      const { error: sessionError } = await supabase.from('active_sessions').upsert({
        user_id: authData.user.id,
        session_token: sessionToken,
        ip_address: currentIp,
        last_active: new Date().toISOString()
      });

      if (sessionError) throw new Error("Failed to establish secure session connection.");

      // Store locally for the SessionManager component to verify
      localStorage.setItem("fapl_session_token", sessionToken);

      // =====================================================================
      // 4. ENTERPRISE SECURITY TELEMETRY (Immutable Audit Log)
      // =====================================================================
      await supabase.from('staff_activity_logs').insert([{
        staff_id: authData.user.id,
        staff_email: email.trim().toLowerCase(),
        action_type: 'SECURITY_AUDIT',
        module: 'AUTHENTICATION',
        target_id: partnerData.id,
        details: `Partner successfully authenticated. IP: ${currentIp}`
      }]);

      // =====================================================================
      // 5. INTELLIGENT ROUTING
      // =====================================================================
      if (authData.user.user_metadata?.must_change_password) {
        router.push("/update-password");
        return;
      }

      if (!partnerData.tc_accepted) {
        router.push("/partner/terms");
      } else {
        router.push("/partner/dashboard");
      }

    } catch (error: any) {
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 font-sans">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        
        <div className="bg-blue-600 p-8 text-center border-b-4 border-slate-900">
          <div className="w-10 h-10 bg-white rounded flex items-center justify-center text-blue-600 font-black text-xl mx-auto mb-3 shadow-sm">
            F
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">FAST ARK</h1>
          <p className="text-blue-100 font-bold mt-1 uppercase text-[10px] tracking-widest">Authorized Partner Portal</p>
        </div>

        <div className="p-8">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 font-bold text-sm rounded-lg shadow-sm leading-relaxed">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Registered Email ID</label>
              <input 
                type="email" 
                required 
                className="w-full border-2 border-slate-200 p-3.5 rounded-lg outline-none focus:border-blue-600 transition font-bold text-slate-800"
                placeholder="Enter your registered email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-[10px] uppercase tracking-widest font-black text-slate-500">Password</label>
                <Link href="/forgot-password" className="text-[10px] font-bold text-blue-600 hover:underline">
                  Forgot Password?
                </Link>
              </div>
              <input 
                type="password" 
                required 
                className="w-full border-2 border-slate-200 p-3.5 rounded-lg outline-none focus:border-blue-600 transition font-bold text-slate-800"
                placeholder="Enter the password sent to your email"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-slate-900 text-white font-black text-sm uppercase tracking-widest py-4 rounded-xl shadow-lg hover:bg-blue-600 transition transform hover:-translate-y-0.5 disabled:bg-slate-300 disabled:text-slate-500 disabled:transform-none mt-2"
            >
              {loading ? "Authenticating Clearance & Logging..." : "Secure Login"}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center space-y-3">
            <p className="text-xs font-bold text-slate-500">
              Not a partner yet? <Link href="/apply" className="text-blue-600 hover:text-blue-800 underline">Submit an application</Link>
            </p>
            <Link href="/" className="inline-block text-[10px] text-slate-400 font-black uppercase tracking-widest hover:text-slate-600 transition">
              &larr; Return to Website
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}