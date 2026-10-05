"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase"; 

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

      // Insert right after authData is returned and verified:
      if (authData.user.user_metadata?.must_change_password) {
        router.push("/update-password");
        return;
      }

      // 2. Strict Verification against back_office_staff Table
      const { data: staffData, error: staffError } = await supabase
        .from("back_office_staff")
        .select("id, name, role, status")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();

      if (staffError || !staffData) {
        // Force sign out immediately if user is not in back_office_staff
        await supabase.auth.signOut();
        throw new Error(
          "Access Denied: This credential is not mapped to an internal Back-Office profile."
        );
      }

      // 3. Strict Status Check (The Kill-Switch)
      if (staffData.status !== "Active") {
        await supabase.auth.signOut();
        throw new Error("Account Deactivated: Your clearance has been revoked. Contact Administration.");
      }

      // [CRITICAL FIX]: Self-Healing JWT Token
      // Instantly patch the Supabase JWT Cookie with the correct DB Role.
      // This permanently stops "Ghost Click" bounces in the proxy.ts middleware.
      if (authData.user.user_metadata?.role !== staffData.role) {
        await supabase.auth.updateUser({
          data: { role: staffData.role }
        });
      }

      // 4. Role-Aware Intelligent Dispatch
      setMessage("✅ Clearance verified. Establishing secure connection...");
      router.push("/dashboard");

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

        <div className="text-center mb-8 mt-2">
          <div className="w-12 h-12 bg-slate-900 border border-slate-700 rounded-xl flex items-center justify-center text-white font-black text-2xl mx-auto mb-4 shadow-md">
            F
          </div>
          <h1 className="text-2xl font-black tracking-wider text-white uppercase">FAST ARK</h1>
          <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest mt-1">Corporate Command Hub &bull; Authorized Personnel Only</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 text-xs font-bold rounded-lg border leading-relaxed ${
            message.startsWith("❌") 
              ? "bg-red-950/50 text-red-400 border-red-900/50" 
              : "bg-emerald-950/50 text-emerald-400 border-emerald-900/50"
          }`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-5">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
              Staff Email Address
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
            {isLoading ? "Authenticating Clearance..." : "Authorize Access"}
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