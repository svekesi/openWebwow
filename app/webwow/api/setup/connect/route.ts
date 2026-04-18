import { NextRequest } from 'next/server';
import { testDatabaseConnection } from '@/lib/knex-client';
import { noCache } from '@/lib/api-response';

/**
 * POST /webwow/api/setup/connect
 *
 * Validates a PostgreSQL connection string. Persist DATABASE_URL via .env / host settings;
 * this route does not write environment variables.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const databaseUrl =
      typeof body.database_url === 'string'
        ? body.database_url
        : typeof body.databaseUrl === 'string'
          ? body.databaseUrl
          : '';

    if (!databaseUrl.trim()) {
      return noCache(
        { error: 'Missing required field: database_url' },
        400
      );
    }

    const dbTestResult = await testDatabaseConnection(databaseUrl.trim());
    if (!dbTestResult.success) {
      return noCache(
        { error: `Database connection failed: ${dbTestResult.error || 'Unknown error'}` },
        400
      );
    }

    return noCache({
      success: true,
      message: 'Database connection successful. Set DATABASE_URL in your environment and restart the app if needed.',
    });
  } catch (error) {
    console.error('[Setup API] Connection failed:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Connection failed' },
      500
    );
  }
}
