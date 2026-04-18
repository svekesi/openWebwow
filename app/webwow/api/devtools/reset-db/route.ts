import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getKnexClient } from '@/lib/knex-client';
import { deleteFiles } from '@/lib/local-storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /webwow/api/devtools/reset-db
 *
 * DANGEROUS: Deletes all tables in the public schema and empties storage buckets.
 * Authentication enforced by proxy.
 */
export async function POST() {
  try {
    console.log('[POST /webwow/api/devtools/reset-db] Starting database reset...');

    const knex = await getKnexClient();

    const tables = await knex.raw(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);

    console.log('[POST /webwow/api/devtools/reset-db] Found ' + tables.rows.length + ' tables');

    try {
      const assetRows = await knex('assets').select('storage_path').whereNotNull('storage_path');
      const paths = assetRows.map((r: any) => r.storage_path).filter(Boolean);
      if (paths.length > 0) {
        await deleteFiles(paths);
        console.log(`[POST /webwow/api/devtools/reset-db] Deleted ${paths.length} storage files`);
      }
    } catch (storageError) {
      console.log('[POST /webwow/api/devtools/reset-db] Storage cleanup error:', storageError);
    }

    await knex.raw(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
        LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    console.log('[POST /webwow/api/devtools/reset-db] All tables dropped successfully');

    revalidatePath('/', 'layout');
    console.log('[POST /webwow/api/devtools/reset-db] Cache invalidated');

    return NextResponse.json({
      data: { message: 'All public tables and storage buckets have been deleted' }
    });
  } catch (error) {
    console.error('[POST /webwow/api/devtools/reset-db] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reset database' },
      { status: 500 }
    );
  }
}
