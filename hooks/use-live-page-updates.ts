// Realtime updates disabled - was using Supabase Realtime

'use client';

import { useCallback } from 'react';
import type { Page } from '../types';

interface UseLivePageUpdatesReturn {
  broadcastPageUpdate: (pageId: string, changes: Partial<Page>) => void;
  broadcastPageCreate: (page: Page) => void;
  broadcastPageDelete: (pageId: string) => void;
  isReceivingUpdates: boolean;
  lastUpdateTime: number | null;
}

export function useLivePageUpdates(): UseLivePageUpdatesReturn {
  // TODO: Replace with polling or WebSocket
  const broadcastPageUpdate = useCallback((_pageId: string, _changes: Partial<Page>) => {
  }, []);

  const broadcastPageCreate = useCallback((_page: Page) => {
  }, []);

  const broadcastPageDelete = useCallback((_pageId: string) => {
  }, []);

  return {
    broadcastPageUpdate,
    broadcastPageCreate,
    broadcastPageDelete,
    isReceivingUpdates: false,
    lastUpdateTime: null,
  };
}
