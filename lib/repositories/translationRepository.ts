/**
 * Translation Repository
 *
 * Data access layer for translations
 * Supports draft/published workflow with composite primary key (id, is_published)
 */

import { getKnexClient } from '@/lib/knex-client';
import type { Translation, CreateTranslationData, UpdateTranslationData } from '@/types';

/**
 * Get all translations for a locale (draft by default)
 */
export async function getTranslationsByLocale(
  localeId: string,
  isPublished: boolean = false
): Promise<Translation[]> {
  const db = await getKnexClient();

  const data = await db('translations')
    .select('*')
    .where('locale_id', localeId)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc');

  return data || [];
}

/**
 * Get translations by source (draft by default)
 */
export async function getTranslationsBySource(
  sourceType: string,
  sourceId: string,
  isPublished: boolean = false
): Promise<Translation[]> {
  const db = await getKnexClient();

  const data = await db('translations')
    .select('*')
    .where('source_type', sourceType)
    .where('source_id', sourceId)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc');

  return data || [];
}

/**
 * Get a single translation by ID (draft by default)
 */
export async function getTranslationById(
  id: string,
  isPublished: boolean = false
): Promise<Translation | null> {
  const db = await getKnexClient();

  const data = await db('translations')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get a translation by locale and key parts (draft by default)
 */
export async function getTranslationByKey(
  localeId: string,
  sourceType: string,
  sourceId: string,
  contentKey: string,
  isPublished: boolean = false
): Promise<Translation | null> {
  const db = await getKnexClient();

  const data = await db('translations')
    .select('*')
    .where('locale_id', localeId)
    .where('source_type', sourceType)
    .where('source_id', sourceId)
    .where('content_key', contentKey)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Create a new translation (draft by default)
 * Uses upsert to handle existing translations
 */
export async function createTranslation(
  translationData: CreateTranslationData
): Promise<Translation> {
  const db = await getKnexClient();

  const [data] = await db('translations')
    .insert({
      locale_id: translationData.locale_id,
      source_type: translationData.source_type,
      source_id: translationData.source_id,
      content_key: translationData.content_key,
      content_type: translationData.content_type,
      content_value: translationData.content_value,
      is_completed: translationData.is_completed ?? false,
      is_published: false,
      deleted_at: null,
    })
    .onConflict(['locale_id', 'source_type', 'source_id', 'content_key', 'is_published'])
    .merge()
    .returning('*');

  return data;
}

/**
 * Update a translation (draft only)
 */
export async function updateTranslation(
  id: string,
  updates: UpdateTranslationData
): Promise<Translation> {
  const db = await getKnexClient();

  const [data] = await db('translations')
    .where('id', id)
    .where('is_published', false)
    .update({
      ...updates,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  return data;
}

/**
 * Delete a translation (soft delete - sets deleted_at timestamp)
 */
export async function deleteTranslation(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('translations')
    .where('id', id)
    .where('is_published', false)
    .update({ deleted_at: new Date().toISOString() });
}

/**
 * Delete translations in bulk (soft delete - sets deleted_at timestamp)
 * Only deletes draft versions
 *
 * @param sourceType - Type of source (page, folder, component, cms)
 * @param sourceIds - Single source ID or array of source IDs
 * @param contentKeys - Optional. Specific content keys to delete. If not provided, deletes all translations for the source(s).
 */
export async function deleteTranslationsInBulk(
  sourceType: string,
  sourceIds: string | string[],
  contentKeys?: string[]
): Promise<void> {
  const db = await getKnexClient();

  // Normalize sourceIds to array
  const sourceIdArray = Array.isArray(sourceIds) ? sourceIds : [sourceIds];

  // If no source IDs, nothing to delete
  if (sourceIdArray.length === 0) {
    return;
  }

  // If contentKeys provided but empty, nothing to delete
  if (contentKeys !== undefined && contentKeys.length === 0) {
    return;
  }

  // Build the base query
  let query = db('translations')
    .where('source_type', sourceType)
    .whereIn('source_id', sourceIdArray)
    .where('is_published', false);

  // Add content_key filter if specific keys provided
  if (contentKeys !== undefined) {
    query = query.whereIn('content_key', contentKeys);
  }

  await query.update({ deleted_at: new Date().toISOString() });
}

/**
 * Mark translations as incomplete when source content changes
 */
export async function markTranslationsIncomplete(
  sourceType: string,
  sourceId: string,
  contentKeys: string[]
): Promise<void> {
  const db = await getKnexClient();

  if (contentKeys.length === 0) {
    return;
  }

  await db('translations')
    .where('source_type', sourceType)
    .where('source_id', sourceId)
    .whereIn('content_key', contentKeys)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({
      is_completed: false,
      updated_at: new Date().toISOString(),
    });
}

/**
 * Upsert multiple translations (draft by default)
 * Uses batch upsert for efficiency
 */
export async function upsertTranslations(
  translations: CreateTranslationData[]
): Promise<Translation[]> {
  const db = await getKnexClient();

  const translationsToUpsert = translations.map((t) => ({
    locale_id: t.locale_id,
    source_type: t.source_type,
    source_id: t.source_id,
    content_key: t.content_key,
    content_type: t.content_type,
    content_value: t.content_value,
    is_published: false,
    deleted_at: null,
  }));

  const data = await db('translations')
    .insert(translationsToUpsert)
    .onConflict(['locale_id', 'source_type', 'source_id', 'content_key', 'is_published'])
    .merge()
    .returning('*');

  return data || [];
}
