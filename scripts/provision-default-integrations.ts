import knex from 'knex';
import { createHash, randomBytes } from 'crypto';

type DefaultWebhook = {
  name: string;
  event: string;
  suffix: string;
};

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

function normalizeBase(url: string): string {
  return String(url || '').replace(/\/+$/, '');
}

async function ensureDefaultApiKey(db: ReturnType<typeof knex>): Promise<void> {
  const envApiKey = (process.env.WEBWOW_API_KEY || '').trim();
  if (!envApiKey) {
    console.log('WEBWOW_API_KEY not set, skipping default API key provisioning.');
    return;
  }

  const keyHash = hashApiKey(envApiKey);
  const keyPrefix = envApiKey.slice(0, 8);
  const defaultName = 'n8n-default-api-key';
  const now = new Date().toISOString();

  const existingByHash = await db('api_keys').where('key_hash', keyHash).first();
  if (existingByHash) {
    console.log(`API key hash already present (${existingByHash.name}).`);
    return;
  }

  const existingByName = await db('api_keys').where('name', defaultName).first();
  if (existingByName) {
    await db('api_keys')
      .where('id', existingByName.id)
      .update({
        key_hash: keyHash,
        key_prefix: keyPrefix,
        updated_at: now,
      });
    console.log(`Updated default API key entry: ${defaultName}`);
    return;
  }

  await db('api_keys').insert({
    name: defaultName,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    created_at: now,
    updated_at: now,
  });
  console.log(`Created default API key entry: ${defaultName}`);
}

async function ensureDefaultWebhooks(db: ReturnType<typeof knex>): Promise<void> {
  const shouldProvision = String(process.env.WEBWOW_AUTO_PROVISION_WEBHOOKS || 'true') === 'true';
  if (!shouldProvision) {
    console.log('WEBWOW_AUTO_PROVISION_WEBHOOKS=false, skipping webhook provisioning.');
    return;
  }

  const webhookBase = normalizeBase(process.env.WEBWOW_N8N_WEBHOOK_BASE_URL || 'http://n8n:5678/webhook');
  const now = new Date().toISOString();

  const defaults: DefaultWebhook[] = [
    { name: 'n8n-default-form-submitted', event: 'form.submitted', suffix: 'webwow_form_submitted' },
    { name: 'n8n-default-site-published', event: 'site.published', suffix: 'webwow_site_published' },
    { name: 'n8n-default-collection-item-created', event: 'collection_item.created', suffix: 'webwow_collection_item_created' },
    { name: 'n8n-default-collection-item-updated', event: 'collection_item.updated', suffix: 'webwow_collection_item_updated' },
    { name: 'n8n-default-collection-item-deleted', event: 'collection_item.deleted', suffix: 'webwow_collection_item_deleted' },
  ];

  for (const webhook of defaults) {
    const existing = await db('webhooks').where('name', webhook.name).first();
    const url = `${webhookBase}/${webhook.suffix}`;

    if (existing) {
      await db('webhooks')
        .where('id', existing.id)
        .update({
          url,
          events: JSON.stringify([webhook.event]),
          filters: null,
          enabled: true,
          updated_at: now,
        });
      console.log(`Updated default webhook: ${webhook.name}`);
      continue;
    }

    await db('webhooks').insert({
      name: webhook.name,
      url,
      secret: randomBytes(32).toString('hex'),
      events: JSON.stringify([webhook.event]),
      filters: null,
      enabled: true,
      failure_count: 0,
      created_at: now,
      updated_at: now,
    });
    console.log(`Created default webhook: ${webhook.name}`);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('DATABASE_URL is missing, skipping provisioning.');
    return;
  }

  const db = knex({
    client: 'pg',
    connection: databaseUrl,
    pool: { min: 0, max: 5 },
  });

  try {
    await ensureDefaultApiKey(db);
    await ensureDefaultWebhooks(db);
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => {
    console.log('Webwow default integrations provisioned.');
  })
  .catch((error) => {
    console.error('Webwow default integrations provisioning failed:', error);
    process.exit(1);
  });
