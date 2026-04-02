import { noCache } from '@/lib/api-response';
import { testKnexConnection } from '@/lib/knex-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Check if database is connected and migrations have been run (setup complete)
 */
async function isDatabaseReady(): Promise<boolean> {
  try {
    return await testKnexConnection();
  } catch {
    return false;
  }
}

/**
 * GET /ycode/api/setup/status
 *
 * Check if database is configured and ready.
 */
export async function GET() {
  try {
    const isConfigured = !!process.env.DATABASE_URL;
    const setupComplete = isConfigured ? await isDatabaseReady() : false;

    return noCache({
      is_configured: isConfigured,
      is_setup_complete: setupComplete,
    });
  } catch (error) {
    console.error('Setup status check failed:', error);

    return noCache(
      { error: 'Failed to check setup status' },
      500
    );
  }
}
