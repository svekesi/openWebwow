/**
 * Font Upload Utilities
 *
 * Handles uploading custom font files to local storage and creating font records.
 */

import { uploadFile, getPublicUrl } from '@/lib/local-storage';
import { createFont } from '@/lib/repositories/fontRepository';
import { STORAGE_FOLDERS } from '@/lib/asset-constants';
import { mapExtensionToFontFormat } from '@/lib/font-utils';
import type { Font } from '@/types';

/**
 * Upload a custom font file to storage and create a font record
 *
 * @param file - Font file (ttf, otf, woff, woff2)
 * @param fontName - Display name for the font
 * @returns Created font record or null if upload fails
 */
export async function uploadFontFile(
  file: File,
  fontName?: string,
): Promise<Font | null> {
  try {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const format = mapExtensionToFontFormat(extension);

    if (!format) {
      throw new Error(`Unsupported font format: ${extension}`);
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const storagePath = `${STORAGE_FOLDERS.FONTS}/${timestamp}-${random}.${extension}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await uploadFile(storagePath, buffer);
    const publicUrl = getPublicUrl(storagePath);

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const displayName = fontName || baseName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const slugName = displayName.toLowerCase().replace(/\s+/g, '-');

    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const font = await createFont({
      name: slugName,
      family: displayName,
      type: 'custom',
      variants: ['400'],
      weights: ['400'],
      category: '',
      kind: format,
      url: publicUrl,
      storage_path: storagePath,
      file_hash: fileHash,
    });

    return font;
  } catch (error) {
    console.error('Error in uploadFontFile:', error);
    return null;
  }
}
