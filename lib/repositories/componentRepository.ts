/**
 * Component Repository
 *
 * Data access layer for components (reusable layer trees)
 * Components are stored globally and can be instanced across pages
 * Supports draft/published workflow with content hash-based change detection
 */

import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import type { Component, Layer } from '@/types';
import { generateComponentContentHash } from '../hash-utils';
import { deleteTranslationsInBulk, markTranslationsIncomplete } from '@/lib/repositories/translationRepository';
import { extractLayerContentMap } from '../localisation-utils';

/**
 * Input data for creating a new component
 */
export interface CreateComponentData {
  name: string;
  layers: Layer[];
  variables?: any[]; // Component variables for exposed properties
}

/**
 * Get all components (draft by default, excludes soft deleted)
 */
export async function getAllComponents(isPublished: boolean = false): Promise<Component[]> {
  const db = await getKnexClient();

  const data = await db('components')
    .select('*')
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc');

  return data || [];
}

/**
 * Get a single component by ID (draft by default, excludes soft deleted)
 * With composite primary key, we need to specify is_published to get a single row
 */
export async function getComponentById(id: string, isPublished: boolean = false): Promise<Component | null> {
  const db = await getKnexClient();

  const data = await db('components')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get multiple components by IDs (drafts by default, excludes soft deleted)
 * Returns a map of component ID to component for quick lookup
 */
export async function getComponentsByIds(
  ids: string[],
  isPublished: boolean = false
): Promise<Record<string, Component>> {
  const db = await getKnexClient();

  if (ids.length === 0) {
    return {};
  }

  const data = await db('components')
    .select('*')
    .whereIn('id', ids)
    .where('is_published', isPublished)
    .whereNull('deleted_at');

  // Convert array to map for O(1) lookup
  const componentMap: Record<string, Component> = {};
  (data || []).forEach(component => {
    componentMap[component.id] = component;
  });

  return componentMap;
}

/**
 * Create a new component (draft by default)
 */
export async function createComponent(
  componentData: CreateComponentData
): Promise<Component> {
  const db = await getKnexClient();

  // Calculate content hash
  const contentHash = generateComponentContentHash({
    name: componentData.name,
    layers: componentData.layers,
    variables: componentData.variables,
  });

  const insertData: any = {
    name: componentData.name,
    layers: jsonb(componentData.layers),
    content_hash: contentHash,
    is_published: false,
  };

  // Include variables if provided
  if (componentData.variables?.length) {
    insertData.variables = jsonb(componentData.variables);
  }

  const [data] = await db('components')
    .insert(insertData)
    .returning('*');

  return data;
}

/**
 * Update a component and recalculate content hash
 */
export async function updateComponent(
  id: string,
  updates: Partial<Pick<Component, 'name' | 'layers' | 'variables'>>
): Promise<Component> {
  const db = await getKnexClient();

  // Get current component to merge with updates
  const current = await getComponentById(id);
  if (!current) {
    throw new Error('Component not found');
  }

  // Detect removed and changed layer content if layers are being updated
  if (updates.layers !== undefined) {
    const oldContentMap = extractLayerContentMap(current.layers || [], 'component', id);
    const newContentMap = extractLayerContentMap(updates.layers, 'component', id);

    // Find removed keys (exist in old but not in new)
    const removedKeys = Object.keys(oldContentMap).filter(key => !(key in newContentMap));

    // Find changed keys (exist in both but value differs)
    const changedKeys = Object.keys(newContentMap).filter(
      key => key in oldContentMap && oldContentMap[key] !== newContentMap[key]
    );

    // Delete translations for removed content
    if (removedKeys.length > 0) {
      await deleteTranslationsInBulk('component', id, removedKeys);
    }

    // Mark translations as incomplete for changed content
    if (changedKeys.length > 0) {
      await markTranslationsIncomplete('component', id, changedKeys);
    }
  }

  // Merge current data with updates for hash calculation
  const finalData = {
    name: updates.name !== undefined ? updates.name : current.name,
    layers: updates.layers !== undefined ? updates.layers : current.layers,
    variables: updates.variables !== undefined ? updates.variables : current.variables,
  };

  // Recalculate content hash
  const contentHash = generateComponentContentHash(finalData);

  const { layers, variables, ...restUpdates } = updates;

  const [data] = await db('components')
    .where('id', id)
    .where('is_published', false)
    .update({
      ...restUpdates,
      ...(layers !== undefined && { layers: jsonb(layers) }),
      ...(variables !== undefined && { variables: jsonb(variables) }),
      content_hash: contentHash,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  return data;
}

/**
 * Get published component by ID
 * Used to find the published version of a draft component
 */
export async function getPublishedComponentById(id: string): Promise<Component | null> {
  const db = await getKnexClient();

  const data = await db('components')
    .select('*')
    .where('id', id)
    .where('is_published', true)
    .first();

  return data || null;
}

/**
 * Publish a component (dual-record pattern like pages)
 * Creates/updates a separate published version while keeping draft untouched
 * Uses composite primary key (id, is_published) - same ID for draft and published versions
 */
export async function publishComponent(draftComponentId: string): Promise<Component> {
  const db = await getKnexClient();

  // Get the draft component
  const draftComponent = await getComponentById(draftComponentId);
  if (!draftComponent) {
    throw new Error('Draft component not found');
  }

  // Upsert published version - composite key handles insert/update automatically
  const [data] = await db('components')
    .insert({
      id: draftComponent.id,
      name: draftComponent.name,
      layers: jsonb(draftComponent.layers),
      variables: jsonb(draftComponent.variables ?? null),
      content_hash: draftComponent.content_hash,
      is_published: true,
      updated_at: new Date().toISOString(),
    })
    .onConflict(['id', 'is_published'])
    .merge()
    .returning('*');

  return data;
}

/**
 * Publish multiple components in batch
 * Uses batch upsert for efficiency
 */
export async function publishComponents(componentIds: string[]): Promise<{ count: number }> {
  if (componentIds.length === 0) {
    return { count: 0 };
  }

  const db = await getKnexClient();

  // Batch fetch all draft components (excluding soft deleted)
  const draftComponents = await db('components')
    .select('*')
    .whereIn('id', componentIds)
    .where('is_published', false)
    .whereNull('deleted_at');

  if (!draftComponents || draftComponents.length === 0) {
    return { count: 0 };
  }

  // Prepare components for batch upsert
  const componentsToUpsert = draftComponents.map(draft => ({
    id: draft.id,
    name: draft.name,
    layers: jsonb(draft.layers),
    variables: jsonb(draft.variables ?? null),
    content_hash: draft.content_hash,
    is_published: true,
    updated_at: new Date().toISOString(),
  }));

  // Batch upsert all components
  await db('components')
    .insert(componentsToUpsert)
    .onConflict(['id', 'is_published'])
    .merge();

  return { count: componentsToUpsert.length };
}

/**
 * Get all unpublished components (excludes soft deleted)
 * A component needs publishing if:
 * - It has is_published: false (never published), OR
 * - Its draft content_hash differs from published content_hash (needs republishing)
 */
export async function getUnpublishedComponents(): Promise<Component[]> {
  const db = await getKnexClient();

  // Get all draft components (excluding soft deleted)
  const draftComponents = await db('components')
    .select('*')
    .where('is_published', false)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc');

  if (!draftComponents || draftComponents.length === 0) {
    return [];
  }

  const unpublishedComponents: Component[] = [];

  // Batch fetch all published components for the draft IDs
  const draftIds = draftComponents.map(c => c.id);
  const publishedComponents = await db('components')
    .select('*')
    .whereIn('id', draftIds)
    .where('is_published', true);

  // Build lookup map
  const publishedById = new Map<string, Component>();
  (publishedComponents || []).forEach(c => publishedById.set(c.id, c));

  // Check each draft component
  for (const draftComponent of draftComponents) {
    // Check if published version exists
    const publishedComponent = publishedById.get(draftComponent.id);

    // If no published version exists, needs first-time publishing
    if (!publishedComponent) {
      unpublishedComponents.push(draftComponent);
      continue;
    }

    // Compare content hashes
    if (draftComponent.content_hash !== publishedComponent.content_hash) {
      unpublishedComponents.push(draftComponent);
    }
  }

  return unpublishedComponents;
}

/**
 * Hard-delete soft-deleted draft components and their published counterparts.
 */
export async function hardDeleteSoftDeletedComponents(): Promise<{ count: number }> {
  const db = await getKnexClient();

  const deletedDrafts = await db('components')
    .select('id')
    .where('is_published', false)
    .whereNotNull('deleted_at');

  if (!deletedDrafts || deletedDrafts.length === 0) {
    return { count: 0 };
  }

  const ids = deletedDrafts.map(c => c.id);

  try {
    await db('components')
      .whereIn('id', ids)
      .where('is_published', true)
      .delete();
  } catch (pubError) {
    console.error('Failed to delete published components:', pubError);
  }

  await db('components')
    .whereIn('id', ids)
    .where('is_published', false)
    .whereNotNull('deleted_at')
    .delete();

  return { count: deletedDrafts.length };
}

/**
 * Get count of unpublished components
 */
export async function getUnpublishedComponentsCount(): Promise<number> {
  const components = await getUnpublishedComponents();
  return components.length;
}

/**
 * Affected entity info returned when deleting a component
 */
export interface AffectedEntity {
  type: 'page' | 'component';
  id: string;
  name: string;
  pageId?: string; // For page_layers, this is the page_id
  previousLayers: Layer[];
  newLayers: Layer[];
}

/**
 * Result of soft deleting a component
 */
export interface SoftDeleteResult {
  component: Component;
  affectedEntities: AffectedEntity[];
}

/**
 * Find all pages and components that use a specific component
 */
export async function findEntitiesUsingComponent(componentId: string): Promise<AffectedEntity[]> {
  const db = await getKnexClient();

  const affectedEntities: AffectedEntity[] = [];

  // Find all page_layers records that contain this component
  const pageLayersRecords = await db('page_layers')
    .select('id', 'page_id', 'layers', 'is_published')
    .whereNull('deleted_at')
    .where('is_published', false);

  // Get page names for better UX
  const pageIds = (pageLayersRecords || []).map(r => r.page_id).filter(Boolean);
  let pageNames: Record<string, string> = {};
  if (pageIds.length > 0) {
    const pages = await db('pages')
      .select('id', 'name')
      .whereIn('id', pageIds);
    pageNames = (pages || []).reduce((acc, p) => ({ ...acc, [p.id]: p.name }), {});
  }

  // Check each page_layers record
  for (const record of pageLayersRecords || []) {
    if (layersContainComponent(record.layers || [], componentId)) {
      const newLayers = await detachComponentFromLayersRecursive(record.layers || [], componentId);
      affectedEntities.push({
        type: 'page',
        id: record.id,
        pageId: record.page_id,
        name: pageNames[record.page_id] || 'Unknown Page',
        previousLayers: record.layers || [],
        newLayers,
      });
    }
  }

  // Find all components (draft versions) that contain this component
  const componentRecords = await db('components')
    .select('id', 'name', 'layers')
    .whereNull('deleted_at')
    .where('is_published', false)
    .where('id', '!=', componentId);

  // Check each component
  for (const record of componentRecords || []) {
    if (layersContainComponent(record.layers || [], componentId)) {
      const newLayers = await detachComponentFromLayersRecursive(record.layers || [], componentId);
      affectedEntities.push({
        type: 'component',
        id: record.id,
        name: record.name,
        previousLayers: record.layers || [],
        newLayers,
      });
    }
  }

  return affectedEntities;
}

/**
 * Check if layers contain a reference to a specific component
 */
function layersContainComponent(layers: Layer[], componentId: string): boolean {
  for (const layer of layers) {
    if (layer.componentId === componentId) {
      return true;
    }
    if (layer.children && layersContainComponent(layer.children, componentId)) {
      return true;
    }
  }
  return false;
}

/**
 * Soft delete a component and detach it from all layers
 * Returns the deleted component and affected entities for undo/redo
 */
export async function softDeleteComponent(id: string): Promise<SoftDeleteResult> {
  const db = await getKnexClient();

  // Get the component before deleting
  const component = await db('components')
    .select('*')
    .where('id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .first();

  if (!component) {
    throw new Error('Component not found');
  }

  // Find all affected entities
  const affectedEntities = await findEntitiesUsingComponent(id);

  // Detach component from all affected page_layers
  for (const entity of affectedEntities) {
    if (entity.type === 'page') {
      try {
        await db('page_layers')
          .where('id', entity.id)
          .update({
            layers: jsonb(entity.newLayers),
            updated_at: new Date().toISOString(),
          });
      } catch (updateError) {
        console.error(`Failed to update page_layers ${entity.id}:`, updateError);
      }
    } else if (entity.type === 'component') {
      try {
        await db('components')
          .where('id', entity.id)
          .where('is_published', false)
          .update({
            layers: jsonb(entity.newLayers),
            updated_at: new Date().toISOString(),
          });
      } catch (updateError) {
        console.error(`Failed to update component ${entity.id}:`, updateError);
      }
    }
  }

  // Soft delete the component (both draft and published versions)
  const deletedAt = new Date().toISOString();
  await db('components')
    .where('id', id)
    .update({ deleted_at: deletedAt });

  return {
    component: { ...component, deleted_at: deletedAt },
    affectedEntities,
  };
}

/**
 * Restore a soft-deleted component
 */
export async function restoreComponent(id: string): Promise<Component> {
  const db = await getKnexClient();

  const [data] = await db('components')
    .where('id', id)
    .where('is_published', false)
    .update({ deleted_at: null })
    .returning('*');

  return data;
}

/**
 * Hard delete a component (permanent, use with caution)
 */
export async function deleteComponent(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('components')
    .where('id', id)
    .delete();
}

/**
 * Update a component's thumbnail URL (draft only)
 */
export async function updateComponentThumbnail(id: string, thumbnailUrl: string | null): Promise<void> {
  const db = await getKnexClient();

  await db('components')
    .where('id', id)
    .where('is_published', false)
    .update({ thumbnail_url: thumbnailUrl });
}

/**
 * Helper function to recursively remove componentId from layers
 */
/**
 * Detach component from layers - async wrapper that fetches component data
 * Uses the shared utility function from component-utils.ts
 */
async function detachComponentFromLayersRecursive(layers: Layer[], componentId: string): Promise<Layer[]> {
  const { detachComponentFromLayers } = await import('../component-utils');

  // Get the component data to extract its layers
  const component = await getComponentById(componentId);

  // Use the shared utility function
  return detachComponentFromLayers(layers, componentId, component || undefined);
}
