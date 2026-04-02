/**
 * Storage Utilities
 *
 * Shared helpers for managing files in local storage.
 */

import { getKnexClient } from '@/lib/knex-client';
import { deleteFiles } from '@/lib/local-storage';

/**
 * Delete files from local storage in batches.
 * Best-effort: logs errors but does not throw.
 */
export async function deleteStorageFiles(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  return deleteFiles(paths);
}

/**
 * Delete storage files only if their storage_path is no longer referenced
 * by any row in the given table (neither draft nor published).
 * Safe to call after deleting DB rows — verifies before removing files.
 */
export async function cleanupOrphanedStorageFiles(
  tableName: string,
  storagePaths: string[]
): Promise<number> {
  if (storagePaths.length === 0) return 0;

  const db = await getKnexClient();

  const existingRows = await db(tableName)
    .select('storage_path')
    .whereIn('storage_path', storagePaths);

  const stillReferenced = new Set(
    existingRows.map((r: Record<string, unknown>) => r.storage_path as string)
  );

  const orphanedPaths = storagePaths.filter(p => !stillReferenced.has(p));

  return deleteStorageFiles(orphanedPaths);
}
