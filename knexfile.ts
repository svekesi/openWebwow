import type { Knex } from 'knex';
import path from 'path';

/**
 * Knex Configuration for Ycode Migrations
 *
 * Connects directly to PostgreSQL via DATABASE_URL environment variable.
 */

function getPoolNumber(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

const createConfig = (): Knex.Config => ({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: path.join(process.cwd(), 'database/migrations'),
    extension: 'ts',
    tableName: 'migrations',
  },
  pool: {
    // Keep idle usage low in Next.js dev to avoid exhausting DB limits
    // when multiple workers/HMR are active.
    min: getPoolNumber('DB_POOL_MIN', 0),
    max: getPoolNumber('DB_POOL_MAX', 20),
    acquireTimeoutMillis: getPoolNumber('DB_POOL_ACQUIRE_TIMEOUT_MS', 20000),
    createTimeoutMillis: getPoolNumber('DB_POOL_CREATE_TIMEOUT_MS', 20000),
    idleTimeoutMillis: getPoolNumber('DB_POOL_IDLE_TIMEOUT_MS', 30000),
  },
});

const config: { [key: string]: Knex.Config } = {
  development: createConfig(),
  production: createConfig(),
};

export default config;
