import type { Knex } from 'knex';

/**
 * Migration: Create form_submissions table
 *
 * Stores form submissions from published websites.
 * Uses a simple structure with JSONB payload for flexible field storage.
 * form_id references the layer.settings.id of the form element.
 */

export async function up(knex: Knex): Promise<void> {
  // Create form_submissions table
  await knex.schema.createTable('form_submissions', (table) => {
    table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).primary();

    // Form identifier (from layer.settings.id)
    table.string('form_id', 255).notNullable();

    // Form data as JSON
    table.jsonb('payload').notNullable().defaultTo('{}');

    // Request metadata (IP, user agent, referrer, page URL)
    table.jsonb('metadata').nullable();

    // Submission status
    table.string('status', 50).notNullable().defaultTo('new');

    // Timestamps
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Create indexes for efficient queries
  await knex.schema.raw(`
    CREATE INDEX idx_form_submissions_form_id
    ON form_submissions(form_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_form_submissions_form_id_created
    ON form_submissions(form_id, created_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_form_submissions_status
    ON form_submissions(status)
  `);

}

export async function down(knex: Knex): Promise<void> {
  // Drop table
  await knex.schema.dropTableIfExists('form_submissions');
}
