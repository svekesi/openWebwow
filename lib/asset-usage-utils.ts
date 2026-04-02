/**
 * Asset Usage Utilities
 *
 * Functions to find and count asset usage across pages, components, and CMS items
 */

import { getKnexClient } from '@/lib/knex-client';
import type { Knex } from 'knex';
import type { Layer } from '@/types';
import { ASSET_FIELD_TYPES, findDisplayField } from './collection-field-utils';

export interface AssetUsageEntry {
  id: string;
  name: string;
}

export interface CmsItemUsageEntry extends AssetUsageEntry {
  collectionId: string;
  collectionName: string;
}

export interface FieldDefaultUsageEntry extends AssetUsageEntry {
  collectionId: string;
  collectionName: string;
}

export interface AssetUsageResult {
  pages: AssetUsageEntry[];
  components: AssetUsageEntry[];
  cmsItems: CmsItemUsageEntry[];
  fieldDefaults: FieldDefaultUsageEntry[];
  total: number;
}

/**
 * Check if a variable contains an asset reference with the given ID
 */
function isAssetVarWithId(
  v: any,
  assetId: string
): boolean {
  return v?.type === 'asset' && v?.data?.asset_id === assetId;
}

/**
 * Check if a link variable contains an asset reference with the given ID
 */
function linkHasAssetId(link: any, assetId: string): boolean {
  return link?.asset?.id === assetId;
}

/**
 * Scan rich text content for asset references
 */
function richTextContainsAsset(content: any, assetId: string): boolean {
  if (!content || typeof content !== 'object') return false;

  // Check marks for richTextLink with asset
  if (Array.isArray(content.marks)) {
    for (const mark of content.marks) {
      if (mark.type === 'richTextLink' && mark.attrs?.asset?.id === assetId) {
        return true;
      }
    }
  }

  // Recurse into content arrays
  if (Array.isArray(content.content)) {
    for (const child of content.content) {
      if (richTextContainsAsset(child, assetId)) return true;
    }
  }
  if (Array.isArray(content)) {
    for (const child of content) {
      if (richTextContainsAsset(child, assetId)) return true;
    }
  }

  return false;
}

/**
 * Check if a layer contains a reference to a specific asset
 */
function layerContainsAsset(layer: Layer, assetId: string): boolean {
  // Image source
  if (isAssetVarWithId(layer.variables?.image?.src, assetId)) return true;

  // Video source and poster
  if (isAssetVarWithId(layer.variables?.video?.src, assetId)) return true;
  if (isAssetVarWithId(layer.variables?.video?.poster, assetId)) return true;

  // Audio source
  if (isAssetVarWithId(layer.variables?.audio?.src, assetId)) return true;

  // Icon source
  if (isAssetVarWithId(layer.variables?.icon?.src, assetId)) return true;

  // Direct asset link
  if (linkHasAssetId(layer.variables?.link, assetId)) return true;

  // Rich text links with asset type
  const textVar = layer.variables?.text;
  if (textVar?.type === 'dynamic_rich_text' && (textVar as any).data?.content) {
    if (richTextContainsAsset((textVar as any).data.content, assetId)) return true;
  }

  // Component variable overrides (image type)
  const imageOverrides = layer.componentOverrides?.image;
  if (imageOverrides) {
    for (const value of Object.values(imageOverrides)) {
      if (typeof value === 'string' && value === assetId) return true;
    }
  }

  return false;
}

/**
 * Recursively check if layers contain a reference to a specific asset
 */
function layersContainAsset(layers: Layer[], assetId: string): boolean {
  for (const layer of layers) {
    if (layerContainsAsset(layer, assetId)) return true;
    if (layer.children && layersContainAsset(layer.children, assetId)) return true;
  }
  return false;
}

/**
 * Check if page settings contain an asset reference
 */
function pageSettingsContainAsset(settings: any, assetId: string): boolean {
  // Check SEO image
  if (settings?.seo?.image === assetId) return true;
  return false;
}

/**
 * Parse a field default value into an array of asset IDs.
 * Returns the parsed array (cached) for multi-asset, or null if not a JSON array.
 */
function parseDefaultAssetIds(defaultVal: string): string[] | null {
  if (!defaultVal.startsWith('[')) return null;
  try {
    return JSON.parse(defaultVal) as string[];
  } catch {
    return null;
  }
}

/** Check if a field default value (single ID or JSON array) references a given asset */
function fieldDefaultReferencesAsset(defaultVal: string, assetId: string, parsedIds?: string[] | null): boolean {
  if (defaultVal === assetId) return true;
  const ids = parsedIds !== undefined ? parsedIds : parseDefaultAssetIds(defaultVal);
  return ids != null && ids.includes(assetId);
}

/** Fetch collection names by IDs and return a lookup map */
async function fetchCollectionNames(
  db: Knex,
  collectionIds: string[]
): Promise<Record<string, string>> {
  if (collectionIds.length === 0) return {};

  const data = await db('collections')
    .select('id', 'name')
    .whereIn('id', collectionIds)
    .where('is_published', false)
    .whereNull('deleted_at');

  const map: Record<string, string> = {};
  (data || []).forEach((c: any) => {
    map[c.id] = c.name ?? 'Unknown Collection';
  });
  return map;
}

interface AssetFieldDefault {
  id: string;
  name?: string;
  collection_id: string;
  default: string | null;
}

/** Fetch asset-type collection fields that have a non-null default value */
async function fetchAssetFieldsWithDefaults(
  db: Knex,
  selectColumns: string[] = ['id', 'name', 'collection_id', 'default']
): Promise<AssetFieldDefault[]> {
  const data = await db('collection_fields')
    .select(selectColumns)
    .whereIn('type', ASSET_FIELD_TYPES)
    .where('is_published', false)
    .whereNull('deleted_at')
    .whereNotNull('default');

  return (data || []) as unknown as AssetFieldDefault[];
}

/**
 * Get asset usage with names across pages, components, and CMS items
 */
export async function getAssetUsage(assetId: string): Promise<AssetUsageResult> {
  const db = await getKnexClient();

  const pageEntries: AssetUsageEntry[] = [];
  const componentEntries: AssetUsageEntry[] = [];
  const cmsItemEntries: CmsItemUsageEntry[] = [];

  // Track unique page IDs that use this asset
  const pageIdsWithAsset = new Set<string>();

  const pageLayersRecords = await db('page_layers')
    .select('id', 'page_id', 'layers')
    .where('is_published', false)
    .whereNull('deleted_at');

  for (const record of pageLayersRecords || []) {
    if (record.layers && layersContainAsset(record.layers, assetId)) {
      pageIdsWithAsset.add(record.page_id);
    }
  }

  const pagesData = await db('pages')
    .select('id', 'name', 'settings')
    .where('is_published', false)
    .whereNull('deleted_at');

  for (const page of pagesData || []) {
    if (page.settings && pageSettingsContainAsset(page.settings, assetId)) {
      pageIdsWithAsset.add(page.id);
    }
  }

  // Build page entries with names
  const pageIds = Array.from(pageIdsWithAsset);
  const pagesWithAsset = (pagesData || []).filter((p) => pageIds.includes(p.id));
  for (const pageId of pageIds) {
    const page = pagesWithAsset.find((p) => p.id === pageId);
    pageEntries.push({ id: pageId, name: page?.name ?? 'Unknown Page' });
  }

  const components = await db('components')
    .select('id', 'name', 'layers')
    .where('is_published', false)
    .whereNull('deleted_at');

  for (const component of components || []) {
    if (component.layers && layersContainAsset(component.layers, assetId)) {
      componentEntries.push({ id: component.id, name: component.name ?? 'Unknown Component' });
    }
  }

  const imageFields = await db('collection_fields')
    .select('id', 'collection_id')
    .whereIn('type', ['image', 'file'])
    .where('is_published', false)
    .whereNull('deleted_at');

  if (imageFields && imageFields.length > 0) {
    const fieldIds = imageFields.map((f) => f.id);

    const itemValues = await db('collection_item_values')
      .select('item_id')
      .whereIn('field_id', fieldIds)
      .where('value', assetId)
      .where('is_published', false)
      .whereNull('deleted_at');

    const uniqueItemIds = [...new Set(itemValues?.map((v) => v.item_id) || [])];
    if (uniqueItemIds.length > 0) {
      const items = await db('collection_items')
        .select('id', 'collection_id')
        .whereIn('id', uniqueItemIds)
        .where('is_published', false)
        .whereNull('deleted_at');

      const cmsCollectionIds = [...new Set((items || []).map((i) => i.collection_id))];

      const allFields = await db('collection_fields')
        .select('id', 'key', 'type', 'fillable', 'collection_id')
        .whereIn('collection_id', cmsCollectionIds)
        .where('is_published', false)
        .whereNull('deleted_at');

      const displayFieldByCollection: Record<string, { id: string }> = {};
      for (const collectionId of cmsCollectionIds) {
        const fields = (allFields || []).filter((f) => f.collection_id === collectionId);
        const displayField = findDisplayField(fields as any);
        if (displayField) {
          displayFieldByCollection[collectionId] = { id: displayField.id };
        }
      }

      const displayFieldIds = Object.values(displayFieldByCollection).map((f) => f.id);
      const displayValues = await db('collection_item_values')
        .select('item_id', 'field_id', 'value')
        .whereIn('item_id', uniqueItemIds)
        .whereIn('field_id', displayFieldIds)
        .where('is_published', false)
        .whereNull('deleted_at');

      const valueByItem: Record<string, string> = {};
      displayValues?.forEach((row: any) => {
        valueByItem[`${row.item_id}:${row.field_id}`] = row.value ?? '';
      });

      for (const item of items || []) {
        const displayField = displayFieldByCollection[item.collection_id];
        const name =
          displayField && valueByItem[`${item.id}:${displayField.id}`]
            ? valueByItem[`${item.id}:${displayField.id}`]
            : 'Untitled';
        cmsItemEntries.push({ id: item.id, name, collectionId: item.collection_id, collectionName: '' });
      }
    }
  }

  // Check collection field defaults that reference this asset
  const fieldDefaultEntries: FieldDefaultUsageEntry[] = [];
  const assetFieldsWithDefaults = await fetchAssetFieldsWithDefaults(db);

  for (const field of assetFieldsWithDefaults) {
    const defaultVal = field.default as string;
    if (fieldDefaultReferencesAsset(defaultVal, assetId)) {
      fieldDefaultEntries.push({
        id: field.id,
        name: field.name ?? 'Unknown Field',
        collectionId: field.collection_id,
        collectionName: '',
      });
    }
  }

  // Resolve all collection names in a single query
  const allCollectionIds = [
    ...new Set([
      ...cmsItemEntries.map((e) => e.collectionId),
      ...fieldDefaultEntries.map((e) => e.collectionId),
    ]),
  ];
  const collectionNamesById = await fetchCollectionNames(db, allCollectionIds);

  for (const entry of cmsItemEntries) {
    entry.collectionName = collectionNamesById[entry.collectionId] ?? 'Unknown Collection';
  }
  for (const entry of fieldDefaultEntries) {
    entry.collectionName = collectionNamesById[entry.collectionId] ?? 'Unknown Collection';
  }

  return {
    pages: pageEntries,
    components: componentEntries,
    cmsItems: cmsItemEntries,
    fieldDefaults: fieldDefaultEntries,
    total: pageEntries.length + componentEntries.length + cmsItemEntries.length + fieldDefaultEntries.length,
  };
}

/**
 * Get bulk asset usage for multiple assets
 * More efficient than calling getAssetUsage multiple times
 */
export async function getBulkAssetUsage(
  assetIds: string[]
): Promise<Record<string, AssetUsageResult>> {
  if (assetIds.length === 0) {
    return {};
  }

  const db = await getKnexClient();

  const results: Record<string, AssetUsageResult> = {};
  for (const assetId of assetIds) {
    results[assetId] = { pages: [], components: [], cmsItems: [], fieldDefaults: [], total: 0 };
  }

  // Create a set for faster lookup
  const assetIdSet = new Set(assetIds);

  const pageLayersRecords = await db('page_layers')
    .select('id', 'page_id', 'layers')
    .where('is_published', false)
    .whereNull('deleted_at');

  // Track page IDs per asset
  const pageIdsByAsset: Record<string, Set<string>> = {};
  for (const assetId of assetIds) {
    pageIdsByAsset[assetId] = new Set();
  }

  for (const record of pageLayersRecords || []) {
    if (!record.layers) continue;

    for (const assetId of assetIds) {
      if (layersContainAsset(record.layers, assetId)) {
        pageIdsByAsset[assetId].add(record.page_id);
      }
    }
  }

  const pages = await db('pages')
    .select('id', 'settings')
    .where('is_published', false)
    .whereNull('deleted_at');

  for (const page of pages || []) {
    if (!page.settings) continue;

    for (const assetId of assetIds) {
      if (pageSettingsContainAsset(page.settings, assetId)) {
        pageIdsByAsset[assetId].add(page.id);
      }
    }
  }

  // Get page names
  const pageIds = [...new Set(assetIds.flatMap((id) => [...pageIdsByAsset[id]]))];
  let pageNamesById: Record<string, string> = {};
  if (pageIds.length > 0) {
    const pagesWithNames = await db('pages')
      .select('id', 'name')
      .whereIn('id', pageIds)
      .where('is_published', false);
    pageNamesById = (pagesWithNames || []).reduce((acc, p) => ({ ...acc, [p.id]: p.name ?? 'Unknown Page' }), {});
  }

  for (const assetId of assetIds) {
    results[assetId].pages = [...pageIdsByAsset[assetId]].map((id) => ({
      id,
      name: pageNamesById[id] ?? 'Unknown Page',
    }));
  }

  const components = await db('components')
    .select('id', 'name', 'layers')
    .where('is_published', false)
    .whereNull('deleted_at');

  for (const component of components || []) {
    if (!component.layers) continue;

    for (const assetId of assetIds) {
      if (layersContainAsset(component.layers, assetId)) {
        results[assetId].components.push({ id: component.id, name: component.name ?? 'Unknown Component' });
      }
    }
  }

  // Check CMS items
  let cmsCollectionIds: string[] = [];

  const imageFields: Array<{ id: string }> = await db('collection_fields')
    .select('id')
    .whereIn('type', ['image', 'file'])
    .where('is_published', false)
    .whereNull('deleted_at');

  if (imageFields && imageFields.length > 0) {
    const fieldIds = imageFields.map((f) => f.id);

    const itemValues = await db('collection_item_values')
      .select('item_id', 'value')
      .whereIn('field_id', fieldIds)
      .whereIn('value', assetIds)
      .where('is_published', false)
      .whereNull('deleted_at');

    const itemIdsByAsset: Record<string, Set<string>> = {};
    for (const assetId of assetIds) {
      itemIdsByAsset[assetId] = new Set();
    }

    for (const v of itemValues || []) {
      if (v.value && assetIdSet.has(v.value)) {
        itemIdsByAsset[v.value].add(v.item_id);
      }
    }

    const uniqueItemIds = [...new Set(Object.values(itemIdsByAsset).flatMap((s) => [...s]))];
    const itemCollectionById: Record<string, string> = {};

    if (uniqueItemIds.length > 0) {
      const items = await db('collection_items')
        .select('id', 'collection_id')
        .whereIn('id', uniqueItemIds)
        .where('is_published', false)
        .whereNull('deleted_at');

      (items || []).forEach((i: any) => {
        itemCollectionById[i.id] = i.collection_id;
      });
    }

    for (const assetId of assetIds) {
      results[assetId].cmsItems = [...itemIdsByAsset[assetId]].map((id) => {
        const collectionId = itemCollectionById[id] ?? '';
        return { id, name: 'Untitled', collectionId, collectionName: '' };
      });
    }

    cmsCollectionIds = [...new Set(Object.values(itemCollectionById))];
  }

  // Check collection field defaults
  const assetFieldsWithDefaults = await fetchAssetFieldsWithDefaults(db);

  for (const field of assetFieldsWithDefaults) {
    const defaultVal = field.default as string;
    // Parse once per field, reuse for all asset IDs
    const parsedIds = parseDefaultAssetIds(defaultVal);
    for (const assetId of assetIds) {
      if (fieldDefaultReferencesAsset(defaultVal, assetId, parsedIds)) {
        results[assetId].fieldDefaults.push({
          id: field.id,
          name: field.name ?? 'Unknown Field',
          collectionId: field.collection_id,
          collectionName: '',
        });
      }
    }
  }

  // Resolve all collection names in a single query
  const defaultCollectionIds = new Set<string>();
  for (const assetId of assetIds) {
    for (const entry of results[assetId].fieldDefaults) {
      defaultCollectionIds.add(entry.collectionId);
    }
  }
  const allCollectionIds = [...new Set([...cmsCollectionIds, ...defaultCollectionIds])];
  const collectionNamesById = await fetchCollectionNames(db, allCollectionIds);

  for (const assetId of assetIds) {
    for (const entry of results[assetId].cmsItems) {
      entry.collectionName = collectionNamesById[entry.collectionId] ?? 'Unknown Collection';
    }
    for (const entry of results[assetId].fieldDefaults) {
      entry.collectionName = collectionNamesById[entry.collectionId] ?? 'Unknown Collection';
    }
  }

  for (const assetId of assetIds) {
    const r = results[assetId];
    r.total = r.pages.length + r.components.length + r.cmsItems.length + r.fieldDefaults.length;
  }

  return results;
}

// =============================================================================
// Asset Cleanup Functions
// =============================================================================

/**
 * Remove asset references from rich text content
 */
function removeAssetFromRichText(content: any, assetId: string): any {
  if (!content || typeof content !== 'object') return content;

  // Clone the content to avoid mutation
  const cloned = JSON.parse(JSON.stringify(content));

  const processNode = (node: any): any => {
    if (!node || typeof node !== 'object') return node;

    // Remove richTextLink marks with matching asset
    if (Array.isArray(node.marks)) {
      node.marks = node.marks.filter((mark: any) => {
        if (mark.type === 'richTextLink' && mark.attrs?.asset?.id === assetId) {
          return false; // Remove this mark
        }
        return true;
      });
    }

    // Recurse into content arrays
    if (Array.isArray(node.content)) {
      node.content = node.content.map(processNode);
    }

    return node;
  };

  if (Array.isArray(cloned)) {
    return cloned.map(processNode);
  }

  return processNode(cloned);
}

/**
 * Remove asset references from a single layer
 * Returns a new layer object with asset references nullified
 */
function removeAssetFromLayer(layer: Layer, assetId: string): Layer {
  const newLayer = JSON.parse(JSON.stringify(layer)) as Layer;

  // Image source
  if (isAssetVarWithId(newLayer.variables?.image?.src, assetId)) {
    (newLayer.variables!.image!.src as any).data.asset_id = null;
  }

  // Video source
  if (isAssetVarWithId(newLayer.variables?.video?.src, assetId)) {
    (newLayer.variables!.video!.src as any).data.asset_id = null;
  }

  // Video poster
  if (isAssetVarWithId(newLayer.variables?.video?.poster, assetId)) {
    (newLayer.variables!.video!.poster as any).data.asset_id = null;
  }

  // Audio source
  if (isAssetVarWithId(newLayer.variables?.audio?.src, assetId)) {
    (newLayer.variables!.audio!.src as any).data.asset_id = null;
  }

  // Icon source
  if (isAssetVarWithId(newLayer.variables?.icon?.src, assetId)) {
    (newLayer.variables!.icon!.src as any).data.asset_id = null;
  }

  // Link asset
  if (linkHasAssetId(newLayer.variables?.link, assetId)) {
    newLayer.variables!.link!.asset = { id: null };
  }

  // Rich text content
  const textVar = newLayer.variables?.text;
  if (textVar?.type === 'dynamic_rich_text' && (textVar as any).data?.content) {
    (textVar as any).data.content = removeAssetFromRichText((textVar as any).data.content, assetId);
  }

  // Component variable overrides (image type)
  if (newLayer.componentOverrides?.image) {
    const imageOverrides = newLayer.componentOverrides.image as Record<string, string>;
    for (const [key, value] of Object.entries(imageOverrides)) {
      if (value === assetId) {
        delete imageOverrides[key];
      }
    }
  }

  return newLayer;
}

/**
 * Recursively remove asset references from layers
 * Returns new layers array with asset references nullified
 */
function removeAssetFromLayers(layers: Layer[], assetId: string): Layer[] {
  return layers.map((layer) => {
    const newLayer = removeAssetFromLayer(layer, assetId);

    if (newLayer.children && newLayer.children.length > 0) {
      newLayer.children = removeAssetFromLayers(newLayer.children, assetId);
    }

    return newLayer;
  });
}

export interface AffectedPageEntity {
  pageId: string;
  previousLayers: Layer[];
  newLayers: Layer[];
}

export interface AffectedComponentEntity {
  componentId: string;
  previousLayers: Layer[];
  newLayers: Layer[];
}

export interface AssetCleanupResult {
  pagesUpdated: number;
  componentsUpdated: number;
  cmsItemsUpdated: number;
  fieldDefaultsUpdated: number;
  affectedPages: AffectedPageEntity[];
  affectedComponents: AffectedComponentEntity[];
}

/**
 * Clean up all references to an asset before deletion
 * Updates pages, components, and CMS items to remove the asset reference
 * Returns affected entities with before/after states for version tracking
 */
export async function cleanupAssetReferences(assetId: string): Promise<AssetCleanupResult> {
  const db = await getKnexClient();

  let pagesUpdated = 0;
  let componentsUpdated = 0;
  let cmsItemsUpdated = 0;
  const affectedPages: AffectedPageEntity[] = [];
  const affectedComponents: AffectedComponentEntity[] = [];

  const pageLayersRecords = await db('page_layers')
    .select('id', 'page_id', 'layers')
    .where('is_published', false)
    .whereNull('deleted_at');

  const pageLayersToUpdate: Array<{ id: string; pageId: string; previousLayers: Layer[]; newLayers: Layer[] }> = [];

  for (const record of pageLayersRecords || []) {
    if (record.layers && layersContainAsset(record.layers, assetId)) {
      const cleanedLayers = removeAssetFromLayers(record.layers, assetId);
      pageLayersToUpdate.push({
        id: record.id,
        pageId: record.page_id,
        previousLayers: record.layers,
        newLayers: cleanedLayers,
      });
    }
  }

  // Batch update page layers
  if (pageLayersToUpdate.length > 0) {
    for (const { id, pageId, previousLayers, newLayers } of pageLayersToUpdate) {
      try {
        await db('page_layers')
          .where('id', id)
          .where('is_published', false)
          .update({ layers: JSON.stringify(newLayers), updated_at: new Date().toISOString() });
        pagesUpdated++;
        affectedPages.push({ pageId, previousLayers, newLayers });
      } catch (error) {
        console.error(`Failed to update page_layers ${id}:`, error);
      }
    }
  }

  const pagesData = await db('pages')
    .select('id', 'settings')
    .where('is_published', false)
    .whereNull('deleted_at');

  const pagesToUpdate: Array<{ id: string; settings: any }> = [];

  for (const page of pagesData || []) {
    if (pageSettingsContainAsset(page.settings, assetId)) {
      const newSettings = JSON.parse(JSON.stringify(page.settings));
      if (newSettings.seo?.image === assetId) {
        newSettings.seo.image = null;
      }
      pagesToUpdate.push({ id: page.id, settings: newSettings });
    }
  }

  // Batch update pages
  if (pagesToUpdate.length > 0) {
    for (const { id, settings } of pagesToUpdate) {
      try {
        await db('pages')
          .where('id', id)
          .where('is_published', false)
          .update({ settings: JSON.stringify(settings), updated_at: new Date().toISOString() });
      } catch (error) {
        console.error(`Failed to update page ${id}:`, error);
      }
      // Note: page settings changes don't need layer version tracking
    }
  }

  const components = await db('components')
    .select('id', 'layers')
    .where('is_published', false)
    .whereNull('deleted_at');

  const componentsToUpdate: Array<{ id: string; previousLayers: Layer[]; newLayers: Layer[] }> = [];

  for (const component of components || []) {
    if (component.layers && layersContainAsset(component.layers, assetId)) {
      const cleanedLayers = removeAssetFromLayers(component.layers, assetId);
      componentsToUpdate.push({
        id: component.id,
        previousLayers: component.layers,
        newLayers: cleanedLayers,
      });
    }
  }

  // Batch update components
  if (componentsToUpdate.length > 0) {
    for (const { id, previousLayers, newLayers } of componentsToUpdate) {
      try {
        await db('components')
          .where('id', id)
          .where('is_published', false)
          .update({ layers: JSON.stringify(newLayers), updated_at: new Date().toISOString() });
        componentsUpdated++;
        affectedComponents.push({ componentId: id, previousLayers, newLayers });
      } catch (error) {
        console.error(`Failed to update component ${id}:`, error);
      }
    }
  }

  const imageFieldsForCleanup = await db('collection_fields')
    .select('id')
    .whereIn('type', ['image', 'file'])
    .where('is_published', false)
    .whereNull('deleted_at');

  if (imageFieldsForCleanup && imageFieldsForCleanup.length > 0) {
    const fieldIds = imageFieldsForCleanup.map((f) => f.id);

    try {
      cmsItemsUpdated = await db('collection_item_values')
        .whereIn('field_id', fieldIds)
        .where('value', assetId)
        .where('is_published', false)
        .whereNull('deleted_at')
        .update({ value: null, updated_at: new Date().toISOString() });
    } catch (updateError) {
      console.error('Failed to update CMS values:', updateError);
    }
  }

  // 5. Update collection field defaults that reference this asset
  let fieldDefaultsUpdated = 0;
  const assetFieldsWithDefaults = await fetchAssetFieldsWithDefaults(db, ['id', 'default']);

  for (const field of assetFieldsWithDefaults) {
    const defaultVal = field.default as string;
    const parsedIds = parseDefaultAssetIds(defaultVal);

    if (!fieldDefaultReferencesAsset(defaultVal, assetId, parsedIds)) continue;

    // Compute new default: null for single-asset, filtered array for multi-asset
    let newDefault: string | null = null;
    if (parsedIds) {
      const filtered = parsedIds.filter((id) => id !== assetId);
      newDefault = filtered.length > 0 ? JSON.stringify(filtered) : null;
    }

    try {
      await db('collection_fields')
        .where('id', field.id)
        .where('is_published', false)
        .update({ default: newDefault, updated_at: new Date().toISOString() });
      fieldDefaultsUpdated++;
    } catch (updateError) {
      console.error(`Failed to update field default ${field.id}:`, updateError);
    }
  }

  return {
    pagesUpdated,
    componentsUpdated,
    cmsItemsUpdated,
    fieldDefaultsUpdated,
    affectedPages,
    affectedComponents,
  };
}
