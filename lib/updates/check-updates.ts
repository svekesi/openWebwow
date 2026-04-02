/**
 * Check for Ycode updates from the official repository.
 * Extracted for reuse and to allow cloud overlay to return "no update" in hosted deployments.
 */

const UPSTREAM_REPO = 'ycode/ycode'; // Official Ycode repo

export interface CheckUpdatesResult {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string | null;
  publishedAt?: string | null;
  updateInstructions?: {
    method: 'github-sync' | 'git-pull' | 'manual';
    steps: string[];
    autoSyncUrl?: string;
  };
  message?: string;
  error?: string;
}

/**
 * Simple version comparison (semantic versioning)
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aNum = aParts[i] || 0;
    const bNum = bParts[i] || 0;

    if (aNum > bNum) return 1;
    if (aNum < bNum) return -1;
  }

  return 0;
}

/**
 * Check for updates from the official Ycode repository
 */
export async function checkForUpdates(currentVersion: string): Promise<CheckUpdatesResult> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Ycode-Update-Checker',
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      return {
        available: false,
        currentVersion,
        message: 'Unable to check for updates',
      };
    }

    const release = await response.json();
    const latestVersion = release.tag_name?.replace(/^v/, '') || '1.0.0';

    const hasUpdate =
      latestVersion !== currentVersion &&
      compareVersions(latestVersion, currentVersion) > 0;

    const updateMethod: 'github-sync' | 'git-pull' | 'manual' = 'github-sync';
    const autoSyncUrl = `https://github.com/${UPSTREAM_REPO}`;
    const steps = [
      'Go to your forked GitHub repository',
      'Click the <span class="!font-semibold">"Sync fork"</span> button',
      'Click <span class="!font-semibold">"Update branch"</span>',
      'Your deployment will automatically redeploy with the latest changes',
      'Please reload builder after deployment to apply the latest migrations',
    ];

    return {
      available: hasUpdate,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      releaseNotes: release.body,
      publishedAt: release.published_at,
      updateInstructions: {
        method: updateMethod,
        steps,
        autoSyncUrl,
      },
    };
  } catch (error) {
    console.error('Failed to check for updates:', error);
    return {
      available: false,
      currentVersion,
      error: 'Failed to check for updates',
    };
  }
}
