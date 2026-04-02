import { getKnexClient } from '@/lib/knex-client';
import type { CollectionImport, CollectionImportStatus } from '@/types';

/**
 * Collection Import Repository
 *
 * Handles CRUD operations for CSV import jobs.
 * Supports background processing with status tracking.
 */

export interface CreateImportData {
  collection_id: string;
  column_mapping: Record<string, string>;
  csv_data: Record<string, string>[];
  total_rows: number;
}

/**
 * Create a new import job
 */
export async function createImport(data: CreateImportData): Promise<CollectionImport> {
  const db = await getKnexClient();

  const [result] = await db('collection_imports')
    .insert({
      collection_id: data.collection_id,
      column_mapping: JSON.stringify(data.column_mapping),
      csv_data: JSON.stringify(data.csv_data),
      total_rows: data.total_rows,
      status: 'pending',
      processed_rows: 0,
      failed_rows: 0,
      errors: JSON.stringify([]),
    })
    .returning('*');

  return result;
}

/**
 * Get import by ID
 */
export async function getImportById(id: string): Promise<CollectionImport | null> {
  const db = await getKnexClient();

  const data = await db('collection_imports')
    .select('*')
    .where('id', id)
    .first();

  return data || null;
}

/**
 * Get pending or processing imports (for background processing)
 */
export async function getPendingImports(limit: number = 5): Promise<CollectionImport[]> {
  const db = await getKnexClient();

  const data = await db('collection_imports')
    .select('*')
    .whereIn('status', ['pending', 'processing'])
    .orderBy('created_at', 'asc')
    .limit(limit);

  return data;
}

/**
 * Update import status
 */
export async function updateImportStatus(
  id: string,
  status: CollectionImportStatus
): Promise<void> {
  const db = await getKnexClient();

  await db('collection_imports')
    .where('id', id)
    .update({
      status,
      updated_at: new Date().toISOString(),
    });
}

/**
 * Update import progress
 */
export async function updateImportProgress(
  id: string,
  processedRows: number,
  failedRows: number,
  errors: string[] | null = null
): Promise<void> {
  const db = await getKnexClient();

  const updateData: Record<string, unknown> = {
    processed_rows: processedRows,
    failed_rows: failedRows,
    updated_at: new Date().toISOString(),
  };

  if (errors !== null) {
    updateData.errors = JSON.stringify(errors);
  }

  await db('collection_imports')
    .where('id', id)
    .update(updateData);
}

/**
 * Mark import as completed
 */
export async function completeImport(
  id: string,
  processedRows: number,
  failedRows: number,
  errors: string[]
): Promise<void> {
  const db = await getKnexClient();

  const status: CollectionImportStatus = failedRows > 0 && processedRows === 0 ? 'failed' : 'completed';

  await db('collection_imports')
    .where('id', id)
    .update({
      status,
      processed_rows: processedRows,
      failed_rows: failedRows,
      errors: errors.length > 0 ? JSON.stringify(errors) : null,
      updated_at: new Date().toISOString(),
    });
}

/**
 * Delete import job
 */
export async function deleteImport(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('collection_imports')
    .where('id', id)
    .delete();
}

/**
 * Get imports for a collection
 */
export async function getImportsByCollectionId(collectionId: string): Promise<CollectionImport[]> {
  const db = await getKnexClient();

  const data = await db('collection_imports')
    .select('*')
    .where('collection_id', collectionId)
    .orderBy('created_at', 'desc');

  return data;
}
