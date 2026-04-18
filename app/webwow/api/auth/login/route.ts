import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, buildSessionCookie, AUTH_COOKIE_NAME, isAuthEnabled } from '@/lib/simple-auth';

export async function POST(request: NextRequest) {
  try {
    if (!isAuthEnabled()) {
      return NextResponse.json({ error: 'Auth is not enabled' }, { status: 400 });
    }

    const { password } = await request.json();

    if (!password || !verifyPassword(password)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const cookieValue = buildSessionCookie();

    const response = NextResponse.json({ data: { authenticated: true } });
    response.cookies.set(AUTH_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
