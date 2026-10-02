import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // 1. Extract Supabase auth cookies
  const authCookies = request.cookies.getAll().filter(
    cookie => cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')
  );

  const hasAuthCookie = authCookies.length > 0;

  // Protect Partner Routes
  if (pathname.startsWith('/partner/dashboard') || pathname.startsWith('/partner/sales') || pathname.startsWith('/partner/deposit') || pathname.startsWith('/partner/stock')) {
    if (!hasAuthCookie) return NextResponse.redirect(new URL('/partner/login', request.url));
  }

  // Protect Back-Office Routes & Enforce RBAC
  if (pathname.startsWith('/dashboard')) {
    if (!hasAuthCookie) return NextResponse.redirect(new URL('/login', request.url));

    try {
      authCookies.sort((a, b) => a.name.localeCompare(b.name));
      const tokenString = authCookies.map(c => decodeURIComponent(c.value)).join('');
      
      const parsedCookies = JSON.parse(tokenString);
      const accessToken = parsedCookies?.access_token || (Array.isArray(parsedCookies) ? parsedCookies[0] : null);

      if (!accessToken || typeof accessToken !== 'string') {
        throw new Error("Invalid or Missing Access Token structure.");
      }

      const base64Url = accessToken.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      );
      
      const payload = JSON.parse(jsonPayload);
      
      // [FIX 1]: Normalize the role to lowercase to prevent strict-casing bounces
      const rawRole = payload.user_metadata?.role || '';
      const safeRole = rawRole.trim().toLowerCase();

      const financeRoutes = ['/dashboard/accounts', '/dashboard/sales-verification', '/dashboard/reports', '/dashboard/banking'];
      
      // [FIX 2]: Add '/dashboard/manager-mis' so Staff can securely pass the proxy
      const opsRoutes = ['/dashboard/applications', '/dashboard/logistics', '/dashboard/ocsc', '/dashboard/manager-mis'];
      const managerRoutes = [...opsRoutes, '/dashboard/compliance', '/dashboard/locations', '/dashboard/messages', '/dashboard/partners'];
      const adminOnlyRoutes = ['/dashboard/staff', '/dashboard/staff-reports'];

      // Accountant Guard
      if (safeRole === 'accountant') {
        if (!financeRoutes.some(p => pathname.startsWith(p)) && pathname !== '/dashboard') {
          return NextResponse.redirect(new URL('/dashboard', request.url));
        }
      }

      // Staff Guard
      if (safeRole === 'staff') {
        if (!opsRoutes.some(p => pathname.startsWith(p)) && pathname !== '/dashboard') {
          return NextResponse.redirect(new URL('/dashboard', request.url));
        }
      }

      // Manager Guard
      if (safeRole === 'manager') {
        if (!managerRoutes.some(p => pathname.startsWith(p)) && pathname !== '/dashboard') {
          return NextResponse.redirect(new URL('/dashboard', request.url));
        }
      }

      // [CRITICAL FIX]: Admin Guard Fault Tolerance
      // To prevent the "Ghost Click" 307 bounce, we let the native database handle Admin verification 
      // instead of failing solely on a stale browser cookie.
      if (adminOnlyRoutes.some(p => pathname.startsWith(p))) {
        if (['accountant', 'staff', 'manager'].includes(safeRole)) {
          return NextResponse.redirect(new URL('/dashboard', request.url));
        }
      }

    } catch (error) {
      console.error("RBAC Edge Violation or JWT Decode Error:", error);
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/partner/dashboard/:path*', 
    '/partner/sales/:path*', 
    '/partner/deposit/:path*', 
    '/partner/stock/:path*', 
    '/dashboard/:path*'
  ],
};