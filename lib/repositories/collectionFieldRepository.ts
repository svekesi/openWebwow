import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import { SUPABASE_QUERY_LIMIT } from '@/lib/db-constants';
import type { CollectionField, CreateCollectionFieldData, UpdateCollectionFieldData } from '@/types';
import { randomUUID } from 'crypto';

/**
 * Collection Field Repository
 *
 * Handles CRUD operations for collection fields (schema definitions).
 * Uses Knex/PostgreSQL query builder.
 *
 * NOTE: Uses composite primary key (id, is_published) architecture.
 * References parent collections using FK (collection_id).
 */

export interface FieldFilters {
  search?: string;
  excludeComputed?: boolean;
}

/**
 * Get all fields for all collections
 * @param is_published - Filter for draft (false) or published (true) fields. Defaults to false (draft).
 */
export async function getAllFields(
  is_published: boolean = false
): Promise<CollectionField[]> {
  const db = await getKnexClient();

  const allFields: CollectionField[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await db('collection_fields')
      .select('*')
      .where('is_published', is_published)
      .whereNull('deleted_at')
      .orderBy('collection_id', 'asc')
      .orderBy('order', 'asc')
      .offset(offset)
      .limit(SUPABASE_QUERY_LIMIT);

    if (data && data.length > 0) {
      allFields.push(...data);
      offset += data.length;
      hasMore = data.length === SUPABASE_QUERY_LIMIT;
    } else {
      hasMore = false;
    }
  }

  return allFields;
}

/**
 * Get all fields for a collection with optional search filtering
 * @param collection_id - Collection UUID
 * @param is_published - Filter for draft (false) or published (true) fields. Defaults to false (draft).
 * @param filters - Optional search filters
 */
export async function getFieldsByCollectionId(
  collection_id: string,
  is_published: boolean = false,
  filters?: FieldFilters
): Promise<CollectionField[]> {
  const db = await getKnexClient();

  let query = db('collection_fields')
    .select('*')
    .where('collection_id', collection_id)
    .where('is_published', is_published)
    .whereNull('deleted_at')
    .orderBy('order', 'asc');

  if (filters?.excludeComputed) {
    query = query.where('is_computed', false);
  }

  if (filters?.search && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    query = query.where('name', 'ilike', searchTerm);
  }

  const data = await query;

  return data || [];
}

/**
 * Get field by ID
 * @param id - Field UUID
 * @param isPublished - Get draft (false) or published (true) version. Defaults to false (draft).
 */
export async function getFieldById(id: string, isPublished: boolean = false): Promise<CollectionField | null> {
  const db = await getKnexClient();

  const data = await db('collection_fields')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Create a new field
 */
export async function createField(fieldData: CreateCollectionFieldData): Promise<CollectionField> {
  const db = await getKnexClient();

  const id = randomUUID();
  const isPublished = fieldData.is_published ?? false;

  const [data] = await db('collection_fields')
    .insert({
      id,
      ...fieldData,
      fillable: fieldData.fillable ?? true,
      key: fieldData.key ?? null,
      hidden: fieldData.hidden ?? false,
      is_computed: fieldData.is_computed ?? false,
      data: jsonb(fieldData.data ?? {}),
      is_published: isPublished,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  return data;
}

/**
 * Update a field
 * @param id - Field UUID
 * @param fieldData - Data to update
 * @param isPublished - Which version to update: draft (false) or published (true). Defaults to false (draft).
 */
export async function updateField(
  id: string,
  fieldData: UpdateCollectionFieldData,
  isPublished: boolean = false
): Promise<CollectionField> {
  const db = await getKnexClient();

  const { data: dataVal, ...restFieldData } = fieldData as any;
  const updateData: Record<string, unknown> = {
    ...restFieldData,
    updated_at: new Date().toISOString(),
  };
  if (dataVal !== undefined) {
    updateData.data = jsonb(dataVal);
  }

  const [data] = await db('collection_fields')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .update(updateData)
    .returning('*');

  return data;
}

/**
 * Delete a field (soft delete)
 * Also soft-deletes all collection_item_values that reference this field
 * Only deletes the draft version by default.
 * @param id - Field UUID
 * @param isPublished - Which version to delete: draft (false) or published (true). Defaults to false (draft).
 */
export async function deleteField(id: string, isPublished: boolean = false): Promise<void> {
  const db = await getKnexClient();

  const now = new Date().toISOString();

  // Soft delete the field
  await db('collection_fields')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .update({
      deleted_at: now,
      updated_at: now,
    });

  // Soft delete all collection_item_values for this field (same published state)
  await db('collection_item_values')
    .where('field_id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .update({
      deleted_at: now,
      updated_at: now,
    });
}

/**
 * Reorder fields
 * @param collection_id - Collection UUID
 * @param is_published - Filter for draft (false) or published (true) fields. Defaults to false (draft).
 * @param field_ids - Array of field UUIDs in desired order
 */
export async function reorderFields(
  collection_id: string,
  is_published: boolean = false,
  field_ids: string[]
): Promise<void> {
  const db = await getKnexClient();

  // Update order for each field
  const updates = field_ids.map((field_id, index) =>
    db('collection_fields')
      .where('id', field_id)
      .where('collection_id', collection_id)
      .where('is_published', is_published)
      .whereNull('deleted_at')
      .update({
        order: index,
        updated_at: new Date().toISOString(),
      })
  );

  await Promise.all(updates);
}

/**
 * Hard delete a field
 * Permanently removes field and all associated collection_item_values via CASCADE
 * Used during publish to permanently remove soft-deleted fields
 * @param id - Field UUID
 * @param isPublished - Which version to delete: draft (false) or published (true). Defaults to false (draft).
 */
export async function hardDeleteField(id: string, isPublished: boolean = false): Promise<void> {
  const db = await getKnexClient();

  // Hard delete the field (CASCADE will delete values)
  await db('collection_fields')
    .where('id', id)
    .where('is_published', isPublished)
    .delete();
}

/**
 * Publish a field
 * Creates or updates the published version by copying the draft
 * Uses upsert with composite primary key for simplicity
 * @param id - Field UUID
 */
export async function publishField(id: string): Promise<CollectionField> {
  const db = await getKnexClient();

  // Get the draft version
  const draft = await getFieldById(id, false);
  if (!draft) {
    throw new Error('Draft field not found');
  }

  // Upsert published version (composite key handles insert/update automatically)
  const [data] = await db('collection_fields')
    .insert({
      id: draft.id,
      name: draft.name,
      key: draft.key,
      type: draft.type,
      default: draft.default,
      fillable: draft.fillable,
      order: draft.order,
      collection_id: draft.collection_id,
      reference_collection_id: draft.reference_collection_id,
      hidden: draft.hidden,
      data: jsonb(draft.data),
      is_published: true,
      created_at: draft.created_at,
      updated_at: new Date().toISOString(),
    })
    .onConflict(['id', 'is_published'])
    .merge()
    .returning('*');

  return data;
}
