/**
 * Settings Repository
 *
 * Data access layer for application settings stored in the database
 */

import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import type { Setting } from '@/types';

/**
 * Get all settings
 *
 * @returns Promise resolving to all settings
 */
export async function getAllSettings(): Promise<Setting[]> {
  const db = await getKnexClient();

  const data = await db('settings')
    .select('*')
    .orderBy('key', 'asc');

  return data || [];
}

/**
 * Get a setting by key
 *
 * @param key - The setting key
 * @returns Promise resolving to the setting value or null if not found
 */
export async function getSettingByKey(key: string): Promise<any | null> {
  const db = await getKnexClient();

  const data = await db('settings')
    .select('value')
    .where('key', key)
    .first();

  return data?.value || null;
}

/**
 * Get multiple settings by keys in a single query
 *
 * @param keys - Array of setting keys to fetch
 * @returns Promise resolving to a map of key -> value
 */
export async function getSettingsByKeys(keys: string[]): Promise<Record<string, any>> {
  if (keys.length === 0) {
    return {};
  }

  const db = await getKnexClient();

  const data = await db('settings')
    .select('key', 'value')
    .whereIn('key', keys);

  const result: Record<string, any> = {};
  for (const setting of data || []) {
    result[setting.key] = setting.value;
  }

  return result;
}

/**
 * Set a setting value (insert or update)
 *
 * @param key - The setting key
 * @param value - The value to store
 * @returns Promise resolving to the created/updated setting
 */
export async function setSetting(key: string, value: any): Promise<Setting> {
  const db = await getKnexClient();

  const [data] = await db('settings')
    .insert({
      key,
      value: jsonb(value),
      updated_at: new Date().toISOString(),
    })
    .onConflict('key')
    .merge()
    .returning('*');

  return data;
}

/**
 * Set multiple settings at once (batch upsert)
 * Settings with null/undefined values are deleted instead of upserted.
 *
 * @param settings - Object with key-value pairs to store
 * @returns Promise resolving to the number of settings updated
 */
export async function setSettings(settings: Record<string, any>): Promise<number> {
  const entries = Object.entries(settings);
  if (entries.length === 0) {
    return 0;
  }

  const db = await getKnexClient();

  // Separate entries: null/undefined values should be deleted, others upserted
  const toUpsert: [string, any][] = [];
  const toDelete: string[] = [];

  for (const [key, value] of entries) {
    if (value === null || value === undefined) {
      toDelete.push(key);
    } else {
      toUpsert.push([key, value]);
    }
  }

  // Delete settings with null values
  if (toDelete.length > 0) {
    await db('settings')
      .whereIn('key', toDelete)
      .delete();
  }

  // Upsert settings with non-null values
  if (toUpsert.length > 0) {
    const now = new Date().toISOString();
    const records = toUpsert.map(([key, value]) => ({
      key,
      value: jsonb(value),
      updated_at: now,
    }));

    await db('settings')
      .insert(records)
      .onConflict('key')
      .merge();
  }

  return entries.length;
}
