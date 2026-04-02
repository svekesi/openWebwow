import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';

/**
 * App Settings Repository
 *
 * Generic key-value store for app integration settings.
 * Each app stores its configuration (API keys, connections, etc.) here.
 */

// =============================================================================
// Types
// =============================================================================

export interface AppSetting {
  id: string;
  app_id: string;
  key: string;
  value: unknown;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get all settings for a specific app
 */
export async function getAppSettings(appId: string): Promise<AppSetting[]> {
  const db = await getKnexClient();

  const data = await db('app_settings')
    .select('*')
    .where('app_id', appId)
    .orderBy('key', 'asc');

  return data || [];
}

/**
 * Get a specific setting for an app
 */
export async function getAppSetting(
  appId: string,
  key: string
): Promise<AppSetting | null> {
  const db = await getKnexClient();

  const data = await db('app_settings')
    .select('*')
    .where('app_id', appId)
    .where('key', key)
    .first();

  return data || null;
}

/**
 * Get a setting value directly (convenience helper)
 */
export async function getAppSettingValue<T = unknown>(
  appId: string,
  key: string
): Promise<T | null> {
  const setting = await getAppSetting(appId, key);
  return setting ? (setting.value as T) : null;
}

/**
 * Check if an app has a specific setting configured
 */
export async function hasAppSetting(
  appId: string,
  key: string
): Promise<boolean> {
  const setting = await getAppSetting(appId, key);
  return setting !== null;
}

/**
 * Get all app IDs that have settings configured (i.e. connected apps)
 */
export async function getConnectedAppIds(): Promise<string[]> {
  const db = await getKnexClient();

  const data = await db('app_settings')
    .select('app_id')
    .orderBy('app_id');

  // Deduplicate app IDs
  const appIds = new Set((data || []).map((row: { app_id: string }) => row.app_id));
  return Array.from(appIds);
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Set a setting value for an app (upsert)
 */
export async function setAppSetting(
  appId: string,
  key: string,
  value: unknown
): Promise<AppSetting> {
  const db = await getKnexClient();

  const [data] = await db('app_settings')
    .insert({
      app_id: appId,
      key,
      value: jsonb(value),
      updated_at: new Date().toISOString(),
    })
    .onConflict(['app_id', 'key'])
    .merge()
    .returning('*');

  return data;
}

/**
 * Delete a specific setting for an app
 */
export async function deleteAppSetting(
  appId: string,
  key: string
): Promise<void> {
  const db = await getKnexClient();

  await db('app_settings')
    .where('app_id', appId)
    .where('key', key)
    .delete();
}

/**
 * Delete all settings for an app (disconnect)
 */
export async function deleteAllAppSettings(appId: string): Promise<void> {
  const db = await getKnexClient();

  await db('app_settings')
    .where('app_id', appId)
    .delete();
}
