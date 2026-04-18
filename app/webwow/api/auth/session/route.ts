import { NextResponse } from 'next/server';
import { isAuthenticated, isAuthEnabled } from '@/lib/simple-auth';

export async function GET() {
  const authEnabled = isAuthEnabled();
  const authenticated = await isAuthenticated();

  return NextResponse.json({
    authenticated,
    authEnabled,
  });
}
