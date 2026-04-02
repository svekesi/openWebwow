/**
 * Database Constants
 *
 * Centralized constants for database operations.
 */

/**
 * Default row limit for paginated queries.
 */
export const DB_QUERY_LIMIT = 1000;

/**
 * Batch size for insert/update/upsert operations.
 */
export const DB_WRITE_BATCH_SIZE = 100;

// Re-export with old names for backward compatibility during migration
export const SUPABASE_QUERY_LIMIT = DB_QUERY_LIMIT;
export const SUPABASE_WRITE_BATCH_SIZE = DB_WRITE_BATCH_SIZE;
