// Realtime updates disabled - was using Supabase Realtime

import { useCallback } from 'react';
import type { Layer } from '../types';

export interface UseLiveLayerUpdatesReturn {
  broadcastLayerUpdate: (layerId: string, changes: Partial<Layer>) => void;
  broadcastLayerAdd: (pageId: string, parentLayerId: string | null, layerName: string, newLayer: Layer) => void;
  broadcastLayerDelete: (pageId: string, layerId: string) => void;
  broadcastLayerMove: (pageId: string, layerId: string, targetParentId: string | null, targetIndex: number) => void;
  isReceivingUpdates: boolean;
  lastUpdateTime: number | null;
}

export function useLiveLayerUpdates(
  _pageId: string | null
): UseLiveLayerUpdatesReturn {
  // TODO: Replace with polling or WebSocket
  const broadcastLayerUpdate = useCallback((_layerId: string, _changes: Partial<Layer>) => {
  }, []);

  const broadcastLayerAdd = useCallback((_pageId: string, _parentLayerId: string | null, _layerName: string, _newLayer: Layer) => {
  }, []);

  const broadcastLayerDelete = useCallback((_pageId: string, _layerId: string) => {
  }, []);

  const broadcastLayerMove = useCallback((_pageId: string, _layerId: string, _targetParentId: string | null, _targetIndex: number) => {
  }, []);

  return {
    broadcastLayerUpdate,
    broadcastLayerAdd,
    broadcastLayerDelete,
    broadcastLayerMove,
    isReceivingUpdates: false,
    lastUpdateTime: null,
  };
}
