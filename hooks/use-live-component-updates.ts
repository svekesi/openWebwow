// Realtime updates disabled - was using Supabase Realtime

'use client';

import { useCallback } from 'react';
import type { Component, Layer } from '../types';

export interface UseLiveComponentUpdatesReturn {
  broadcastComponentCreate: (component: Component) => void;
  broadcastComponentUpdate: (componentId: string, changes: Partial<Component>) => void;
  broadcastComponentDelete: (componentId: string) => void;
  broadcastComponentLayersUpdate: (componentId: string, layers: Layer[]) => void;
  isConnected: boolean;
}

export function useLiveComponentUpdates(): UseLiveComponentUpdatesReturn {
  // TODO: Replace with polling or WebSocket
  const broadcastComponentCreate = useCallback((_component: Component) => {
  }, []);

  const broadcastComponentUpdate = useCallback((_componentId: string, _changes: Partial<Component>) => {
  }, []);

  const broadcastComponentDelete = useCallback((_componentId: string) => {
  }, []);

  const broadcastComponentLayersUpdate = useCallback((_componentId: string, _layers: Layer[]) => {
  }, []);

  return {
    broadcastComponentCreate,
    broadcastComponentUpdate,
    broadcastComponentDelete,
    broadcastComponentLayersUpdate,
    isConnected: false,
  };
}
