import { getKnexClient } from '@/lib/knex-client';

/**
 * Webhook Repository
 *
 * Handles CRUD operations for webhooks and webhook delivery logs.
 */

// =============================================================================
// Types
// =============================================================================

export type WebhookEventType =
  | 'form.submitted'
  | 'site.published'
  | 'collection_item.created'
  | 'collection_item.updated'
  | 'collection_item.deleted'
  | 'page.created'
  | 'page.updated'
  | 'page.published'
  | 'page.deleted'
  | 'asset.uploaded'
  | 'asset.deleted';

export interface WebhookFilters {
  /** Filter form.submitted events to a specific form */
  form_id?: string | null;
  /** Filter collection_item.* events to a specific collection */
  collection_id?: string | null;
}

export interface Webhook {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  events: WebhookEventType[];
  filters: WebhookFilters | null;
  enabled: boolean;
  last_triggered_at: string | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  response_status: number | null;
  response_body: string | null;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  duration_ms: number | null;
  created_at: string;
}

export interface CreateWebhookData {
  name: string;
  url: string;
  secret?: string;
  events: WebhookEventType[];
  filters?: WebhookFilters | null;
}

export interface UpdateWebhookData {
  name?: string;
  url?: string;
  secret?: string | null;
  events?: WebhookEventType[];
  filters?: WebhookFilters | null;
  enabled?: boolean;
}

export interface CreateWebhookDeliveryData {
  webhook_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status?: 'pending' | 'success' | 'failed';
  attempts?: number;
}

export interface UpdateWebhookDeliveryData {
  response_status?: number;
  response_body?: string;
  status?: 'pending' | 'success' | 'failed';
  attempts?: number;
  duration_ms?: number;
}

// =============================================================================
// Webhook CRUD Operations
// =============================================================================

/**
 * Get all webhooks
 */
export async function getAllWebhooks(): Promise<Webhook[]> {
  const db = await getKnexClient();

  const data = await db('webhooks')
    .select('*')
    .orderBy('created_at', 'desc');

  return (data || []).map(mapWebhookFromDb);
}

/**
 * Get webhook by ID
 */
export async function getWebhookById(id: string): Promise<Webhook | null> {
  const db = await getKnexClient();

  const data = await db('webhooks')
    .select('*')
    .where('id', id)
    .first();

  return data ? mapWebhookFromDb(data) : null;
}

/**
 * Get all enabled webhooks for a specific event type
 */
export async function getWebhooksForEvent(eventType: WebhookEventType): Promise<Webhook[]> {
  const db = await getKnexClient();

  const data = await db('webhooks')
    .select('*')
    .where('enabled', true);

  // Filter by event type in JS to avoid PostgREST JSONB contains serialization issues
  return (data || [])
    .map(mapWebhookFromDb)
    .filter((w) => w.events.includes(eventType));
}

/**
 * Create a new webhook
 */
export async function createWebhook(webhookData: CreateWebhookData): Promise<Webhook> {
  const db = await getKnexClient();

  const [data] = await db('webhooks')
    .insert({
      name: webhookData.name,
      url: webhookData.url,
      secret: webhookData.secret || null,
      events: JSON.stringify(webhookData.events),
      filters: webhookData.filters ? JSON.stringify(webhookData.filters) : null,
      enabled: true,
      failure_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  return mapWebhookFromDb(data);
}

/**
 * Update a webhook
 */
export async function updateWebhook(id: string, updates: UpdateWebhookData): Promise<Webhook> {
  const db = await getKnexClient();

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.url !== undefined) updateData.url = updates.url;
  if (updates.secret !== undefined) updateData.secret = updates.secret;
  if (updates.events !== undefined) updateData.events = JSON.stringify(updates.events);
  if (updates.filters !== undefined) updateData.filters = updates.filters ? JSON.stringify(updates.filters) : null;
  if (updates.enabled !== undefined) updateData.enabled = updates.enabled;

  const [data] = await db('webhooks')
    .where('id', id)
    .update(updateData)
    .returning('*');

  return mapWebhookFromDb(data);
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('webhooks')
    .where('id', id)
    .delete();
}

/**
 * Update webhook trigger timestamp and reset failure count on success
 */
export async function markWebhookTriggered(id: string, success: boolean): Promise<void> {
  const db = await getKnexClient();

  if (success) {
    await db('webhooks')
      .where('id', id)
      .update({
        last_triggered_at: new Date().toISOString(),
        failure_count: 0,
        updated_at: new Date().toISOString(),
      });
  } else {
    await db('webhooks')
      .where('id', id)
      .update({
        failure_count: db.raw('failure_count + 1'),
        updated_at: new Date().toISOString(),
      });
  }
}

/**
 * Increment webhook failure count (called when delivery fails)
 */
export async function incrementWebhookFailureCount(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('webhooks')
    .where('id', id)
    .update({
      failure_count: db.raw('failure_count + 1'),
      updated_at: new Date().toISOString(),
    });
}

// =============================================================================
// Webhook Delivery Operations
// =============================================================================

/**
 * Create a webhook delivery log entry
 */
export async function createWebhookDelivery(
  deliveryData: CreateWebhookDeliveryData
): Promise<WebhookDelivery> {
  const db = await getKnexClient();

  const [data] = await db('webhook_deliveries')
    .insert({
      webhook_id: deliveryData.webhook_id,
      event_type: deliveryData.event_type,
      payload: JSON.stringify(deliveryData.payload),
      status: deliveryData.status || 'pending',
      attempts: deliveryData.attempts || 1,
      created_at: new Date().toISOString(),
    })
    .returning('*');

  return data as WebhookDelivery;
}

/**
 * Update a webhook delivery
 */
export async function updateWebhookDelivery(
  id: string,
  updates: UpdateWebhookDeliveryData
): Promise<void> {
  const db = await getKnexClient();

  await db('webhook_deliveries')
    .where('id', id)
    .update(updates);
}

/**
 * Get deliveries for a specific webhook
 */
export async function getWebhookDeliveries(
  webhookId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
  const db = await getKnexClient();

  const limit = options.limit || 50;
  const offset = options.offset || 0;

  // Get total count
  const [{ count }] = await db('webhook_deliveries')
    .count('* as count')
    .where('webhook_id', webhookId);

  // Get paginated results
  const data = await db('webhook_deliveries')
    .select('*')
    .where('webhook_id', webhookId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    deliveries: (data || []) as WebhookDelivery[],
    total: Number(count) || 0,
  };
}

/**
 * Delete old webhook deliveries (cleanup)
 */
export async function deleteOldWebhookDeliveries(olderThanDays: number = 30): Promise<number> {
  const db = await getKnexClient();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const deletedCount = await db('webhook_deliveries')
    .where('created_at', '<', cutoffDate.toISOString())
    .delete();

  return deletedCount;
}

// =============================================================================
// Helpers
// =============================================================================
 
function mapWebhookFromDb(data: any): Webhook {
  return {
    id: data.id,
    name: data.name,
    url: data.url,
    secret: data.secret,
    events: Array.isArray(data.events) ? data.events : [],
    filters: data.filters || null,
    enabled: data.enabled,
    last_triggered_at: data.last_triggered_at,
    failure_count: data.failure_count || 0,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}
