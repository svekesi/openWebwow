/**
 * Locale Repository
 *
 * Data access layer for locales (language/region configurations)
 * Supports draft/published workflow with composite primary key (id, is_published)
 */

import { getKnexClient } from '@/lib/knex-client';
import type { Locale, CreateLocaleData, UpdateLocaleData } from '@/types';

/**
 * Get all locales (draft by default)
 */
export async function getAllLocales(isPublished: boolean = false): Promise<Locale[]> {
  const db = await getKnexClient();

  const data = await db('locales')
    .select('*')
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .orderBy('is_default', 'desc')
    .orderBy('label', 'asc');

  return data || [];
}

/**
 * Get a single locale by ID (draft by default)
 * With composite primary key, we need to specify is_published to get a single row
 */
export async function getLocaleById(id: string, isPublished: boolean = false): Promise<Locale | null> {
  const db = await getKnexClient();

  const data = await db('locales')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get locale by code (draft by default)
 */
export async function getLocaleByCode(code: string, isPublished: boolean = false): Promise<Locale | null> {
  const db = await getKnexClient();

  const data = await db('locales')
    .select('*')
    .where('code', code)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get the default locale (draft by default)
 */
export async function getDefaultLocale(isPublished: boolean = false): Promise<Locale | null> {
  const db = await getKnexClient();

  const data = await db('locales')
    .select('*')
    .where('is_default', true)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Create a new locale (draft by default)
 * If a locale with the same code exists (including soft-deleted), it will be updated instead
 * Returns both the created/updated locale and all locales
 */
export async function createLocale(
  localeData: CreateLocaleData
): Promise<{ locale: Locale; locales: Locale[] }> {
  const db = await getKnexClient();

  // Check if a locale with this code already exists (including soft-deleted)
  const existingLocale = await db('locales')
    .select('*')
    .where('code', localeData.code)
    .where('is_published', false)
    .first();

  // If this is set as default, unset any existing default
  if (localeData.is_default) {
    await db('locales')
      .where('is_default', true)
      .where('is_published', false)
      .update({ is_default: false });
  }

  let data: Locale;

  if (existingLocale) {
    // Update existing locale (restore if soft-deleted)
    const [updatedData] = await db('locales')
      .where('id', existingLocale.id)
      .where('is_published', false)
      .update({
        label: localeData.label,
        is_default: localeData.is_default || false,
        deleted_at: null,
        updated_at: new Date().toISOString(),
      })
      .returning('*');

    data = updatedData;
  } else {
    // Create new locale
    const [newData] = await db('locales')
      .insert({
        code: localeData.code,
        label: localeData.label,
        is_default: localeData.is_default || false,
        is_published: false,
      })
      .returning('*');

    data = newData;
  }

  // Always return all locales so client can update all is_default flags
  const allLocales = await getAllLocales(false);

  return { locale: data, locales: allLocales };
}

/**
 * Update a locale (draft only)
 * Returns both the updated locale and all locales
 */
export async function updateLocale(
  id: string,
  updates: UpdateLocaleData
): Promise<{ locale: Locale; locales: Locale[] }> {
  const db = await getKnexClient();

  // If this is being set as default, unset any existing default
  if (updates.is_default) {
    await db('locales')
      .where('is_default', true)
      .where('is_published', false)
      .where('id', '!=', id)
      .update({ is_default: false });
  }

  const [data] = await db('locales')
    .where('id', id)
    .where('is_published', false)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  // Always return all locales so client can update all is_default flags
  const allLocales = await getAllLocales(false);

  return { locale: data, locales: allLocales };
}

/**
 * Delete a locale (soft delete - sets deleted_at timestamp)
 */
export async function deleteLocale(id: string): Promise<void> {
  const db = await getKnexClient();

  // Check if this is the default locale
  const locale = await getLocaleById(id, false);
  if (locale?.is_default) {
    throw new Error('Cannot delete the default locale');
  }

  await db('locales')
    .where('id', id)
    .where('is_published', false)
    .update({ deleted_at: new Date().toISOString() });
}

/**
 * Set a locale as the default
 */
export async function setDefaultLocale(id: string): Promise<Locale> {
  const db = await getKnexClient();

  // Unset current default
  await db('locales')
    .where('is_default', true)
    .where('is_published', false)
    .update({ is_default: false });

  // Set new default
  const [data] = await db('locales')
    .where('id', id)
    .where('is_published', false)
    .update({
      is_default: true,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  return data;
}
