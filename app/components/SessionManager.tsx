"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";

// 10 Minutes in milliseconds
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000; 
// Check the database every 60 seconds
const HEARTBEAT_INTERVAL_MS = 60 * 1000; 

export default function SessionManager({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  
  const lastActivity = useRef<number>(Date.now());
  const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);
  const inactivityTimer = useRef<NodeJS.Timeout | null>(null);

  // We only run the session manager on protected routes
  const isProtectedRoute = pathname.includes('/dashboard') || pathname.includes('/partner/dashboard') || pathname.includes('/partner/stock') || pathname.includes('/partner/sales') || pathname.includes('/partner/deposit');

  const executeLogout = async (reason: string) => {
    alert(reason);
    localStorage.removeItem("fapl_session_token");
    await supabase.auth.signOut();
    router.push(pathname.includes('/partner') ? '/partner/login' : '/login');
  };

  const handleActivity = () => {
    lastActivity.current = Date.now();
  };

  const checkHeartbeatAndConcurrency = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return; // Not logged in, let middleware handle it

      const localToken = localStorage.getItem("fapl_session_token");
      if (!localToken) return executeLogout("Session corrupted. Please log in again.");

      // Check DB for the active token
      const { data: dbSession, error } = await supabase
        .from('active_sessions')
        .select('session_token')
        .eq('user_id', session.user.id)
        .single();

      if (error || !dbSession) return;

      // CONCURRENCY CHECK: If the DB token doesn't match the local token, another device logged in!
      if (dbSession.session_token !== localToken) {
        return executeLogout("Security Alert: Your account was logged into from another browser or device. You have been disconnected.");
      }

      // Update last active time in DB to keep session alive
      await supabase.from('active_sessions').update({ last_active: new Date().toISOString() }).eq('user_id', session.user.id);

    } catch (err) {
      console.error("Heartbeat error", err);
    }
  };

  const checkInactivity = () => {
    const timeSinceLastActive = Date.now() - lastActivity.current;
    if (timeSinceLastActive >= INACTIVITY_LIMIT_MS) {
      executeLogout("Session Expired: You have been logged out due to 10 minutes of inactivity to protect your financial data.");
    }
  };

  useEffect(() => {
    if (!isProtectedRoute) return;

    // 1. Setup DOM Event Listeners for Activity Tracking
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(event => window.addEventListener(event, handleActivity));

    // 2. Start the Checkers
    heartbeatTimer.current = setInterval(checkHeartbeatAndConcurrency, HEARTBEAT_INTERVAL_MS);
    inactivityTimer.current = setInterval(checkInactivity, 30000); // Check inactivity every 30 seconds

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (inactivityTimer.current) clearInterval(inactivityTimer.current);
    };
  }, [isProtectedRoute, pathname]);

  return <>{children}</>;
}