/**
 * Knex Query Helpers
 *
 * Batch update and increment helpers for raw SQL queries.
 */

import type { Knex } from 'knex';

/**
 * Serialize a value for a PostgreSQL jsonb column.
 *
 * The pg driver converts JS arrays to PostgreSQL array format (e.g. {val1,val2})
 * which is invalid for jsonb. This helper ensures all values are serialized as
 * JSON strings that PostgreSQL can cast to jsonb.
 *
 * Use this for ALL insert/update values targeting jsonb columns.
 */
export function jsonb(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Batch update a column using CASE statements for efficiency.
 *
 * Generates: UPDATE table SET "column" = CASE WHEN id = ? THEN ? ... END, updated_at = NOW()
 *            WHERE id IN (?, ...) [extraWhereClause]
 *
 * @param knex - Knex instance
 * @param tableName - Table to update
 * @param column - Column to set via CASE
 * @param updates - Array of { id, value } pairs
 * @param options - Optional extra WHERE clause, params, and cast type
 */
export async function batchUpdateColumn(
  knex: Knex,
  tableName: string,
  column: string,
  updates: Array<{ id: string; value: string | number }>,
  options?: {
    extraWhereClause?: string;
    extraWhereParams?: (string | number)[];
    castType?: string;
  }
): Promise<void> {
  if (updates.length === 0) return;

  const { extraWhereClause = '', extraWhereParams = [], castType } = options || {};

  const cast = castType ? `::${castType}` : '';
  const caseStatements = updates.map(() => `WHEN id = ? THEN ?${cast}`).join(' ');
  const values = updates.flatMap(u => [u.id, u.value]);
  const idPlaceholders = updates.map(() => '?').join(', ');

  await knex.raw(`
    UPDATE ${tableName}
    SET "${column}" = CASE ${caseStatements} END,
        updated_at = NOW()
    WHERE id IN (${idPlaceholders})
      ${extraWhereClause}
  `, [...values, ...updates.map(u => u.id), ...extraWhereParams]);
}

/**
 * Increment a column for rows matching given conditions.
 *
 * Generates: UPDATE table SET "column" = "column" + 1 WHERE [whereClause]
 *
 * @param knex - Knex instance
 * @param tableName - Table to update
 * @param column - Column to increment
 * @param whereClause - WHERE conditions (without leading WHERE keyword)
 * @param whereParams - Parameters for the WHERE clause
 */
export async function incrementColumn(
  knex: Knex,
  tableName: string,
  column: string,
  whereClause: string,
  whereParams: (string | number)[]
): Promise<void> {
  await knex.raw(`
    UPDATE ${tableName}
    SET "${column}" = "${column}" + 1
    WHERE ${whereClause}
  `, [...whereParams]);
}
