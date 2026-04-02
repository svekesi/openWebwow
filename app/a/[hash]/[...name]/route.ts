/**
 * Asset Proxy Route
 *
 * Serves assets with SEO-friendly URLs from local storage.
 * URL format: /a/{base62-hash}/{seo-friendly-name}.{ext}
 *
 * The hash is a base62-encoded UUID used for lookup.
 * The name segment is cosmetic (for SEO) and derived from the asset's filename.
 * If the name doesn't match the current filename, a 301 redirect is issued.
 *
 * Supports image resizing via query params (width, height, quality) using sharp.
 * Responses are cached with immutable headers so sharp only runs once per unique URL.
 */

import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { base62ToUuid } from '@/lib/convertion-utils';
import { getAssetProxyUrl, isAssetOfType, ASSET_CATEGORIES } from '@/lib/asset-utils';
import { getAssetForProxy } from '@/lib/repositories/assetRepository';
import { readFile } from '@/lib/local-storage';

function parseTransformParams(searchParams: URLSearchParams) {
  const width = parseInt(searchParams.get('width') || '');
  const height = parseInt(searchParams.get('height') || '');
  const quality = parseInt(searchParams.get('quality') || '');

  const hasParams = width > 0 || height > 0 || quality > 0;
  if (!hasParams) return null;

  return {
    width: width > 0 ? width : undefined,
    height: height > 0 ? height : undefined,
    quality: quality > 0 ? Math.min(quality, 100) : 80,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string; name: string[] }> }
) {
  try {
    const { hash, name } = await params;

    let assetId: string;
    try {
      assetId = base62ToUuid(hash);
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const asset = await getAssetForProxy(assetId);
    if (!asset?.storage_path) {
      return new Response('Not found', { status: 404 });
    }

    const canonicalPath = getAssetProxyUrl(asset);
    if (canonicalPath) {
      const requestedName = name.join('/');
      const canonicalName = canonicalPath.split('/').slice(3).join('/');
      if (requestedName !== canonicalName) {
        const url = new URL(request.url);
        const redirectUrl = new URL(canonicalPath, url.origin);
        redirectUrl.search = url.search;
        return Response.redirect(redirectUrl.toString(), 301);
      }
    }

    const fileBuffer = await readFile(asset.storage_path);
    if (!fileBuffer) {
      return new Response('Not found', { status: 404 });
    }

    const url = new URL(request.url);
    const transform = parseTransformParams(url.searchParams);
    const canResize = transform && isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES);

    if (canResize) {
      let pipeline = sharp(fileBuffer);

      if (transform.width || transform.height) {
        pipeline = pipeline.resize(transform.width, transform.height, {
          fit: 'cover',
          withoutEnlargement: true,
        });
      }

      pipeline = pipeline.webp({ quality: transform.quality });

      const resized = await pipeline.toBuffer();

      return new Response(new Uint8Array(resized), {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': resized.length.toString(),
        },
      });
    }

    return new Response(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': asset.mime_type || 'application/octet-stream',
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch {
    return new Response('Internal server error', { status: 500 });
  }
}
