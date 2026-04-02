import { getKnexClient } from '@/lib/knex-client';
import { createHash, randomBytes } from 'crypto';

/**
 * API Key Repository
 *
 * Handles CRUD operations for API keys used in the public v1 API.
 * Keys are stored as SHA-256 hashes for security.
 */

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyWithPlainKey extends ApiKey {
  api_key: string; // Only returned once during creation
}

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Generate a new API key
 * Format: 64 random hex chars
 */
function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Get all API keys (without hashes)
 */
export async function getAllApiKeys(): Promise<ApiKey[]> {
  const db = await getKnexClient();

  const data = await db('api_keys')
    .select('id', 'name', 'key_prefix', 'last_used_at', 'created_at', 'updated_at')
    .orderBy('created_at', 'desc');

  return data || [];
}

/**
 * Create a new API key
 * Returns the key info including the plain key (shown only once)
 */
export async function createApiKey(name: string): Promise<ApiKeyWithPlainKey> {
  const db = await getKnexClient();

  // Generate the key
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);
  const keyPrefix = apiKey.substring(0, 8); // First 8 chars for identification

  const [data] = await db('api_keys')
    .insert({
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .returning(['id', 'name', 'key_prefix', 'last_used_at', 'created_at', 'updated_at']);

  return {
    ...data,
    api_key: apiKey, // Return plain key only on creation
  };
}

/**
 * Delete an API key
 */
export async function deleteApiKey(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('api_keys')
    .where('id', id)
    .delete();
}

/**
 * Validate an API key
 * Returns the key record if valid, null otherwise
 * Also updates last_used_at timestamp
 */
export async function validateApiKey(apiKey: string): Promise<ApiKey | null> {
  const db = await getKnexClient();

  const keyHash = hashApiKey(apiKey);

  // Find the key by hash
  const data = await db('api_keys')
    .select('id', 'name', 'key_prefix', 'last_used_at', 'created_at', 'updated_at')
    .where('key_hash', keyHash)
    .first();

  if (!data) {
    return null;
  }

  // Update last_used_at (fire and forget - don't wait for it)
  (async () => {
    try {
      await db('api_keys')
        .where('id', data.id)
        .update({ last_used_at: new Date().toISOString() });
    } catch (err) {
      console.error('Failed to update last_used_at:', err);
    }
  })();

  return data;
}

/**
 * Get an API key by ID (without hash)
 */
export async function getApiKeyById(id: string): Promise<ApiKey | null> {
  const db = await getKnexClient();

  const data = await db('api_keys')
    .select('id', 'name', 'key_prefix', 'last_used_at', 'created_at', 'updated_at')
    .where('id', id)
    .first();

  return data || null;
}
