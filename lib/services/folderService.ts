/**
 * Folder Service
 *
 * Business logic for page folder operations
 */

import { getKnexClient } from '@/lib/knex-client';
import type { PageFolder } from '@/types';

export interface PublishFoldersResult {
  count: number;
}

async function collectAncestorFolderIds(
  pageIds: string[],
  db: Awaited<ReturnType<typeof getKnexClient>>
): Promise<Set<string>> {
  const folderIdsToPublish = new Set<string>();

  const pagesToPublish = await db('pages')
    .select('page_folder_id')
    .whereIn('id', pageIds)
    .where('is_published', false)
    .whereNull('deleted_at');

  if (!pagesToPublish) {
    return folderIdsToPublish;
  }

  const allDraftFolders: PageFolder[] = await db('page_folders')
    .select('*')
    .where('is_published', false)
    .whereNull('deleted_at');

  if (!allDraftFolders) {
    return folderIdsToPublish;
  }

  const foldersById = new Map<string, PageFolder>(
    allDraftFolders.map((f) => [f.id, f])
  );

  const collectAncestors = (folderId: string | null): void => {
    if (!folderId) return;
    const folder = foldersById.get(folderId);
    if (folder) {
      folderIdsToPublish.add(folder.id);
      collectAncestors(folder.page_folder_id);
    }
  };

  for (const page of pagesToPublish) {
    if (page.page_folder_id) {
      collectAncestors(page.page_folder_id);
    }
  }

  return folderIdsToPublish;
}

/**
 * Publish folders by their IDs
 */
export async function publishFolders(
  folderIds: string[] = [],
  pageIds?: string[]
): Promise<PublishFoldersResult> {
  const db = await getKnexClient();

  const isPublishingAll = folderIds.length === 0;
  const folderIdsToPublish = new Set<string>(folderIds);

  if (!isPublishingAll && pageIds && pageIds.length > 0) {
    const ancestorIds = await collectAncestorFolderIds(pageIds, db);
    ancestorIds.forEach(id => folderIdsToPublish.add(id));
  }

  if (!isPublishingAll && folderIdsToPublish.size === 0) {
    return { count: 0 };
  }

  const allDraftFolders: PageFolder[] = await db('page_folders')
    .select('*')
    .where('is_published', false);

  const foldersToProcess = isPublishingAll
    ? allDraftFolders
    : allDraftFolders.filter((f) => folderIdsToPublish.has(f.id));

  const activeFolders = foldersToProcess.filter((f) => f.deleted_at === null);
  const softDeletedFolders = foldersToProcess.filter((f) => f.deleted_at !== null);

  const folderIdsToCheck = foldersToProcess.map((f) => f.id);

  const parentFolderIds = new Set<string>();
  foldersToProcess.forEach((f) => {
    if (f.page_folder_id) {
      parentFolderIds.add(f.page_folder_id);
    }
  });

  const allIdsToCheck = [...new Set([...folderIdsToCheck, ...parentFolderIds])];

  const existingPublished: PageFolder[] = await db('page_folders')
    .select('*')
    .where('is_published', true)
    .whereIn('id', allIdsToCheck);

  const publishedFoldersById = new Map<string, PageFolder>(
    (existingPublished || []).map((f) => [f.id, f])
  );
  const publishedIds = new Set(publishedFoldersById.keys());

  if (folderIdsToCheck.length > 0) {
    const idsToSoftDelete = softDeletedFolders
      .filter((f) => publishedIds.has(f.id))
      .map((f) => f.id);

    if (idsToSoftDelete.length > 0) {
      await db('page_folders')
        .update({ deleted_at: new Date().toISOString() })
        .where('is_published', true)
        .whereIn('id', idsToSoftDelete)
        .whereNull('deleted_at');
    }
  }

  const sortedFolders = [...activeFolders].sort(
    (a, b) => (a.depth || 0) - (b.depth || 0)
  );

  const foldersBeingPublished = new Set<string>();

  const foldersToUpsert: Array<{
    id: string;
    name: string;
    slug: string;
    page_folder_id: string | null;
    order: number | null;
    depth: number;
    settings: PageFolder['settings'];
    is_published: boolean;
  }> = [];

  for (const folder of sortedFolders) {
    let publishedParentId: string | null = null;

    if (folder.page_folder_id) {
      const parentIsPublished = publishedFoldersById.has(folder.page_folder_id);
      const parentIsInBatch = foldersBeingPublished.has(folder.page_folder_id);

      if (!parentIsPublished && !parentIsInBatch) {
        continue;
      }

      publishedParentId = folder.page_folder_id;
    }

    foldersBeingPublished.add(folder.id);

    const existing = publishedFoldersById.get(folder.id);
    if (
      existing &&
      existing.name === folder.name &&
      existing.slug === folder.slug &&
      existing.page_folder_id === publishedParentId &&
      existing.order === folder.order &&
      existing.depth === folder.depth &&
      JSON.stringify(existing.settings) === JSON.stringify(folder.settings)
    ) {
      continue;
    }

    foldersToUpsert.push({
      id: folder.id,
      name: folder.name,
      slug: folder.slug,
      page_folder_id: publishedParentId,
      order: folder.order,
      depth: folder.depth,
      settings: folder.settings,
      is_published: true,
    });
  }

  if (foldersToUpsert.length === 0) {
    return { count: 0 };
  }

  await db('page_folders')
    .insert(foldersToUpsert)
    .onConflict(['id', 'is_published'])
    .merge();

  return { count: foldersToUpsert.length };
}
