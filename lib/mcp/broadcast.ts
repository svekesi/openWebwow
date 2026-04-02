/**
 * Server-side broadcast for MCP changes.
 *
 * In the open-source build realtime push is not available (no Supabase Realtime).
 * These functions are no-ops; the editor refreshes via polling or manual reload.
 */

import type { Component, Layer, Page } from '@/types';

export async function broadcastLayersChanged(
  _pageId: string,
  _layers: Layer[],
): Promise<void> {
  // No-op in open-source mode
}

export async function broadcastPageCreated(_page: Page): Promise<void> {
  // No-op in open-source mode
}

export async function broadcastPageUpdated(
  _pageId: string,
  _changes: Partial<Page>,
): Promise<void> {
  // No-op in open-source mode
}

export async function broadcastPageDeleted(_pageId: string): Promise<void> {
  // No-op in open-source mode
}

export async function broadcastComponentCreated(_component: Component): Promise<void> {
  // No-op in open-source mode
}

export async function broadcastComponentUpdated(
  _componentId: string,
  _changes: Record<string, unknown>,
): Promise<void> {
  // No-op in open-source mode
}

export async function broadcastComponentDeleted(_componentId: string): Promise<void> {
  // No-op in open-source mode
}

export async function broadcastComponentLayersUpdated(
  _componentId: string,
  _layers: Layer[],
): Promise<void> {
  // No-op in open-source mode
}
