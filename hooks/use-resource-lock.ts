// Realtime updates disabled - was using Supabase Realtime

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useCollaborationPresenceStore, getResourceLockKey } from '@/stores/useCollaborationPresenceStore';
import { getSessionId } from '@/stores/useCollaborationPresenceStore';

export interface UseResourceLockOptions {
  resourceType: string;
  channelName: string;
}

export interface UseResourceLockReturn {
  acquireLock: (resourceId: string) => Promise<boolean>;
  releaseLock: (resourceId: string) => Promise<void>;
  releaseAllLocks: () => Promise<void>;
  isLocked: (resourceId: string) => boolean;
  isLockedByOther: (resourceId: string) => boolean;
  getLockOwner: (resourceId: string) => string | null;
}

export function useResourceLock({
  resourceType,
}: UseResourceLockOptions): UseResourceLockReturn {
  const sessionId = getSessionId();
  const storeAcquireLock = useCollaborationPresenceStore((state) => state.acquireResourceLock);
  const storeReleaseLock = useCollaborationPresenceStore((state) => state.releaseResourceLock);

  const myLocksRef = useRef<Set<string>>(new Set());

  // TODO: Replace with polling or WebSocket for broadcasting lock changes

  const acquireLock = useCallback(async (resourceId: string): Promise<boolean> => {
    const { resourceLocks } = useCollaborationPresenceStore.getState();
    const key = getResourceLockKey(resourceType, resourceId);
    const existingLock = resourceLocks[key];

    if (existingLock && existingLock.user_id !== sessionId && Date.now() <= existingLock.expires_at) {
      return false;
    }

    storeAcquireLock(resourceType, resourceId, sessionId);
    myLocksRef.current.add(resourceId);

    return true;
  }, [sessionId, resourceType, storeAcquireLock]);

  const releaseLock = useCallback(async (resourceId: string) => {
    storeReleaseLock(resourceType, resourceId);
    myLocksRef.current.delete(resourceId);
  }, [resourceType, storeReleaseLock]);

  const releaseAllLocks = useCallback(async () => {
    const locks = Array.from(myLocksRef.current);
    for (const resourceId of locks) {
      await releaseLock(resourceId);
    }
  }, [releaseLock]);

  const isLocked = useCallback((resourceId: string): boolean => {
    const { resourceLocks } = useCollaborationPresenceStore.getState();
    const key = getResourceLockKey(resourceType, resourceId);
    const lock = resourceLocks[key];
    return !!(lock && Date.now() <= lock.expires_at);
  }, [resourceType]);

  const isLockedByOther = useCallback((resourceId: string): boolean => {
    return useCollaborationPresenceStore.getState().isResourceLockedByOther(resourceType, resourceId, sessionId);
  }, [resourceType, sessionId]);

  const getLockOwner = useCallback((resourceId: string): string | null => {
    const lock = useCollaborationPresenceStore.getState().getResourceLock(resourceType, resourceId);
    return lock?.user_id || null;
  }, [resourceType]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const locks = Array.from(myLocksRef.current);
      if (locks.length > 0) {
        locks.forEach(resourceId => {
          storeReleaseLock(resourceType, resourceId);
        });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [resourceType, storeReleaseLock]);

  return {
    acquireLock,
    releaseLock,
    releaseAllLocks,
    isLocked,
    isLockedByOther,
    getLockOwner,
  };
}
