// FILE PATH: ./app/components/SessionManager.tsx
"use client";

import React, { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";

const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const ACTIVITY_STORAGE_KEY = "fapl_last_active_ts";

export default function SessionManager({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const lastActivity = useRef<number>(Date.now());
  const lastStorageSync = useRef<number>(0);
  const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);
  const inactivityTimer = useRef<NodeJS.Timeout | null>(null);

  const isProtectedRoute =
    pathname.includes("/dashboard") ||
    pathname.includes("/partner/dashboard") ||
    pathname.includes("/partner/stock") ||
    pathname.includes("/partner/sales") ||
    pathname.includes("/partner/deposit") ||
    pathname.includes("/partner/helpdesk") ||
    pathname.includes("/partner/aadhaar") ||
    pathname.includes("/partner/terms") ||
    pathname.includes("/partner/resubmit");

  const executeLogout = async (reason: string) => {
    alert(reason);
    localStorage.removeItem("fapl_session_token");
    localStorage.removeItem(ACTIVITY_STORAGE_KEY);
    await supabase.auth.signOut();
    router.push(pathname.includes("/partner") ? "/partner/login" : "/login");
  };

  const handleActivity = () => {
    const now = Date.now();
    lastActivity.current = now;
    // Throttle localStorage writes to once every 5 seconds so multi-tab sessions stay synced
    if (now - lastStorageSync.current > 5000) {
      lastStorageSync.current = now;
      try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
      } catch (_) {}
    }
  };

  const checkHeartbeatAndConcurrency = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const localToken = localStorage.getItem("fapl_session_token");

      const { data: dbSession, error } = await supabase
        .from("active_sessions")
        .select("session_token")
        .eq("user_id", session.user.id)
        .maybeSingle();

      // Self-Heal: If user arrived via password-recovery link and localToken is missing, bind it instead of false logout
      if (!localToken) {
        if (dbSession?.session_token) {
          localStorage.setItem("fapl_session_token", dbSession.session_token);
          return;
        } else {
          const newToken = `RECOVERED_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2)}`;
          await supabase.from("active_sessions").upsert(
            {
              user_id: session.user.id,
              session_token: newToken,
              last_active: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );
          localStorage.setItem("fapl_session_token", newToken);
          return;
        }
      }

      if (error || !dbSession) return;

      if (dbSession.session_token !== localToken) {
        return executeLogout(
          "Security Alert: Your account was logged into from another browser or device. You have been disconnected."
        );
      }

      await supabase
        .from("active_sessions")
        .update({ last_active: new Date().toISOString() })
        .eq("user_id", session.user.id);
    } catch (err) {
      console.error("Heartbeat error", err);
    }
  };

  const checkInactivity = () => {
    let latestActiveTs = lastActivity.current;
    try {
      const sharedTs = Number(localStorage.getItem(ACTIVITY_STORAGE_KEY) || 0);
      if (sharedTs > latestActiveTs) {
        latestActiveTs = sharedTs;
        lastActivity.current = sharedTs;
      }
    } catch (_) {}

    const timeSinceLastActive = Date.now() - latestActiveTs;
    if (timeSinceLastActive >= INACTIVITY_LIMIT_MS) {
      executeLogout(
        "Session Expired: You have been logged out due to 10 minutes of inactivity to protect your financial data."
      );
    }
  };

  useEffect(() => {
    if (!isProtectedRoute) return;

    handleActivity();

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    events.forEach((event) => window.addEventListener(event, handleActivity));

    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === ACTIVITY_STORAGE_KEY && e.newValue) {
        const ts = Number(e.newValue);
        if (!isNaN(ts) && ts > lastActivity.current) {
          lastActivity.current = ts;
        }
      }
    };
    window.addEventListener("storage", handleStorageSync);

    heartbeatTimer.current = setInterval(
      checkHeartbeatAndConcurrency,
      HEARTBEAT_INTERVAL_MS
    );
    inactivityTimer.current = setInterval(checkInactivity, 30000);

    return () => {
      events.forEach((event) =>
        window.removeEventListener(event, handleActivity)
      );
      window.removeEventListener("storage", handleStorageSync);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (inactivityTimer.current) clearInterval(inactivityTimer.current);
    };
  }, [isProtectedRoute, pathname]);

  return <>{children}</>;
}