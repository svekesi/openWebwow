/**
 * Asset Folder Repository
 *
 * Data access layer for asset folder operations with Knex
 */

import { getKnexClient } from '@/lib/knex-client';
import { SUPABASE_WRITE_BATCH_SIZE } from '@/lib/db-constants';
import type { AssetFolder, CreateAssetFolderData, UpdateAssetFolderData } from '../../types';

/**
 * Get all asset folders (drafts by default)
 * @param isPublished - Filter by published status (default: false for drafts)
 */
export async function getAllAssetFolders(isPublished = false): Promise<AssetFolder[]> {
  const db = await getKnexClient();

  return await db('asset_folders')
    .select('*')
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .orderBy('order', 'asc');
}

/**
 * Get asset folder by ID (draft by default)
 * @param id - Folder ID
 * @param isPublished - Get published or draft version (default: false for draft)
 */
export async function getAssetFolderById(id: string, isPublished = false): Promise<AssetFolder | null> {
  const db = await getKnexClient();

  const data = await db('asset_folders')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get all child folders of a parent folder
 * @param parentId - Parent folder ID (null for root folders)
 * @param isPublished - Filter by published status (default: false for drafts)
 */
export async function getChildFolders(
  parentId: string | null,
  isPublished = false
): Promise<AssetFolder[]> {
  const db = await getKnexClient();

  let query = db('asset_folders')
    .select('*')
    .where('is_published', isPublished)
    .whereNull('deleted_at');

  if (parentId === null) {
    query = query.whereNull('asset_folder_id');
  } else {
    query = query.where('asset_folder_id', parentId);
  }

  return await query.orderBy('order', 'asc');
}

/**
 * Create new asset folder
 */
export async function createAssetFolder(folderData: CreateAssetFolderData): Promise<AssetFolder> {
  const db = await getKnexClient();

  const dataToInsert = {
    ...folderData,
    is_published: folderData.is_published ?? false,
  };

  const [data] = await db('asset_folders')
    .insert(dataToInsert)
    .returning('*');

  return data;
}

/**
 * Update asset folder (drafts only)
 */
export async function updateAssetFolder(id: string, updates: UpdateAssetFolderData): Promise<AssetFolder> {
  const db = await getKnexClient();

  const [data] = await db('asset_folders')
    .where('id', id)
    .where('is_published', false)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  if (!data) {
    throw new Error('Failed to update asset folder: record not found');
  }

  return data;
}

/**
 * Get all descendant folder IDs recursively (drafts only)
 */
async function getDescendantFolderIds(folderId: string): Promise<string[]> {
  const db = await getKnexClient();

  const allFolders: Array<{ id: string; asset_folder_id: string | null }> = await db('asset_folders')
    .select('id', 'asset_folder_id')
    .where('is_published', false)
    .whereNull('deleted_at');

  if (allFolders.length === 0) {
    return [];
  }

  const foldersByParent = new Map<string, string[]>();
  for (const folder of allFolders) {
    const parentId = folder.asset_folder_id || 'root';
    if (!foldersByParent.has(parentId)) {
      foldersByParent.set(parentId, []);
    }
    foldersByParent.get(parentId)!.push(folder.id);
  }

  const collectDescendants = (parentId: string): string[] => {
    const children = foldersByParent.get(parentId) || [];
    const descendants: string[] = [...children];

    for (const childId of children) {
      descendants.push(...collectDescendants(childId));
    }

    return descendants;
  };

  return collectDescendants(folderId);
}

/**
 * Soft delete an asset folder and all its nested assets and folders (drafts only)
 */
export async function deleteAssetFolder(id: string): Promise<void> {
  const db = await getKnexClient();

  const deletedAt = new Date().toISOString();

  const folderToDelete = await getAssetFolderById(id, false);
  if (!folderToDelete) {
    throw new Error('Folder not found');
  }

  const descendantFolderIds = await getDescendantFolderIds(id);
  const allFolderIds = [id, ...descendantFolderIds];

  await db('assets')
    .whereIn('asset_folder_id', allFolderIds)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({ deleted_at: new Date().toISOString() });

  await db('asset_folders')
    .whereIn('id', allFolderIds)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({ deleted_at: deletedAt });
}

/**
 * Reorder folders within a parent (drafts only)
 */
export async function reorderFolders(updates: Array<{ id: string; order: number }>): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  const { getKnexClient } = await import('../knex-client');
  const { batchUpdateColumn } = await import('../knex-helpers');
  const knex = await getKnexClient();

  await batchUpdateColumn(knex, 'asset_folders', 'order',
    updates.map(u => ({ id: u.id, value: u.order })),
    {
      extraWhereClause: 'AND is_published = false AND deleted_at IS NULL',
      castType: 'integer',
    }
  );
}

// =============================================================================
// Publishing Functions
// =============================================================================

/**
 * Get all unpublished (draft) asset folders that have changes.
 * A folder needs publishing if no published version exists or its data differs.
 */
export async function getUnpublishedAssetFolders(): Promise<AssetFolder[]> {
  const db = await getKnexClient();

  const draftFolders: AssetFolder[] = await db('asset_folders')
    .select('*')
    .where('is_published', false)
    .whereNull('deleted_at')
    .orderBy('depth', 'asc')
    .orderBy('order', 'asc');

  if (draftFolders.length === 0) {
    return [];
  }

  const draftIds = draftFolders.map(f => f.id);
  const publishedFolders: AssetFolder[] = await db('asset_folders')
    .select('*')
    .whereIn('id', draftIds)
    .where('is_published', true);

  const publishedById = new Map<string, AssetFolder>();
  publishedFolders.forEach(f => publishedById.set(f.id, f));

  return draftFolders.filter(draft => {
    const published = publishedById.get(draft.id);
    if (!published) {
      return true;
    }
    return hasAssetFolderChanged(draft, published);
  });
}

/**
 * Get soft-deleted draft asset folders
 */
export async function getDeletedDraftAssetFolders(): Promise<AssetFolder[]> {
  const db = await getKnexClient();

  return await db('asset_folders')
    .select('*')
    .where('is_published', false)
    .whereNotNull('deleted_at');
}

/** Check if a draft asset folder differs from its published version */
function hasAssetFolderChanged(draft: AssetFolder, published: AssetFolder): boolean {
  return (
    draft.name !== published.name ||
    draft.asset_folder_id !== published.asset_folder_id ||
    draft.depth !== published.depth ||
    draft.order !== published.order
  );
}

/**
 * Publish asset folders - copies draft to published, skipping unchanged folders
 */
export async function publishAssetFolders(folderIds: string[]): Promise<{ count: number }> {
  if (folderIds.length === 0) {
    return { count: 0 };
  }

  const db = await getKnexClient();

  const draftFolders: AssetFolder[] = [];

  for (let i = 0; i < folderIds.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = folderIds.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    const data: AssetFolder[] = await db('asset_folders')
      .select('*')
      .whereIn('id', batchIds)
      .where('is_published', false)
      .whereNull('deleted_at');

    draftFolders.push(...data);
  }

  if (draftFolders.length === 0) {
    return { count: 0 };
  }

  draftFolders.sort((a, b) => a.depth - b.depth);

  const publishedById = new Map<string, AssetFolder>();
  for (let i = 0; i < folderIds.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = folderIds.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    const existingPublished: AssetFolder[] = await db('asset_folders')
      .select('*')
      .whereIn('id', batchIds)
      .where('is_published', true);

    existingPublished.forEach(f => publishedById.set(f.id, f));
  }

  const recordsToUpsert: any[] = [];
  const now = new Date().toISOString();

  for (const draft of draftFolders) {
    const existing = publishedById.get(draft.id);

    if (existing && !hasAssetFolderChanged(draft, existing)) {
      continue;
    }

    recordsToUpsert.push({
      id: draft.id,
      name: draft.name,
      asset_folder_id: draft.asset_folder_id,
      depth: draft.depth,
      order: draft.order,
      is_published: true,
      created_at: draft.created_at,
      updated_at: now,
      deleted_at: null,
    });
  }

  recordsToUpsert.sort((a: any, b: any) => a.depth - b.depth);

  if (recordsToUpsert.length > 0) {
    for (let i = 0; i < recordsToUpsert.length; i += SUPABASE_WRITE_BATCH_SIZE) {
      const batch = recordsToUpsert.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
      await db('asset_folders')
        .insert(batch)
        .onConflict(['id', 'is_published'])
        .merge();
    }
  }

  return { count: recordsToUpsert.length };
}

/**
 * Hard delete asset folders that were soft-deleted in drafts
 */
export async function hardDeleteSoftDeletedAssetFolders(): Promise<{ count: number }> {
  const db = await getKnexClient();

  const deletedDrafts = await getDeletedDraftAssetFolders();

  if (deletedDrafts.length === 0) {
    return { count: 0 };
  }

  const ids = deletedDrafts.map(f => f.id);

  for (let i = 0; i < ids.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);

    await db('assets')
      .whereIn('asset_folder_id', batchIds)
      .where('is_published', true)
      .update({ asset_folder_id: null });

    await db('assets')
      .whereIn('asset_folder_id', batchIds)
      .where('is_published', false)
      .update({ asset_folder_id: null });

    await db('asset_folders')
      .whereIn('asset_folder_id', batchIds)
      .where('is_published', true)
      .update({ asset_folder_id: null });

    await db('asset_folders')
      .whereIn('asset_folder_id', batchIds)
      .where('is_published', false)
      .update({ asset_folder_id: null });
  }

  for (let i = 0; i < ids.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);

    await db('asset_folders')
      .whereIn('id', batchIds)
      .where('is_published', true)
      .delete();

    await db('asset_folders')
      .whereIn('id', batchIds)
      .where('is_published', false)
      .whereNotNull('deleted_at')
      .delete();
  }

  return { count: deletedDrafts.length };
}
