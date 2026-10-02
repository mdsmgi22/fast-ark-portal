import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  const authCookies = request.cookies.getAll().filter(
    cookie => cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')
  );

  const hasAuthCookie = authCookies.length > 0;

  if (pathname.startsWith('/partner/dashboard') || pathname.startsWith('/partner/sales') || pathname.startsWith('/partner/deposit') || pathname.startsWith('/partner/stock')) {
    if (!hasAuthCookie) return NextResponse.redirect(new URL('/partner/login', request.url));
  }

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
      
      const rawRole = payload.user_metadata?.role || '';
      const safeRole = rawRole.trim().toLowerCase();

      const financeRoutes = ['/dashboard/accounts', '/dashboard/sales-verification', '/dashboard/reports', '/dashboard/banking'];
      
      // [STRICT ALLOWANCE]: Staff added specifically to the MIS route
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
      if (adminOnlyRoutes.some(p => pathname.startsWith(p))) {
        // Explicitly bypass the Edge check. We allow the native DB lookup inside the
        // page component to handle security. This stops the 307 Ghost Redirect loop.
        return NextResponse.next();
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