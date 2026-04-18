'use client';

import { SelectItem, SelectSeparator } from '@/components/ui/select';
import type { CollectionItemWithValues, CollectionField } from '@/types';
import type { ReferenceItemOption } from '@/lib/collection-field-utils';

interface CollectionItemSelectOptionsProps {
  canUseCurrentPageItem: boolean;
  canUseCurrentCollectionItem: boolean;
  referenceItemOptions: ReferenceItemOption[];
  collectionItems: CollectionItemWithValues[];
  /** Fields for the linked page's collection, used to derive display names */
  collectionFields: CollectionField[];
}

/** Derives a human-readable label for a collection item. */
function getDisplayName(item: CollectionItemWithValues, collectionFields: CollectionField[]): string {
  const nameField = collectionFields.find(f => f.key === 'name');
  if (nameField && item.values[nameField.id]) return item.values[nameField.id];
  const values = Object.values(item.values);
  return values[0] || item.id;
}

/**
 * Shared SelectContent items for CMS item pickers used in link settings.
 * Renders "Current page item", "Current collection item", reference field options,
 * a separator, and the concrete item list.
 */
export default function LinkItemOptions({
  canUseCurrentPageItem,
  canUseCurrentCollectionItem,
  referenceItemOptions,
  collectionItems,
  collectionFields,
}: CollectionItemSelectOptionsProps) {
  const hasSpecialOptions = canUseCurrentPageItem || canUseCurrentCollectionItem || referenceItemOptions.length > 0;

  return (
    <>
      {canUseCurrentPageItem && (
        <SelectItem value="current-page">
          <div className="flex items-center gap-2">
            Current page item
          </div>
        </SelectItem>
      )}
      {canUseCurrentCollectionItem && (
        <SelectItem value="current-collection">
          <div className="flex items-center gap-2">
            Current collection item
          </div>
        </SelectItem>
      )}
      {referenceItemOptions.map((opt) => (
        <SelectItem key={opt.value} value={opt.value}>
          <div className="flex items-center gap-2">
            {opt.label}
          </div>
        </SelectItem>
      ))}
      {hasSpecialOptions && <SelectSeparator />}
      {collectionItems.map((item) => (
        <SelectItem key={item.id} value={item.id}>
          {getDisplayName(item, collectionFields)}
        </SelectItem>
      ))}
    </>
  );
}
