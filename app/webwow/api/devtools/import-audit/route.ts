import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /webwow/api/devtools/import-audit?local=/artist&live=https://www.valeskavonbrase.com/artist
 *
 * Diagnostic helper that compares the rendered HTML of two URLs (a locally
 * imported page and the original live Webflow site). Returns a high-level
 * structural diff so it's quick to spot when the importer has dropped or
 * mangled a Webflow class on a specific page.
 *
 * Output:
 * {
 *   local: { url, status, classCount, distinctClasses, sampleStructureCounts },
 *   live:  { url, status, classCount, distinctClasses, sampleStructureCounts },
 *   diff: {
 *     classesOnlyInLive: string[],   // ← classes present on live but not local
 *     classesOnlyInLocal: string[],  // ← noise we synthesised that isn't on live
 *     sharedClasses: string[]
 *   }
 * }
 *
 * Auth: routes under /webwow/api/devtools should already be admin-protected
 * by the proxy/middleware; this endpoint is read-only and never exposes
 * secrets.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const localPath = url.searchParams.get('local') || '/';
  const liveUrl = url.searchParams.get('live') || '';

  if (!liveUrl) {
    return NextResponse.json(
      { error: "Missing 'live' query parameter (e.g. ?live=https://www.example.com/page)" },
      { status: 400 }
    );
  }

  const baseUrl = `${url.protocol}//${url.host}`;
  const localFullUrl = localPath.startsWith('http') ? localPath : `${baseUrl}${localPath}`;

  try {
    const [localStats, liveStats] = await Promise.all([
      fetchAndAnalyze(localFullUrl),
      fetchAndAnalyze(liveUrl),
    ]);

    const localSet = new Set(localStats.distinctClasses);
    const liveSet = new Set(liveStats.distinctClasses);

    const classesOnlyInLive = liveStats.distinctClasses.filter((c) => !localSet.has(c));
    const classesOnlyInLocal = localStats.distinctClasses.filter((c) => !liveSet.has(c));
    const sharedClasses = liveStats.distinctClasses.filter((c) => localSet.has(c));

    return NextResponse.json({
      local: localStats,
      live: liveStats,
      diff: {
        classesOnlyInLive: classesOnlyInLive.slice(0, 100),
        classesOnlyInLocal: classesOnlyInLocal.slice(0, 100),
        sharedClasses: sharedClasses.slice(0, 50),
        counts: {
          onlyInLive: classesOnlyInLive.length,
          onlyInLocal: classesOnlyInLocal.length,
          shared: sharedClasses.length,
        },
      },
    });
  } catch (error) {
    console.error('[import-audit] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Audit failed' },
      { status: 500 }
    );
  }
}

interface PageStats {
  url: string;
  status: number;
  bytes: number;
  classCount: number;
  distinctClasses: string[];
  sampleStructureCounts: Record<string, number>;
}

async function fetchAndAnalyze(targetUrl: string): Promise<PageStats> {
  const res = await fetch(targetUrl, {
    headers: { 'user-agent': 'WebwowAuditBot/1.0' },
  });
  const html = await res.text();

  const classRegex = /class\s*=\s*"([^"]+)"/g;
  const classCount = (html.match(classRegex) || []).length;
  const distinct = new Set<string>();
  for (const m of html.matchAll(classRegex)) {
    for (const cls of m[1].split(/\s+/)) {
      const trimmed = cls.trim();
      if (trimmed) distinct.add(trimmed);
    }
  }

  const sampleStructureCounts: Record<string, number> = {
    img: (html.match(/<img\b/g) || []).length,
    section: (html.match(/<section\b/g) || []).length,
    nav: (html.match(/<nav\b/g) || []).length,
    footer: (html.match(/<footer\b/g) || []).length,
    'w-richtext': (html.match(/w-richtext/g) || []).length,
    'w-dyn-list': (html.match(/w-dyn-list/g) || []).length,
    'w-dyn-item': (html.match(/w-dyn-item/g) || []).length,
    'w-slider': (html.match(/w-slider/g) || []).length,
    'w-form': (html.match(/w-form/g) || []).length,
    'w-row': (html.match(/\bw-row\b/g) || []).length,
    'w-col': (html.match(/\bw-col\b/g) || []).length,
    'w-layout-grid': (html.match(/w-layout-grid/g) || []).length,
    'data-w-id': (html.match(/data-w-id=/g) || []).length,
    'background-image-inline': (html.match(/background-image\s*:\s*url/g) || []).length,
  };

  return {
    url: targetUrl,
    status: res.status,
    bytes: html.length,
    classCount,
    distinctClasses: Array.from(distinct).sort(),
    sampleStructureCounts,
  };
}
