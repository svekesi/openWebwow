/**
 * Shared configuration constants
 */

/**
 * Base URL for the Webwow external API service (templates, icons, etc.).
 *
 * Defaults to the public Ycode template service (Webwow is built on top of
 * the open-source Ycode builder and is fully API-compatible with it).
 * Override via `TEMPLATE_API_URL` in `.env` to point at a self-hosted
 * template service.
 */
export const WEBWOW_EXTERNAL_API_URL =
  process.env.TEMPLATE_API_URL || 'https://templates-virid.vercel.app';
