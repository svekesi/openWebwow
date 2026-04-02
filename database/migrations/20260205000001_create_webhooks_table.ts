import type { Knex } from 'knex';

/**
 * Migration: Create Webhooks Tables
 *
 * Creates the webhooks table for managing webhook subscriptions
 * and webhook_deliveries table for logging delivery attempts.
 */

export async function up(knex: Knex): Promise<void> {
  // Drop existing tables if they exist (to handle schema changes during development)
  const hasWebhookDeliveries = await knex.schema.hasTable('webhook_deliveries');
  if (hasWebhookDeliveries) {
    await knex.schema.dropTable('webhook_deliveries');
  }

  const hasWebhooks = await knex.schema.hasTable('webhooks');
  if (hasWebhooks) {
    await knex.schema.dropTable('webhooks');
  }

  // Create webhooks table
  await knex.schema.createTable('webhooks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 255).notNullable();
    table.string('url', 2048).notNullable();
    table.string('secret', 64).nullable(); // HMAC signing secret
    table.jsonb('events').notNullable().defaultTo('[]'); // Array of event types
    table.jsonb('filters').nullable().defaultTo(null); // Optional resource filters (e.g., { form_id, collection_id })
    table.boolean('enabled').defaultTo(true);
    table.timestamp('last_triggered_at', { useTz: true }).nullable();
    table.integer('failure_count').defaultTo(0);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Create webhook_deliveries table for logging
  await knex.schema.createTable('webhook_deliveries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('webhook_id').notNullable().references('id').inTable('webhooks').onDelete('CASCADE');
    table.string('event_type', 100).notNullable();
    table.jsonb('payload').notNullable();
    table.integer('response_status').nullable();
    table.text('response_body').nullable();
    table.string('status', 20).notNullable().defaultTo('pending'); // pending, success, failed
    table.integer('attempts').defaultTo(1);
    table.integer('duration_ms').nullable(); // Request duration in milliseconds
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Create index for faster webhook delivery lookups
  await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id)');
  await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at DESC)');

}

export async function down(knex: Knex): Promise<void> {
  // Drop tables (webhook_deliveries first due to foreign key)
  await knex.schema.dropTableIfExists('webhook_deliveries');
  await knex.schema.dropTableIfExists('webhooks');
}
