// Realtime updates disabled - was using Supabase Realtime

import { useCallback, useEffect, useRef } from 'react';
import { useCollaborationPresenceStore } from '@/stores/useCollaborationPresenceStore';
import { getSessionId } from '@/stores/useCollaborationPresenceStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useResourceLock } from './use-resource-lock';

const LAYER_RESOURCE_TYPE = 'layer';

interface UseLayerLocksReturn {
  acquireLock: (layerId: string) => Promise<boolean>;
  releaseLock: (layerId: string) => Promise<void>;
  releaseAllLocks: () => Promise<void>;
  isLayerLocked: (layerId: string) => boolean;
  getLockOwner: (layerId: string) => string | null;
  canEditLayer: (layerId: string) => boolean;
  isLockedByOther: (layerId: string) => boolean;
}

export function useLayerLocks(): UseLayerLocksReturn {
  const sessionId = getSessionId();
  const currentUserId = useCollaborationPresenceStore((state) => state.currentUserId);
  const updateUser = useCollaborationPresenceStore((state) => state.updateUser);
  const { currentPageId, editingComponentId } = useEditorStore();

  const lastActivity = useRef<number>(0);

  const channelName = editingComponentId
    ? `component:${editingComponentId}:locks`
    : currentPageId
      ? `page:${currentPageId}:locks`
      : '';

  const resourceLock = useResourceLock({
    resourceType: LAYER_RESOURCE_TYPE,
    channelName,
  });

  useEffect(() => {
    const userId = currentUserId || sessionId;
    if (!userId) return;

    let timeoutId: NodeJS.Timeout;
    const updateActivity = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const existingUser = useCollaborationPresenceStore.getState().users[userId];
        if (!existingUser) return;

        lastActivity.current = Date.now();
        updateUser(userId, { last_active: Date.now() });
      }, 1000);
    };

    document.addEventListener('mousemove', updateActivity);
    document.addEventListener('keydown', updateActivity);
    document.addEventListener('click', updateActivity);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousemove', updateActivity);
      document.removeEventListener('keydown', updateActivity);
      document.removeEventListener('click', updateActivity);
    };
  }, [currentUserId, sessionId, updateUser]);

  const acquireLock = useCallback(async (layerId: string): Promise<boolean> => {
    return resourceLock.acquireLock(layerId);
  }, [resourceLock]);

  const releaseLock = useCallback(async (layerId: string): Promise<void> => {
    return resourceLock.releaseLock(layerId);
  }, [resourceLock]);

  const releaseAllLocks = useCallback(async (): Promise<void> => {
    return resourceLock.releaseAllLocks();
  }, [resourceLock]);

  const isLayerLocked = useCallback((layerId: string): boolean => {
    return resourceLock.isLocked(layerId);
  }, [resourceLock]);

  const getLockOwner = useCallback((layerId: string): string | null => {
    return resourceLock.getLockOwner(layerId);
  }, [resourceLock]);

  const canEditLayer = useCallback((layerId: string): boolean => {
    return !resourceLock.isLockedByOther(layerId);
  }, [resourceLock]);

  const isLockedByOther = useCallback((layerId: string): boolean => {
    return resourceLock.isLockedByOther(layerId);
  }, [resourceLock]);

  return {
    acquireLock,
    releaseLock,
    releaseAllLocks,
    isLayerLocked,
    getLockOwner,
    canEditLayer,
    isLockedByOther,
  };
}

export { LAYER_RESOURCE_TYPE };
