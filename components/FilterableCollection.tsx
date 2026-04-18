'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useFilterStore } from '@/stores/useFilterStore';
import type { ConditionalVisibility, Layer } from '@/types';

interface FilterableCollectionProps {
  children: React.ReactNode;
  collectionId: string;
  collectionLayerId: string;
  filters: ConditionalVisibility;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  sortByInputLayerId?: string;
  sortOrderInputLayerId?: string;
  limit?: number;
  paginationMode?: 'pages' | 'load_more';
  layerTemplate: Layer[];
}

export default function FilterableCollection({
  children,
  collectionId,
  collectionLayerId,
  filters,
  sortBy,
  sortOrder,
  sortByInputLayerId,
  sortOrderInputLayerId,
  limit,
  paginationMode,
  layerTemplate,
}: FilterableCollectionProps) {
  const ssrRef = useRef<HTMLDivElement>(null);
  const filteredRef = useRef<HTMLDivElement>(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [hasActiveFilters, setHasActiveFilters] = useState(false);
  const prevFilterKeyRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRequestKeyRef = useRef<string | null>(null);

  const [filteredPage, setFilteredPage] = useState(1);
  const [filteredTotalPages, setFilteredTotalPages] = useState(1);
  const [filteredHasMore, setFilteredHasMore] = useState(false);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [filteredLoaded, setFilteredLoaded] = useState(0);
  const loadMoreOffsetRef = useRef(0);

  // Store original SSR pagination state so we can restore it when filters clear
  const ssrPaginationTextRef = useRef<string | null>(null);
  const ssrPrevClassRef = useRef<string | null>(null);
  const ssrNextClassRef = useRef<string | null>(null);
  const ssrCountTextRef = useRef<string | null>(null);
  const ssrLoadMoreBtnDisplayRef = useRef<string | null>(null);

  // Track whether we stripped a p_ param so we know the SSR content doesn't
  // match page 1 and a reload is needed when filters clear.
  const strippedPaginationParamRef = useRef(false);

  const strippedId = collectionLayerId.startsWith('lyr-')
    ? collectionLayerId.slice(4)
    : collectionLayerId;
  const pKey = `p_${strippedId}`;
  const fpKey = `fp_${strippedId}`;

  const filterValues = useFilterStore((state) => state.values);

  const findLinkedInputValue = useCallback((inputLayerId?: string): string => {
    if (!inputLayerId) return '';
    for (const layerValues of Object.values(filterValues)) {
      if (inputLayerId in layerValues) {
        return layerValues[inputLayerId] || '';
      }
    }
    return '';
  }, [filterValues]);

  const linkedSortByValue = findLinkedInputValue(sortByInputLayerId).trim();
  const linkedSortOrderValue = findLinkedInputValue(sortOrderInputLayerId).trim().toLowerCase();

  const isLinkedSortByValid = linkedSortByValue.length > 0 && linkedSortByValue !== 'none';
  const isLinkedSortOrderValid = linkedSortOrderValue === 'asc' || linkedSortOrderValue === 'desc';

  const effectiveSortBy = isLinkedSortByValid ? linkedSortByValue : sortBy;
  const effectiveSortOrder = (isLinkedSortOrderValid ? linkedSortOrderValue : sortOrder) as 'asc' | 'desc' | undefined;
  const hasRuntimeSortOverride = Boolean(
    (sortByInputLayerId && isLinkedSortByValid) ||
    (sortOrderInputLayerId && isLinkedSortOrderValid)
  );

  const buildApiFilters = useCallback(() => {
    // Conditions within the same original group are ORed (e.g. Free OR Paid).
    // Conditions from different original groups are ANDed (e.g. (Free OR Paid) AND Category).
    // The API uses: OR between groups, AND within a group.
    // So we use the distributive property to convert:
    //   (A OR B) AND C  →  (A AND C) OR (B AND C)

    type FilterItem = { fieldId: string; operator: string; value: string; value2?: string; fieldType?: string };
    const operatorsWithoutValue = new Set([
      'is_present',
      'is_empty',
      'is_not_empty',
      'has_items',
      'has_no_items',
      'exists',
      'does_not_exist',
    ]);

    const activeByGroup: FilterItem[][] = [];

    for (const group of filters.groups) {
      const activeInGroup: FilterItem[] = [];

      for (const condition of group.conditions) {
        if (!condition.fieldId) continue;

        // Use static values only when bound is not linked to an input.
        let value = condition.inputLayerId ? '' : (condition.value || '');
        let value2 = condition.inputLayerId2 ? '' : condition.value2;

        if (condition.inputLayerId) {
          let inputValue = '';
          for (const layerValues of Object.values(filterValues)) {
            if (condition.inputLayerId in layerValues) {
              inputValue = layerValues[condition.inputLayerId];
              break;
            }
          }
          if (!inputValue && condition.operator !== 'is_between') continue;
          if (condition.fieldType === 'boolean' && inputValue === 'false') continue;
          if (inputValue) value = inputValue;
        }

        if (condition.inputLayerId2) {
          let inputValue2 = '';
          for (const layerValues of Object.values(filterValues)) {
            if (condition.inputLayerId2 in layerValues) {
              inputValue2 = layerValues[condition.inputLayerId2];
              break;
            }
          }
          if (!inputValue2 && condition.operator !== 'is_between') continue;
          if (inputValue2) value2 = inputValue2;
        }

        const requiresValue = !operatorsWithoutValue.has(condition.operator);
        if (condition.operator === 'is_between') {
          // Allow one-sided date range: start-only or end-only
          if (!value && !value2) continue;
        } else if (requiresValue && !value) {
          continue;
        }

        if (
          (condition.fieldType === 'reference' || condition.fieldType === 'multi_reference') &&
          ['is_one_of', 'is_not_one_of', 'contains_all_of', 'contains_exactly'].includes(condition.operator) &&
          condition.inputLayerId
        ) {
          value = JSON.stringify([value]);
        }

        activeInGroup.push({
          fieldId: condition.fieldId,
          operator: condition.operator,
          value,
          value2,
          fieldType: condition.fieldType,
        });
      }

      if (activeInGroup.length > 0) {
        activeByGroup.push(activeInGroup);
      }
    }

    if (activeByGroup.length === 0) return [];

    // Cross-product to distribute OR-within-group across AND-between-groups
    const MAX_FILTER_GROUPS = 50;
    let result: FilterItem[][] = [[]];
    for (const groupConditions of activeByGroup) {
      const expanded: FilterItem[][] = [];
      for (const existing of result) {
        for (const cond of groupConditions) {
          expanded.push([...existing, cond]);
          if (expanded.length >= MAX_FILTER_GROUPS) break;
        }
        if (expanded.length >= MAX_FILTER_GROUPS) break;
      }
      result = expanded;
      if (result.length >= MAX_FILTER_GROUPS) break;
    }

    return result;
  }, [filters, filterValues]);

  const updateEmptyStateElements = useCallback((filteredCount: number) => {
    const emptyEls = document.querySelectorAll(
      `[data-collection-empty-state="${collectionLayerId}"]`
    );
    const hasItemsEls = document.querySelectorAll(
      `[data-collection-has-items="${collectionLayerId}"]`
    );
    const itemCountEls = document.querySelectorAll(
      `[data-collection-item-count="${collectionLayerId}"]`
    );

    const evaluateItemCount = (count: number, op: string, value: number): boolean => {
      if (op === 'lt') return count < value;
      if (op === 'lte') return count <= value;
      if (op === 'gt') return count > value;
      if (op === 'gte') return count >= value;
      return count === value;
    };

    if (filteredCount < 0) {
      emptyEls.forEach(el => { (el as HTMLElement).style.display = 'none'; });
      hasItemsEls.forEach(el => { (el as HTMLElement).style.display = 'none'; });
      itemCountEls.forEach(el => { (el as HTMLElement).style.display = 'none'; });
    } else {
      emptyEls.forEach(el => {
        (el as HTMLElement).style.display = filteredCount === 0 ? '' : 'none';
      });
      hasItemsEls.forEach(el => {
        (el as HTMLElement).style.display = filteredCount > 0 ? '' : 'none';
      });
      itemCountEls.forEach(el => {
        const node = el as HTMLElement;
        const op = node.getAttribute('data-collection-item-count-op') || 'eq';
        const rawValue = node.getAttribute('data-collection-item-count-value') || '0';
        const value = Number.parseInt(rawValue, 10);
        const shouldShow = evaluateItemCount(filteredCount, op, Number.isNaN(value) ? 0 : value);
        node.style.display = shouldShow ? '' : 'none';
      });
    }
  }, [collectionLayerId]);

  // --- SSR pagination DOM helpers ---

  const getSsrPaginationWrapper = useCallback(() => {
    return document.querySelector(
      `[data-pagination-for="${collectionLayerId}"]`
    ) as HTMLElement | null;
  }, [collectionLayerId]);

  // --- Pages mode: SSR pagination display ---

  const updateSsrPaginationDisplay = useCallback((page: number, totalPages: number) => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper) return;

    const infoEl = wrapper.querySelector(`[data-layer-id$="-pagination-info"]`) as HTMLElement | null;
    if (infoEl) {
      if (ssrPaginationTextRef.current === null) {
        ssrPaginationTextRef.current = infoEl.textContent || '';
      }
      infoEl.textContent = `Page ${page} of ${totalPages}`;
    }

    const prevBtn = wrapper.querySelector(`[data-pagination-action="prev"]`) as HTMLElement | null;
    if (prevBtn) {
      if (ssrPrevClassRef.current === null) {
        ssrPrevClassRef.current = prevBtn.className;
      }
      const isFirst = page <= 1;
      if (isFirst) {
        prevBtn.classList.add('opacity-50', 'cursor-not-allowed');
        prevBtn.classList.remove('cursor-pointer');
      } else {
        prevBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        prevBtn.classList.add('cursor-pointer');
      }
    }

    const nextBtn = wrapper.querySelector(`[data-pagination-action="next"]`) as HTMLElement | null;
    if (nextBtn) {
      if (ssrNextClassRef.current === null) {
        ssrNextClassRef.current = nextBtn.className;
      }
      const isLast = page >= totalPages;
      if (isLast) {
        nextBtn.classList.add('opacity-50', 'cursor-not-allowed');
        nextBtn.classList.remove('cursor-pointer');
      } else {
        nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        nextBtn.classList.add('cursor-pointer');
      }
    }
  }, [getSsrPaginationWrapper]);

  // --- Load More mode: SSR button + count display ---

  const updateSsrLoadMoreDisplay = useCallback((loaded: number, total: number, hasMore: boolean) => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper) return;

    const countEl = wrapper.querySelector(`[data-layer-id$="-pagination-count"]`) as HTMLElement | null;
    if (countEl) {
      if (ssrCountTextRef.current === null) {
        ssrCountTextRef.current = countEl.textContent || '';
      }
      countEl.textContent = `Showing ${loaded} of ${total}`;
    }

    const loadMoreBtn = wrapper.querySelector(`[data-pagination-action="load_more"]`) as HTMLElement | null;
    if (loadMoreBtn) {
      if (ssrLoadMoreBtnDisplayRef.current === null) {
        ssrLoadMoreBtnDisplayRef.current = loadMoreBtn.style.display;
      }
      loadMoreBtn.style.display = hasMore ? '' : 'none';
    }
  }, [getSsrPaginationWrapper]);

  const restoreSsrPagination = useCallback(() => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper) return;

    // Pages mode state
    if (ssrPaginationTextRef.current !== null) {
      const infoEl = wrapper.querySelector(`[data-layer-id$="-pagination-info"]`) as HTMLElement | null;
      if (infoEl) {
        infoEl.textContent = ssrPaginationTextRef.current;
      }
      ssrPaginationTextRef.current = null;
    }

    if (ssrPrevClassRef.current !== null) {
      const prevBtn = wrapper.querySelector(`[data-pagination-action="prev"]`) as HTMLElement | null;
      if (prevBtn) prevBtn.className = ssrPrevClassRef.current;
      ssrPrevClassRef.current = null;
    }

    if (ssrNextClassRef.current !== null) {
      const nextBtn = wrapper.querySelector(`[data-pagination-action="next"]`) as HTMLElement | null;
      if (nextBtn) nextBtn.className = ssrNextClassRef.current;
      ssrNextClassRef.current = null;
    }

    // Load More mode state
    if (ssrCountTextRef.current !== null) {
      const countEl = wrapper.querySelector(`[data-layer-id$="-pagination-count"]`) as HTMLElement | null;
      if (countEl) countEl.textContent = ssrCountTextRef.current;
      ssrCountTextRef.current = null;
    }

    if (ssrLoadMoreBtnDisplayRef.current !== null) {
      const loadMoreBtn = wrapper.querySelector(`[data-pagination-action="load_more"]`) as HTMLElement | null;
      if (loadMoreBtn) loadMoreBtn.style.display = ssrLoadMoreBtnDisplayRef.current;
      ssrLoadMoreBtnDisplayRef.current = null;
    }
  }, [getSsrPaginationWrapper]);

  // --- Click intercepts (pages + load_more share the same wrapper listener) ---

  const paginationInterceptRef = useRef<((e: Event) => void) | null>(null);

  const goToFilteredPageRef = useRef<(page: number) => void>(() => {});
  const handleLoadMoreRef = useRef<() => void>(() => {});

  const syncFilteredPageToUrl = useCallback((page: number) => {
    const url = new URL(window.location.href);
    if (page <= 1) {
      url.searchParams.delete(fpKey);
    } else {
      url.searchParams.set(fpKey, String(page));
    }
    window.history.replaceState({}, '', url.toString());
  }, [fpKey]);

  const goToFilteredPage = useCallback((page: number) => {
    if (page < 1 || page > filteredTotalPages || isFiltering) return;
    const groups = buildApiFilters();
    const offset = (page - 1) * (limit || 10);
    setFilteredPage(page);
    syncFilteredPageToUrl(page);
    fetchFilteredRef.current(groups, offset, false);
  }, [filteredTotalPages, isFiltering, buildApiFilters, limit, syncFilteredPageToUrl]);

  useEffect(() => {
    goToFilteredPageRef.current = goToFilteredPage;
  }, [goToFilteredPage]);

  const handleLoadMore = useCallback(() => {
    if (isFiltering || !filteredHasMore) return;
    const groups = buildApiFilters();
    fetchFilteredRef.current(groups, loadMoreOffsetRef.current, true);
  }, [isFiltering, filteredHasMore, buildApiFilters]);

  useEffect(() => {
    handleLoadMoreRef.current = handleLoadMore;
  }, [handleLoadMore]);

  const attachPaginationIntercept = useCallback(() => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper || paginationInterceptRef.current) return;

    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      const button = target.closest('[data-pagination-action]') as HTMLElement | null;
      if (!button) return;

      e.stopPropagation();
      e.preventDefault();

      const action = button.getAttribute('data-pagination-action');

      if (action === 'prev') {
        goToFilteredPageRef.current(filteredPageRef.current - 1);
      } else if (action === 'next') {
        goToFilteredPageRef.current(filteredPageRef.current + 1);
      } else if (action === 'load_more') {
        handleLoadMoreRef.current();
      }
    };

    wrapper.addEventListener('click', handler, true);
    paginationInterceptRef.current = handler;
  }, [getSsrPaginationWrapper]);

  const detachPaginationIntercept = useCallback(() => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper || !paginationInterceptRef.current) return;
    wrapper.removeEventListener('click', paginationInterceptRef.current, true);
    paginationInterceptRef.current = null;
  }, [getSsrPaginationWrapper]);

  // Stable ref for filteredPage so the intercept handler reads the latest value
  const filteredPageRef = useRef(filteredPage);
  useEffect(() => { filteredPageRef.current = filteredPage; }, [filteredPage]);

  // --- Fetch logic ---

  const fetchFiltered = useCallback((
    filterGroups: Array<Array<{ fieldId: string; operator: string; value: string; value2?: string; fieldType?: string }>>,
    offset: number,
    append: boolean,
  ) => {
    const requestKey = JSON.stringify({
      filterGroups,
      offset,
      append,
      sortBy: effectiveSortBy,
      sortOrder: effectiveSortOrder,
      limit,
    });
    if (inFlightRequestKeyRef.current === requestKey) return;

    setIsFiltering(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRequestKeyRef.current = requestKey;

    fetch(`/webwow/api/collections/${collectionId}/items/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layerTemplate,
        collectionLayerId,
        filterGroups,
        sortBy: effectiveSortBy,
        sortOrder: effectiveSortOrder,
        limit,
        offset,
        published: true,
      }),
      signal: controller.signal,
    })
      .then(res => {
        if (!res.ok) throw new Error(`Filter API returned ${res.status}`);
        return res.json();
      })
      .then(result => {
        if (result.error) {
          console.error('Filter API error:', result.error);
          setIsFiltering(false);
          return;
        }

        const data = result.data;
        if (!data) {
          setIsFiltering(false);
          return;
        }

        if (filteredRef.current) {
          if (append) {
            filteredRef.current.insertAdjacentHTML('beforeend', data.html ?? '');
          } else {
            filteredRef.current.innerHTML = data.html ?? '';
          }
        }

        const total = data.total ?? 0;
        const count = data.count ?? 0;
        const hasMore = data.hasMore ?? false;
        const newOffset = (data.offset ?? 0) + count;

        loadMoreOffsetRef.current = newOffset;
        setFilteredHasMore(hasMore);
        setFilteredTotal(total);
        setFilteredLoaded(newOffset);
        setIsFiltering(false);
        updateEmptyStateElements(total);

        if (paginationMode === 'pages' && limit && limit > 0) {
          setFilteredTotalPages(Math.max(1, Math.ceil(total / limit)));
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Filter fetch failed:', err);
          setIsFiltering(false);
        }
      })
      .finally(() => {
        if (inFlightRequestKeyRef.current === requestKey) {
          inFlightRequestKeyRef.current = null;
          abortRef.current = null;
        }
      });
  }, [collectionId, collectionLayerId, layerTemplate, effectiveSortBy, effectiveSortOrder, limit, paginationMode, updateEmptyStateElements]);

  // Stable ref so goToFilteredPage (via intercept handler) can call fetchFiltered
  const fetchFilteredRef = useRef(fetchFiltered);
  useEffect(() => { fetchFilteredRef.current = fetchFiltered; }, [fetchFiltered]);

  // --- React to filter value changes ---

  useEffect(() => {
    const filterGroups = buildApiFilters();
    const hasRuntimeControls = filterGroups.length > 0 || hasRuntimeSortOverride;
    const filterKey = JSON.stringify({
      filterGroups,
      sortBy: effectiveSortBy,
      sortOrder: effectiveSortOrder,
      hasRuntimeControls,
    });

    if (filterKey === prevFilterKeyRef.current) return;
    const wasEmpty = prevFilterKeyRef.current === '' || prevFilterKeyRef.current === '[]';
    prevFilterKeyRef.current = filterKey;

    if (!hasRuntimeControls) {
      // Remove filtered page param from URL
      const cleanUrl = new URL(window.location.href);
      if (cleanUrl.searchParams.has(fpKey)) {
        cleanUrl.searchParams.delete(fpKey);
        window.history.replaceState({}, '', cleanUrl.toString());
      }

      // Reload when SSR content is stale: either we stripped a p_ param
      // (pages mode — SSR was for a page other than 1) or load_more mode
      // where LoadMoreCollection may have appended extra items to the DOM.
      // Only reload when transitioning FROM active filters, not on initial load.
      if (strippedPaginationParamRef.current || (paginationMode === 'load_more' && !wasEmpty)) {
        strippedPaginationParamRef.current = false;
        const reloadUrl = new URL(window.location.href);
        reloadUrl.searchParams.delete(fpKey);
        reloadUrl.searchParams.delete(pKey);
        window.location.href = reloadUrl.toString();
        return;
      }

      setHasActiveFilters(false);
      setIsFiltering(false);
      setFilteredHasMore(false);
      setFilteredPage(1);
      setFilteredTotalPages(1);
      setFilteredTotal(0);
      setFilteredLoaded(0);
      loadMoreOffsetRef.current = 0;
      if (filteredRef.current) filteredRef.current.innerHTML = '';
      detachPaginationIntercept();
      restoreSsrPagination();
      // Restore SSR pagination visibility (may have been hidden)
      const wrapper = getSsrPaginationWrapper();
      if (wrapper) wrapper.style.display = '';
      updateEmptyStateElements(-1);
      return;
    }

    setHasActiveFilters(true);

    // On first activation (e.g. page load with filter + fp_ in URL), restore
    // the persisted page. On subsequent filter changes, always reset to page 1.
    const currentUrl = new URL(window.location.href);
    const fpValue = currentUrl.searchParams.get(fpKey);
    const restoredPage = fpValue ? Math.max(1, parseInt(fpValue, 10) || 1) : 1;
    const startPage = wasEmpty ? restoredPage : 1;

    setFilteredPage(startPage);
    loadMoreOffsetRef.current = 0;

    // Sync the fp_ param: remove it if resetting to page 1
    if (startPage <= 1 && currentUrl.searchParams.has(fpKey)) {
      currentUrl.searchParams.delete(fpKey);
      window.history.replaceState({}, '', currentUrl.toString());
    }

    // Strip stale p_ pagination params from the URL since client-side
    // filtering manages its own pagination independently of SSR pages.
    if (currentUrl.searchParams.has(pKey)) {
      currentUrl.searchParams.delete(pKey);
      window.history.replaceState({}, '', currentUrl.toString());
      strippedPaginationParamRef.current = true;
    }

    // Both modes use the same intercept — pages for prev/next, load_more for
    // the load more button. Either way we need to stop the SSR component's
    // document-level listener from firing.
    if (paginationMode === 'pages' || paginationMode === 'load_more') {
      attachPaginationIntercept();
    }

    const startOffset = (startPage - 1) * (limit || 10);
    fetchFiltered(filterGroups, startOffset, false);

    return () => abortRef.current?.abort();
  }, [filterValues, buildApiFilters, fetchFiltered, paginationMode, attachPaginationIntercept, detachPaginationIntercept, restoreSsrPagination, getSsrPaginationWrapper, updateEmptyStateElements, fpKey, pKey, limit, hasRuntimeSortOverride, effectiveSortBy, effectiveSortOrder]);

  // Update SSR pagination display when filtered page/total changes (pages mode)
  useEffect(() => {
    if (!hasActiveFilters || paginationMode !== 'pages') return;
    updateSsrPaginationDisplay(filteredPage, filteredTotalPages);
  }, [hasActiveFilters, paginationMode, filteredPage, filteredTotalPages, updateSsrPaginationDisplay]);

  // Update SSR load more display when filtered results change (load_more mode)
  useEffect(() => {
    if (!hasActiveFilters || paginationMode !== 'load_more') return;
    updateSsrLoadMoreDisplay(filteredLoaded, filteredTotal, filteredHasMore);
  }, [hasActiveFilters, paginationMode, filteredLoaded, filteredTotal, filteredHasMore, updateSsrLoadMoreDisplay]);

  // Cleanup intercept on unmount
  useEffect(() => {
    return () => detachPaginationIntercept();
  }, [detachPaginationIntercept]);

  return (
    <div
      className={`relative ${isFiltering ? 'opacity-50 pointer-events-none' : ''}`}
      data-filterable-collection={collectionLayerId}
    >
      {isFiltering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      )}

      <div ref={ssrRef} style={{ display: hasActiveFilters ? 'none' : undefined }}>
        {children}
      </div>

      <div ref={filteredRef} style={{ display: hasActiveFilters ? undefined : 'none' }} />
    </div>
  );
}
