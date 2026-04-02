import { getKnexClient } from '@/lib/knex-client';
import { SUPABASE_WRITE_BATCH_SIZE } from '@/lib/db-constants';
import { STORAGE_BUCKET, STORAGE_FOLDERS } from '@/lib/asset-constants';
import { cleanupOrphanedStorageFiles } from '@/lib/storage-utils';
import { generateAssetContentHash } from '../hash-utils';
import type { Knex } from 'knex';
import type { Asset } from '../../types';

export interface CreateAssetData {
  filename: string;
  source: string; // Required: identifies where the asset was uploaded from (e.g., 'library', 'page-settings', 'components')
  storage_path?: string | null; // Nullable for SVG icons with inline content
  public_url?: string | null; // Nullable for SVG icons with inline content
  file_size: number;
  mime_type: string;
  width?: number;
  height?: number;
  asset_folder_id?: string | null;
  content?: string | null; // Inline SVG content for icon assets
  is_published?: boolean; // Defaults to false
}

export interface PaginatedAssetsResult {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface GetAssetsOptions {
  folderId?: string | null; // Filter by folder (null = root, undefined = all)
  folderIds?: string[]; // Filter by multiple folders (for search across descendants)
  search?: string; // Search by filename
  page?: number; // Page number (1-based)
  limit?: number; // Items per page
}

/**
 * Get assets with pagination and search support (drafts only)
 */
export async function getAssetsPaginated(options: GetAssetsOptions = {}): Promise<PaginatedAssetsResult> {
  const db = await getKnexClient();

  const {
    folderId,
    folderIds,
    search,
    page = 1,
    limit = 50,
  } = options;

  const offset = (page - 1) * limit;

  const buildQuery = (builder: Knex.QueryBuilder) => {
    builder
      .where('is_published', false)
      .whereNull('deleted_at');

    if (folderIds && folderIds.length > 0) {
      const actualFolderIds = folderIds.filter(id => id !== 'root');
      const includesRoot = folderIds.includes('root');

      if (includesRoot && actualFolderIds.length > 0) {
        builder.where(function () {
          this.whereNull('asset_folder_id')
            .orWhereIn('asset_folder_id', actualFolderIds);
        });
      } else if (includesRoot) {
        builder.whereNull('asset_folder_id');
      } else {
        builder.whereIn('asset_folder_id', actualFolderIds);
      }
    } else if (folderId !== undefined) {
      if (folderId === null) {
        builder.whereNull('asset_folder_id');
      } else {
        builder.where('asset_folder_id', folderId);
      }
    }

    if (search && search.trim()) {
      builder.whereILike('filename', `%${search.trim()}%`);
    }
  };

  const countResult = await db('assets')
    .modify(buildQuery)
    .count('* as total')
    .first();

  const total = Number(countResult?.total ?? 0);

  const assets = await db('assets')
    .select('*')
    .modify(buildQuery)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    assets,
    total,
    page,
    limit,
    hasMore: offset + limit < total,
  };
}

/**
 * Get all draft assets (legacy function for backwards compatibility)
 * @param folderId - Optional folder ID to filter assets (null for root folder, undefined for all assets)
 * @deprecated Use getAssetsPaginated for better performance with large datasets
 */
export async function getAllAssets(folderId?: string | null): Promise<Asset[]> {
  const db = await getKnexClient();

  let query = db('assets')
    .select('*')
    .where('is_published', false)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc');

  if (folderId !== undefined) {
    if (folderId === null) {
      query = query.whereNull('asset_folder_id');
    } else {
      query = query.where('asset_folder_id', folderId);
    }
  }

  return await query;
}

/**
 * Get asset by ID
 * @param id Asset ID
 * @param isPublished If true, get published version; if false, get draft version (default: false)
 */
export async function getAssetById(id: string, isPublished: boolean = false): Promise<Asset | null> {
  const db = await getKnexClient();

  let query = db('assets')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished);

  if (!isPublished) {
    query = query.whereNull('deleted_at');
  }

  const data = await query.first();
  return data || null;
}

/**
 * Get minimal asset info for proxy serving (ignores publish state)
 * Returns the first matching non-deleted record since both draft/published share the same storage_path
 */
export async function getAssetForProxy(id: string): Promise<Pick<Asset, 'id' | 'filename' | 'storage_path' | 'mime_type'> | null> {
  const db = await getKnexClient();

  const data = await db('assets')
    .select('id', 'filename', 'storage_path', 'mime_type')
    .where('id', id)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get multiple assets by IDs in a single query
 * Returns a map of asset ID to asset for quick lookup
 * @param isPublished If true, get published versions; if false, get draft versions (default: false)
 */
export async function getAssetsByIds(ids: string[], isPublished: boolean = false): Promise<Record<string, Asset>> {
  const db = await getKnexClient();

  if (ids.length === 0) {
    return {};
  }

  let query = db('assets')
    .select('*')
    .where('is_published', isPublished)
    .whereIn('id', ids);

  if (!isPublished) {
    query = query.whereNull('deleted_at');
  }

  const data: Asset[] = await query;

  const assetMap: Record<string, Asset> = {};
  data.forEach(asset => {
    assetMap[asset.id] = asset;
  });

  return assetMap;
}

/**
 * Create asset record (always creates as draft)
 */
export async function createAsset(assetData: CreateAssetData): Promise<Asset> {
  const db = await getKnexClient();

  const now = new Date().toISOString();
  const content_hash = generateAssetContentHash({
    filename: assetData.filename,
    storage_path: assetData.storage_path ?? null,
    public_url: assetData.public_url ?? null,
    file_size: assetData.file_size,
    mime_type: assetData.mime_type,
    width: assetData.width ?? null,
    height: assetData.height ?? null,
    asset_folder_id: assetData.asset_folder_id ?? null,
    content: assetData.content ?? null,
    source: assetData.source,
  });

  const [data] = await db('assets')
    .insert({
      ...assetData,
      content_hash,
      is_published: false,
      updated_at: now,
    })
    .returning('*');

  return data;
}

/**
 * Update asset (only updates drafts)
 */
export interface UpdateAssetData {
  filename?: string;
  asset_folder_id?: string | null;
  content?: string | null; // Allow updating SVG content
}

export async function updateAsset(id: string, assetData: UpdateAssetData): Promise<Asset> {
  const db = await getKnexClient();

  const [data] = await db('assets')
    .where('id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({
      ...assetData,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  if (!data) {
    throw new Error('Failed to update asset: record not found');
  }

  const content_hash = generateAssetContentHash({
    filename: data.filename,
    storage_path: data.storage_path,
    public_url: data.public_url,
    file_size: data.file_size,
    mime_type: data.mime_type,
    width: data.width,
    height: data.height,
    asset_folder_id: data.asset_folder_id,
    content: data.content,
    source: data.source,
  });

  const [updated] = await db('assets')
    .where('id', id)
    .where('is_published', false)
    .update({ content_hash })
    .returning('*');

  return updated;
}

/**
 * Soft-delete asset (sets deleted_at on draft)
 * If the asset was never published, also deletes the physical file
 */
export async function deleteAsset(id: string): Promise<void> {
  const db = await getKnexClient();

  const draftAsset = await getAssetById(id, false);

  if (!draftAsset) {
    throw new Error('Asset not found');
  }

  const publishedAsset = await getAssetById(id, true);

  if (!publishedAsset && draftAsset.storage_path) {
    const { deleteFile } = await import('@/lib/local-storage');
    await deleteFile(draftAsset.storage_path);
  }

  await db('assets')
    .where('id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({ deleted_at: new Date().toISOString() });
}

/**
 * Bulk soft-delete assets
 * If assets were never published, also deletes their physical files
 */
export async function bulkDeleteAssets(ids: string[]): Promise<{ success: string[]; failed: string[] }> {
  const db = await getKnexClient();

  if (ids.length === 0) {
    return { success: [], failed: [] };
  }

  const draftAssets: Asset[] = [];

  for (let i = 0; i < ids.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    const data = await db('assets')
      .select('*')
      .whereIn('id', batchIds)
      .where('is_published', false)
      .whereNull('deleted_at');

    draftAssets.push(...data);
  }

  const publishedIds = new Set<string>();
  for (let i = 0; i < ids.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    const publishedAssets = await db('assets')
      .select('id')
      .whereIn('id', batchIds)
      .where('is_published', true);

    publishedAssets.forEach((a: { id: string }) => publishedIds.add(a.id));
  }

  const storagePaths = draftAssets
    .filter(asset => asset.storage_path && !publishedIds.has(asset.id))
    .map(asset => asset.storage_path as string);

  if (storagePaths.length > 0) {
    const { deleteFiles } = await import('@/lib/local-storage');
    await deleteFiles(storagePaths);
  }

  for (let i = 0; i < ids.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    await db('assets')
      .whereIn('id', batchIds)
      .where('is_published', false)
      .whereNull('deleted_at')
      .update({ deleted_at: new Date().toISOString() });
  }

  return { success: ids, failed: [] };
}

/**
 * Bulk update assets (move to folder) - only updates drafts
 */
export async function bulkUpdateAssets(
  ids: string[],
  updates: UpdateAssetData
): Promise<{ success: string[]; failed: string[] }> {
  const db = await getKnexClient();

  if (ids.length === 0) {
    return { success: [], failed: [] };
  }

  const now = new Date().toISOString();

  for (let i = 0; i < ids.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);

    await db('assets')
      .whereIn('id', batchIds)
      .where('is_published', false)
      .whereNull('deleted_at')
      .update({
        ...updates,
        updated_at: now,
      });

    const updatedAssets: Asset[] = await db('assets')
      .select('*')
      .whereIn('id', batchIds)
      .where('is_published', false)
      .whereNull('deleted_at');

    if (updatedAssets.length > 0) {
      const hashRecords = updatedAssets.map(a => ({
        id: a.id,
        is_published: false as const,
        content_hash: generateAssetContentHash({
          filename: a.filename,
          storage_path: a.storage_path,
          public_url: a.public_url,
          file_size: a.file_size,
          mime_type: a.mime_type,
          width: a.width,
          height: a.height,
          asset_folder_id: a.asset_folder_id,
          content: a.content,
          source: a.source,
        }),
      }));

      await db('assets')
        .insert(hashRecords)
        .onConflict(['id', 'is_published'])
        .merge();
    }
  }

  return { success: ids, failed: [] };
}

/**
 * Sanitize filename for storage
 * Removes spaces and special characters that might cause issues
 */
function sanitizeFilename(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  const name = lastDot > 0 ? filename.substring(0, lastDot) : filename;
  const ext = lastDot > 0 ? filename.substring(lastDot) : '';

  const sanitized = name
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '')
    .toLowerCase();

  return sanitized + ext.toLowerCase();
}

/**
 * Upload file to storage
 */
export async function uploadFile(file: File): Promise<{ path: string; url: string }> {
  const { uploadFile: uploadToLocal, getPublicUrl } = await import('@/lib/local-storage');

  const sanitizedName = sanitizeFilename(file.name);
  const storagePath = `${STORAGE_FOLDERS.WEBSITE}/${Date.now()}-${sanitizedName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await uploadToLocal(storagePath, buffer);

  return {
    path: storagePath,
    url: getPublicUrl(storagePath),
  };
}

// =============================================================================
// Publishing Functions
// =============================================================================

/**
 * Get all unpublished (draft) assets that have changes.
 * An asset needs publishing if no published version exists or content_hash differs.
 */
export async function getUnpublishedAssets(): Promise<Asset[]> {
  const db = await getKnexClient();

  const draftAssets: Asset[] = await db('assets')
    .select('*')
    .where('is_published', false)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc');

  if (draftAssets.length === 0) {
    return [];
  }

  const draftIds = draftAssets.map(a => a.id);
  const PUBLISHED_ASSET_HASH_BATCH_SIZE = 200;
  const publishedHashById = new Map<string, string | null>();

  for (let i = 0; i < draftIds.length; i += PUBLISHED_ASSET_HASH_BATCH_SIZE) {
    const batchIds = draftIds.slice(i, i + PUBLISHED_ASSET_HASH_BATCH_SIZE);
    const publishedAssets: Array<{ id: string; content_hash: string | null }> = await db('assets')
      .select('id', 'content_hash')
      .whereIn('id', batchIds)
      .where('is_published', true);

    publishedAssets.forEach(a => publishedHashById.set(a.id, a.content_hash));
  }

  return draftAssets.filter(draft => {
    if (!publishedHashById.has(draft.id)) {
      return true;
    }
    return draft.content_hash !== publishedHashById.get(draft.id);
  });
}

/**
 * Get soft-deleted draft assets that need their published versions and files removed
 */
export async function getDeletedDraftAssets(): Promise<Asset[]> {
  const db = await getKnexClient();

  return await db('assets')
    .select('*')
    .where('is_published', false)
    .whereNotNull('deleted_at');
}

/**
 * Publish assets - copies draft to published, using content_hash for change detection
 */
export async function publishAssets(assetIds: string[]): Promise<{ count: number }> {
  if (assetIds.length === 0) {
    return { count: 0 };
  }

  const db = await getKnexClient();

  const draftAssets: Asset[] = [];
  for (let i = 0; i < assetIds.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = assetIds.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    const data: Asset[] = await db('assets')
      .select('*')
      .whereIn('id', batchIds)
      .where('is_published', false)
      .whereNull('deleted_at');

    draftAssets.push(...data);
  }

  if (draftAssets.length === 0) {
    return { count: 0 };
  }

  const publishedHashById = new Map<string, string | null>();
  for (let i = 0; i < assetIds.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = assetIds.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    const existingPublished: Array<{ id: string; content_hash: string | null }> = await db('assets')
      .select('id', 'content_hash')
      .whereIn('id', batchIds)
      .where('is_published', true);

    existingPublished.forEach(a => publishedHashById.set(a.id, a.content_hash));
  }

  const recordsToUpsert: any[] = [];
  const now = new Date().toISOString();

  for (const draft of draftAssets) {
    if (publishedHashById.has(draft.id) && draft.content_hash === publishedHashById.get(draft.id)) {
      continue;
    }

    recordsToUpsert.push({
      id: draft.id,
      source: draft.source,
      filename: draft.filename,
      storage_path: draft.storage_path,
      public_url: draft.public_url,
      file_size: draft.file_size,
      mime_type: draft.mime_type,
      width: draft.width,
      height: draft.height,
      asset_folder_id: draft.asset_folder_id,
      content: draft.content,
      content_hash: draft.content_hash,
      is_published: true,
      created_at: draft.created_at,
      updated_at: now,
      deleted_at: null,
    });
  }

  if (recordsToUpsert.length > 0) {
    for (let i = 0; i < recordsToUpsert.length; i += SUPABASE_WRITE_BATCH_SIZE) {
      const batch = recordsToUpsert.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
      await db('assets')
        .insert(batch)
        .onConflict(['id', 'is_published'])
        .merge();
    }
  }

  return { count: recordsToUpsert.length };
}

/**
 * Hard delete assets that were soft-deleted in drafts
 * This removes:
 * 1. The published record (if exists)
 * 2. The physical file from storage
 * 3. The soft-deleted draft record
 */
export async function hardDeleteSoftDeletedAssets(): Promise<{ count: number }> {
  const db = await getKnexClient();

  const deletedDrafts = await getDeletedDraftAssets();

  if (deletedDrafts.length === 0) {
    return { count: 0 };
  }

  const ids = deletedDrafts.map(a => a.id);

  for (let i = 0; i < ids.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);

    await db('assets')
      .whereIn('id', batchIds)
      .where('is_published', true)
      .delete();

    await db('assets')
      .whereIn('id', batchIds)
      .where('is_published', false)
      .whereNotNull('deleted_at')
      .delete();
  }

  const storagePaths = deletedDrafts
    .filter(a => a.storage_path)
    .map(a => a.storage_path as string);

  await cleanupOrphanedStorageFiles('assets', storagePaths);

  return { count: deletedDrafts.length };
}
