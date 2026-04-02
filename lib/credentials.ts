/**
 * Credentials
 *
 * Reads configuration from environment variables.
 * SERVER-ONLY: This module should never be imported in client code.
 */

import 'server-only';

/**
 * Check if the database is configured.
 */
export async function isDatabaseConfigured(): Promise<boolean> {
  return !!process.env.DATABASE_URL;
}

/**
 * Get the database URL.
 */
export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

export const credentials = {
  isDatabaseConfigured,
  getDatabaseUrl,
};
