// Realtime updates disabled - was using Supabase Realtime

'use client';

import { useCallback } from 'react';
import type { LayerStyle } from '../types';

export interface UseLiveLayerStyleUpdatesReturn {
  broadcastStyleCreate: (style: LayerStyle) => void;
  broadcastStyleUpdate: (styleId: string, changes: Partial<LayerStyle>) => void;
  broadcastStyleDelete: (styleId: string) => void;
  isConnected: boolean;
}

export function useLiveLayerStyleUpdates(): UseLiveLayerStyleUpdatesReturn {
  // TODO: Replace with polling or WebSocket
  const broadcastStyleCreate = useCallback((_style: LayerStyle) => {
  }, []);

  const broadcastStyleUpdate = useCallback((_styleId: string, _changes: Partial<LayerStyle>) => {
  }, []);

  const broadcastStyleDelete = useCallback((_styleId: string) => {
  }, []);

  return {
    broadcastStyleCreate,
    broadcastStyleUpdate,
    broadcastStyleDelete,
    isConnected: false,
  };
}
