import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import { SUPABASE_QUERY_LIMIT, SUPABASE_WRITE_BATCH_SIZE } from '@/lib/db-constants';
import { cleanupOrphanedStorageFiles } from '@/lib/storage-utils';
import { generateFontContentHash } from '@/lib/hash-utils';
import type { Font, CreateFontData, UpdateFontData } from '@/types';

/**
 * Get all fonts (drafts only)
 */
export async function getAllFonts(): Promise<Font[]> {
  const db = await getKnexClient();

  const data = await db('fonts')
    .select('*')
    .where('is_published', false)
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc')
    .limit(SUPABASE_QUERY_LIMIT);

  return data || [];
}

/**
 * Get all published fonts
 */
export async function getPublishedFonts(): Promise<Font[]> {
  const db = await getKnexClient();

  const data = await db('fonts')
    .select('*')
    .where('is_published', true)
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc')
    .limit(SUPABASE_QUERY_LIMIT);

  return data || [];
}

/**
 * Get a font by ID (draft)
 */
export async function getFontById(id: string): Promise<Font | null> {
  const db = await getKnexClient();

  const data = await db('fonts')
    .select('*')
    .where('id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Create a new font
 */
export async function createFont(fontData: CreateFontData): Promise<Font> {
  const db = await getKnexClient();

  const contentHash = generateFontContentHash(fontData);

  const [data] = await db('fonts')
    .insert({
      name: fontData.name,
      family: fontData.family,
      type: fontData.type,
      variants: jsonb(fontData.variants),
      weights: jsonb(fontData.weights),
      category: fontData.category,
      axes: jsonb(fontData.axes ?? null),
      kind: fontData.kind ?? null,
      url: fontData.url ?? null,
      storage_path: fontData.storage_path ?? null,
      file_hash: fontData.file_hash ?? null,
      content_hash: contentHash,
      is_published: false,
    })
    .returning('*');

  return data;
}

/**
 * Update an existing font
 */
export async function updateFont(id: string, fontData: UpdateFontData): Promise<Font> {
  const db = await getKnexClient();

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (fontData.name !== undefined) updatePayload.name = fontData.name;
  if (fontData.family !== undefined) updatePayload.family = fontData.family;
  if (fontData.variants !== undefined) updatePayload.variants = jsonb(fontData.variants);
  if (fontData.weights !== undefined) updatePayload.weights = jsonb(fontData.weights);
  if (fontData.category !== undefined) updatePayload.category = fontData.category;

  // Recalculate content hash
  const existing = await getFontById(id);
  if (existing) {
    const merged = {
      name: fontData.name ?? existing.name,
      family: fontData.family ?? existing.family,
      type: existing.type,
      variants: fontData.variants ?? existing.variants,
      weights: fontData.weights ?? existing.weights,
      category: fontData.category ?? existing.category,
    };
    updatePayload.content_hash = generateFontContentHash(merged);
  }

  const [data] = await db('fonts')
    .where('id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update(updatePayload)
    .returning('*');

  return data;
}

/**
 * Soft-delete a font
 */
export async function deleteFont(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('fonts')
    .where('id', id)
    .where('is_published', false)
    .update({ deleted_at: new Date().toISOString() });
}

/**
 * Get all unpublished fonts (fonts that have changes since last publish)
 */
export async function getUnpublishedFonts(): Promise<Font[]> {
  const db = await getKnexClient();

  // Get all draft fonts (including soft-deleted ones for cleanup)
  const draftFonts = await db('fonts')
    .select('*')
    .where('is_published', false)
    .limit(SUPABASE_QUERY_LIMIT);

  // Get all published fonts
  const publishedFonts = await db('fonts')
    .select('*')
    .where('is_published', true)
    .limit(SUPABASE_QUERY_LIMIT);

  const publishedMap = new Map(publishedFonts?.map(f => [f.id, f]) || []);

  // Find fonts that need publishing (new, changed, or deleted)
  return (draftFonts || []).filter(draft => {
    const published = publishedMap.get(draft.id);
    if (!published) return true; // New font
    if (draft.deleted_at) return true; // Deleted font
    return draft.content_hash !== published.content_hash; // Changed font
  });
}

/**
 * Publish all draft fonts to production
 */
export async function publishFonts(): Promise<{ added: number; updated: number; deleted: number }> {
  const db = await getKnexClient();

  const stats = { added: 0, updated: 0, deleted: 0 };

  // Get all draft fonts
  const draftFonts = await db('fonts')
    .select('*')
    .where('is_published', false)
    .limit(SUPABASE_QUERY_LIMIT);

  // Get all published fonts
  const publishedFonts = await db('fonts')
    .select('*')
    .where('is_published', true)
    .limit(SUPABASE_QUERY_LIMIT);

  const publishedMap = new Map(publishedFonts?.map(f => [f.id, f]) || []);

  // Fonts to upsert (new or changed)
  const toUpsert: Record<string, unknown>[] = [];

  for (const draft of draftFonts || []) {
    if (draft.deleted_at) {
      // Soft-deleted in draft - remove from published
      if (publishedMap.has(draft.id)) {
        stats.deleted++;
      }
      continue;
    }

    const published = publishedMap.get(draft.id);

    if (!published) {
      stats.added++;
    } else if (draft.content_hash !== published.content_hash) {
      stats.updated++;
    } else {
      continue; // No changes
    }

    toUpsert.push({
      id: draft.id,
      name: draft.name,
      family: draft.family,
      type: draft.type,
      variants: jsonb(draft.variants),
      weights: jsonb(draft.weights),
      category: draft.category,
      axes: jsonb(draft.axes ?? null),
      kind: draft.kind,
      url: draft.url,
      storage_path: draft.storage_path,
      file_hash: draft.file_hash,
      content_hash: draft.content_hash,
      is_published: true,
      created_at: draft.created_at,
      updated_at: new Date().toISOString(),
      deleted_at: null,
    });
  }

  // Upsert changed fonts in batches
  for (let i = 0; i < toUpsert.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batch = toUpsert.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    await db('fonts')
      .insert(batch)
      .onConflict(['id', 'is_published'])
      .merge();
  }

  // Delete published fonts that were soft-deleted in draft
  const deletedDrafts = (draftFonts || []).filter(f => f.deleted_at !== null);
  const deletedDraftIds = deletedDrafts.map(f => f.id);

  if (deletedDraftIds.length > 0) {
    // Delete from published
    await db('fonts')
      .whereIn('id', deletedDraftIds)
      .where('is_published', true)
      .delete();

    // Hard-delete from draft
    await db('fonts')
      .whereIn('id', deletedDraftIds)
      .where('is_published', false)
      .delete();
  }

  // Also delete published fonts whose drafts no longer exist (orphans)
  const activeDraftIds = new Set(
    (draftFonts || []).filter(f => !f.deleted_at).map(f => f.id)
  );

  const orphanedPublished = (publishedFonts || []).filter(f => !activeDraftIds.has(f.id) && !deletedDraftIds.includes(f.id));

  if (orphanedPublished.length > 0) {
    const orphanIds = orphanedPublished.map(f => f.id);
    await db('fonts')
      .whereIn('id', orphanIds)
      .where('is_published', true)
      .delete();

    stats.deleted += orphanedPublished.length;
  }

  // Delete physical files for all hard-deleted fonts
  const allDeletedFonts = [...deletedDrafts, ...orphanedPublished];
  const storagePaths = allDeletedFonts
    .filter(f => f.storage_path)
    .map(f => f.storage_path as string);

  await cleanupOrphanedStorageFiles('fonts', storagePaths);

  return stats;
}
