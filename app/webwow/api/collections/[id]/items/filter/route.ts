import { NextRequest } from 'next/server';
import { getKnexClient } from '@/lib/knex-client';
import { getItemsByCollectionId } from '@/lib/repositories/collectionItemRepository';
import { getValuesByItemIds } from '@/lib/repositories/collectionItemValueRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { renderCollectionItemsToHtml, loadTranslationsForLocale } from '@/lib/page-fetcher';
import { noCache } from '@/lib/api-response';
import type { Layer, CollectionItem, CollectionItemWithValues } from '@/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import type { Knex } from 'knex';

interface FilterCondition {
  fieldId: string;
  operator: string;
  value: string;
  value2?: string;
  fieldType?: string;
}

function escapeLikeValue(val: string): string {
  return val.replace(/[%_\\]/g, '\\$&');
}

async function getAllItemIdsForCollection(
  db: Knex,
  collectionId: string,
  isPublished: boolean,
): Promise<string[]> {
  let query = db('collection_items')
    .select('id')
    .where('collection_id', collectionId)
    .where('is_published', isPublished)
    .whereNull('deleted_at');

  if (isPublished) {
    query = query.where('is_publishable', true);
  }

  const data = await query;
  return data?.map(d => d.id) || [];
}

async function getIdsMatchingFilter(
  db: Knex,
  filter: FilterCondition,
  isPublished: boolean,
  allItemIds: string[],
): Promise<Set<string>> {
  const { fieldId, operator, value } = filter;
  const allSet = new Set(allItemIds);

  const baseQuery = () => db('collection_item_values')
    .where('field_id', fieldId)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .whereIn('item_id', allItemIds);

  switch (operator) {
    case 'contains': {
      const data = await baseQuery().select('item_id').whereRaw('LOWER(value) LIKE LOWER(?)', [`%${escapeLikeValue(value)}%`]);
      return new Set(data.map(d => d.item_id));
    }
    case 'is': {
      const data = await baseQuery().select('item_id').whereRaw('LOWER(value) = LOWER(?)', [value]);
      return new Set(data.map(d => d.item_id));
    }
    case 'starts_with': {
      const data = await baseQuery().select('item_id').whereRaw('LOWER(value) LIKE LOWER(?)', [`${escapeLikeValue(value)}%`]);
      return new Set(data.map(d => d.item_id));
    }
    case 'ends_with': {
      const data = await baseQuery().select('item_id').whereRaw('LOWER(value) LIKE LOWER(?)', [`%${escapeLikeValue(value)}`]);
      return new Set(data.map(d => d.item_id));
    }
    case 'does_not_contain': {
      const data = await baseQuery().select('item_id').whereRaw('LOWER(value) LIKE LOWER(?)', [`%${escapeLikeValue(value)}%`]);
      const matchIds = new Set(data.map(d => d.item_id));
      return new Set([...allSet].filter(id => !matchIds.has(id)));
    }
    case 'is_not': {
      const data = await baseQuery().select('item_id').whereRaw('LOWER(value) = LOWER(?)', [value]);
      const matchIds = new Set(data.map(d => d.item_id));
      return new Set([...allSet].filter(id => !matchIds.has(id)));
    }
    case 'is_empty':
    case 'is_not_present': {
      const data = await baseQuery().select('item_id').whereNot('value', '');
      const nonEmptyIds = new Set(data.map(d => d.item_id));
      return new Set([...allSet].filter(id => !nonEmptyIds.has(id)));
    }
    case 'is_not_empty':
    case 'is_present':
    case 'exists': {
      const data = await baseQuery().select('item_id').whereNot('value', '');
      return new Set(data.map(d => d.item_id));
    }
    case 'does_not_exist': {
      const data = await baseQuery().select('item_id').whereNot('value', '');
      const existIds = new Set(data.map(d => d.item_id));
      return new Set([...allSet].filter(id => !existIds.has(id)));
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const filterNum = parseFloat(value);
      if (isNaN(filterNum)) return new Set();
      const data = await baseQuery().select('item_id', 'value').whereNot('value', '');
      const result = new Set<string>();
      for (const row of data) {
        const num = parseFloat(String(row.value ?? ''));
        if (isNaN(num)) continue;
        if (operator === 'gt' && num > filterNum) result.add(row.item_id);
        else if (operator === 'gte' && num >= filterNum) result.add(row.item_id);
        else if (operator === 'lt' && num < filterNum) result.add(row.item_id);
        else if (operator === 'lte' && num <= filterNum) result.add(row.item_id);
      }
      return result;
    }
    case 'is_before': {
      const filterDate = new Date(value).getTime();
      if (isNaN(filterDate)) return new Set();
      const data = await baseQuery().select('item_id', 'value').whereNot('value', '');
      const result = new Set<string>();
      for (const row of data) {
        const d = new Date(String(row.value)).getTime();
        if (!isNaN(d) && d < filterDate) result.add(row.item_id);
      }
      return result;
    }
    case 'is_after': {
      const filterDate = new Date(value).getTime();
      if (isNaN(filterDate)) return new Set();
      const data = await baseQuery().select('item_id', 'value').whereNot('value', '');
      const result = new Set<string>();
      for (const row of data) {
        const d = new Date(String(row.value)).getTime();
        if (!isNaN(d) && d > filterDate) result.add(row.item_id);
      }
      return result;
    }
    case 'is_between': {
      const startRaw = value?.trim();
      const endRaw = (filter.value2 || '').trim();
      if (!startRaw && !endRaw) return new Set();
      const startDate = startRaw ? new Date(startRaw).getTime() : null;
      const endDate = endRaw ? new Date(endRaw).getTime() : null;
      if ((startDate !== null && isNaN(startDate)) || (endDate !== null && isNaN(endDate))) return new Set();
      const data = await baseQuery().select('item_id', 'value').whereNot('value', '');
      const result = new Set<string>();
      for (const row of data) {
        const d = new Date(String(row.value)).getTime();
        if (isNaN(d)) continue;
        if (startDate !== null && endDate !== null) { if (d >= startDate && d <= endDate) result.add(row.item_id); }
        else if (startDate !== null) { if (d >= startDate) result.add(row.item_id); }
        else if (endDate !== null) { if (d <= endDate) result.add(row.item_id); }
      }
      return result;
    }
    case 'is_one_of': {
      try {
        const allowedIds = JSON.parse(value || '[]');
        if (!Array.isArray(allowedIds)) return new Set();
        const data = await baseQuery().select('item_id', 'value');
        const result = new Set<string>();
        for (const row of data) {
          const val = String(row.value ?? '');
          if (allowedIds.includes(val)) { result.add(row.item_id); continue; }
          try { const arr = JSON.parse(val); if (Array.isArray(arr) && arr.some((id: string) => allowedIds.includes(id))) result.add(row.item_id); } catch { /* not JSON */ }
        }
        return result;
      } catch { return new Set(); }
    }
    case 'is_not_one_of': {
      try {
        const excludedIds = JSON.parse(value || '[]');
        if (!Array.isArray(excludedIds)) return allSet;
        const data = await baseQuery().select('item_id', 'value');
        const excludeSet = new Set<string>();
        for (const row of data) {
          const val = String(row.value ?? '');
          if (excludedIds.includes(val)) { excludeSet.add(row.item_id); continue; }
          try { const arr = JSON.parse(val); if (Array.isArray(arr) && arr.some((id: string) => excludedIds.includes(id))) excludeSet.add(row.item_id); } catch { /* not JSON */ }
        }
        return new Set([...allSet].filter(id => !excludeSet.has(id)));
      } catch { return allSet; }
    }
    case 'has_items': {
      const data = await baseQuery().select('item_id', 'value').whereNot('value', '');
      const result = new Set<string>();
      for (const row of data) {
        try { const arr = JSON.parse(String(row.value)); if (Array.isArray(arr) && arr.length > 0) result.add(row.item_id); } catch { if (row.value) result.add(row.item_id); }
      }
      return result;
    }
    case 'has_no_items': {
      const data = await baseQuery().select('item_id', 'value');
      const hasItemsSet = new Set<string>();
      for (const row of data) {
        try { const arr = JSON.parse(String(row.value)); if (Array.isArray(arr) && arr.length > 0) hasItemsSet.add(row.item_id); } catch { if (row.value) hasItemsSet.add(row.item_id); }
      }
      return new Set([...allSet].filter(id => !hasItemsSet.has(id)));
    }
    case 'contains_all_of': {
      try {
        const requiredIds = JSON.parse(value || '[]');
        if (!Array.isArray(requiredIds)) return new Set();
        const data = await baseQuery().select('item_id', 'value');
        const result = new Set<string>();
        for (const row of data) {
          try { const arr = JSON.parse(String(row.value)); if (Array.isArray(arr) && requiredIds.every((id: string) => arr.includes(id))) result.add(row.item_id); } catch { /* skip */ }
        }
        return result;
      } catch { return new Set(); }
    }
    case 'contains_exactly': {
      try {
        const requiredIds = JSON.parse(value || '[]');
        if (!Array.isArray(requiredIds)) return new Set();
        const data = await baseQuery().select('item_id', 'value');
        const result = new Set<string>();
        for (const row of data) {
          try { const arr = JSON.parse(String(row.value)); if (Array.isArray(arr) && arr.length === requiredIds.length && requiredIds.every((id: string) => arr.includes(id))) result.add(row.item_id); } catch { /* skip */ }
        }
        return result;
      } catch { return new Set(); }
    }
    default: {
      const data = await baseQuery().select('item_id').whereRaw('LOWER(value) LIKE LOWER(?)', [`%${escapeLikeValue(value)}%`]);
      return new Set(data.map(d => d.item_id));
    }
  }
}

async function getFilteredItemIds(
  collectionId: string,
  isPublished: boolean,
  filterGroups: FilterCondition[][],
): Promise<{ matchingIds: string[]; total: number }> {
  const db = await getKnexClient();

  const allItemIds = await getAllItemIdsForCollection(db, collectionId, isPublished);

  if (filterGroups.length === 0) {
    return { matchingIds: allItemIds, total: allItemIds.length };
  }

  // Each group's conditions are ANDed. Groups are ORed (union).
  const groupResults: Set<string>[] = [];

  for (const group of filterGroups) {
    let currentIds = new Set(allItemIds);

    for (const filter of group) {
      if (currentIds.size === 0) break;
      const matchingForFilter = await getIdsMatchingFilter(db, filter, isPublished, [...currentIds]);
      currentIds = new Set([...currentIds].filter(id => matchingForFilter.has(id)));
    }

    groupResults.push(currentIds);
  }

  // Union all group results (OR)
  const unionIds = new Set<string>();
  for (const groupIds of groupResults) {
    for (const id of groupIds) {
      unionIds.add(id);
    }
  }

  return { matchingIds: [...unionIds], total: unionIds.size };
}

function reorderItemsById(items: CollectionItem[], idOrder: string[]): CollectionItem[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const ordered: CollectionItem[] = [];
  for (const id of idOrder) {
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  return ordered;
}

async function getFieldValuesForItems(
  fieldId: string,
  isPublished: boolean,
  itemIds: string[],
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  const db = await getKnexClient();

  const rows = await db('collection_item_values')
    .select('item_id', 'value')
    .where('field_id', fieldId)
    .where('is_published', isPublished)
    .whereNull('deleted_at')
    .whereIn('item_id', itemIds);

  const valueMap = new Map<string, string>();
  for (const row of rows) {
    valueMap.set(row.item_id, row.value ?? '');
  }
  return valueMap;
}

/**
 * POST /webwow/api/collections/[id]/items/filter
 *
 * Body (JSON):
 * - layerTemplate: Layer[]
 * - collectionLayerId: string
 * - filterGroups: Array<Array<{ fieldId, operator, value, value2? }>>
 *     Groups are ORed; conditions within a group are ANDed.
 * - sortBy?: string
 * - sortOrder?: 'asc' | 'desc'
 * - limit?: number
 * - offset?: number
 * - localeCode?: string
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: collectionId } = await params;
    const body = await request.json();
    const {
      layerTemplate,
      collectionLayerId,
      filterGroups = [],
      sortBy,
      sortOrder = 'asc',
      limit,
      offset = 0,
      localeCode,
    } = body;

    if (!layerTemplate || !Array.isArray(layerTemplate)) {
      return noCache({ error: 'layerTemplate is required and must be an array' }, 400);
    }
    if (!collectionLayerId) {
      return noCache({ error: 'collectionLayerId is required' }, 400);
    }

    const { matchingIds, total: filteredTotal } = await getFilteredItemIds(
      collectionId,
      true,
      filterGroups,
    );

    if (matchingIds.length === 0) {
      return noCache({
        data: { html: '', total: 0, count: 0, offset, hasMore: false },
      });
    }

    const pageOffset = Math.max(0, offset || 0);
    const pageLimit = limit && limit > 0 ? limit : filteredTotal;
    let pageRawItems: CollectionItem[] = [];
    let pageItemIds: string[] = [];

    if (!sortBy || sortBy === 'none' || sortBy === 'manual') {
      // Let DB do ordering and pagination for cheap paths.
      const { items } = await getItemsByCollectionId(collectionId, true, {
        itemIds: matchingIds,
        limit: pageLimit,
        offset: pageOffset,
      });
      pageRawItems = items;
      pageItemIds = items.map(item => item.id);
    } else if (sortBy === 'random') {
      const randomizedIds = [...matchingIds].sort(() => Math.random() - 0.5);
      pageItemIds = randomizedIds.slice(pageOffset, pageOffset + pageLimit);
      if (pageItemIds.length > 0) {
        const { items } = await getItemsByCollectionId(collectionId, true, {
          itemIds: pageItemIds,
        });
        pageRawItems = reorderItemsById(items, pageItemIds);
      }
    } else {
      // For field-based sort, sort IDs using just the sort field values first,
      // then hydrate only the requested page window.
      const sortValueByItem = await getFieldValuesForItems(sortBy, true, matchingIds);
      const sortedIds = [...matchingIds].sort((a, b) => {
        const aVal = sortValueByItem.get(a) || '';
        const bVal = sortValueByItem.get(b) || '';
        const aNum = parseFloat(String(aVal));
        const bNum = parseFloat(String(bVal));
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortOrder === 'desc' ? bNum - aNum : aNum - bNum;
        }
        return sortOrder === 'desc'
          ? String(bVal).localeCompare(String(aVal))
          : String(aVal).localeCompare(String(bVal));
      });
      pageItemIds = sortedIds.slice(pageOffset, pageOffset + pageLimit);
      if (pageItemIds.length > 0) {
        const { items } = await getItemsByCollectionId(collectionId, true, {
          itemIds: pageItemIds,
        });
        pageRawItems = reorderItemsById(items, pageItemIds);
      }
    }

    const valuesByItem = await getValuesByItemIds(
      pageRawItems.map(i => i.id),
      true,
    );
    const paginatedItems: CollectionItemWithValues[] = pageRawItems.map(item => ({
      ...item,
      values: valuesByItem[item.id] || {},
    }));
    const hasMore = pageOffset + paginatedItems.length < filteredTotal;

    const collectionFields = await getFieldsByCollectionId(collectionId, true, { excludeComputed: true });
    const slugField = collectionFields.find(f => f.key === 'slug');
    const collectionItemSlugs: Record<string, string> = {};
    if (slugField) {
      for (const item of paginatedItems) {
        if (item.values[slugField.id]) {
          collectionItemSlugs[item.id] = item.values[slugField.id];
        }
      }
    }

    const [pages, folders] = await Promise.all([
      getAllPages(),
      getAllPageFolders(),
    ]);

    let locale = null;
    let translations: Record<string, any> | undefined;
    if (localeCode) {
      const localeData = await loadTranslationsForLocale(localeCode, true);
      locale = localeData.locale;
      translations = localeData.translations;
    }

    const html = await renderCollectionItemsToHtml(
      paginatedItems,
      layerTemplate as Layer[],
      collectionId,
      collectionLayerId,
      true,
      pages,
      folders,
      collectionItemSlugs,
      locale,
      translations,
    );

    return noCache({
      data: {
        html,
        total: filteredTotal,
        count: paginatedItems.length,
        offset: pageOffset,
        hasMore,
      },
    });
  } catch (error) {
    console.error('Error filtering collection items:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to filter items' },
      500,
    );
  }
}
