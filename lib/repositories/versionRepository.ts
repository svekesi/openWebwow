import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import type { Version, CreateVersionData, VersionEntityType, VersionHistoryItem } from '@/types';

/**
 * Version Repository
 *
 * Handles CRUD operations for version history (undo/redo functionality)
 * Uses JSON Patch format for optimized diff storage
 */

export const SNAPSHOT_INTERVAL = 10; // Store full snapshot every N versions
export const MAX_VERSIONS_PER_ENTITY = 50; // Maximum versions to keep per entity

/**
 * Create a new version entry
 * Automatically deletes oldest versions if limit is reached
 */
export async function createVersion(data: CreateVersionData): Promise<Version> {
  const db = await getKnexClient();

  // Enforce version limit (keep only MAX_VERSIONS_PER_ENTITY - 1 to make room for new version)
  await enforceVersionLimit(data.entity_type, data.entity_id, MAX_VERSIONS_PER_ENTITY - 1);

  const [result] = await db('versions')
    .insert({
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      action_type: data.action_type,
      description: data.description || null,
      redo: jsonb(data.redo),
      undo: jsonb(data.undo || null),
      snapshot: jsonb(data.snapshot || null),
      previous_hash: data.previous_hash || null,
      current_hash: data.current_hash,
      session_id: data.session_id || null,
      metadata: jsonb(data.metadata || null),
    })
    .returning('*');

  return result;
}

/**
 * Get version history for an entity
 */
export async function getVersionHistory(
  entityType: VersionEntityType,
  entityId: string,
  limit: number = 50,
  offset: number = 0
): Promise<Version[]> {
  const db = await getKnexClient();

  const data = await db('versions')
    .select('*')
    .where('entity_type', entityType)
    .where('entity_id', entityId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  return data || [];
}

/**
 * Get version history summary (without redo/undo patch data)
 */
export async function getVersionHistorySummary(
  entityType: VersionEntityType,
  entityId: string,
  limit: number = 50
): Promise<VersionHistoryItem[]> {
  const db = await getKnexClient();

  const data = await db('versions')
    .select('id', 'action_type', 'description', 'created_at')
    .where('entity_type', entityType)
    .where('entity_id', entityId)
    .orderBy('created_at', 'desc')
    .limit(limit);

  return data || [];
}

/**
 * Get a specific version by ID
 */
export async function getVersionById(id: string): Promise<Version | null> {
  const db = await getKnexClient();

  const data = await db('versions')
    .select('*')
    .where('id', id)
    .first();

  return data || null;
}

/**
 * Get the latest version for an entity
 */
export async function getLatestVersion(
  entityType: VersionEntityType,
  entityId: string
): Promise<Version | null> {
  const db = await getKnexClient();

  const data = await db('versions')
    .select('*')
    .where('entity_type', entityType)
    .where('entity_id', entityId)
    .orderBy('created_at', 'desc')
    .first();

  return data || null;
}

/**
 * Get the version count for an entity (for determining when to store snapshots)
 */
export async function getVersionCount(
  entityType: VersionEntityType,
  entityId: string
): Promise<number> {
  const db = await getKnexClient();

  const [{ count }] = await db('versions')
    .count('* as count')
    .where('entity_type', entityType)
    .where('entity_id', entityId);

  return Number(count) || 0;
}

/**
 * Check if we should store a full snapshot (every N versions)
 */
export async function shouldStoreSnapshot(
  entityType: VersionEntityType,
  entityId: string
): Promise<boolean> {
  const count = await getVersionCount(entityType, entityId);
  return count > 0 && count % SNAPSHOT_INTERVAL === 0;
}

/**
 * Get the most recent snapshot for an entity
 */
export async function getLatestSnapshot(
  entityType: VersionEntityType,
  entityId: string
): Promise<{ version: Version; snapshot: object } | null> {
  const db = await getKnexClient();

  const data = await db('versions')
    .select('*')
    .where('entity_type', entityType)
    .where('entity_id', entityId)
    .whereNotNull('snapshot')
    .orderBy('created_at', 'desc')
    .first();

  if (!data) {
    return null;
  }

  return data?.snapshot ? { version: data, snapshot: data.snapshot as object } : null;
}

/**
 * Enforce version limit for a specific entity or all entities
 * Deletes oldest versions beyond MAX_VERSIONS_PER_ENTITY
 */
export async function enforceVersionLimit(
  entityType?: VersionEntityType,
  entityId?: string,
  maxVersions: number = MAX_VERSIONS_PER_ENTITY
): Promise<number> {
  const db = await getKnexClient();

  let totalDeleted = 0;

  // If specific entity provided, cleanup only that entity
  if (entityType && entityId) {
    const allVersions = await db('versions')
      .select('id')
      .where('entity_type', entityType)
      .where('entity_id', entityId)
      .orderBy('created_at', 'desc');

    if (allVersions && allVersions.length > maxVersions) {
      const idsToDelete = allVersions.slice(maxVersions).map(v => v.id);
      const deleted = await db('versions')
        .whereIn('id', idsToDelete)
        .delete();

      totalDeleted = deleted;
    }

    return totalDeleted;
  }

  // Otherwise, cleanup all entities
  const entities = await db('versions')
    .select('entity_type', 'entity_id');

  if (!entities) {
    return 0;
  }

  // Group by entity
  const entityMap = new Map<string, { entity_type: string; entity_id: string }>();
  for (const entity of entities) {
    const key = `${entity.entity_type}:${entity.entity_id}`;
    entityMap.set(key, entity);
  }

  // Cleanup each entity
  for (const { entity_type, entity_id } of entityMap.values()) {
    const deleted = await enforceVersionLimit(entity_type as VersionEntityType, entity_id, maxVersions);
    totalDeleted += deleted;
  }

  return totalDeleted;
}

/**
 * Hard delete versions older than a certain date
 * Also enforces the MAX_VERSIONS_PER_ENTITY limit for all entities
 */
export async function cleanupOldVersions(
  olderThanDays: number = 30
): Promise<number> {
  const db = await getKnexClient();

  let totalDeleted = 0;

  // 1. Delete versions older than cutoff date
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const deletedCount = await db('versions')
    .where('created_at', '<', cutoffDate.toISOString())
    .delete();

  totalDeleted += deletedCount;

  // 2. Enforce MAX_VERSIONS_PER_ENTITY limit for all entities
  const limitDeleted = await enforceVersionLimit();
  totalDeleted += limitDeleted;

  return totalDeleted;
}

/**
 * Get versions by session ID (for grouped operations)
 */
export async function getVersionsBySession(sessionId: string): Promise<Version[]> {
  const db = await getKnexClient();

  const data = await db('versions')
    .select('*')
    .where('session_id', sessionId)
    .orderBy('created_at', 'asc');

  return data || [];
}

/**
 * Delete all versions for an entity (hard delete)
 * Used when an entity is permanently deleted
 */
export async function deleteVersionsForEntity(
  entityType: VersionEntityType,
  entityId: string
): Promise<void> {
  const db = await getKnexClient();

  await db('versions')
    .where('entity_type', entityType)
    .where('entity_id', entityId)
    .delete();
}
