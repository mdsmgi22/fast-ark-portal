// FILE PATH: ./proxy.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const VALID_STAFF_ROLES = ['admin', 'manager', 'accountant', 'staff', 'supervisor'];

const PARTNER_ROLES = [
  'ocsc',
  'aadhaar center',
  'aadhaar',
  'cm (consumer mobility)',
  'cm',
  'partner',
  'irctc agent',
];

function decodeJwtPayload(request: NextRequest): any | null {
  const authCookies = request.cookies
    .getAll()
    .filter(
      (cookie) =>
        cookie.name.startsWith('sb-') &&
        cookie.name.includes('-auth-token') &&
        !cookie.name.includes('-code-verifier')
    );

  if (authCookies.length === 0) return null;

  try {
    authCookies.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    const tokenString = authCookies
      .map((c) => decodeURIComponent(c.value))
      .join('');

    const parsedCookies = JSON.parse(tokenString);
    const accessToken =
      parsedCookies?.access_token ||
      (Array.isArray(parsedCookies) ? parsedCookies[0] : null);

    if (!accessToken || typeof accessToken !== 'string') {
      return null;
    }

    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;

    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '='
    );

    const jsonPayload = decodeURIComponent(
      atob(paddedBase64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    const payload = JSON.parse(jsonPayload);

    // Reject expired tokens (with a 60-second clock-skew grace window)
    if (payload.exp && Date.now() >= (payload.exp + 60) * 1000) {
      return null;
    }

    return payload;
  } catch (_) {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const payload = decodeJwtPayload(request);
  const hasValidSession = Boolean(payload);

  // 1. UNIFIED PARTNER PORTAL SECURITY GATE
  if (
    pathname.startsWith('/partner/dashboard') ||
    pathname.startsWith('/partner/sales') ||
    pathname.startsWith('/partner/deposit') ||
    pathname.startsWith('/partner/stock') ||
    pathname.startsWith('/partner/helpdesk') ||
    pathname.startsWith('/partner/aadhaar') ||
    pathname.startsWith('/partner/terms') ||
    pathname.startsWith('/partner/resubmit')
  ) {
    if (!hasValidSession) {
      return NextResponse.redirect(new URL('/partner/login', request.url));
    }

    const rawRole = String(payload?.user_metadata?.role || '').trim().toLowerCase();

    // Prevent internal back-office staff from accidentally operating inside the Partner Portal
    if (VALID_STAFF_ROLES.includes(rawRole)) {
      return NextResponse.redirect(
        new URL(
          rawRole === 'supervisor' ? '/dashboard/supervisor-hub' : '/dashboard',
          request.url
        )
      );
    }

    return NextResponse.next();
  }

  // 2. CORPORATE COMMAND CENTER & STRICT RBAC SECURITY GATE
  if (pathname.startsWith('/dashboard')) {
    if (!hasValidSession) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const rawRole = String(payload?.user_metadata?.role || '').trim().toLowerCase();

    // CRITICAL FIX: Block Franchise Partners from accessing any /dashboard/* route
    if (PARTNER_ROLES.includes(rawRole)) {
      return NextResponse.redirect(new URL('/partner/dashboard', request.url));
    }

    // CRITICAL FIX: Whitelist-verify that the user holds an authorized Back-Office Staff role
    if (!VALID_STAFF_ROLES.includes(rawRole)) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const financeRoutes = [
      '/dashboard/accounts',
      '/dashboard/sales-verification',
      '/dashboard/reports',
      '/dashboard/banking',
      '/dashboard/aadhaar',
    ];

    const opsRoutes = [
      '/dashboard/applications',
      '/dashboard/logistics',
      '/dashboard/ocsc',
      '/dashboard/manager-mis',
      '/dashboard/aadhaar',
    ];

    const managerRoutes = [
      ...opsRoutes,
      '/dashboard/compliance',
      '/dashboard/locations',
      '/dashboard/messages',
      '/dashboard/partners',
      '/dashboard/banking',
      '/dashboard/reports',
      '/dashboard/sales-verification',
    ];

    const adminOnlyRoutes = ['/dashboard/staff', '/dashboard/staff-reports'];
    const supervisorRoutes = ['/dashboard/supervisor-hub'];

    // Supervisor Guard: Strictly traps supervisors in their regional hub
    if (rawRole === 'supervisor') {
      if (!supervisorRoutes.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(
          new URL('/dashboard/supervisor-hub', request.url)
        );
      }
      return NextResponse.next();
    }

    // Prevent non-supervisors from entering the supervisor-only hub if needed, except Admin/Manager
    if (
      supervisorRoutes.some((p) => pathname.startsWith(p)) &&
      !['admin', 'manager', 'supervisor'].includes(rawRole)
    ) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    // Accountant Guard
    if (rawRole === 'accountant') {
      if (
        !financeRoutes.some((p) => pathname.startsWith(p)) &&
        pathname !== '/dashboard'
      ) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      return NextResponse.next();
    }

    // Staff Guard
    if (rawRole === 'staff') {
      if (
        !opsRoutes.some((p) => pathname.startsWith(p)) &&
        pathname !== '/dashboard'
      ) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      return NextResponse.next();
    }

    // Manager Guard
    if (rawRole === 'manager') {
      if (
        adminOnlyRoutes.some((p) => pathname.startsWith(p)) ||
        (!managerRoutes.some((p) => pathname.startsWith(p)) &&
          pathname !== '/dashboard')
      ) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      return NextResponse.next();
    }

    // Admin Guard (Full Access)
    if (rawRole === 'admin') {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/partner/dashboard',
    '/partner/dashboard/:path*',
    '/partner/sales',
    '/partner/sales/:path*',
    '/partner/deposit',
    '/partner/deposit/:path*',
    '/partner/stock',
    '/partner/stock/:path*',
    '/partner/helpdesk',
    '/partner/helpdesk/:path*',
    '/partner/aadhaar',
    '/partner/aadhaar/:path*',
    '/partner/terms',
    '/partner/terms/:path*',
    '/partner/resubmit',
    '/partner/resubmit/:path*',
    '/dashboard',
    '/dashboard/:path*',
  ],
};