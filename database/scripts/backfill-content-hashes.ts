/**
 * Backfill Content Hashes Script
 * 
 * This script calculates and stores content_hash for all existing entities:
 * - Pages (metadata hash)
 * - PageLayers (layers + CSS hash)
 * - Components (name + layers hash)
 * - LayerStyles (name + classes + design hash)
 * - Assets (all mutable fields hash)
 * - CollectionItems (EAV values hash)
 * 
 * Run this after the content_hash migrations have been applied.
 * 
 * Usage: npx tsx database/scripts/backfill-content-hashes.ts
 */

import knex, { Knex } from 'knex';
import knexfileConfig from '../../knexfile';
import {
  generatePageMetadataHash,
  generatePageLayersHash,
  generateComponentContentHash,
  generateLayerStyleContentHash,
  generateAssetContentHash,
} from '../../lib/hash-utils';
import { generateCollectionItemContentHash } from '../../lib/hash-utils';

const PAGE_SIZE = 1000;

/** Create Knex client from knexfile config */
async function getDbClient(): Promise<Knex> {
  const environment = process.env.NODE_ENV || 'development';
  const config = knexfileConfig[environment];
  if (!config) {
    throw new Error(`No knex configuration found for environment: ${environment}`);
  }
  return knex(config);
}

/**
 * Fetch all rows matching a query using pagination.
 */
async function fetchAllPaginated(
  client: Knex,
  table: string,
  applyFilters: (query: Knex.QueryBuilder) => Knex.QueryBuilder,
): Promise<any[]> {
  const allRows: any[] = [];
  let offset = 0;

  while (true) {
    const baseQuery = client(table).select('*');
    const data = await applyFilters(baseQuery)
      .limit(PAGE_SIZE)
      .offset(offset);

    if (!data || data.length === 0) break;

    allRows.push(...data);

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

async function backfillPageHashes(client: Knex) {
  console.log('Backfilling page content hashes...');

  const pages = await fetchAllPaginated(client, 'pages', (q) =>
    q.whereNull('deleted_at').whereNull('content_hash')
  );

  if (pages.length === 0) {
    console.log('  No pages need backfilling');
    return;
  }

  let updated = 0;

  for (const page of pages) {
    try {
      const hash = generatePageMetadataHash({
        name: page.name,
        slug: page.slug,
        settings: page.settings || {},
        is_index: page.is_index || false,
        is_dynamic: page.is_dynamic || false,
        error_page: page.error_page || null,
      });

      await client('pages').where('id', page.id).update({ content_hash: hash });
      updated++;
    } catch (error) {
      console.error(`  Error processing page ${page.id}:`, error);
    }
  }

  console.log(`  Updated ${updated} of ${pages.length} pages`);
}

async function backfillPageLayersHashes(client: Knex) {
  console.log('Backfilling page_layers content hashes...');

  const pageLayersRecords = await fetchAllPaginated(client, 'page_layers', (q) =>
    q.whereNull('deleted_at').whereNull('content_hash')
  );

  if (pageLayersRecords.length === 0) {
    console.log('  No page_layers need backfilling');
    return;
  }

  let updated = 0;

  for (const record of pageLayersRecords) {
    try {
      const hash = generatePageLayersHash({
        layers: record.layers || [],
        generated_css: record.generated_css || null,
      });

      await client('page_layers').where('id', record.id).update({ content_hash: hash });
      updated++;
    } catch (error) {
      console.error(`  Error processing page_layers ${record.id}:`, error);
    }
  }

  console.log(`  Updated ${updated} of ${pageLayersRecords.length} page_layers records`);
}

async function backfillComponentHashes(client: Knex) {
  console.log('Backfilling component content hashes...');

  const components = await fetchAllPaginated(client, 'components', (q) =>
    q.whereNull('content_hash')
  );

  if (components.length === 0) {
    console.log('  No components need backfilling');
    return;
  }

  let updated = 0;

  for (const component of components) {
    try {
      const hash = generateComponentContentHash({
        name: component.name,
        layers: component.layers || [],
      });

      await client('components').where('id', component.id).update({ content_hash: hash });
      updated++;
    } catch (error) {
      console.error(`  Error processing component ${component.id}:`, error);
    }
  }

  console.log(`  Updated ${updated} of ${components.length} components`);
}

async function backfillLayerStyleHashes(client: Knex) {
  console.log('Backfilling layer_styles content hashes...');

  const styles = await fetchAllPaginated(client, 'layer_styles', (q) =>
    q.whereNull('content_hash')
  );

  if (styles.length === 0) {
    console.log('  No layer_styles need backfilling');
    return;
  }

  let updated = 0;

  for (const style of styles) {
    try {
      const hash = generateLayerStyleContentHash({
        name: style.name,
        classes: style.classes || '',
        design: style.design || {},
      });

      await client('layer_styles').where('id', style.id).update({ content_hash: hash });
      updated++;
    } catch (error) {
      console.error(`  Error processing layer_style ${style.id}:`, error);
    }
  }

  console.log(`  Updated ${updated} of ${styles.length} layer_styles`);
}

async function backfillAssetHashes(client: Knex) {
  console.log('Backfilling asset content hashes...');

  const assets = await fetchAllPaginated(client, 'assets', (q) =>
    q.whereNull('content_hash').whereNull('deleted_at')
  );

  if (assets.length === 0) {
    console.log('  No assets need backfilling');
    return;
  }

  let updated = 0;

  for (const asset of assets) {
    try {
      const hash = generateAssetContentHash({
        filename: asset.filename,
        storage_path: asset.storage_path,
        public_url: asset.public_url,
        file_size: asset.file_size,
        mime_type: asset.mime_type,
        width: asset.width,
        height: asset.height,
        asset_folder_id: asset.asset_folder_id,
        content: asset.content,
        source: asset.source,
      });

      await client('assets').where('id', asset.id).where('is_published', asset.is_published).update({ content_hash: hash });
      updated++;
    } catch (error) {
      console.error(`  Error processing asset ${asset.id}:`, error);
    }
  }

  console.log(`  Updated ${updated} of ${assets.length} assets`);
}

async function backfillCollectionItemHashes(client: Knex) {
  console.log('Backfilling collection_items content hashes...');

  const items = await fetchAllPaginated(client, 'collection_items', (q) =>
    q.whereNull('deleted_at').whereNull('content_hash')
  );

  if (items.length === 0) {
    console.log('  No collection items need backfilling');
    return;
  }

  // Batch-fetch all values for these items
  const itemIds = items.map((item: any) => item.id);

  const allValues = await client('collection_item_values')
    .select('item_id', 'field_id', 'value', 'is_published')
    .whereIn('item_id', itemIds)
    .whereNull('deleted_at');

  // Group values by (item_id, is_published)
  const valuesMap = new Map<string, Array<{ field_id: string; value: string | null }>>();
  for (const row of allValues) {
    const key = `${row.item_id}:${row.is_published}`;
    if (!valuesMap.has(key)) valuesMap.set(key, []);
    valuesMap.get(key)!.push({ field_id: row.field_id, value: row.value });
  }

  let updated = 0;
  for (const item of items) {
    try {
      const key = `${item.id}:${item.is_published}`;
      const values = valuesMap.get(key) || [];
      const hash = generateCollectionItemContentHash(values);

      await client('collection_items').where('id', item.id).where('is_published', item.is_published).update({ content_hash: hash });
      updated++;
    } catch (error) {
      console.error(`  Error processing collection_item ${item.id}:`, error);
    }
  }

  console.log(`  Updated ${updated} of ${items.length} collection items`);
}

async function main() {
  console.log('Starting content hash backfill...\n');

  try {
    const client = await getDbClient();

    await backfillPageHashes(client);
    await backfillPageLayersHashes(client);
    await backfillComponentHashes(client);
    await backfillLayerStyleHashes(client);
    await backfillAssetHashes(client);
    await backfillCollectionItemHashes(client);

    console.log('\n✅ Content hash backfill completed successfully');
  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  }
}

// Run the script
main();
