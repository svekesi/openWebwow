/**
 * File upload utilities for local storage
 * Creates Asset records in database for uploaded files
 */

import { uploadFile as uploadToStorage, getPublicUrl } from '@/lib/local-storage';
import { createAsset } from '@/lib/repositories/assetRepository';
import { isAssetOfType } from './asset-utils';
import { ASSET_CATEGORIES, STORAGE_FOLDERS } from '@/lib/asset-constants';
import sharp from 'sharp';
import type { Asset } from '@/types';

/**
 * Validate SVG content
 * @param content - SVG content to validate
 * @returns true if valid, false otherwise
 */
export function isValidSvg(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return false;
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const svgTagRegex = /<svg[\s>]/i;
  if (!svgTagRegex.test(trimmed)) {
    return false;
  }

  const hasClosingTag = /<\/svg>/i.test(trimmed);
  const hasSelfClosing = /<svg[^>]*\/>/i.test(trimmed);

  if (!hasClosingTag && !hasSelfClosing) {
    return false;
  }

  const svgMatch = trimmed.match(/<svg[\s>][\s\S]*<\/svg>/i);
  if (!svgMatch) {
    return false;
  }

  return true;
}

/**
 * Clean SVG content by removing potentially dangerous elements, attributes, and comments
 * @param svgContent - Raw SVG string
 * @returns Cleaned SVG string without classes, IDs, comments, or fixed dimensions (preserves inline styles)
 */
export function cleanSvgContent(svgContent: string): string {
  let cleaned = svgContent
    .replace(/<\?xml[^?]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');

  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  cleaned = cleaned
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');

  const dangerousTags = ['script', 'iframe', 'embed', 'object', 'link', 'style'];
  dangerousTags.forEach(tag => {
    const regex = new RegExp(`<${tag}\\b[^<]*(?:(?!<\\/${tag}>)<[^<]*)*<\\/${tag}>`, 'gi');
    cleaned = cleaned.replace(regex, '');
  });

  cleaned = cleaned
    .replace(/(<svg[^>]*)\s+width\s*=\s*["'][^"']*["']/gi, '$1')
    .replace(/(<svg[^>]*)\s+height\s*=\s*["'][^"']*["']/gi, '$1');

  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><');

  return cleaned.trim();
}

/**
 * Extract image dimensions from file buffer using sharp
 */
async function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    if (!isAssetOfType(file.type, ASSET_CATEGORIES.IMAGES)) {
      return null;
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const metadata = await sharp(buffer).metadata();

    if (metadata.width && metadata.height) {
      return {
        width: metadata.width,
        height: metadata.height,
      };
    }

    return null;
  } catch (error) {
    console.error('Error extracting image dimensions:', error);
    return null;
  }
}

/**
 * Convert image to WebP format using sharp
 */
async function convertImageToWebP(file: File): Promise<{
  buffer: Buffer;
  mimeType: string;
  fileExtension: string;
  width: number;
  height: number;
} | null> {
  try {
    if (!isAssetOfType(file.type, ASSET_CATEGORIES.IMAGES) ||
        file.type === 'image/svg+xml' ||
        file.type === 'image/gif') {
      return null;
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const webpBuffer = await sharp(buffer)
      .webp({ quality: 85 })
      .toBuffer();

    const metadata = await sharp(webpBuffer).metadata();

    return {
      buffer: webpBuffer,
      mimeType: 'image/webp',
      fileExtension: 'webp',
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  } catch (error) {
    console.error('Error converting image to WebP:', error);
    return null;
  }
}

/**
 * Upload a file to local storage and create Asset record
 * Automatically converts raster images to WebP format for better performance
 *
 * @param file - File to upload
 * @param source - Source identifier (e.g., 'library', 'page-settings', 'components')
 * @param customName - Optional custom name for the file
 * @param assetFolderId - Optional asset folder ID to organize the asset
 * @returns Asset with metadata or null if upload fails
 */
export async function uploadFile(
  file: File,
  source: string,
  customName?: string,
  assetFolderId?: string | null
): Promise<Asset | null> {
  try {
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const filename = customName || baseName || file.name;

    if (file.type === 'image/svg+xml') {
      const svgText = await file.text();
      const cleanedContent = cleanSvgContent(svgText);

      let dimensions: { width: number; height: number } | null = null;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const metadata = await sharp(buffer).metadata();
        if (metadata.width && metadata.height) {
          dimensions = {
            width: metadata.width,
            height: metadata.height,
          };
        }
      } catch {
        // SVG dimension extraction is best-effort
      }

      const asset = await createAsset({
        filename,
        storage_path: null,
        public_url: null,
        file_size: cleanedContent.length,
        mime_type: 'image/svg+xml',
        width: dimensions?.width,
        height: dimensions?.height,
        source,
        asset_folder_id: assetFolderId,
        content: cleanedContent,
      });

      return asset;
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);

    const webpConversion = await convertImageToWebP(file);

    let fileBuffer: Buffer;
    let fileExtension: string;
    let mimeType: string;
    let fileSize: number;
    let dimensions: { width: number; height: number } | null = null;

    if (webpConversion) {
      fileBuffer = webpConversion.buffer;
      fileExtension = webpConversion.fileExtension;
      mimeType = webpConversion.mimeType;
      fileSize = webpConversion.buffer.length;
      dimensions = {
        width: webpConversion.width,
        height: webpConversion.height,
      };
    } else {
      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      fileExtension = file.name.split('.').pop() || '';
      mimeType = file.type;
      fileSize = file.size;
      dimensions = await getImageDimensions(file);
    }

    const storagePath = `${STORAGE_FOLDERS.WEBSITE}/${timestamp}-${random}.${fileExtension}`;

    await uploadToStorage(storagePath, fileBuffer);

    const publicUrl = getPublicUrl(storagePath);

    const asset = await createAsset({
      filename,
      storage_path: storagePath,
      public_url: publicUrl,
      file_size: fileSize,
      mime_type: mimeType,
      width: dimensions?.width,
      height: dimensions?.height,
      source,
      asset_folder_id: assetFolderId,
    });

    return asset;
  } catch (error) {
    console.error('Error in uploadFile:', error);
    return null;
  }
}

/**
 * Delete an asset (from both storage and database)
 * @deprecated Use deleteAsset from '@/lib/repositories/assetRepository' instead.
 *
 * @param assetId - Asset ID to delete
 * @returns True if successful, false otherwise
 */
export async function deleteAsset(assetId: string): Promise<boolean> {
  try {
    const { getKnexClient } = await import('@/lib/knex-client');
    const { deleteFile } = await import('@/lib/local-storage');
    const db = await getKnexClient();

    const asset = await db('assets')
      .select('storage_path')
      .where('id', assetId)
      .first();

    if (!asset) {
      console.error('Asset not found:', assetId);
      return false;
    }

    if (asset.storage_path) {
      await deleteFile(asset.storage_path);
    }

    await db('assets').where('id', assetId).delete();

    return true;
  } catch (error) {
    console.error('Error in deleteAsset:', error);
    return false;
  }
}
