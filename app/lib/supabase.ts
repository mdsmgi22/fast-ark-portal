// FILE PATH: ./app/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://build-placeholder.supabase.co";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "build-placeholder-key";

// =========================================================================
// HYBRID COOKIE + LOCALSTORAGE ADAPTER (4KB-SAFE EDGE COOKIE + FULL LOCALSTORAGE)
// Stores a lightweight { access_token } cookie (~700B) for Next.js proxy.ts
// so browsers never drop oversized (>4096B) session cookies, while keeping
// the complete session payload in localStorage for client-side token refresh.
// =========================================================================
const writeCookie = (key: string, value: string) => {
  if (typeof document === "undefined") return;
  const isSecure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "secure;"
      : "";

  let cookiePayload = value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && parsed.access_token) {
      cookiePayload = JSON.stringify({ access_token: parsed.access_token });
    }
  } catch (_) {}

  document.cookie = `${key}=${encodeURIComponent(
    cookiePayload
  )}; path=/; max-age=31536000; SameSite=Lax; ${isSecure}`;
};

const customHybridStorage = {
  getItem: (key: string) => {
    if (typeof document === "undefined") return null;

    // 1. Read full session (with refresh_token & user) from localStorage first
    try {
      const localVal = window.localStorage.getItem(key);
      if (localVal) {
        writeCookie(key, localVal);
        return localVal;
      }
    } catch (e) {
      console.warn("LocalStorage read warning:", e);
    }

    // 2. Fallback to cookie if localStorage was cleared
    const match = document.cookie.match(new RegExp("(^| )" + key + "=([^;]+)"));
    if (match) {
      return decodeURIComponent(match[2]);
    }
    return null;
  },
  setItem: (key: string, value: string) => {
    if (typeof document === "undefined") return;
    writeCookie(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      console.warn("LocalStorage write warning:", e);
    }
  },
  removeItem: (key: string) => {
    if (typeof document === "undefined") return;
    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      console.warn("LocalStorage remove warning:", e);
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: typeof window !== "undefined" ? customHybridStorage : undefined,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});