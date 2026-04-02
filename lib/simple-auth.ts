/**
 * Simple Password-Based Auth
 *
 * Single-user authentication using ADMIN_PASSWORD environment variable.
 * Sessions are tracked via signed HTTP cookies.
 */

import 'server-only';

import { createHmac, randomUUID } from 'crypto';

const AUTH_COOKIE_NAME = 'ycode_admin_auth';

const fallbackSecret = randomUUID();

function getAuthSecret(): string {
  return process.env.PAGE_AUTH_SECRET || process.env.AUTH_SECRET || fallbackSecret;
}

function signValue(value: string): string {
  const secret = getAuthSecret();
  const hmac = createHmac('sha256', secret);
  hmac.update(value);
  return hmac.digest('hex');
}

function verifySignature(value: string, signature: string): boolean {
  const expectedSignature = signValue(value);
  return signature === expectedSignature;
}

/**
 * Check if ADMIN_PASSWORD is configured.
 * If not set, the builder is accessible without login.
 */
export function isAuthEnabled(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

/**
 * Verify a password against the configured ADMIN_PASSWORD.
 */
export function verifyPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return true;
  return password === adminPassword;
}

/**
 * Build a signed session cookie value.
 */
export function buildSessionCookie(): string {
  const payload = JSON.stringify({
    authenticated: true,
    created: Date.now(),
  });
  const encoded = Buffer.from(payload).toString('base64');
  const signature = signValue(encoded);
  return `${encoded}.${signature}`;
}

/**
 * Verify a session cookie value.
 */
export function verifySessionCookie(cookieValue: string): boolean {
  try {
    const parts = cookieValue.split('.');
    if (parts.length !== 2) return false;

    const [encoded, signature] = parts;
    if (!verifySignature(encoded, signature)) return false;

    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
    return payload.authenticated === true;
  } catch {
    return false;
  }
}

/**
 * Check if the current request is authenticated.
 * Reads the session cookie from Next.js headers.
 */
export async function isAuthenticated(): Promise<boolean> {
  if (!isAuthEnabled()) return true;

  try {
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const cookie = cookieStore.get(AUTH_COOKIE_NAME);
    if (!cookie?.value) return false;
    return verifySessionCookie(cookie.value);
  } catch {
    return false;
  }
}

export { AUTH_COOKIE_NAME };
