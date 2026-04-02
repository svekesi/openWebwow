/**
 * Thumbnail upload utility for component previews
 * Converts image buffers to WebP and saves to local storage
 */

import { uploadFile, deleteFile, getPublicUrl } from '@/lib/local-storage';
import { STORAGE_FOLDERS } from '@/lib/asset-constants';
import sharp from 'sharp';

/**
 * Convert an image buffer to WebP format
 * @param imageBuffer - Raw image buffer (PNG, JPEG, etc.)
 * @param quality - WebP quality 0-100
 * @returns WebP buffer
 */
export async function convertToWebP(imageBuffer: Buffer, quality: number = 85): Promise<Buffer> {
  return sharp(imageBuffer)
    .webp({ quality })
    .toBuffer();
}

/**
 * Upload a component thumbnail to local storage as WebP
 * Replaces existing thumbnail if present (overwrites)
 * @param componentId - Component ID used as filename
 * @param imageBuffer - Raw image buffer (PNG from html-to-image)
 * @returns Public URL of the uploaded thumbnail
 */
export async function uploadThumbnail(componentId: string, imageBuffer: Buffer): Promise<string> {
  const webpBuffer = await convertToWebP(imageBuffer);
  const storagePath = `${STORAGE_FOLDERS.COMPONENTS}/${componentId}.webp`;

  await uploadFile(storagePath, webpBuffer);
  return getPublicUrl(storagePath);
}

/**
 * Delete a component thumbnail from local storage
 * @param componentId - Component ID used as filename
 */
export async function deleteThumbnail(componentId: string): Promise<void> {
  const storagePath = `${STORAGE_FOLDERS.COMPONENTS}/${componentId}.webp`;
  await deleteFile(storagePath);
}
