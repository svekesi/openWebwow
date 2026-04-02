import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import type { Collection, CreateCollectionData, UpdateCollectionData } from '@/types';
import { randomUUID } from 'crypto';

/**
 * Collection Repository
 *
 * Handles CRUD operations for collections (content types).
 * Uses Knex/PostgreSQL query builder.
 *
 * NOTE: Uses composite primary key (id, is_published) architecture.
 * All queries must specify is_published filter.
 */

export interface QueryFilters {
  is_published?: boolean;
  deleted?: boolean;
}

/**
 * Get all collections
 * @param filters - Optional filters (is_published, deleted)
 * @param filters.is_published - Get draft (false) or published (true) collections. Defaults to false (draft).
 */
export async function getAllCollections(filters?: QueryFilters): Promise<Collection[]> {
  const db = await getKnexClient();

  const isPublished = filters?.is_published ?? false;

  let query = db('collections')
    .select('*')
    .where('is_published', isPublished)
    .orderBy('order', 'asc')
    .orderBy('created_at', 'desc');

  // Apply deleted filter
  if (filters?.deleted === false) {
    query = query.whereNull('deleted_at');
  } else if (filters?.deleted === true) {
    query = query.whereNotNull('deleted_at');
  } else {
    // Default: exclude deleted
    query = query.whereNull('deleted_at');
  }

  const data = await query;

  const collectionIds = data.map((c: any) => c.id);

  // Fetch item rows for counting (replaces Supabase embedded resource)
  const itemRows = collectionIds.length > 0
    ? await db('collection_items')
      .select('id', 'deleted_at', 'is_published', 'collection_id')
      .whereIn('collection_id', collectionIds)
    : [];

  const itemsByCollectionId: Record<string, any[]> = {};
  itemRows.forEach((item: any) => {
    if (!itemsByCollectionId[item.collection_id]) {
      itemsByCollectionId[item.collection_id] = [];
    }
    itemsByCollectionId[item.collection_id].push(item);
  });

  // When fetching draft collections, batch-check which ones have a published version
  const publishedIds = !isPublished && collectionIds.length > 0
    ? await getPublishedCollectionIds(collectionIds)
    : new Set<string>();

  // Process the data to add draft_items_count and has_published_version
  const collections = data.map((collection: any) => {
    const items = itemsByCollectionId[collection.id] || [];
    const draft_items_count = items.filter((item: any) =>
      item.deleted_at === null && item.is_published === isPublished
    ).length;

    return {
      ...collection,
      draft_items_count,
      ...(!isPublished && { has_published_version: publishedIds.has(collection.id) }),
    };
  });

  return collections;
}

/**
 * Batch-check which collection IDs have a published version.
 * Returns a Set of IDs that have is_published=true rows.
 */
export async function getPublishedCollectionIds(collectionIds: string[]): Promise<Set<string>> {
  if (collectionIds.length === 0) return new Set();

  const db = await getKnexClient();

  const data = await db('collections')
    .select('id')
    .whereIn('id', collectionIds)
    .where('is_published', true)
    .whereNull('deleted_at');

  return new Set(data.map((c: any) => c.id));
}

/**
 * Get collection by ID
 * @param id - Collection UUID
 * @param isPublished - Get draft (false) or published (true) version. Defaults to false (draft).
 * @param includeDeleted - Whether to include soft-deleted collections. Defaults to false.
 */
export async function getCollectionById(
  id: string,
  isPublished: boolean = false,
  includeDeleted: boolean = false
): Promise<Collection | null> {
  const db = await getKnexClient();

  let query = db('collections')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished);

  // Filter out deleted unless explicitly requested
  if (!includeDeleted) {
    query = query.whereNull('deleted_at');
  }

  const data = await query.first();

  return data || null;
}

/**
 * Get collection by name
 * @param name - Collection name
 * @param isPublished - Get draft (false) or published (true) version. Defaults to false (draft).
 */
export async function getCollectionByName(name: string, isPublished: boolean = false): Promise<Collection | null> {
  const db = await getKnexClient();

  const data = await db('collections')
    .select('*')
    .where('name', name)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Create a new collection (draft by default)
 */
export async function createCollection(collectionData: CreateCollectionData): Promise<Collection> {
  const db = await getKnexClient();

  const id = randomUUID();
  const isPublished = collectionData.is_published ?? false;

  const { sorting, ...restData } = collectionData as any;
  const insertData: Record<string, unknown> = {
    id,
    ...restData,
    order: collectionData.order ?? 0,
    is_published: isPublished,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (sorting !== undefined) {
    insertData.sorting = jsonb(sorting);
  }

  const [data] = await db('collections')
    .insert(insertData)
    .returning('*');

  return data;
}

/**
 * Update a collection
 * @param id - Collection UUID
 * @param collectionData - Data to update
 * @param isPublished - Which version to update: draft (false) or published (true). Defaults to false (draft).
 */
export async function updateCollection(
  id: string,
  collectionData: UpdateCollectionData,
  isPublished: boolean = false
): Promise<Collection> {
  const db = await getKnexClient();

  const { sorting: sortingVal, ...restUpdateData } = collectionData as any;
  const updateData: Record<string, unknown> = {
    ...restUpdateData,
    updated_at: new Date().toISOString(),
  };
  if (sortingVal !== undefined) {
    updateData.sorting = jsonb(sortingVal);
  }

  const [data] = await db('collections')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .update(updateData)
    .returning('*');

  return data;
}

/**
 * Delete a collection (soft delete)
 * Also cascades soft delete to all related fields, items, and item values
 * @param id - Collection UUID
 * @param isPublished - Which version to delete: draft (false) or published (true). Defaults to false (draft).
 */
export async function deleteCollection(id: string, isPublished: boolean = false): Promise<void> {
  const db = await getKnexClient();

  const now = new Date().toISOString();

  // Soft delete the collection
  await db('collections')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .update({
      deleted_at: now,
      updated_at: now,
    });

  // Soft delete all related fields
  try {
    await db('collection_fields')
      .where('collection_id', id)
      .where('is_published', isPublished)
      .whereNull('deleted_at')
      .update({
        deleted_at: now,
        updated_at: now,
      });
  } catch (fieldsError) {
    console.error('Error soft-deleting collection fields:', fieldsError);
  }

  // Soft delete all related items
  try {
    await db('collection_items')
      .where('collection_id', id)
      .where('is_published', isPublished)
      .whereNull('deleted_at')
      .update({
        deleted_at: now,
        updated_at: now,
      });
  } catch (itemsError) {
    console.error('Error soft-deleting collection items:', itemsError);
  }

  // Soft delete all item values (these are linked to items via FK)
  const items = await db('collection_items')
    .select('id')
    .where('collection_id', id)
    .where('is_published', isPublished);

  if (items && items.length > 0) {
    const itemIds = items.map((item: any) => item.id);

    try {
      await db('collection_item_values')
        .whereIn('item_id', itemIds)
        .where('is_published', isPublished)
        .whereNull('deleted_at')
        .update({
          deleted_at: now,
          updated_at: now,
        });
    } catch (valuesError) {
      console.error('Error soft-deleting collection item values:', valuesError);
    }
  }
}

/**
 * Hard delete a collection and all its related data
 * This permanently removes the collection, fields, items, and item values
 * CASCADE constraints will handle the related data deletion
 * @param id - Collection UUID
 * @param isPublished - Which version to delete: draft (false) or published (true). Defaults to false (draft).
 */
export async function hardDeleteCollection(id: string, isPublished: boolean = false): Promise<void> {
  const db = await getKnexClient();

  // Hard delete the collection (CASCADE will delete all related data)
  await db('collections')
    .where('id', id)
    .where('is_published', isPublished)
    .delete();
}

/**
 * Publish a collection
 * Creates or updates the published version by copying the draft
 * Uses upsert with composite primary key for simplicity
 * @param id - Collection UUID
 */
export async function publishCollection(id: string): Promise<Collection> {
  const db = await getKnexClient();

  // Get the draft version
  const draft = await getCollectionById(id, false);
  if (!draft) {
    throw new Error('Draft collection not found');
  }

  // Upsert published version (composite key handles insert/update automatically)
  const [data] = await db('collections')
    .insert({
      id: draft.id,
      name: draft.name,
      sorting: jsonb(draft.sorting),
      order: draft.order,
      is_published: true,
      created_at: draft.created_at,
      updated_at: new Date().toISOString(),
    })
    .onConflict(['id', 'is_published'])
    .merge()
    .returning('*');

  return data;
}

/** Check if draft collection metadata differs from published */
function hasCollectionChanged(draft: Collection, published: Collection): boolean {
  return (
    draft.name !== published.name ||
    draft.order !== published.order
  );
}

/**
 * Get all unpublished collections.
 * A collection needs publishing if no published version exists or draft data differs.
 * Uses batch query instead of N+1.
 */
export async function getUnpublishedCollections(): Promise<Collection[]> {
  const db = await getKnexClient();

  // Get all draft collections
  const draftCollections = await getAllCollections({ is_published: false });

  if (draftCollections.length === 0) {
    return [];
  }

  // Batch fetch all published collections for comparison
  const draftIds = draftCollections.map(c => c.id);
  const publishedCollections = await db('collections')
    .select('*')
    .whereIn('id', draftIds)
    .where('is_published', true);

  const publishedById = new Map<string, Collection>();
  publishedCollections.forEach((c: any) => publishedById.set(c.id, c));

  return draftCollections.filter(draft => {
    const published = publishedById.get(draft.id);
    if (!published) {
      return true; // Never published
    }
    return hasCollectionChanged(draft, published);
  });
}

/**
 * Reorder collections
 * Updates the order field for multiple collections
 * @param isPublished - Whether to update draft (false) or published (true) collections
 * @param collectionIds - Array of collection IDs in the desired order
 */
export async function reorderCollections(isPublished: boolean, collectionIds: string[]): Promise<void> {
  const db = await getKnexClient();

  // Update order for each collection
  const updates = collectionIds.map((id, index) =>
    db('collections')
      .where('id', id)
      .where('is_published', isPublished)
      .whereNull('deleted_at')
      .update({
        order: index,
        updated_at: new Date().toISOString(),
      })
  );

  await Promise.all(updates);
}
