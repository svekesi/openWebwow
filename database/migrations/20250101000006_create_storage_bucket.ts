import type { Knex } from 'knex';

/**
 * Migration: Storage Bucket (no-op)
 *
 * Previously created Supabase storage bucket and policies.
 * Now a no-op since we use local filesystem storage.
 */

export async function up(_knex: Knex): Promise<void> {
  // No-op: local filesystem storage needs no DB setup
}

export async function down(_knex: Knex): Promise<void> {
  // No-op
}
