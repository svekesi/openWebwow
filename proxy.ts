import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Public API routes that skip authentication.
 */
const PUBLIC_API_PREFIXES = [
  '/webwow/api/setup/',
  '/webwow/api/auth/',
  '/webwow/api/v1/',
];

const PUBLIC_COLLECTION_ITEM_SUFFIXES = ['/items/filter', '/items/load-more'];

const PUBLIC_API_EXACT = [
  '/webwow/api/revalidate',
];

function isPublicApiRoute(pathname: string, method: string): boolean {
  if (pathname === '/webwow/api/form-submissions' && method === 'POST') {
    return true;
  }

  if (PUBLIC_API_EXACT.includes(pathname)) return true;
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;

  if (method === 'POST' && pathname.startsWith('/webwow/api/collections/') &&
      PUBLIC_COLLECTION_ITEM_SUFFIXES.some(suffix => pathname.endsWith(suffix))) {
    return true;
  }

  return false;
}

/**
 * Verify session for protected API routes.
 * In open-source mode, authentication is handled via session cookies
 * set by the /webwow/api/auth/* endpoints.
 */
async function verifyApiAuth(request: NextRequest): Promise<NextResponse | null> {
  if (isPublicApiRoute(request.nextUrl.pathname, request.method)) {
    return null;
  }

  // If no ADMIN_PASSWORD is set, skip auth entirely
  if (!process.env.ADMIN_PASSWORD) {
    return null;
  }

  const sessionCookie = request.cookies.get('webwow_admin_auth');
  if (!sessionCookie?.value) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/webwow/api') || pathname.startsWith('/webwow/preview')) {
    const authResponse = await verifyApiAuth(request);
    if (authResponse) {
      if (pathname.startsWith('/webwow/preview')) {
        return NextResponse.redirect(new URL('/webwow', request.url));
      }
      return authResponse;
    }
  }

  const isPublicPage = !pathname.startsWith('/webwow')
    && !pathname.startsWith('/_next')
    && !pathname.startsWith('/api')
    && !pathname.startsWith('/dynamic');
  const hasPaginationParams = Array.from(request.nextUrl.searchParams.keys())
    .some((key) => key.startsWith('p_'));

  if (isPublicPage && hasPaginationParams) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = pathname === '/' ? '/dynamic' : `/dynamic${pathname}`;

    const rewriteResponse = NextResponse.rewrite(rewriteUrl);
    rewriteResponse.headers.set('x-pathname', pathname);
    return rewriteResponse;
  }

  const response = NextResponse.next();
  response.headers.set('x-pathname', pathname);

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
