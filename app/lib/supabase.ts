import { createClient } from '@supabase/supabase-js';

// ARCHITECTURAL FIX: Provide a build-time fallback so the static compiler never crashes
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://build-placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'build-placeholder-key';

// =========================================================================
// ARCHITECTURAL FIX: Cookie Storage Adapter
// Forces Supabase to write sessions to HTTP Cookies instead of LocalStorage 
// so the Edge Proxy can intercept and read the JWT.
// =========================================================================
const customCookieStorage = {
  getItem: (key: string) => {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + key + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  },
  setItem: (key: string, value: string) => {
    if (typeof document === 'undefined') return;
    // Set cookie to expire in 1 year, accessible across the whole app
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax; secure`;
  },
  removeItem: (key: string) => {
    if (typeof document === 'undefined') return;
    // Obliterate the cookie on sign out
    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Dynamically apply the cookie storage only in the browser context
    storage: typeof window !== 'undefined' ? customCookieStorage : undefined,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  }
});