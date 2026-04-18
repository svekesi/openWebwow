import { runMigrations } from '@/lib/services/migrationService';
import { runSeeds } from '@/lib/services/seedService';
import { noCache } from '@/lib/api-response';

interface MigrateResponseBody {
  success: boolean;
  executed?: string[];
  seeds?: Record<string, { success: boolean; error?: string }>;
  message?: string;
  error?: string;
  failed?: string;
}

let inFlightMigration: Promise<{ status: number; body: MigrateResponseBody }> | null = null;
let lastSuccessAt = 0;
let lastSuccessResponse: { status: number; body: MigrateResponseBody } | null = null;

async function runSetupMigrationsOnce(): Promise<{ status: number; body: MigrateResponseBody }> {
  const result = await runMigrations();

  if (!result.success) {
    console.error('[setup/migrate] Migration failed:', result.error);
    return {
      status: 500,
      body: {
        error: result.error || 'Migration failed',
        executed: result.executed,
        failed: result.failed,
        success: false,
      },
    };
  }

  // Seeds are only needed when a migration actually changed schema/data.
  const shouldRunSeeds = result.executed.length > 0;
  let seedResults: Record<string, { success: boolean; error?: string }> = {};

  if (shouldRunSeeds) {
    const seedResult = await runSeeds();
    seedResults = seedResult.results;

    if (!seedResult.success) {
      console.warn('[setup/migrate] Some seeds failed:', seedResult.results);
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      executed: result.executed,
      seeds: seedResults,
      message: result.executed.length > 0
        ? `Successfully executed ${result.executed.length} migration(s)`
        : 'All migrations already up to date',
    },
  };
}

/**
 * POST /webwow/api/setup/migrate
 *
 * Runs pending migrations at most once concurrently to avoid
 * connection pool starvation when multiple clients trigger setup in parallel.
 */
export async function POST() {
  try {
    const now = Date.now();

    if (lastSuccessResponse && now - lastSuccessAt < 60_000) {
      return noCache(lastSuccessResponse.body, lastSuccessResponse.status);
    }

    if (!inFlightMigration) {
      inFlightMigration = runSetupMigrationsOnce();
    }

    const response = await inFlightMigration;

    if (response.status === 200) {
      lastSuccessAt = Date.now();
      lastSuccessResponse = response;
    }

    return noCache(response.body, response.status);
  } catch (error) {
    console.error('[setup/migrate] Migration error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      500
    );
  } finally {
    inFlightMigration = null;
  }
}
