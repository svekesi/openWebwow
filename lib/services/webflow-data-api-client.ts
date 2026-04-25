/**
 * Webflow Data API Client
 *
 * Thin server-side wrapper around the Webflow REST API
 * (https://developers.webflow.com/data/reference/rest-introduction).
 *
 * The client is intentionally read-only and request-scoped — it never
 * persists the user's API token, never logs it, and never returns it in
 * responses. The token lives in memory only for the duration of a single
 * import run.
 *
 * Why we have this:
 *   The static Webflow ZIP export is the source of truth for layout, CSS
 *   and the runtime JS. But it produces ugly CSV serialisations for
 *   collection items (semicolon-joined image lists, type-erased reference
 *   IDs, badly-escaped rich-text). The Data API gives us the canonical
 *   typed JSON for the same data — `MultiImage`, `MultiReference`,
 *   `RichText` etc. as proper structures.
 *
 * Auth scope expected: `cms:read`, `pages:read`, `assets:read`, `sites:read`
 * (the default scope of any "Read CMS" Webflow App token).
 */

const WEBFLOW_API_BASE = 'https://api.webflow.com/v2';

export class WebflowApiError extends Error {
  constructor(
    public status: number,
    public endpoint: string,
    public body: unknown
  ) {
    super(`Webflow API ${status} ${endpoint}`);
    this.name = 'WebflowApiError';
  }
}

export interface WebflowApiClient {
  getSite(): Promise<WebflowSite>;
  listCollections(): Promise<WebflowCollectionSummary[]>;
  getCollection(collectionId: string): Promise<WebflowCollection>;
  listItems(collectionId: string, opts?: { limit?: number; offset?: number }): Promise<WebflowItem[]>;
  listAllItems(collectionId: string): Promise<WebflowItem[]>;
  listAssets(opts?: { limit?: number; offset?: number }): Promise<WebflowAsset[]>;
  listAllAssets(): Promise<WebflowAsset[]>;
  listPages(): Promise<WebflowPage[]>;
}

// ─── Types (subset of Webflow API responses we actually consume) ────────

export interface WebflowSite {
  id: string;
  workspaceId: string;
  displayName: string;
  shortName: string;
  timeZone: string;
  createdOn: string;
  lastPublished: string | null;
  customDomains?: Array<{ id: string; url: string; lastPublished: string | null }>;
}

export interface WebflowCollectionSummary {
  id: string;
  displayName: string;
  singularName: string;
  slug: string;
  createdOn: string;
  lastUpdated: string;
}

export interface WebflowCollectionField {
  id: string;
  isRequired: boolean;
  isEditable: boolean;
  type: WebflowFieldType;
  slug: string;
  displayName: string;
  helpText?: string;
  validations?: Record<string, unknown>;
}

export type WebflowFieldType =
  | 'PlainText'
  | 'RichText'
  | 'Image'
  | 'MultiImage'
  | 'Video'
  | 'Link'
  | 'Email'
  | 'Phone'
  | 'Number'
  | 'DateTime'
  | 'Switch'
  | 'Color'
  | 'Option'
  | 'Reference'
  | 'MultiReference'
  | 'File'
  | string;

export interface WebflowCollection extends WebflowCollectionSummary {
  fields: WebflowCollectionField[];
}

export interface WebflowItem {
  id: string;
  cmsLocaleId?: string | null;
  lastPublished: string | null;
  lastUpdated: string;
  createdOn: string;
  isArchived: boolean;
  isDraft: boolean;
  fieldData: Record<string, unknown>;
}

export interface WebflowAsset {
  id: string;
  contentType: string;
  size: number;
  siteId: string;
  hostedUrl: string;
  originalFileName: string;
  displayName: string;
  lastUpdated: string;
  createdOn: string;
  variants?: Array<{ hostedUrl: string; format: string; width: number; height: number }>;
}

export interface WebflowPage {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  parentId?: string | null;
  collectionId?: string | null;
  createdOn: string;
  lastUpdated: string;
  archived: boolean;
  draft: boolean;
  canBranch: boolean;
  isMembersOnly: boolean;
  seo?: { title?: string; description?: string };
  openGraph?: { title?: string; description?: string };
  localeId?: string | null;
}

// ─── Implementation ─────────────────────────────────────────────────────

export interface CreateClientOptions {
  apiToken: string;
  siteId: string;
  /** Optional fetch override for testing. */
  fetchImpl?: typeof fetch;
}

export function createWebflowApiClient(opts: CreateClientOptions): WebflowApiClient {
  const apiToken = opts.apiToken.trim();
  const siteId = opts.siteId.trim();
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (!apiToken) throw new Error('Webflow API token is required');
  if (!siteId) throw new Error('Webflow site ID is required');

  async function call<T>(endpoint: string): Promise<T> {
    const res = await fetchImpl(`${WEBFLOW_API_BASE}${endpoint}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'accept-version': '2.0.0',
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      let body: unknown;
      try { body = await res.json(); } catch { body = await res.text(); }
      throw new WebflowApiError(res.status, endpoint, body);
    }

    return res.json() as Promise<T>;
  }

  return {
    async getSite() {
      return call<WebflowSite>(`/sites/${siteId}`);
    },

    async listCollections() {
      const data = await call<{ collections: WebflowCollectionSummary[] }>(
        `/sites/${siteId}/collections`
      );
      return data.collections || [];
    },

    async getCollection(collectionId: string) {
      return call<WebflowCollection>(`/collections/${collectionId}`);
    },

    async listItems(collectionId: string, opts = {}) {
      const limit = opts.limit ?? 100;
      const offset = opts.offset ?? 0;
      const data = await call<{ items: WebflowItem[] }>(
        `/collections/${collectionId}/items?limit=${limit}&offset=${offset}`
      );
      return data.items || [];
    },

    /**
     * Convenience helper that drains all paginated results from a
     * collection. Webflow caps page size at 100 — for typical CMS
     * collections (artworks, exhibitions, blog posts) this is fine.
     */
    async listAllItems(collectionId: string) {
      const all: WebflowItem[] = [];
      let offset = 0;
      const pageSize = 100;
      // Safety stop after 50 pages (5000 items) to avoid runaway loops on
      // mis-configured token/collection combinations.
      for (let i = 0; i < 50; i++) {
        const batch = await this.listItems(collectionId, { limit: pageSize, offset });
        all.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }
      return all;
    },

    async listAssets(opts = {}) {
      const limit = opts.limit ?? 100;
      const offset = opts.offset ?? 0;
      const data = await call<{ assets: WebflowAsset[] }>(
        `/sites/${siteId}/assets?limit=${limit}&offset=${offset}`
      );
      return data.assets || [];
    },

    async listAllAssets() {
      const all: WebflowAsset[] = [];
      let offset = 0;
      const pageSize = 100;
      for (let i = 0; i < 100; i++) {
        const batch = await this.listAssets({ limit: pageSize, offset });
        all.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }
      return all;
    },

    async listPages() {
      const data = await call<{ pages: WebflowPage[] }>(`/sites/${siteId}/pages`);
      return data.pages || [];
    },
  };
}

// ─── Typing helpers for downstream consumers ───────────────────────────

/**
 * Translate Webflow's field-type names to Webwow's `CollectionFieldType`.
 * Used by the importer when bridging from API field metadata to Webwow's
 * collection schema.
 */
export function mapWebflowFieldType(t: WebflowFieldType): string {
  switch (t) {
    case 'PlainText': return 'text';
    case 'RichText': return 'rich_text';
    case 'Image': return 'image';
    case 'MultiImage': return 'image';
    case 'Video': return 'video';
    case 'Link': return 'link';
    case 'Email': return 'email';
    case 'Phone': return 'phone';
    case 'Number': return 'number';
    case 'DateTime': return 'date';
    case 'Switch': return 'boolean';
    case 'Color': return 'color';
    case 'Option': return 'text';
    case 'Reference': return 'reference';
    case 'MultiReference': return 'multi_reference';
    case 'File': return 'document';
    default: return 'text';
  }
}
