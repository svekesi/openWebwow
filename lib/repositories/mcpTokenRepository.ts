import { getKnexClient } from '@/lib/knex-client';
import { randomBytes } from 'crypto';

export interface McpToken {
  id: string;
  name: string;
  token_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface McpTokenWithPlainToken extends McpToken {
  token: string;
}

function generateToken(): string {
  return 'ymc_' + randomBytes(24).toString('hex');
}

export async function getAllTokens(): Promise<McpToken[]> {
  const db = await getKnexClient();

  const data = await db('mcp_tokens')
    .select('id', 'name', 'token_prefix', 'is_active', 'last_used_at', 'created_at', 'updated_at')
    .orderBy('created_at', 'desc');

  return data || [];
}

export async function createToken(name: string): Promise<McpTokenWithPlainToken> {
  const db = await getKnexClient();

  const token = generateToken();
  const tokenPrefix = token.substring(0, 12);

  const [data] = await db('mcp_tokens')
    .insert({
      name,
      token,
      token_prefix: tokenPrefix,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .returning(['id', 'name', 'token', 'token_prefix', 'is_active', 'last_used_at', 'created_at', 'updated_at']);

  return data;
}

/**
 * Validate a token and return the record if active.
 * Updates last_used_at in the background.
 */
export async function validateToken(token: string): Promise<McpToken | null> {
  const db = await getKnexClient();

  const data = await db('mcp_tokens')
    .select('id', 'name', 'token_prefix', 'is_active', 'last_used_at', 'created_at', 'updated_at')
    .where('token', token)
    .where('is_active', true)
    .first();

  if (!data) {
    return null;
  }

  await db('mcp_tokens')
    .where('id', data.id)
    .update({ last_used_at: new Date().toISOString() });

  return data;
}

export async function deleteToken(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('mcp_tokens')
    .where('id', id)
    .delete();
}

export async function getTokenById(id: string): Promise<McpToken | null> {
  const db = await getKnexClient();

  const data = await db('mcp_tokens')
    .select('id', 'name', 'token_prefix', 'is_active', 'last_used_at', 'created_at', 'updated_at')
    .where('id', id)
    .first();

  return data || null;
}
