/**
 * Local File Storage Service
 *
 * Replaces Supabase Storage with local filesystem operations.
 * Files are stored in UPLOAD_DIR (defaults to ./uploads).
 */

import 'server-only';

import fs from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Get the absolute path for a storage file.
 */
function getFilePath(storagePath: string): string {
  return path.join(UPLOAD_DIR, storagePath);
}

/**
 * Upload a file (Buffer or File) to local storage.
 * @param storagePath - Relative path within the uploads directory (e.g., "website/123-abc.webp")
 * @param data - File data as Buffer
 * @returns The storage path that was written to
 */
export async function uploadFile(
  storagePath: string,
  data: Buffer,
): Promise<string> {
  const filePath = getFilePath(storagePath);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, data);
  return storagePath;
}

/**
 * Read a file from local storage.
 * @param storagePath - Relative path within the uploads directory
 * @returns File contents as Buffer, or null if not found
 */
export async function readFile(storagePath: string): Promise<Buffer | null> {
  try {
    const filePath = getFilePath(storagePath);
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Delete a single file from local storage.
 * Best-effort: does not throw if file doesn't exist.
 */
export async function deleteFile(storagePath: string): Promise<boolean> {
  try {
    const filePath = getFilePath(storagePath);
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete multiple files from local storage.
 * Best-effort: logs errors but does not throw.
 * @returns Number of successfully deleted files
 */
export async function deleteFiles(storagePaths: string[]): Promise<number> {
  let deletedCount = 0;
  for (const storagePath of storagePaths) {
    const success = await deleteFile(storagePath);
    if (success) deletedCount++;
  }
  return deletedCount;
}

/**
 * Check if a file exists in local storage.
 */
export async function fileExists(storagePath: string): Promise<boolean> {
  try {
    const filePath = getFilePath(storagePath);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the public URL for an asset, given the asset's id and filename.
 * Uses the /a/{hash}/{name} proxy route pattern.
 */
export function getPublicUrl(storagePath: string): string {
  return `/uploads/${storagePath}`;
}

/**
 * Get the uploads directory path.
 */
export function getUploadDir(): string {
  return UPLOAD_DIR;
}

/**
 * Ensure the base upload directories exist.
 */
export async function initializeStorage(): Promise<void> {
  await ensureDir(path.join(UPLOAD_DIR, 'website'));
  await ensureDir(path.join(UPLOAD_DIR, 'fonts'));
  await ensureDir(path.join(UPLOAD_DIR, 'components'));
  await ensureDir(path.join(UPLOAD_DIR, 'avatars'));
}
