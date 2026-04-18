import knex, { Knex } from 'knex';
import knexfileConfig from '../knexfile';

/**
 * Knex Client for Webwow
 *
 * Creates a knex instance connected to the PostgreSQL database
 * Uses configuration from knexfile.ts based on NODE_ENV
 */

const globalScope = globalThis as typeof globalThis & {
  __webwowKnexInstance?: Knex;
};
let knexInstance: Knex | null = globalScope.__webwowKnexInstance || null;

/**
 * Get or create knex instance
 */
export async function getKnexClient(): Promise<Knex> {
  if (knexInstance) {
    return knexInstance;
  }

  const environment = process.env.NODE_ENV || 'development';
  const config = knexfileConfig[environment];

  if (!config) {
    throw new Error(`No knex configuration found for environment: ${environment}`);
  }

  knexInstance = knex(config);
  globalScope.__webwowKnexInstance = knexInstance;

  return knexInstance;
}

/**
 * Close knex connection
 */
export async function closeKnexClient(): Promise<void> {
  if (knexInstance) {
    await knexInstance.destroy();
    globalScope.__webwowKnexInstance = undefined;
    knexInstance = null;
  }
}

/**
 * Test database connection
 */
export async function testKnexConnection(): Promise<boolean> {
  try {
    const client = await getKnexClient();
    await client.raw('SELECT 1');
    return true;
  } catch (error) {
    console.error('[testKnexConnection] Database connection test failed:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      code: (error as any)?.code,
      detail: (error as any)?.detail,
    });

    try {
      await closeKnexClient();
    } catch (closeError) {
      console.error('[testKnexConnection] Error closing failed connection:', closeError);
    }

    return false;
  }
}

/**
 * Test a database connection URL before persisting it
 */
export async function testDatabaseConnection(connectionUrl: string): Promise<{
  success: boolean;
  error?: string;
}> {
  let testClient: Knex | null = null;

  try {
    testClient = knex({
      client: 'pg',
      connection: connectionUrl,
      pool: { min: 0, max: 1 },
    });

    await testClient.raw('SELECT 1');
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database connection failed',
    };
  } finally {
    if (testClient) {
      try {
        await testClient.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
