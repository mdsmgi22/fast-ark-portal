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
      // 2. Safely Reconstruct and Parse the Cookie Value
      authCookies.sort((a, b) => a.name.localeCompare(b.name));
      const tokenString = authCookies.map(c => decodeURIComponent(c.value)).join('');
      
      const parsedCookies = JSON.parse(tokenString);
      const accessToken = parsedCookies?.access_token || (Array.isArray(parsedCookies) ? parsedCookies[0] : null);

      if (!accessToken || typeof accessToken !== 'string') {
        throw new Error("Invalid or Missing Access Token structure.");
      }

      // 3. Decode the JWT Payload natively at the Edge
      const base64Url = accessToken.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      
      const payload = JSON.parse(jsonPayload);
      
      // [FIX 1]: Normalize the role to lowercase to prevent strict-casing bounces
      const rawRole = payload.user_metadata?.role || '';
      const safeRole = rawRole.trim().toLowerCase();

      // 4. Strict RBAC Routing Protocols
      const financeRoutes = ['/dashboard/accounts', '/dashboard/sales-verification', '/dashboard/reports', '/dashboard/banking'];
      const opsRoutes = ['/dashboard/applications', '/dashboard/logistics', '/dashboard/ocsc'];
      
      // [FIX 2]: Added '/dashboard/manager-mis' to the permitted manager routes
      const managerRoutes = [...opsRoutes, '/dashboard/compliance', '/dashboard/locations', '/dashboard/messages', '/dashboard/partners', '/dashboard/manager-mis'];
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

      // Admin Guard (Super Admin Check)
      if (adminOnlyRoutes.some(p => pathname.startsWith(p)) && safeRole !== 'admin') {
        return NextResponse.redirect(new URL('/dashboard', request.url));
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