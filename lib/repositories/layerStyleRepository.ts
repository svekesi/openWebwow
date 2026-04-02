/**
 * Layer Style Repository
 *
 * Data access layer for layer styles (reusable design configurations)
 * Supports draft/published workflow with content hash-based change detection
 */

import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import type { LayerStyle, Layer } from '@/types';
import { generateLayerStyleContentHash } from '../hash-utils';

/**
 * Input data for creating a new layer style
 */
export interface CreateLayerStyleData {
  name: string;
  classes: string;
  design?: LayerStyle['design'];
  group?: string;
}

/**
 * Affected entity when deleting a layer style
 */
export interface LayerStyleAffectedEntity {
  type: 'page' | 'component';
  id: string;
  name: string;
  pageId?: string; // For pages, this is the page.id (not page_layers.id)
  previousLayers: Layer[];
  newLayers: Layer[];
}

/**
 * Result of soft delete operation
 */
export interface LayerStyleSoftDeleteResult {
  layerStyle: LayerStyle;
  affectedEntities: LayerStyleAffectedEntity[];
}

/**
 * Get all layer styles (draft by default, excludes soft deleted)
 */
export async function getAllStyles(isPublished: boolean = false): Promise<LayerStyle[]> {
  const db = await getKnexClient();

  const data = await db('layer_styles')
    .select('*')
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc');

  return data || [];
}

/**
 * Get a single layer style by ID (draft by default, excludes soft deleted)
 * With composite primary key, we need to specify is_published to get a single row
 */
export async function getStyleById(id: string, isPublished: boolean = false): Promise<LayerStyle | null> {
  const db = await getKnexClient();

  const data = await db('layer_styles')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .first();

  return data || null;
}

/**
 * Get a layer style by ID including soft deleted (for restoration)
 */
export async function getStyleByIdIncludingDeleted(id: string, isPublished: boolean = false): Promise<LayerStyle | null> {
  const db = await getKnexClient();

  const data = await db('layer_styles')
    .select('*')
    .where('id', id)
    .where('is_published', isPublished)
    .first();

  return data || null;
}

/**
 * Create a new layer style (draft by default)
 */
export async function createStyle(
  styleData: CreateLayerStyleData
): Promise<LayerStyle> {
  const db = await getKnexClient();

  // Calculate content hash
  const contentHash = generateLayerStyleContentHash({
    name: styleData.name,
    classes: styleData.classes,
    design: styleData.design,
  });

  const [data] = await db('layer_styles')
    .insert({
      name: styleData.name,
      classes: styleData.classes,
      design: jsonb(styleData.design),
      group: styleData.group,
      content_hash: contentHash,
      is_published: false,
    })
    .returning('*');

  return data;
}

/**
 * Update a layer style and recalculate content hash
 */
export async function updateStyle(
  id: string,
  updates: Partial<Pick<LayerStyle, 'name' | 'classes' | 'design'>>
): Promise<LayerStyle> {
  const db = await getKnexClient();

  // Get current style to merge with updates
  const current = await getStyleById(id);
  if (!current) {
    throw new Error('Layer style not found');
  }

  // Merge current data with updates for hash calculation
  const finalData = {
    name: updates.name !== undefined ? updates.name : current.name,
    classes: updates.classes !== undefined ? updates.classes : current.classes,
    design: updates.design !== undefined ? updates.design : current.design,
  };

  // Recalculate content hash
  const contentHash = generateLayerStyleContentHash(finalData);

  const [data] = await db('layer_styles')
    .where('id', id)
    .where('is_published', false)
    .update({
      ...updates,
      ...(updates.design !== undefined ? { design: jsonb(updates.design) } : {}),
      content_hash: contentHash,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  return data;
}

/**
 * Get published layer style by ID
 * Used to find the published version of a draft layer style
 */
export async function getPublishedStyleById(id: string): Promise<LayerStyle | null> {
  const db = await getKnexClient();

  const data = await db('layer_styles')
    .select('*')
    .where('id', id)
    .where('is_published', true)
    .first();

  return data || null;
}

/**
 * Publish a layer style (dual-record pattern like pages and components)
 * Creates/updates a separate published version while keeping draft untouched
 * Uses composite primary key (id, is_published) - same ID for draft and published versions
 */
export async function publishLayerStyle(draftStyleId: string): Promise<LayerStyle> {
  const db = await getKnexClient();

  // Get the draft style
  const draftStyle = await getStyleById(draftStyleId);
  if (!draftStyle) {
    throw new Error('Draft layer style not found');
  }

  // Upsert published version - composite key handles insert/update automatically
  const [data] = await db('layer_styles')
    .insert({
      id: draftStyle.id,
      name: draftStyle.name,
      classes: draftStyle.classes,
      design: jsonb(draftStyle.design),
      group: draftStyle.group,
      content_hash: draftStyle.content_hash,
      is_published: true,
      updated_at: new Date().toISOString(),
    })
    .onConflict(['id', 'is_published'])
    .merge()
    .returning('*');

  return data;
}

/**
 * Publish multiple layer styles in batch
 * Uses batch upsert for efficiency
 */
export async function publishLayerStyles(styleIds: string[]): Promise<{ count: number }> {
  if (styleIds.length === 0) {
    return { count: 0 };
  }

  const db = await getKnexClient();

  // Batch fetch all draft styles
  const draftStyles = await db('layer_styles')
    .select('*')
    .whereIn('id', styleIds)
    .where('is_published', false);

  if (!draftStyles || draftStyles.length === 0) {
    return { count: 0 };
  }

  // Prepare styles for batch upsert
  const stylesToUpsert = draftStyles.map(draft => ({
    id: draft.id,
    name: draft.name,
    classes: draft.classes,
    design: jsonb(draft.design),
    group: draft.group,
    content_hash: draft.content_hash,
    is_published: true,
    updated_at: new Date().toISOString(),
  }));

  // Batch upsert all styles
  await db('layer_styles')
    .insert(stylesToUpsert)
    .onConflict(['id', 'is_published'])
    .merge();

  return { count: stylesToUpsert.length };
}

/**
 * Get all unpublished layer styles
 * A layer style needs publishing if:
 * - It has is_published: false (never published), OR
 * - Its draft content_hash differs from published content_hash (needs republishing)
 */
export async function getUnpublishedLayerStyles(): Promise<LayerStyle[]> {
  const db = await getKnexClient();

  // Get all draft layer styles
  const draftStyles = await db('layer_styles')
    .select('*')
    .where('is_published', false)
    .orderBy('created_at', 'desc');

  if (!draftStyles || draftStyles.length === 0) {
    return [];
  }

  const unpublishedStyles: LayerStyle[] = [];

  // Batch fetch all published styles for the draft IDs
  const draftIds = draftStyles.map(s => s.id);
  const publishedStyles = await db('layer_styles')
    .select('*')
    .whereIn('id', draftIds)
    .where('is_published', true);

  // Build lookup map
  const publishedById = new Map<string, LayerStyle>();
  (publishedStyles || []).forEach(s => publishedById.set(s.id, s));

  // Check each draft style
  for (const draftStyle of draftStyles) {
    // Check if published version exists
    const publishedStyle = publishedById.get(draftStyle.id);

    // If no published version exists, needs first-time publishing
    if (!publishedStyle) {
      unpublishedStyles.push(draftStyle);
      continue;
    }

    // Compare content hashes
    if (draftStyle.content_hash !== publishedStyle.content_hash) {
      unpublishedStyles.push(draftStyle);
    }
  }

  return unpublishedStyles;
}

/**
 * Hard-delete soft-deleted draft layer styles and their published counterparts.
 */
export async function hardDeleteSoftDeletedLayerStyles(): Promise<{ count: number }> {
  const db = await getKnexClient();

  const deletedDrafts = await db('layer_styles')
    .select('id')
    .where('is_published', false)
    .whereNotNull('deleted_at');

  if (!deletedDrafts || deletedDrafts.length === 0) {
    return { count: 0 };
  }

  const ids = deletedDrafts.map(s => s.id);

  try {
    await db('layer_styles')
      .whereIn('id', ids)
      .where('is_published', true)
      .delete();
  } catch (pubError) {
    console.error('Failed to delete published layer styles:', pubError);
  }

  await db('layer_styles')
    .whereIn('id', ids)
    .where('is_published', false)
    .whereNotNull('deleted_at')
    .delete();

  return { count: deletedDrafts.length };
}

/**
 * Get count of unpublished layer styles
 */
export async function getUnpublishedLayerStylesCount(): Promise<number> {
  const styles = await getUnpublishedLayerStyles();
  return styles.length;
}

/**
 * Check if layers contain a reference to a specific layer style
 */
function layersContainStyle(layers: Layer[], styleId: string): boolean {
  for (const layer of layers) {
    if (layer.styleId === styleId) {
      return true;
    }
    if (layer.children && layersContainStyle(layer.children, styleId)) {
      return true;
    }
  }
  return false;
}

/**
 * Helper function to recursively remove styleId from layers
 */
function detachStyleFromLayersRecursive(layers: Layer[], styleId: string): Layer[] {
  return layers.map(layer => {
    // Create a clean copy of the layer
    const cleanLayer = { ...layer };

    // If this layer uses the style, remove styleId and styleOverrides
    if (cleanLayer.styleId === styleId) {
      delete cleanLayer.styleId;
      delete cleanLayer.styleOverrides;
    }

    // Recursively process children
    if (cleanLayer.children && cleanLayer.children.length > 0) {
      cleanLayer.children = detachStyleFromLayersRecursive(cleanLayer.children, styleId);
    }

    return cleanLayer;
  });
}

/**
 * Find all entities (pages and components) using a layer style
 * Returns detailed info including previous and new layers for undo/redo
 */
export async function findEntitiesUsingLayerStyle(styleId: string): Promise<LayerStyleAffectedEntity[]> {
  const db = await getKnexClient();

  const affectedEntities: LayerStyleAffectedEntity[] = [];

  // Find affected page_layers
  const pageLayersRecords = await db('page_layers')
    .select('id', 'page_id', 'layers')
    .where('is_published', false)
    .whereNull('deleted_at');

  // Get page info for affected pages
  const affectedPageLayerIds = (pageLayersRecords || [])
    .filter(record => layersContainStyle(record.layers || [], styleId))
    .map(record => record.page_id);

  if (affectedPageLayerIds.length > 0) {
    const pages = await db('pages')
      .select('id', 'name')
      .whereIn('id', affectedPageLayerIds)
      .where('is_published', false)
      .whereNull('deleted_at');

    const pageMap = new Map((pages || []).map(p => [p.id, p.name]));

    for (const record of pageLayersRecords || []) {
      if (layersContainStyle(record.layers || [], styleId)) {
        const newLayers = detachStyleFromLayersRecursive(record.layers || [], styleId);
        affectedEntities.push({
          type: 'page',
          id: record.id,
          name: pageMap.get(record.page_id) || 'Unknown Page',
          pageId: record.page_id,
          previousLayers: record.layers || [],
          newLayers,
        });
      }
    }
  }

  // Find affected components
  const componentRecords = await db('components')
    .select('id', 'name', 'layers')
    .where('is_published', false)
    .whereNull('deleted_at');

  for (const record of componentRecords || []) {
    if (layersContainStyle(record.layers || [], styleId)) {
      const newLayers = detachStyleFromLayersRecursive(record.layers || [], styleId);
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
 * Soft delete a layer style and detach it from all layers
 * Returns the deleted style and affected entities for undo/redo
 */
export async function softDeleteStyle(id: string): Promise<LayerStyleSoftDeleteResult> {
  const db = await getKnexClient();

  // Get the layer style before deleting
  const layerStyle = await db('layer_styles')
    .select('*')
    .where('id', id)
    .where('is_published', false)
    .whereNull('deleted_at')
    .first();

  if (!layerStyle) {
    throw new Error('Layer style not found');
  }

  // Find all affected entities
  const affectedEntities = await findEntitiesUsingLayerStyle(id);

  // Detach style from all affected page_layers
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

  // Soft delete the style (both draft and published versions)
  const deletedAt = new Date().toISOString();
  await db('layer_styles')
    .where('id', id)
    .update({ deleted_at: deletedAt });

  return {
    layerStyle: { ...layerStyle, deleted_at: deletedAt },
    affectedEntities,
  };
}

/**
 * Restore a soft-deleted layer style
 */
export async function restoreLayerStyle(id: string): Promise<LayerStyle> {
  const db = await getKnexClient();

  const [data] = await db('layer_styles')
    .where('id', id)
    .where('is_published', false)
    .update({ deleted_at: null })
    .returning('*');

  return data;
}

/**
 * Hard delete a layer style (permanent, use with caution)
 * @deprecated Use softDeleteStyle instead for undo/redo support
 */
export async function deleteStyle(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('layer_styles')
    .where('id', id)
    .delete();
}
