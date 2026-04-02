/**
 * Page Folder Repository
 *
 * Data access layer for page folder operations with Knex
 */

import { getKnexClient } from '@/lib/knex-client';
import { batchUpdateColumn, jsonb } from '@/lib/knex-helpers';
import type { PageFolder } from '../../types';
import { incrementSiblingOrders } from '../services/pageService';

/**
 * Query filters for page folder lookups
 */
export interface QueryFilters {
  [key: string]: string | number | boolean | null;
}

/**
 * Data required to create a new page folder
 */
export interface CreatePageFolderData {
  id?: string;
  name: string;
  slug: string;
  depth?: number;
  order?: number;
  settings?: Record<string, any>;
  is_published?: boolean;
  page_folder_id?: string | null;
}

/**
 * Data that can be updated on an existing page folder
 */
export interface UpdatePageFolderData {
  name?: string;
  slug?: string;
  depth?: number;
  order?: number;
  settings?: Record<string, any>;
  is_published?: boolean;
  page_folder_id?: string | null;
}

/**
 * Retrieves all page folders from the database
 *
 * @param filters - Optional key-value filters to apply (e.g., { is_published: true })
 * @returns Promise resolving to array of page folders, ordered by order field (ascending)
 * @throws Error if query fails
 */
export async function getAllPageFolders(filters?: QueryFilters): Promise<PageFolder[]> {
  const db = await getKnexClient();

  let query = db('page_folders')
    .select('*')
    .whereNull('deleted_at');

  if (filters) {
    Object.entries(filters).forEach(([column, value]) => {
      if (value === null) {
        query = query.whereNull(column);
      } else {
        query = query.where(column, value);
      }
    });
  }

  const data = await query.orderBy('order', 'asc');

  return data;
}

/**
 * Get page folder by ID
 * Filters by is_published to avoid ambiguity when both draft and
 * published rows exist (composite PK is id + is_published).
 */
export async function getPageFolderById(id: string, isPublished = false): Promise<PageFolder | null> {
  const db = await getKnexClient();

  const data = await db('page_folders')
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
 * @param orderBy - Order by field ('order' for manual sorting, 'created_at' for chronological)
 */
export async function getChildFolders(
  parentId: string | null,
  orderBy: 'order' | 'created_at' = 'order'
): Promise<PageFolder[]> {
  const db = await getKnexClient();

  let query = db('page_folders')
    .select('*')
    .whereNull('deleted_at');

  if (parentId === null) {
    query = query.whereNull('page_folder_id');
  } else {
    query = query.where('page_folder_id', parentId);
  }

  const data = await query.orderBy(orderBy, 'asc');

  return data;
}

/**
 * Create new page folder
 */
export async function createPageFolder(folderData: CreatePageFolderData): Promise<PageFolder> {
  const db = await getKnexClient();

  const insertData: Record<string, unknown> = { ...folderData };
  if (insertData.settings !== undefined) {
    insertData.settings = jsonb(insertData.settings);
  }

  const [data] = await db('page_folders')
    .insert(insertData)
    .returning('*');

  if (!data) {
    throw new Error('Failed to create page folder');
  }

  return data;
}

/**
 * Update page folder
 */
export async function updatePageFolder(id: string, updates: UpdatePageFolderData): Promise<PageFolder> {
  const db = await getKnexClient();

  const updateData: Record<string, unknown> = { ...updates };
  if (updateData.settings !== undefined) {
    updateData.settings = jsonb(updateData.settings);
  }

  const [data] = await db('page_folders')
    .where('id', id)
    .where('is_published', false)
    .update(updateData)
    .returning('*');

  if (!data) {
    throw new Error('Failed to update page folder');
  }

  return data;
}

/**
 * Get all descendant folder IDs recursively
 * Fetches all folders once and traverses in memory for better performance
 *
 * This is the database-aware version that fetches folders from the database.
 * For in-memory operations, use the utility function from lib/pages.ts instead.
 *
 * @param folderId - Parent folder ID
 * @returns Array of all descendant folder IDs
 */
async function getDescendantFolderIdsFromDB(folderId: string): Promise<string[]> {
  const db = await getKnexClient();

  // Fetch all non-deleted folders once
  const allFolders = await db('page_folders')
    .select('id', 'page_folder_id')
    .whereNull('deleted_at');

  if (allFolders.length === 0) {
    return [];
  }

  // Build a map for quick lookup: parentId -> childIds[]
  const foldersByParent = new Map<string, string[]>();
  for (const folder of allFolders) {
    const parentId = folder.page_folder_id || 'root';
    if (!foldersByParent.has(parentId)) {
      foldersByParent.set(parentId, []);
    }
    foldersByParent.get(parentId)!.push(folder.id);
  }

  // Recursively collect all descendant IDs using in-memory data
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
 * Batch update order for multiple folders
 * @param updates - Array of { id, order } objects
 */
export async function batchUpdateFolderOrder(updates: Array<{ id: string; order: number }>): Promise<void> {
  const db = await getKnexClient();

  await Promise.all(updates.map(({ id, order }) =>
    db('page_folders')
      .where('id', id)
      .where('is_published', false)
      .whereNull('deleted_at')
      .update({ order })
  ));
}

/**
 * Reorder all siblings (both pages and folders) at the same parent level
 * This ensures pages and folders share continuous order values
 * @param parentId - Parent folder ID (null for root)
 * @param depth - Depth level of the siblings to reorder
 */
export async function reorderSiblings(parentId: string | null, depth: number): Promise<void> {
  const db = await getKnexClient();

  // Fetch sibling folders - filter by parent_id AND depth (drafts only)
  let foldersQuery = db('page_folders')
    .select('id', 'order')
    .where('depth', depth)
    .where('is_published', false)
    .whereNull('deleted_at');

  if (parentId === null) {
    foldersQuery = foldersQuery.whereNull('page_folder_id');
  } else {
    foldersQuery = foldersQuery.where('page_folder_id', parentId);
  }

  const siblingFolders = await foldersQuery.orderBy('order', 'asc');

  // Fetch sibling pages - filter by parent_id AND depth (drafts only)
  let pagesQuery = db('pages')
    .select('id', 'order')
    .where('depth', depth)
    .where('is_published', false)
    .whereNull('deleted_at')
    .whereNull('error_page');

  if (parentId === null) {
    pagesQuery = pagesQuery.whereNull('page_folder_id');
  } else {
    pagesQuery = pagesQuery.where('page_folder_id', parentId);
  }

  const siblingPages = await pagesQuery.orderBy('order', 'asc');

  // Combine and sort by current order
  const allSiblings = [
    ...siblingFolders.map((f: any) => ({ id: f.id, order: f.order ?? 0, type: 'folder' as const })),
    ...siblingPages.map((p: any) => ({ id: p.id, order: p.order ?? 0, type: 'page' as const })),
  ].sort((a, b) => a.order - b.order);

  // Update order for all siblings (continuous sequence: 0, 1, 2, ...)
  // Only update items whose order actually changed
  const folderUpdates: Array<{ id: string; order: number }> = [];
  const pageUpdates: Array<{ id: string; order: number }> = [];

  allSiblings.forEach((sibling, index) => {
    if (sibling.order !== index) {
      if (sibling.type === 'folder') {
        folderUpdates.push({ id: sibling.id, order: index });
      } else {
        pageUpdates.push({ id: sibling.id, order: index });
      }
    }
  });

  // Apply updates using batch CASE statements for efficiency (drafts only)
  if (folderUpdates.length > 0) {
    await batchUpdateColumn(db, 'page_folders', 'order',
      folderUpdates.map(u => ({ id: u.id, value: u.order })),
      {
        extraWhereClause: 'AND is_published = false AND deleted_at IS NULL',
        castType: 'integer',
      }
    );
  }

  if (pageUpdates.length > 0) {
    await batchUpdateColumn(db, 'pages', 'order',
      pageUpdates.map(u => ({ id: u.id, value: u.order })),
      {
        extraWhereClause: 'AND is_published = false AND deleted_at IS NULL AND error_page IS NULL',
        castType: 'integer',
      }
    );
  }
}

/**
 * Soft delete a page folder and all its nested pages and folders
 * Sets deleted_at to current timestamp instead of hard deleting
 * Recursively deletes all child folders, pages, and their page_layers
 * After deletion, reorders remaining folders with the same parent_id
 */
export async function deletePageFolder(id: string): Promise<void> {
  const db = await getKnexClient();

  const deletedAt = new Date().toISOString();

  // Get the folder before deletion to know its parent_id and depth
  const folderToDelete = await getPageFolderById(id);
  if (!folderToDelete) {
    throw new Error('Folder not found');
  }

  // Query 1: Get all descendant folder IDs from database
  const descendantFolderIds = await getDescendantFolderIdsFromDB(id);
  const allFolderIds = [id, ...descendantFolderIds];

  // Query 2: Get all draft page IDs within these folders
  const affectedPages = await db('pages')
    .select('id')
    .whereIn('page_folder_id', allFolderIds)
    .where('is_published', false)
    .whereNull('deleted_at');

  const affectedPageIds = affectedPages.map((p: any) => p.id);

  // Query 3: Soft-delete all draft page_layers for affected pages (if any)
  if (affectedPageIds.length > 0) {
    await db('page_layers')
      .whereIn('page_id', affectedPageIds)
      .where('is_published', false)
      .whereNull('deleted_at')
      .update({ deleted_at: deletedAt });
  }

  // Query 4: Soft-delete all draft pages within this folder and its descendants
  await db('pages')
    .whereIn('page_folder_id', allFolderIds)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({ deleted_at: deletedAt });

  // Query 5: Soft-delete ALL draft folders (parent + descendants) in a single query
  await db('page_folders')
    .whereIn('id', allFolderIds)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({ deleted_at: deletedAt });

  // Reorder remaining siblings (both pages and folders) with the same parent_id and depth
  try {
    await reorderSiblings(folderToDelete.page_folder_id, folderToDelete.depth);
  } catch (reorderError) {
    console.error('[deletePageFolder] Failed to reorder siblings:', reorderError);
  }
}

/**
 * Restore a soft-deleted page folder
 */
export async function restorePageFolder(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('page_folders')
    .where('id', id)
    .where('is_published', false)
    .whereNotNull('deleted_at')
    .update({ deleted_at: null });
}

/**
 * Force delete a page folder (permanent deletion)
 * Use with caution!
 */
export async function forceDeletePageFolder(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('page_folders')
    .where('id', id)
    .delete();
}

/**
 * Get draft page folder by ID
 */
export async function getDraftPageFolderById(id: string): Promise<PageFolder | null> {
  const db = await getKnexClient();

  const data = await db('page_folders')
    .select('*')
    .where('id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get published page folder by ID
 */
export async function getPublishedPageFolderById(id: string): Promise<PageFolder | null> {
  const db = await getKnexClient();

  const data = await db('page_folders')
    .select('*')
    .where('id', id)
    .where('is_published', true)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get all draft page folders (is_published = false)
 * @param includeSoftDeleted - Include soft-deleted folders
 */
export async function getAllDraftPageFolders(includeSoftDeleted = false): Promise<PageFolder[]> {
  const db = await getKnexClient();

  let query = db('page_folders')
    .select('*')
    .where('is_published', false);

  if (!includeSoftDeleted) {
    query = query.whereNull('deleted_at');
  }

  const data = await query.orderBy('order', 'asc');

  return data;
}

/**
 * Get all published page folders
 *
 * @param includeSoftDeleted - Whether to include soft-deleted folders (default: false)
 * @returns Array of published page folders
 */
export async function getAllPublishedPageFolders(includeSoftDeleted = false): Promise<PageFolder[]> {
  const db = await getKnexClient();

  let query = db('page_folders')
    .select('*')
    .where('is_published', true);

  if (!includeSoftDeleted) {
    query = query.whereNull('deleted_at');
  }

  const data = await query.orderBy('order', 'asc');

  return data;
}

/**
 * Get published page folders by IDs
 * Fetches multiple published folders in a single query
 */
export async function getPublishedPageFoldersByIds(ids: string[]): Promise<PageFolder[]> {
  const db = await getKnexClient();

  if (ids.length === 0) {
    return [];
  }

  const data = await db('page_folders')
    .select('*')
    .whereIn('id', ids)
    .where('is_published', true);

  return data;
}

/**
 * Get page folder by slug
 * @param slug - Folder slug
 * @param filters - Optional additional filters
 */
export async function getPageFolderBySlug(slug: string, filters?: QueryFilters): Promise<PageFolder | null> {
  const db = await getKnexClient();

  let query = db('page_folders')
    .select('*')
    .where('slug', slug)
    .whereNull('deleted_at');

  if (filters) {
    Object.entries(filters).forEach(([column, value]) => {
      if (value === null) {
        query = query.whereNull(column);
      } else {
        query = query.where(column, value);
      }
    });
  }

  const data = await query.first();

  return data || null;
}

/**
 * Reorder folders within a parent
 * Updates the order field for multiple folders in a single operation
 * @param updates - Array of { id, order } objects
 */
export async function reorderFolders(updates: Array<{ id: string; order: number }>): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  const db = await getKnexClient();

  await batchUpdateColumn(db, 'page_folders', 'order',
    updates.map(u => ({ id: u.id, value: u.order })),
    {
      extraWhereClause: 'AND is_published = false AND deleted_at IS NULL',
      castType: 'integer',
    }
  );
}

/**
 * Duplicate a page folder recursively
 * Creates a copy of the folder with all its child pages and folders
 * @param folderId - ID of the folder to duplicate
 * @returns The newly created folder
 */
export async function duplicatePageFolder(folderId: string): Promise<PageFolder> {
  const db = await getKnexClient();

  // Get the original folder
  const originalFolder = await getPageFolderById(folderId);
  if (!originalFolder) {
    throw new Error('Folder not found');
  }

  const newName = `${originalFolder.name} (Copy)`;

  // Generate base slug from the new name
  const baseSlug = newName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Get all existing slugs in the same parent folder to find a unique one
  let query = db('page_folders')
    .select('slug')
    .whereNull('deleted_at');

  if (originalFolder.page_folder_id === null) {
    query = query.whereNull('page_folder_id');
  } else {
    query = query.where('page_folder_id', originalFolder.page_folder_id);
  }

  const existingFolders = await query;

  const existingSlugs = existingFolders.map((f: any) => f.slug.toLowerCase());

  // Find unique slug
  let newSlug = baseSlug;
  if (existingSlugs.includes(baseSlug)) {
    let counter = 2;
    newSlug = `${baseSlug}-${counter}`;
    while (existingSlugs.includes(newSlug)) {
      counter++;
      newSlug = `${baseSlug}-${counter}`;
    }
  }

  // Place the duplicate right after the original folder
  const newOrder = originalFolder.order + 1;

  // Increment order for all siblings (folders and pages) that come after the original folder
  await incrementSiblingOrders(newOrder, originalFolder.depth, originalFolder.page_folder_id);

  // Create the new folder
  const [newFolder] = await db('page_folders')
    .insert({
      name: newName,
      slug: newSlug,
      is_published: false,
      page_folder_id: originalFolder.page_folder_id,
      order: newOrder,
      depth: originalFolder.depth,
      settings: jsonb(originalFolder.settings || {}),
    })
    .returning('*');

  if (!newFolder) {
    throw new Error('Failed to create duplicate folder');
  }

  // Now recursively duplicate all child folders and pages
  await duplicateFolderContents(db, folderId, newFolder.id);

  return newFolder;
}

/**
 * Helper function to recursively duplicate all contents of a folder
 * @param db - Knex instance
 * @param originalFolderId - Original folder ID
 * @param newFolderId - New folder ID
 */
async function duplicateFolderContents(
  db: any,
  originalFolderId: string,
  newFolderId: string
): Promise<void> {
  // Get all child folders
  const childFolders = await db('page_folders')
    .select('*')
    .where('page_folder_id', originalFolderId)
    .whereNull('deleted_at')
    .orderBy('order', 'asc');

  // Get all child pages
  const childPages = await db('pages')
    .select('*')
    .where('page_folder_id', originalFolderId)
    .whereNull('deleted_at')
    .orderBy('order', 'asc');

  // Duplicate child folders first (to maintain order)
  const folderIdMap = new Map<string, string>();

  if (childFolders && childFolders.length > 0) {
    for (const folder of childFolders) {
      const timestamp = Date.now() + Math.random();
      const newFolderSlug = `folder-${Math.floor(timestamp)}`;

      const [duplicatedFolder] = await db('page_folders')
        .insert({
          name: folder.name,
          slug: newFolderSlug,
          is_published: false,
          page_folder_id: newFolderId,
          order: folder.order,
          depth: folder.depth,
          settings: jsonb(folder.settings || {}),
        })
        .returning('*');

      if (!duplicatedFolder) {
        throw new Error('Failed to duplicate child folder');
      }

      folderIdMap.set(folder.id, duplicatedFolder.id);

      // Recursively duplicate this folder's contents
      await duplicateFolderContents(db, folder.id, duplicatedFolder.id);
    }
  }

  // Duplicate child pages
  if (childPages && childPages.length > 0) {
    for (const page of childPages) {
      const timestamp = Date.now() + Math.random();
      const newPageSlug = page.is_index ? '' : `page-${Math.floor(timestamp)}`;

      const [duplicatedPage] = await db('pages')
        .insert({
          name: page.name,
          slug: newPageSlug,
          is_published: false,
          page_folder_id: newFolderId,
          order: page.order,
          depth: page.depth,
          is_index: page.is_index,
          is_dynamic: page.is_dynamic,
          error_page: page.error_page,
          settings: jsonb(page.settings || {}),
        })
        .returning('*');

      if (!duplicatedPage) {
        throw new Error('Failed to duplicate child page');
      }

      // Duplicate the page's draft layers if they exist
      const originalLayers = await db('page_layers')
        .select('*')
        .where('page_id', page.id)
        .where('is_published', false)
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc')
        .first();

      if (originalLayers) {
        await db('page_layers')
          .insert({
            page_id: duplicatedPage.id,
            layers: jsonb(originalLayers.layers),
            is_published: false,
          });
      }
    }
  }
}
