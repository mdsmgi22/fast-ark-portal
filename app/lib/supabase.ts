import { createClient } from '@supabase/supabase-js';

// Provide a build-time fallback so the static compiler never crashes
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://build-placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'build-placeholder-key';

// =========================================================================
// HYBRID COOKIE + LOCALSTORAGE ADAPTER (WEB EDGE + MOBILE APP READY)
// Mirrors auth tokens to both HTTP Cookies (for Next.js Edge proxy.ts) and
// LocalStorage (so Capacitor / React Native WebViews never drop sessions).
// =========================================================================
const writeCookie = (key: string, value: string) => {
  if (typeof document === 'undefined') return;
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'secure;' : '';
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax; ${isSecure}`;
};

const customHybridStorage = {
  getItem: (key: string) => {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + key + '=([^;]+)'));
    if (match) {
      return decodeURIComponent(match[2]);
    }
    // Mobile App Fallback: If WebView cleared cookies, recover from localStorage & re-sync cookie
    try {
      const localVal = window.localStorage.getItem(key);
      if (localVal) {
        writeCookie(key, localVal);
        return localVal;
      }
    } catch (e) {
      console.warn("LocalStorage read fallback warning:", e);
    }
    return null;
  },
  setItem: (key: string, value: string) => {
    if (typeof document === 'undefined') return;
    writeCookie(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      console.warn("LocalStorage write warning:", e);
    }
  },
  removeItem: (key: string) => {
    if (typeof document === 'undefined') return;
    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      console.warn("LocalStorage remove warning:", e);
    }
  }
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: typeof window !== 'undefined' ? customHybridStorage : undefined,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  }
});