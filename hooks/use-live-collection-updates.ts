// Realtime updates disabled - was using Supabase Realtime
'use client';

/**
 * Live Collection Updates Hook
 *
 * Realtime push disabled in open-source mode (no Supabase Realtime).
 * Broadcast functions are no-ops; the UI refreshes via polling or manual reload.
 */

import { useCallback } from 'react';
import type { Collection, CollectionItemWithValues } from '../types';

export interface UseLiveCollectionUpdatesReturn {
  broadcastCollectionCreate: (collection: Collection) => void;
  broadcastCollectionUpdate: (collectionId: string, changes: Partial<Collection>) => void;
  broadcastCollectionDelete: (collectionId: string) => void;
  broadcastItemCreate: (collectionId: string, item: CollectionItemWithValues) => void;
  broadcastItemUpdate: (collectionId: string, itemId: string, changes: Partial<CollectionItemWithValues>) => void;
  broadcastItemDelete: (collectionId: string, itemId: string) => void;
  isConnected: boolean;
}

export function useLiveCollectionUpdates(): UseLiveCollectionUpdatesReturn {
  const noop = useCallback(() => {}, []);

  return {
    broadcastCollectionCreate: noop as any,
    broadcastCollectionUpdate: noop as any,
    broadcastCollectionDelete: noop as any,
    broadcastItemCreate: noop as any,
    broadcastItemUpdate: noop as any,
    broadcastItemDelete: noop as any,
    isConnected: false,
  };
}
