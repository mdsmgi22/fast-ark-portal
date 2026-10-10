"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase"; 
import Image from "next/image";

export default function BackOfficeLoginPage() {
  const router = useRouter();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(""); 
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      // 1. Authenticate with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
        email: email.trim().toLowerCase(), 
        password 
      });

      if (authError) throw new Error(authError.message);
      if (!authData.user) throw new Error("Authentication failed.");

      // 2. Fetch Profiles for Validation
      const { data: staffData } = await supabase
        .from("back_office_staff")
        .select("id, name, role, status")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();

      const { data: partnerData } = await supabase
        .from('active_partners')
        .select('id, status, tc_accepted, role')
        .eq('auth_id', authData.user.id)
        .maybeSingle();

      let isStaff = false;
      let targetId = "";

      // 3. Verify Clearance Status
      if (staffData) {
        if (staffData.status !== "Active") {
          await supabase.auth.signOut();
          throw new Error("Account Deactivated: Your clearance has been revoked. Contact Administration.");
        }
        if (authData.user.user_metadata?.role !== staffData.role) {
          await supabase.auth.updateUser({ data: { role: staffData.role } });
        }
        isStaff = true;
        targetId = staffData.id;
      } else if (partnerData) {
        if (partnerData.status === 'Rejected') {
          setMessage("⚠️ Application requires correction. Routing to portal...");
          router.push('/partner/resubmit');
          return;
        } else if (partnerData.status === 'Pending') {
          await supabase.auth.signOut();
          throw new Error("Your franchise application is currently under corporate review.");
        } else if (partnerData.status === 'Suspended') {
          await supabase.auth.signOut();
          throw new Error("Account Suspended: Please contact your Fast Ark manager.");
        }
        targetId = partnerData.id;
      } else {
        await supabase.auth.signOut();
        throw new Error("Access Denied: This credential is not mapped to an internal or partner profile.");
      }

      // =====================================================================
      // 4. SESSION CONCURRENCY & IP TRACKING ENGINE
      // =====================================================================
      const sessionPrefix = isStaff ? "STAFF" : "PARTNER";
      const sessionToken = `${sessionPrefix}_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      let currentIp = "Unknown";
      
      try {
        const ipRes = await fetch("https://api.ipify.org?format=json");
        currentIp = (await ipRes.json()).ip;
      } catch (err) {
        console.warn("Could not fetch IP address for audit log.");
      }

      const { error: sessionError } = await supabase.from('active_sessions').upsert({
        user_id: authData.user.id,
        session_token: sessionToken,
        ip_address: currentIp,
        last_active: new Date().toISOString()
      });

      if (sessionError) throw new Error("Failed to establish secure session connection.");

      localStorage.setItem("fapl_session_token", sessionToken);

      // =====================================================================
      // 5. SECURITY AUDIT LOGGING
      // =====================================================================
      await supabase.from('staff_activity_logs').insert([{
        staff_id: authData.user.id,
        staff_email: email.trim().toLowerCase(),
        action_type: 'SECURITY_AUDIT',
        module: 'AUTHENTICATION',
        target_id: targetId,
        details: `${isStaff ? 'Staff' : 'Partner'} authenticated. IP: ${currentIp}`
      }]);

      // =====================================================================
      // 6. INTELLIGENT ROUTING
      // =====================================================================
      if (authData.user.user_metadata?.must_change_password) {
        router.push("/update-password");
        return;
      }

      if (isStaff) {
        setMessage("✅ Clearance verified. Establishing secure connection...");
        router.push("/dashboard");
      } else {
        // TypeScript Fix: Optional chaining prevents the 18047 strict null check error
        if (!partnerData?.tc_accepted) {
          router.push("/partner/terms");
        } else {
          setMessage("✅ Partner verified. Routing to dashboard...");
          router.push("/partner/dashboard");
        }
      }

    } catch (err: any) {
      setMessage("❌ " + err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <div className="bg-slate-950 max-w-md w-full p-8 rounded-2xl shadow-2xl border border-slate-800 relative overflow-hidden">
        
        {/* Decorative Internal UI Element */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-purple-600 to-emerald-600"></div>

        <div className="text-center mb-8 mt-4">
          <div className="flex justify-center mb-3">
            <Image 
              src="/logo.png" 
              alt="Fast Ark Logo" 
              width={220} 
              height={70} 
              priority 
              className="object-contain"
            />
          </div>
          <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest mt-2">Corporate Command Hub &bull; Authorized Personnel Only</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 text-xs font-bold rounded-lg border leading-relaxed ${
            message.startsWith("❌") 
              ? "bg-red-950/50 text-red-400 border-red-900/50" 
              : message.startsWith("⚠️")
              ? "bg-amber-950/50 text-amber-400 border-amber-900/50"
              : "bg-emerald-950/50 text-emerald-400 border-emerald-900/50"
          }`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-5">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
              Email Address
            </label>
            <input 
              type="email" 
              required 
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm font-bold text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition placeholder:text-slate-600" 
              placeholder="name@fastark.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Secure Password
              </label>
              <Link href="/forgot-password" className="text-[10px] font-bold text-blue-400 hover:underline">
                Forgot Password?
              </Link>
            </div>
            <input 
              type="password" 
              required 
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm font-bold text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition placeholder:text-slate-600" 
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-white hover:bg-slate-200 text-slate-900 p-3.5 rounded-lg font-black text-xs uppercase tracking-widest transition shadow-md disabled:bg-slate-700 disabled:text-slate-500 mt-2"
          >
            {isLoading ? "Authenticating Clearance & Logging..." : "Authorize Access"}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-800 flex flex-col gap-2 text-center text-xs">
          <Link href="/partner/login" className="text-blue-600 font-bold hover:text-blue-400 transition">
            Are you a Franchise Partner? Partner Login &rarr;
          </Link>
          <Link href="/" className="text-slate-500 font-bold hover:text-slate-300 transition mt-2 uppercase tracking-widest text-[10px]">
            &larr; Abort & Return to Public Portal
          </Link>
        </div>

      </div>
    </div>
  );
}