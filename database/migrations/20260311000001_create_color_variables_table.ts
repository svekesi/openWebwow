import type { Knex } from 'knex';

/**
 * Migration: Create Color Variables Table
 *
 * Stores site-wide color variables (design tokens) that can be referenced
 * in any color property via CSS custom properties: color:var(--{id}).
 */

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('color_variables');
  if (!exists) {
    await knex.schema.createTable('color_variables', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.string('name', 255).notNullable();
      table.string('value', 50).notNullable();
      table.integer('sort_order').defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });

  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('color_variables');
}
