/**
 * Setup API Client
 *
 * Handles communication with Next.js setup API routes
 */

import type { ApiResponse } from '@/types';

/**
 * Check if setup is complete
 */
export async function checkSetupStatus(): Promise<{
  is_configured: boolean;
  is_setup_complete?: boolean;
}> {
  const response = await fetch('/webwow/api/setup/status');

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Validate a database connection URL (does not persist DATABASE_URL).
 */
export async function connectDatabase(
  databaseUrl: string
): Promise<ApiResponse<void>> {
  const response = await fetch('/webwow/api/setup/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database_url: databaseUrl }),
  });

  return response.json();
}

/**
 * Run database migrations (Knex) and seeds if configured
 */
export async function runMigrations(): Promise<ApiResponse<void>> {
  const response = await fetch('/webwow/api/setup/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  return response.json();
}

/**
 * Complete setup (no-op now, kept for compatibility)
 */
export async function completeSetup(): Promise<ApiResponse<{ redirect_url: string }>> {
  return {
    data: {
      redirect_url: '/webwow',
    },
  };
}
