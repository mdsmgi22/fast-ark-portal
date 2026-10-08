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
      
      const paddedBase64 = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
      const jsonPayload = decodeURIComponent(
        atob(paddedBase64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      );
      
      const payload = JSON.parse(jsonPayload);
      
      const rawRole = payload.user_metadata?.role || '';
      const safeRole = rawRole.trim().toLowerCase();

      const financeRoutes = ['/dashboard/accounts', '/dashboard/sales-verification', '/dashboard/reports', '/dashboard/banking'];
      const opsRoutes = ['/dashboard/applications', '/dashboard/logistics', '/dashboard/ocsc', '/dashboard/manager-mis'];
      const managerRoutes = [...opsRoutes, '/dashboard/compliance', '/dashboard/locations', '/dashboard/messages', '/dashboard/partners'];
      const adminOnlyRoutes = ['/dashboard/staff', '/dashboard/staff-reports'];
      const supervisorRoutes = ['/dashboard/supervisor-hub'];

      // Supervisor Guard: Strictly traps supervisors in their read-only hub
      if (safeRole === 'supervisor') {
        if (!supervisorRoutes.some(p => pathname.startsWith(p))) {
          return NextResponse.redirect(new URL('/dashboard/supervisor-hub', request.url));
        }
      }
      // Accountant Guard
      else if (safeRole === 'accountant') {
        if (!financeRoutes.some(p => pathname.startsWith(p)) && pathname !== '/dashboard') {
          return NextResponse.redirect(new URL('/dashboard', request.url));
        }
      }
      // Staff Guard
      else if (safeRole === 'staff') {
        if (!opsRoutes.some(p => pathname.startsWith(p)) && pathname !== '/dashboard') {
          return NextResponse.redirect(new URL('/dashboard', request.url));
        }
      }
      // Manager Guard
      else if (safeRole === 'manager') {
        if (!managerRoutes.some(p => pathname.startsWith(p)) && pathname !== '/dashboard') {
          return NextResponse.redirect(new URL('/dashboard', request.url));
        }
      }
      // Admin Guard Fault Tolerance
      else if (adminOnlyRoutes.some(p => pathname.startsWith(p))) {
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