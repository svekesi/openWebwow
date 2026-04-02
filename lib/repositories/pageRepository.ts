/**
 * Page Repository
 *
 * Data access layer for page operations with Knex
 */

import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import { reorderSiblings } from '@/lib/repositories/pageFolderRepository';
import type { Page, PageSettings } from '../../types';
import { isHomepage } from '../page-utils';
import { incrementSiblingOrders, fixOrphanedPageSlugs } from '../services/pageService';
import { generatePageMetadataHash } from '../hash-utils';

/**
 * Query filters for page lookups
 */
export interface QueryFilters {
  [key: string]: string | number | boolean | null;
}

/**
 * Data required to create a new page
 */
export interface CreatePageData {
  id?: string;
  name: string;
  slug: string;
  is_published?: boolean;
  page_folder_id?: string | null;
  order?: number;
  depth?: number;
  is_index?: boolean;
  is_dynamic?: boolean;
  error_page?: number | null;
  settings?: PageSettings;
  content_hash?: string;
}

/**
 * Data that can be updated on an existing page
 */
export interface UpdatePageData {
  name?: string;
  slug?: string;
  is_published?: boolean;
  page_folder_id?: string | null;
  order?: number;
  depth?: number;
  is_index?: boolean;
  is_dynamic?: boolean;
  error_page?: number | null;
  settings?: PageSettings;
  content_hash?: string; // Auto-calculated, should not be set manually
}

function normalizePageFolderId(folderId?: string | null): string | null {
  if (folderId === undefined || folderId === null) {
    return null;
  }

  if (typeof folderId === 'string') {
    const trimmed = folderId.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }
    return trimmed;
  }

  return folderId;
}

/**
 * Retrieves all pages from the database
 *
 * @param filters - Optional key-value filters to apply (e.g., { is_published: true })
 * @returns Promise resolving to array of pages, ordered by creation date (newest first)
 * @throws Error if query fails
 *
 * @example
 * const allPages = await getAllPages();
 * const publishedPages = await getAllPages({ is_published: true });
 */
export async function getAllPages(filters?: QueryFilters): Promise<Page[]> {
  const db = await getKnexClient();

  let query = db('pages')
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
 * Get page by ID
 * @param id - Page ID
 * @param isPublished - Get draft (false) or published (true) version. Defaults to false (draft).
 */
export async function getPageById(id: string, isPublished: boolean = false): Promise<Page | null> {
  const db = await getKnexClient();

  const data = await db('pages')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get page by slug
 * @param slug - Page slug
 * @param filters - Optional additional filters
 */
export async function getPageBySlug(slug: string, filters?: QueryFilters): Promise<Page | null> {
  const db = await getKnexClient();

  let query = db('pages')
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
 * Generate a unique slug from a page name
 */
function generateSlugFromName(name: string, timestamp?: number): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (timestamp) {
    return `${baseSlug}-${timestamp}`;
  }

  return baseSlug || `page-${Date.now()}`;
}

/**
 * Automatically transfer index status from existing index page to new one
 * - Finds existing index page in the same folder
 * - Unsets its is_index flag
 * - Generates and sets a slug for it
 */
async function transferIndexPage(
  db: any,
  newIndexPageId: string,
  pageFolderId: string | null,
  isPublished: boolean = false
): Promise<void> {
  // Find existing index page in the same folder WITH THE SAME is_published status
  // This prevents draft pages from being modified when creating published index pages
  let query = db('pages')
    .select('id', 'name', 'slug')
    .where('is_index', true)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .where('id', '!=', newIndexPageId);

  // Filter by parent folder
  if (pageFolderId === null || pageFolderId === undefined) {
    query = query.whereNull('page_folder_id');
  } else {
    query = query.where('page_folder_id', pageFolderId);
  }

  const existingIndex = await query.first();

  // If no existing index found, nothing to transfer
  if (!existingIndex) {
    return;
  }

  // If the existing index page already has a slug (shouldn't happen but might in edge cases),
  // we don't need to generate a new one - just unset is_index
  if (existingIndex.slug && existingIndex.slug.trim() !== '') {
    await db('pages')
      .where('id', existingIndex.id)
      .where('is_published', isPublished)
      .update({
        is_index: false,
        updated_at: new Date().toISOString()
      });

    return;
  }

  // Generate a slug for the old index page
  const timestamp = Date.now();
  let newSlug = generateSlugFromName(existingIndex.name);

  // Check if slug already exists (regardless of published state)
  const duplicateCheck = await db('pages')
    .select('id')
    .where('slug', newSlug)
    .whereNull('deleted_at')
    .where('id', '!=', existingIndex.id)
    .first();

  // If slug exists, add timestamp
  if (duplicateCheck) {
    newSlug = generateSlugFromName(existingIndex.name, timestamp);

    // Double-check the timestamped slug doesn't exist either
    const timestampedDuplicateCheck = await db('pages')
      .select('id')
      .where('slug', newSlug)
      .whereNull('deleted_at')
      .where('id', '!=', existingIndex.id)
      .first();

    // If still duplicate, add random suffix
    if (timestampedDuplicateCheck) {
      newSlug = `${newSlug}-${Math.random().toString(36).substr(2, 5)}`;
    }
  }

  // Update the old index page: unset is_index and set slug
  await db('pages')
    .where('id', existingIndex.id)
    .where('is_published', isPublished)
    .update({
      is_index: false,
      slug: newSlug,
      updated_at: new Date().toISOString()
    });
}

/**
 * Validate index page constraints
 * - Index pages must have empty slug
 * - Non-index pages must have non-empty slug (unless they're error pages or dynamic pages)
 * - Error pages can have empty slugs regardless of is_index status
 * - Dynamic pages use "*" as slug placeholder
 * - Root folder (page_folder_id = null) must always have an index page
 * - Homepage (root index page) cannot be moved to another folder
 */
async function validateIndexPageConstraints(
  db: any,
  pageData: { is_index?: boolean; slug: string; page_folder_id?: string | null; error_page?: number | null; is_dynamic?: boolean },
  excludePageId?: string,
  currentPageData?: { is_index: boolean; page_folder_id: string | null; is_dynamic?: boolean }
): Promise<void> {
  // Rule 1: Index pages must have empty slug
  if (pageData.is_index && pageData.slug.trim() !== '') {
    throw new Error('Index pages must have an empty slug');
  }

  // Rule 2: Non-index, non-error, non-dynamic pages must have non-empty slug
  const isErrorPage = pageData.error_page !== null && pageData.error_page !== undefined;
  const isDynamicPage = pageData.is_dynamic === true;
  if (!pageData.is_index && !isErrorPage && !isDynamicPage && pageData.slug.trim() === '') {
    throw new Error('Non-index pages must have a non-empty slug');
  }

  // Rule 3: Homepage (root index page) cannot be moved to another folder
  if (currentPageData && isHomepage(currentPageData as Page)) {
    if (pageData.page_folder_id !== null && pageData.page_folder_id !== undefined) {
      throw new Error('The Homepage cannot be moved to another folder. It must remain in the root folder.');
    }
  }

  // Rule 4: Root folder must always have an index page
  // When unsetting is_index (changing from true to false) for a root page
  if (!pageData.is_index && (pageData.page_folder_id === null || pageData.page_folder_id === undefined)) {
    let query = db('pages')
      .select('id')
      .where('is_index', true)
      .whereNull('page_folder_id')
      .whereNull('deleted_at');

    if (excludePageId) {
      query = query.where('id', '!=', excludePageId);
    }

    const otherRootIndexPages = await query;

    if (otherRootIndexPages.length === 0) {
      throw new Error('The root folder must have an index page. Please set another page as index first.');
    }
  }
}

/**
 * Create new page
 * @param pageData - Page data to create
 * @param additionalData - Optional additional fields (e.g., metadata, tags)
 */
export async function createPage(pageData: CreatePageData, additionalData?: Record<string, any>): Promise<Page> {
  const db = await getKnexClient();

  const normalizedPageFolderId = normalizePageFolderId(pageData.page_folder_id);
  const normalizedPageData: CreatePageData = {
    ...pageData,
    page_folder_id: normalizedPageFolderId,
  };

  // Validate index page constraints (no current page data for new pages)
  await validateIndexPageConstraints(
    db,
    {
      is_index: normalizedPageData.is_index || false,
      slug: normalizedPageData.slug,
      page_folder_id: normalizedPageFolderId,
      error_page: normalizedPageData.error_page,
      is_dynamic: normalizedPageData.is_dynamic || false,
    },
    undefined,
    undefined
  );

  // Calculate content hash for page metadata
  const contentHash = generatePageMetadataHash({
    name: normalizedPageData.name,
    slug: normalizedPageData.slug,
    settings: normalizedPageData.settings || {},
    is_index: normalizedPageData.is_index || false,
    is_dynamic: normalizedPageData.is_dynamic || false,
    error_page: normalizedPageData.error_page || null,
  });

  // Remove any content_hash from pageData to prevent override
  const { content_hash: _, ...pageDataWithoutHash } = normalizedPageData as any;

  // Merge page data with any additional fields and our calculated content hash
  const insertData: Record<string, unknown> = {
    ...(additionalData || {}),
    ...pageDataWithoutHash,
    content_hash: contentHash,
  };

  if (insertData.settings !== undefined) {
    insertData.settings = jsonb(insertData.settings);
  }

  const [data] = await db('pages')
    .insert(insertData)
    .returning('*');

  if (!data) {
    throw new Error('Failed to create page');
  }

  // If setting as index page, transfer from existing index page
  if (normalizedPageData.is_index) {
    await transferIndexPage(db, data.id, normalizedPageFolderId, normalizedPageData.is_published || false);
  }

  return data;
}

/**
 * Update page
 */
export async function updatePage(id: string, updates: UpdatePageData): Promise<Page> {
  const db = await getKnexClient();

  // Get current draft page data to merge with updates for validation
  // Repository update functions always update draft versions (users edit drafts)
  const currentPage = await getPageById(id, false);
  if (!currentPage) {
    throw new Error('Page not found');
  }

  const normalizedUpdates: UpdatePageData =
    updates.page_folder_id !== undefined
      ? {
        ...updates,
        page_folder_id: normalizePageFolderId(updates.page_folder_id),
      }
      : updates;

  // Merge current data with updates for validation
  const mergedData = {
    is_index: normalizedUpdates.is_index !== undefined ? normalizedUpdates.is_index : currentPage.is_index,
    slug: normalizedUpdates.slug !== undefined ? normalizedUpdates.slug : currentPage.slug,
    page_folder_id: normalizedUpdates.page_folder_id !== undefined ? normalizedUpdates.page_folder_id : currentPage.page_folder_id,
    error_page: normalizedUpdates.error_page !== undefined ? normalizedUpdates.error_page : currentPage.error_page,
    is_dynamic: normalizedUpdates.is_dynamic !== undefined ? normalizedUpdates.is_dynamic : currentPage.is_dynamic,
  };

  // Validate index page constraints if is_index or slug is being updated
  if (normalizedUpdates.is_index !== undefined || normalizedUpdates.slug !== undefined || normalizedUpdates.page_folder_id !== undefined) {
    await validateIndexPageConstraints(
      db,
      mergedData,
      id,
      { is_index: currentPage.is_index, page_folder_id: currentPage.page_folder_id }
    );
  }

  // If setting as index page (and wasn't before), transfer from existing index page
  // Use the TARGET page_folder_id (where the page will be) to find the existing index
  const isBecomingIndex = normalizedUpdates.is_index === true && !currentPage.is_index;

  if (isBecomingIndex) {
    const folderIdForTransfer = normalizedUpdates.page_folder_id !== undefined ? normalizedUpdates.page_folder_id : currentPage.page_folder_id;

    // FIRST: Clean up any orphaned pages with empty slugs that are NOT index pages
    // This can happen if a previous operation failed mid-way
    const orphanedPages = await db('pages')
      .select('id', 'name', 'slug', 'is_index', 'page_folder_id')
      .where('slug', '')
      .where('is_index', false)
      .whereNull('deleted_at');

    if (orphanedPages && orphanedPages.length > 0) {
      await fixOrphanedPageSlugs(orphanedPages);
    }

    await transferIndexPage(db, id, folderIdForTransfer, currentPage.is_published);
  }

  // Calculate new content hash based on merged data
  const finalData = {
    name: normalizedUpdates.name !== undefined ? normalizedUpdates.name : currentPage.name,
    slug: normalizedUpdates.slug !== undefined ? normalizedUpdates.slug : currentPage.slug,
    settings: normalizedUpdates.settings !== undefined ? normalizedUpdates.settings : currentPage.settings,
    is_index: normalizedUpdates.is_index !== undefined ? normalizedUpdates.is_index : currentPage.is_index,
    is_dynamic: normalizedUpdates.is_dynamic !== undefined ? normalizedUpdates.is_dynamic : currentPage.is_dynamic,
    error_page: normalizedUpdates.error_page !== undefined ? normalizedUpdates.error_page : currentPage.error_page,
  };

  const contentHash = generatePageMetadataHash(finalData);

  // Remove any content_hash from updates to prevent override, then add our calculated one
  const { content_hash: _, settings: settingsVal, ...updatesWithoutHash } = normalizedUpdates as any;

  const updatesWithHash: Record<string, unknown> = {
    ...updatesWithoutHash,
    content_hash: contentHash,
  };

  if (settingsVal !== undefined) {
    updatesWithHash.settings = jsonb(settingsVal);
  }

  // Repository update functions always update DRAFT versions (users edit drafts)
  const [data] = await db('pages')
    .where('id', id)
    .where('is_published', false)
    .update(updatesWithHash)
    .returning('*');

  if (!data) {
    throw new Error('Failed to update page');
  }

  return data;
}

/**
 * Batch update order for multiple pages
 * @param updates - Array of { id, order } objects
 */
export async function batchUpdatePageOrder(updates: Array<{ id: string; order: number }>): Promise<void> {
  const db = await getKnexClient();

  await Promise.all(updates.map(({ id, order }) =>
    db('pages')
      .where('id', id)
      .where('is_published', false)
      .whereNull('deleted_at')
      .update({ order })
  ));
}

/**
 * Soft delete a page and its associated page layers
 * Sets deleted_at to current timestamp instead of hard deleting
 * Also deletes all page_layers (draft and published) for this page
 * After deletion, reorders remaining pages with the same parent_id
 */
export async function deletePage(id: string): Promise<void> {
  const db = await getKnexClient();

  const deletedAt = new Date().toISOString();

  // Get the draft page before deletion to know its parent_id and depth
  // Repository delete functions always delete draft versions
  const pageToDelete = await getPageById(id, false);
  if (!pageToDelete) {
    throw new Error('Page not found');
  }

  // Prevent deleting the homepage
  if (isHomepage(pageToDelete)) {
    const otherRootIndexPages = await db('pages')
      .select('id')
      .where('is_index', true)
      .whereNull('page_folder_id')
      .whereNull('deleted_at')
      .where('id', '!=', id);

    if (otherRootIndexPages.length === 0) {
      throw new Error('Cannot delete the last index page in the root folder. Please set another page as index first.');
    }
  }

  // Soft-delete draft page layers (publishing service will handle published versions)
  await db('page_layers')
    .where('page_id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({ deleted_at: deletedAt });

  // Soft-delete the draft page (publishing service will handle published version)
  await db('pages')
    .where('id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .update({ deleted_at: deletedAt });

  // Reorder remaining siblings (both pages and folders) with the same parent_id and depth
  try {
    await reorderSiblings(pageToDelete.page_folder_id, pageToDelete.depth);
  } catch (reorderError) {
    console.error('[deletePage] Failed to reorder siblings:', reorderError);
  }
}

/**
 * Restore a soft-deleted page
 */
export async function restorePage(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('pages')
    .where('id', id)
    .where('is_published', false)
    .whereNotNull('deleted_at')
    .update({ deleted_at: null });
}

/**
 * Force delete a page (permanent deletion)
 * Use with caution!
 */
export async function forceDeletePage(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('pages')
    .where('id', id)
    .delete();
}

/**
 * Get all draft pages
 * @param includeDeleted - If true, includes soft-deleted drafts
 */
export async function getAllDraftPages(includeDeleted = false): Promise<Page[]> {
  const db = await getKnexClient();

  let query = db('pages')
    .select('*')
    .where('is_published', false);

  if (!includeDeleted) {
    query = query.whereNull('deleted_at');
  }

  const data = await query.orderBy('created_at', 'desc');

  return data;
}

/**
 * Get published pages by IDs
 * Used for batch publishing optimization
 */
export async function getPublishedPagesByIds(ids: string[]): Promise<Page[]> {
  const db = await getKnexClient();

  if (ids.length === 0) {
    return [];
  }

  const data = await db('pages')
    .select('*')
    .whereIn('id', ids)
    .where('is_published', true)
    .whereNull('deleted_at');

  return data;
}

/**
 * Get all pages in a specific folder
 * @param folderId - Folder ID (null for root/unorganized pages)
 */
export async function getPagesByFolder(folderId: string | null): Promise<Page[]> {
  const db = await getKnexClient();

  let query = db('pages')
    .select('*')
    .whereNull('deleted_at');

  if (folderId === null) {
    query = query.whereNull('page_folder_id');
  } else {
    query = query.where('page_folder_id', folderId);
  }

  const data = await query.orderBy('created_at', 'desc');

  return data;
}

/**
 * Duplicate a page with its draft layers
 * Creates a copy of the page and its draft layers with a new slug
 *
 * @param pageId - ID of the page to duplicate
 * @returns Promise resolving to the new duplicated page
 */
export async function duplicatePage(pageId: string): Promise<Page> {
  const db = await getKnexClient();

  // Get the original draft page
  const originalPage = await getPageById(pageId, false);
  if (!originalPage) {
    throw new Error('Page not found');
  }

  // Dynamic pages cannot be duplicated
  if (originalPage.is_dynamic) {
    throw new Error('Dynamic pages cannot be duplicated');
  }

  const newName = `${originalPage.name} (Copy)`;

  // Generate base slug from the new name
  const baseSlug = newName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Get all existing slugs in the same folder to find a unique one
  let query = db('pages')
    .select('slug')
    .where('is_published', false)
    .whereNull('error_page')
    .whereNull('deleted_at');

  if (originalPage.page_folder_id === null) {
    query = query.whereNull('page_folder_id');
  } else {
    query = query.where('page_folder_id', originalPage.page_folder_id);
  }

  const existingPages = await query;

  const existingSlugs = existingPages.map((p: any) => p.slug.toLowerCase());

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

  // Place the duplicate right after the original page
  const newOrder = originalPage.order + 1;

  // Increment order for all siblings (pages and folders) that come after the original page
  await incrementSiblingOrders(newOrder, originalPage.depth, originalPage.page_folder_id);

  // Create the new page
  const [newPage] = await db('pages')
    .insert({
      name: newName,
      slug: newSlug,
      is_published: false,
      page_folder_id: originalPage.page_folder_id,
      order: newOrder,
      depth: originalPage.depth,
      is_index: false,
      is_dynamic: originalPage.is_dynamic,
      error_page: originalPage.error_page,
      settings: jsonb(originalPage.settings || {}),
    })
    .returning('*');

  if (!newPage) {
    throw new Error('Failed to create duplicate page');
  }

  // Get the original page's draft layers
  const originalLayers = await db('page_layers')
    .select('*')
    .where('page_id', pageId)
    .where('is_published', false)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .first();

  // If there are draft layers, duplicate them for the new page
  if (originalLayers) {
    try {
      await db('page_layers')
        .insert({
          page_id: newPage.id,
          layers: jsonb(originalLayers.layers),
          is_published: false,
        });
    } catch (newLayersError) {
      console.error('Failed to duplicate layers:', newLayersError);
    }
  }

  return newPage;
}

/**
 * Get count of unpublished pages efficiently.
 * Uses 2 bulk queries instead of N+1 per-page lookups.
 */
export async function getUnpublishedPagesCount(): Promise<number> {
  const db = await getKnexClient();

  // 2 bulk queries: all draft pages with layers + all published pages with layers
  const [draftData, publishedData] = await Promise.all([
    db('pages')
      .select(
        'pages.id',
        'pages.content_hash',
        'pages.page_folder_id',
        'page_layers.content_hash as layer_content_hash'
      )
      .join('page_layers', function () {
        this.on('pages.id', '=', 'page_layers.page_id')
          .andOn('page_layers.is_published', '=', db.raw('?', [false]));
      })
      .where('pages.is_published', false)
      .whereNull('pages.deleted_at')
      .whereNull('page_layers.deleted_at'),
    db('pages')
      .select(
        'pages.id',
        'pages.content_hash',
        'pages.page_folder_id',
        'page_layers.content_hash as layer_content_hash'
      )
      .join('page_layers', function () {
        this.on('pages.id', '=', 'page_layers.page_id')
          .andOn('page_layers.is_published', '=', db.raw('?', [true]));
      })
      .where('pages.is_published', true)
      .whereNull('pages.deleted_at')
      .whereNull('page_layers.deleted_at'),
  ]);

  if (draftData.length === 0) {
    return 0;
  }

  // Build published lookup: id -> { content_hash, page_folder_id, layerHash }
  const publishedMap = new Map<string, {
    content_hash: string | null;
    page_folder_id: string | null;
    layerHash: string | null;
  }>();
  for (const pub of publishedData) {
    publishedMap.set(pub.id, {
      content_hash: pub.content_hash,
      page_folder_id: pub.page_folder_id,
      layerHash: pub.layer_content_hash ?? null,
    });
  }

  // Count pages needing publishing
  let count = 0;
  for (const draft of draftData) {
    const pub = publishedMap.get(draft.id);

    if (!pub) {
      count++; // Never published
      continue;
    }

    const pageMetadataChanged = draft.content_hash !== pub.content_hash;

    const layersChanged =
      (draft.layer_content_hash ?? null) !== pub.layerHash;

    const folderChanged = draft.page_folder_id !== pub.page_folder_id;

    if (pageMetadataChanged || layersChanged || folderChanged) {
      count++;
    }
  }

  return count;
}

/**
 * Get all unpublished pages
 * A page needs publishing if:
 * - It has is_published: false (never published), OR
 * - Its draft content differs from published content (needs republishing)
 *
 * Uses content_hash for efficient change detection
 */
export async function getUnpublishedPages(): Promise<Page[]> {
  const db = await getKnexClient();

  // Get all draft pages with their layers' content_hash in a single efficient query
  const draftPagesWithLayers = await db('pages')
    .select(
      'pages.*',
      'page_layers.content_hash as layer_content_hash'
    )
    .join('page_layers', function () {
      this.on('pages.id', '=', 'page_layers.page_id')
        .andOn('page_layers.is_published', '=', db.raw('?', [false]));
    })
    .where('pages.is_published', false)
    .whereNull('pages.deleted_at')
    .whereNull('page_layers.deleted_at')
    .orderBy('pages.created_at', 'desc');

  if (draftPagesWithLayers.length === 0) {
    return [];
  }

  const unpublishedPages: Page[] = [];

  // Check each draft page
  for (const draftPage of draftPagesWithLayers) {
    // Check if a published version exists
    const publishedPageWithLayers = await db('pages')
      .select(
        'pages.id',
        'pages.content_hash',
        'pages.page_folder_id',
        'page_layers.content_hash as layer_content_hash'
      )
      .join('page_layers', function () {
        this.on('pages.id', '=', 'page_layers.page_id')
          .andOn('page_layers.is_published', '=', db.raw('?', [true]));
      })
      .where('pages.id', draftPage.id)
      .where('pages.is_published', true)
      .whereNull('pages.deleted_at')
      .whereNull('page_layers.deleted_at')
      .first();

    // If no published version exists, needs first-time publishing
    if (!publishedPageWithLayers) {
      unpublishedPages.push(draftPage);
      continue;
    }

    const pageMetadataChanged =
      draftPage.content_hash !== publishedPageWithLayers.content_hash;

    const layersChanged =
      (draftPage.layer_content_hash ?? null) !==
      (publishedPageWithLayers.layer_content_hash ?? null);

    // Check if page was moved to a different folder
    const folderChanged = draftPage.page_folder_id !== publishedPageWithLayers.page_folder_id;

    // If any of these changed, needs republishing
    if (pageMetadataChanged || layersChanged || folderChanged) {
      unpublishedPages.push(draftPage);
    }
  }

  return unpublishedPages;
}

/**
 * Hard-delete soft-deleted draft pages and their published counterparts.
 * Page layers are cleaned up automatically via CASCADE.
 */
export async function hardDeleteSoftDeletedPages(): Promise<{ count: number }> {
  const db = await getKnexClient();

  const deletedDrafts = await db('pages')
    .select('id')
    .where('is_published', false)
    .whereNotNull('deleted_at');

  if (deletedDrafts.length === 0) {
    return { count: 0 };
  }

  const ids = deletedDrafts.map((p: any) => p.id);

  // Delete published versions first (CASCADE removes page_layers)
  try {
    await db('pages')
      .whereIn('id', ids)
      .where('is_published', true)
      .delete();
  } catch (pubError) {
    console.error('Failed to delete published pages:', pubError);
  }

  // Delete soft-deleted draft versions (CASCADE removes page_layers)
  await db('pages')
    .whereIn('id', ids)
    .where('is_published', false)
    .whereNotNull('deleted_at')
    .delete();

  return { count: deletedDrafts.length };
}
