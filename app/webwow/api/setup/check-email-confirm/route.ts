import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /webwow/api/setup/check-email-confirm
 *
 * In the open-source build (no Supabase), email confirmation
 * is not applicable. Always returns autoconfirm: true.
 */
export async function GET() {
  return noCache({
    autoconfirm: true,
  });
}
