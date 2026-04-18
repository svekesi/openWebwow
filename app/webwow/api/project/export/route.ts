import { NextRequest, NextResponse } from 'next/server';
import {
  exportProject,
  packExport,
  getExportFilename,
  sanitizeProjectNameSlug,
} from '@/lib/services/projectService';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /webwow/api/project/export
 *
 * Export the project as a compressed .webwow dump file.
 * Optionally encrypt with a password (JSON body: { "password": "..." }).
 */
export async function POST(request: NextRequest) {
  try {
    let password: string | undefined;
    let projectName: string | undefined;
    try {
      const body = await request.json();
      password = body.password || undefined;
      projectName = body.projectName || undefined;
    } catch {
      // No body or invalid JSON — export with defaults
    }

    const result = await exportProject();

    if (!result.success || !result.export) {
      return NextResponse.json(
        { error: result.error || 'Export failed' },
        { status: 500 }
      );
    }

    if (projectName && projectName.trim()) {
      result.export.manifest.projectName = sanitizeProjectNameSlug(projectName.trim());
    }

    const fileBuffer = packExport(result.export, password);
    const filename = getExportFilename(result.export.manifest);

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[POST /webwow/api/project/export] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}
