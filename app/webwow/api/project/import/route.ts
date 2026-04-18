import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { importProject, unpackImport } from '@/lib/services/projectService';
import { clearAllCache } from '@/lib/services/cacheService';
import { ToastError } from '@/lib/toast-error';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /webwow/api/project/import
 *
 * Import a project dump (.webwow file).
 * Accepts multipart form-data with:
 *   - "file" (required): the .webwow file
 *   - "password" (optional): decryption password if the file is encrypted
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const password = formData.get('password');

    if (!file || !(file instanceof Blob)) {
      return noCache({ error: 'No file provided. Upload a .webwow file as form-data with field name "file".' }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const passwordStr = typeof password === 'string' && password ? password : undefined;

    let parsed;
    try {
      parsed = unpackImport(buffer, passwordStr);
    } catch (err) {
      if (err instanceof ToastError) {
        return noCache({ errorTitle: err.title, error: err.description }, 400);
      }
      return noCache({ error: err instanceof Error ? err.message : 'Invalid .webwow file.' }, 400);
    }

    const result = await importProject(parsed.manifest, parsed.data, parsed.files);

    if (!result.success) {
      return noCache({ error: result.error }, 500);
    }

    await clearAllCache();

    return noCache({
      success: true,
      message: 'Project imported successfully',
      stats: result.stats,
    });
  } catch (error) {
    console.error('[POST /webwow/api/project/import] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Import failed' },
      500
    );
  }
}
