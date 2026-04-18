import packageJson from '../../../../../package.json';
import { noCache } from '@/lib/api-response';
import { checkForUpdates } from '@/lib/updates/check-updates';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /webwow/api/updates/check
 *
 * Check for updates from the official Webwow repository
 */
export async function GET() {
  const result = await checkForUpdates(packageJson.version);
  return noCache(result);
}
