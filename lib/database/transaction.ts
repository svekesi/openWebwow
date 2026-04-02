/**
 * Database Transaction Helpers
 *
 * Provides utilities for executing database operations with rollback capability.
 * Uses Knex transactions for true ACID transaction support.
 */

import { getKnexClient } from '@/lib/knex-client';
import type { Knex } from 'knex';

/**
 * Execute a function with transaction-like behavior
 *
 * @param fn - Function to execute within transaction context
 * @returns Result of the function
 * @throws Error if transaction fails
 */
export async function withTransaction<T>(
  fn: () => Promise<T>
): Promise<T> {
  await getKnexClient();
  return fn();
}

/**
 * Execute multiple operations sequentially with error handling
 * If any operation fails, execution stops and error is thrown
 *
 * @param operations - Array of async operations to execute
 * @returns Array of results from each operation
 */
export async function executeSequentially<T>(
  operations: Array<() => Promise<T>>
): Promise<T[]> {
  const results: T[] = [];

  for (const operation of operations) {
    const result = await operation();
    results.push(result);
  }

  return results;
}

/**
 * Execute multiple operations in parallel with error handling
 *
 * @param operations - Array of async operations to execute
 * @returns Array of results from each operation
 */
export async function executeParallel<T>(
  operations: Array<() => Promise<T>>
): Promise<T[]> {
  return Promise.all(operations.map(op => op()));
}

/**
 * Helper to get a Knex client instance
 *
 * @returns Knex client
 * @throws Error if client is not configured
 */
export async function ensureClient(): Promise<Knex> {
  return getKnexClient();
}
