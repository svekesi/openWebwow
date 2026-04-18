import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { createWebflowImport } from '@/lib/repositories/webflowImportRepository';
import type { WebflowCsvFile, WebflowImportPayload } from '@/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let payload: WebflowImportPayload;

    if (contentType.includes('application/json')) {
      const body = await request.json();
      if (!body?.zipBase64 || !body?.zipFilename) {
        return noCache({ error: 'Invalid JSON payload: zipFilename and zipBase64 are required' }, 400);
      }

      const csvFiles: WebflowCsvFile[] = Array.isArray(body.csvFiles)
        ? (body.csvFiles as unknown[]).filter((csvFile): csvFile is WebflowCsvFile => (
          typeof (csvFile as Record<string, unknown>)?.filename === 'string'
          && typeof (csvFile as Record<string, unknown>)?.content === 'string'
        ))
        : [];

      payload = {
        zipFilename: String(body.zipFilename),
        zipBase64: String(body.zipBase64),
        csvFiles,
      };
    } else {
      const formData = await request.formData();
      const zipFile = formData.get('webflowZip');
      const csvFilesRaw = formData.getAll('csvFiles');

      if (!zipFile || !(zipFile instanceof Blob)) {
        return noCache({ error: 'webflowZip is required' }, 400);
      }

      const zipFilename = zipFile instanceof File ? zipFile.name : 'webflow-export.zip';
      const zipBuffer = Buffer.from(await zipFile.arrayBuffer());

      const csvFiles: WebflowCsvFile[] = [];
      for (const csvFile of csvFilesRaw) {
        if (!(csvFile instanceof Blob)) continue;
        const filename = csvFile instanceof File ? csvFile.name : `collection-${csvFiles.length + 1}.csv`;
        const content = await csvFile.text();
        csvFiles.push({ filename, content });
      }

      payload = {
        zipFilename,
        zipBase64: zipBuffer.toString('base64'),
        csvFiles,
      };
    }

    const importJob = await createWebflowImport({ payload });

    return noCache({
      data: {
        importId: importJob.id,
      },
    }, 201);
  } catch (error) {
    console.error('[POST /webwow/api/webflow/import] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create Webflow import job' },
      500
    );
  }
}
