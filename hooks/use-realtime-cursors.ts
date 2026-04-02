// Realtime updates disabled - was using Supabase Realtime

import { useState } from 'react';

type CursorEventPayload = {
  position: {
    x: number
    y: number
  }
  user: {
    id: number
    name: string
    authId?: string
    avatarUrl?: string | null
  }
  color: string
  timestamp: number
  selectedLayerId?: string | null
  isEditing?: boolean
  lockedLayerId?: string | null
}

export const useRealtimeCursors = ({
  roomName,
  username,
  throttleMs,
}: {
  roomName: string
  username: string
  throttleMs: number
}) => {
  // TODO: Replace with polling or WebSocket
  const [cursors] = useState<Record<string, CursorEventPayload>>({});

  return { cursors };
}
