import { Knex } from 'knex';

/**
 * Migration: Create collection_imports table
 *
 * Tracks CSV import jobs for collections, enabling background processing
 * that can continue even if the browser is closed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('collection_imports', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('collection_id').notNullable();
    table.string('status', 50).notNullable().defaultTo('pending'); // pending, processing, completed, failed
    table.integer('total_rows').notNullable().defaultTo(0);
    table.integer('processed_rows').notNullable().defaultTo(0);
    table.integer('failed_rows').notNullable().defaultTo(0);
    table.jsonb('column_mapping').notNullable(); // { csvColumn: fieldId }
    table.jsonb('csv_data').notNullable(); // Parsed CSV rows
    table.jsonb('errors').nullable(); // Array of error messages
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    // Indexes
    table.index('collection_id');
    table.index('status');
  });

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('collection_imports');
}
