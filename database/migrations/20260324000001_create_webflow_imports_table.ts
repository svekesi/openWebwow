import { Knex } from 'knex';

/**
 * Migration: Create webflow_imports table
 *
 * Tracks Webflow import jobs (ZIP + CSV payload), processing status,
 * warnings/errors, and final import stats.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('webflow_imports');
  if (!hasTable) {
    await knex.schema.createTable('webflow_imports', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('status', 50).notNullable().defaultTo('pending');
      table.jsonb('payload').notNullable(); // zip + csv inputs
      table.jsonb('warnings').nullable();
      table.jsonb('errors').nullable();
      table.jsonb('result').nullable(); // pages/collections/items/assets stats
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('status');
      table.index('created_at');
    });
  }

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('webflow_imports');
}
