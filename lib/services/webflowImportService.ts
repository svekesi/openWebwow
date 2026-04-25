import { randomUUID } from 'crypto';
import path from 'path';
import JSZip from 'jszip';
import { parse, type HTMLElement, type Node as HtmlNode, NodeType } from 'node-html-parser';
import { noCache } from '@/lib/api-response';
import { STORAGE_FOLDERS } from '@/lib/asset-constants';
import { parseCSVText } from '@/lib/csv-utils';
import { getAssetProxyUrl } from '@/lib/asset-utils';
import { getKnexClient } from '@/lib/knex-client';
import { createAsset } from '@/lib/repositories/assetRepository';
import { uploadFile as uploadToStorage, getPublicUrl } from '@/lib/local-storage';
import { getDefaultSitemapSettings } from '@/lib/sitemap-utils';
import { stringToTiptapContent } from '@/lib/text-format-utils';
import { classesToDesign, designToClasses } from '@/lib/tailwind-class-mapper';
import {
  importProject,
  type ProjectExportData,
  type ProjectManifest,
} from '@/lib/services/projectService';
import { detectWebflowComponent } from '@/lib/services/webflow-component-detector';
import type {
  CollectionFieldType,
  Layer,
  WebflowImportPayload,
  WebflowImportResult,
} from '@/types';

interface ParsedWebflowCsv {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  webflowCollectionId: string;
}

interface NormalizedCollection {
  id: string;
  webflowCollectionId: string;
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}

interface NormalizedField {
  id: string;
  collectionId: string;
  csvHeader: string;
  name: string;
  key: string | null;
  type: CollectionFieldType;
  order: number;
  referenceCollectionId: string | null;
}

interface ImportedAsset {
  id: string;
  storagePath: string;
  publicUrl: string | null;
}

interface ProcessWebflowImportResponse {
  success: boolean;
  result: WebflowImportResult;
  warnings: string[];
  errors: string[];
}

interface ConvertWebflowToProjectExportResponse extends ProcessWebflowImportResponse {
  exportData?: ProjectExportData;
}

interface BuiltPageEntry {
  page: Record<string, unknown>;
  pageLayers: Record<string, unknown>;
}

interface LayerStyleBuildResult {
  layerStyleRows: Record<string, unknown>[];
  styleIdByClassSignature: Map<string, string>;
  styleClassesByClassSignature: Map<string, string>;
  styleDesignByClassSignature: Map<string, Layer['design']>;
  classTokenToTailwindMap: Map<string, string>;
}

const CSV_META_COLUMNS = new Set([
  'Collection ID',
  'Locale ID',
  'Item ID',
  'Archived',
  'Draft',
  'Created On',
  'Updated On',
  'Published On',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp', '.tif', '.tiff']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.avi', '.ogg']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac']);
const SAFE_HTML_TAGS = new Set([
  'div',
  'section',
  'header',
  'footer',
  'main',
  'nav',
  'article',
  'aside',
  'ul',
  'ol',
  'li',
  'form',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'small',
  'label',
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'blockquote',
  'figure',
  'figcaption',
]);

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function stripTopLevelFolder(filePath: string): string {
  const parts = normalizeSlashes(filePath).split('/').filter(Boolean);
  if (parts.length <= 1) {
    return parts[0] || '';
  }
  return parts.slice(1).join('/');
}

function detectTopLevelFolder(zip: JSZip): string | null {
  const entries = Object.keys(zip.files);
  const topLevels = new Set<string>();
  for (const entry of entries) {
    const first = entry.split('/')[0];
    if (first) topLevels.add(first);
  }
  if (topLevels.size === 1) {
    const candidate = [...topLevels][0];
    if (zip.files[candidate + '/']?.dir) return candidate;
  }
  return null;
}

function inferMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    if (extension === '.svg') return 'image/svg+xml';
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    return `image/${extension.slice(1)}`;
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    if (extension === '.mov') return 'video/quicktime';
    return `video/${extension.slice(1)}`;
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return `audio/${extension.slice(1)}`;
  }
  if (extension === '.css') return 'text/css';
  if (extension === '.js') return 'application/javascript';
  if (extension === '.woff') return 'font/woff';
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.ttf') return 'font/ttf';
  if (extension === '.otf') return 'font/otf';
  return 'application/octet-stream';
}

function inferAssetFieldType(urlOrPath: string): CollectionFieldType {
  const lower = urlOrPath.toLowerCase();
  const extension = path.extname(lower);
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return 'document';
}

function sanitizeCollectionName(name: string): string {
  return name.replace(/\s+/g, ' ').trim() || `Collection ${randomUUID().slice(0, 6)}`;
}

function mapFieldKeyFromHeader(header: string): string | null {
  const normalized = header.trim().toLowerCase();
  if (normalized === 'name') return 'name';
  if (normalized === 'slug') return 'slug';
  if (normalized === 'created on') return 'created_at';
  if (normalized === 'updated on') return 'updated_at';
  return null;
}

function splitReferenceCandidates(value: string): string[] {
  if (!value.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v).trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }

  if (trimmed.includes(',')) {
    return trimmed.split(',').map(v => v.trim()).filter(Boolean);
  }

  if (trimmed.includes(';')) {
    return trimmed.split(';').map(v => v.trim()).filter(Boolean);
  }

  return [trimmed];
}

function slugFromFilename(filename: string): string {
  let base = path.basename(filename, '.html').toLowerCase();
  if (base === 'index') return '';

  // Webflow uses `detail_<collection-slug>.html` (or `detail-...`) as the
  // CMS template filename. The actual public URL on the live site is
  // `/<collection-slug>/<item-slug>` — the `detail` prefix never appears in
  // the URL. Strip it here so our routing matches Webflow's behaviour
  // instead of producing nonsense URLs like `/detail-werke/abends-piacenza`.
  base = base.replace(/^detail[_-]+/, '');

  return base.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveHref(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '#';
  if (trimmed.startsWith('#') || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return trimmed;
  }
  if (trimmed.endsWith('.html')) {
    return `/${slugFromFilename(trimmed)}`;
  }
  return trimmed;
}

function classifyPrimitiveType(values: string[]): CollectionFieldType | null {
  if (values.length === 0) return 'text';

  const boolLike = values.every(v => ['true', 'false', '0', '1', 'yes', 'no'].includes(v.trim().toLowerCase()));
  if (boolLike) return 'boolean';

  const numberLike = values.every(v => /^-?\d+(\.\d+)?$/.test(v.trim()));
  if (numberLike) return 'number';

  const dateLike = values.every(v => !Number.isNaN(Date.parse(v)));
  if (dateLike) return 'date';

  const urlLike = values.every(v => /^https?:\/\//.test(v.trim()));
  if (urlLike) {
    return inferAssetFieldType(values[0]);
  }

  return null;
}

function inferRelationType(
  values: string[],
  itemIdsByCollection: Map<string, Set<string>>
): { type: CollectionFieldType | null; targetCollectionId: string | null } {
  if (values.length === 0) {
    return { type: null, targetCollectionId: null };
  }

  const candidateMap = new Map<string, number>();
  let hasMulti = false;
  let tokenCount = 0;

  for (const value of values) {
    const tokens = splitReferenceCandidates(value);
    if (tokens.length > 1) {
      hasMulti = true;
    }
    for (const token of tokens) {
      tokenCount++;
      for (const [collectionId, itemSet] of itemIdsByCollection.entries()) {
        if (itemSet.has(token)) {
          candidateMap.set(collectionId, (candidateMap.get(collectionId) || 0) + 1);
        }
      }
    }
  }

  if (tokenCount === 0 || candidateMap.size === 0) {
    return { type: null, targetCollectionId: null };
  }

  let bestCollectionId: string | null = null;
  let bestScore = 0;
  for (const [collectionId, score] of candidateMap.entries()) {
    if (score > bestScore) {
      bestCollectionId = collectionId;
      bestScore = score;
    }
  }

  if (!bestCollectionId) {
    return { type: null, targetCollectionId: null };
  }

  const relationCoverage = bestScore / tokenCount;
  if (relationCoverage < 0.7) {
    return { type: null, targetCollectionId: null };
  }

  return {
    type: hasMulti ? 'multi_reference' : 'reference',
    targetCollectionId: bestCollectionId,
  };
}

async function uploadAssetBuffer(
  filename: string,
  buffer: Buffer,
  mimeType: string
): Promise<ImportedAsset> {
  const extension = path.extname(filename).toLowerCase() || '.bin';
  const storagePath = `${STORAGE_FOLDERS.WEBSITE}/${Date.now()}-${randomUUID()}${extension}`;

  await uploadToStorage(storagePath, buffer);

  const asset = await createAsset({
    filename: filename.replace(/\.[^/.]+$/, '') || filename,
    source: 'webflow-import',
    storage_path: storagePath,
    public_url: getPublicUrl(storagePath),
    file_size: buffer.byteLength,
    mime_type: mimeType,
  });

  const proxyUrl = getAssetProxyUrl(asset) || getPublicUrl(storagePath);
  if (proxyUrl !== asset.public_url) {
    const db = await getKnexClient();
    await db('assets')
      .where('id', asset.id)
      .where('is_published', false)
      .update({
        public_url: proxyUrl,
        updated_at: new Date().toISOString(),
      });
  }

  return {
    id: asset.id,
    storagePath,
    publicUrl: proxyUrl,
  };
}

async function downloadRemoteAsset(url: string): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || inferMimeType(url);
    const pathname = new URL(url).pathname;
    const filename = path.basename(pathname) || `asset-${Date.now()}`;
    return { buffer, filename, mimeType };
  } catch {
    return null;
  }
}

function extractCssUrls(content: string): string[] {
  const matches = [...content.matchAll(/url\(([^)]+)\)/g)];
  return matches
    .map(match => match[1].trim().replace(/^["']|["']$/g, ''))
    .filter(value => value && !value.startsWith('data:'));
}

function extractCssClassNames(content: string): Set<string> {
  const result = new Set<string>();
  const classRegex = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)(?=[\s.:#,[>+~{])/g;
  const skipTokens = new Set([
    'jpg',
    'jpeg',
    'png',
    'webp',
    'gif',
    'svg',
    'woff',
    'woff2',
    'ttf',
    'otf',
    'mp4',
    'webm',
    'mov',
    'css',
    'js',
  ]);

  for (const match of content.matchAll(classRegex)) {
    const className = (match[1] || '').trim();
    if (!className || skipTokens.has(className.toLowerCase())) {
      continue;
    }
    result.add(className);
  }

  return result;
}

function decodeCssClassToken(token: string): string {
  let decoded = token;
  decoded = decoded.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_match, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16))
  );
  decoded = decoded.replace(/\\(.)/g, '$1');
  return decoded;
}

function extractCssClassSignatures(content: string): Set<string> {
  const signatures = new Set<string>();
  const blockRegex = /([^{]+)\{/g;
  const classRegex = /\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[_a-zA-Z0-9-])+)/g;

  for (const blockMatch of content.matchAll(blockRegex)) {
    const selectorBlock = (blockMatch[1] || '').trim();
    if (!selectorBlock || selectorBlock.startsWith('@')) {
      continue;
    }

    const selectors = selectorBlock.split(',');
    for (const selectorRaw of selectors) {
      const selector = selectorRaw.trim();
      if (!selector) continue;

      const tokens: string[] = [];
      for (const classMatch of selector.matchAll(classRegex)) {
        const token = decodeCssClassToken((classMatch[1] || '').trim());
        if (token) {
          tokens.push(token);
        }
      }

      if (tokens.length === 0) {
        continue;
      }

      const uniqueTokens = [...new Set(tokens)];
      signatures.add(normalizeClassSignature(uniqueTokens.join(' ')));
    }
  }

  return signatures;
}

function getLayerClasses(layer: Layer): string {
  if (Array.isArray(layer.classes)) {
    return layer.classes.join(' ');
  }
  return layer.classes || '';
}

/**
 * Split a Tailwind/Webflow class string into tokens while preserving
 * whitespace inside `[...]` arbitrary values. A naive `split(/\s+/)` would
 * shred `text-[clamp(1rem, 3rem)]` into broken fragments.
 */
function splitClassesPreservingBrackets(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let bracketDepth = 0;
  let parenDepth = 0;
  for (const char of value) {
    if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    if (/\s/.test(char) && bracketDepth === 0 && parenDepth === 0) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function normalizeClassSignature(value: string): string {
  return splitClassesPreservingBrackets(value)
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ');
}

function mergeDesignObjects(
  base: Layer['design'] | undefined,
  extra: Layer['design'] | undefined
): Layer['design'] {
  if (!base && !extra) return undefined;
  return {
    layout: { ...(base?.layout || {}), ...(extra?.layout || {}) },
    typography: { ...(base?.typography || {}), ...(extra?.typography || {}) },
    spacing: { ...(base?.spacing || {}), ...(extra?.spacing || {}) },
    sizing: { ...(base?.sizing || {}), ...(extra?.sizing || {}) },
    borders: { ...(base?.borders || {}), ...(extra?.borders || {}) },
    backgrounds: { ...(base?.backgrounds || {}), ...(extra?.backgrounds || {}) },
    effects: { ...(base?.effects || {}), ...(extra?.effects || {}) },
    positioning: { ...(base?.positioning || {}), ...(extra?.positioning || {}) },
  };
}

/**
 * Intentionally empty: we no longer ship a static Webflow→Tailwind map.
 *
 * We used to inject e.g. `flex` for every `.w-nav-menu` and `grid` for every
 * `.w-layout-grid`, but those unconditional utilities overrode Webflow's own
 * responsive CSS (e.g. `@media(max-width:991px) .w-nav-menu { display:none }`)
 * and shattered the layout. The imported webflow.css already carries every
 * one of these rules including @media variants — adding parallel Tailwind
 * utilities is at best redundant and at worst destructive.
 *
 * Specific element conversions are now handled by the central component
 * detector (see `webflow-component-detector.ts`).
 */
const WEBFLOW_CLASS_TOKEN_TO_TAILWIND_ENTRIES: Array<[string, string]> = [];

function collectCssDeclarationsByClassToken(
  cssFiles: Array<{ filePath: string; content: string }>
): Map<string, Record<string, string>> {
  const declarationsByClass = new Map<string, Record<string, string>>();

  for (const cssFile of cssFiles) {
    const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
    for (const match of cssFile.content.matchAll(ruleRegex)) {
      const selectorText = (match[1] || '').trim();
      const body = (match[2] || '').trim();
      if (!selectorText || !body || selectorText.startsWith('@')) continue;

      const declarations: Record<string, string> = {};
      for (const decl of body.split(';')) {
        const idx = decl.indexOf(':');
        if (idx <= 0) continue;
        const key = decl.slice(0, idx).trim().toLowerCase();
        const value = sanitizeCssValue(decl.slice(idx + 1));
        if (!key || !value) continue;
        declarations[key] = value;
      }
      if (Object.keys(declarations).length === 0) continue;

      for (const selector of selectorText.split(',')) {
        const classMatches = [...selector.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)];
        for (const classMatch of classMatches) {
          const classToken = (classMatch[1] || '').trim();
          if (!classToken) continue;
          const existing = declarationsByClass.get(classToken) || {};
          declarationsByClass.set(classToken, { ...existing, ...declarations });
        }
      }
    }
  }

  return declarationsByClass;
}

function declarationsToDesign(decls?: Record<string, string>): Layer['design'] | undefined {
  if (!decls) return undefined;
  let design: Layer['design'] | undefined;
  const set = (patch: Layer['design']) => {
    design = mergeDesignObjects(design, patch);
  };

  const display = decls['display'];
  if (display) set({ layout: { display, isActive: true } });
  if (decls['flex-direction']) set({ layout: { flexDirection: decls['flex-direction'], isActive: true } });
  if (decls['justify-content']) set({ layout: { justifyContent: decls['justify-content'], isActive: true } });
  if (decls['align-items']) set({ layout: { alignItems: decls['align-items'], isActive: true } });
  if (decls['grid-template-columns']) set({ layout: { gridTemplateColumns: decls['grid-template-columns'], isActive: true } });
  if (decls['grid-template-rows']) set({ layout: { gridTemplateRows: decls['grid-template-rows'], isActive: true } });
  if (decls['gap']) set({ layout: { gap: decls['gap'], isActive: true } });
  if (decls['column-gap']) set({ layout: { columnGap: decls['column-gap'], isActive: true } });
  if (decls['row-gap']) set({ layout: { rowGap: decls['row-gap'], isActive: true } });

  if (decls['width']) set({ sizing: { width: decls['width'], isActive: true } });
  if (decls['height']) set({ sizing: { height: decls['height'], isActive: true } });
  if (decls['min-width']) set({ sizing: { minWidth: decls['min-width'], isActive: true } });
  if (decls['min-height']) set({ sizing: { minHeight: decls['min-height'], isActive: true } });
  if (decls['max-width']) set({ sizing: { maxWidth: decls['max-width'], isActive: true } });
  if (decls['max-height']) set({ sizing: { maxHeight: decls['max-height'], isActive: true } });

  if (decls['padding']) set({ spacing: { padding: decls['padding'], isActive: true } });
  if (decls['padding-top']) set({ spacing: { paddingTop: decls['padding-top'], isActive: true } });
  if (decls['padding-right']) set({ spacing: { paddingRight: decls['padding-right'], isActive: true } });
  if (decls['padding-bottom']) set({ spacing: { paddingBottom: decls['padding-bottom'], isActive: true } });
  if (decls['padding-left']) set({ spacing: { paddingLeft: decls['padding-left'], isActive: true } });
  if (decls['margin']) set({ spacing: { margin: decls['margin'], isActive: true } });
  if (decls['margin-top']) set({ spacing: { marginTop: decls['margin-top'], isActive: true } });
  if (decls['margin-right']) set({ spacing: { marginRight: decls['margin-right'], isActive: true } });
  if (decls['margin-bottom']) set({ spacing: { marginBottom: decls['margin-bottom'], isActive: true } });
  if (decls['margin-left']) set({ spacing: { marginLeft: decls['margin-left'], isActive: true } });

  if (decls['color']) set({ typography: { color: decls['color'], isActive: true } });
  if (decls['font-size']) set({ typography: { fontSize: decls['font-size'], isActive: true } });
  if (decls['font-weight']) set({ typography: { fontWeight: decls['font-weight'], isActive: true } });
  if (decls['line-height']) set({ typography: { lineHeight: decls['line-height'], isActive: true } });
  if (decls['letter-spacing']) set({ typography: { letterSpacing: decls['letter-spacing'], isActive: true } });

  // Typography extras (added in #22): text-decoration, text-transform, text-align
  if (decls['text-decoration'] || decls['text-decoration-line']) {
    set({ typography: { textDecoration: decls['text-decoration'] || decls['text-decoration-line'] || '', isActive: true } });
  }
  if (decls['text-transform']) set({ typography: { textTransform: decls['text-transform'], isActive: true } });
  if (decls['text-align']) set({ typography: { textAlign: decls['text-align'], isActive: true } });
  if (decls['font-family']) set({ typography: { fontFamily: decls['font-family'].replace(/['"]/g, ''), isActive: true } });

  if (decls['background-color']) set({ backgrounds: { backgroundColor: decls['background-color'], isActive: true } });
  if (decls['background-image']) set({ backgrounds: { backgroundImage: decls['background-image'], isActive: true } });
  if (decls['background-size']) set({ backgrounds: { backgroundSize: decls['background-size'], isActive: true } });
  if (decls['background-position']) set({ backgrounds: { backgroundPosition: decls['background-position'], isActive: true } });
  if (decls['background-repeat']) set({ backgrounds: { backgroundRepeat: decls['background-repeat'], isActive: true } });

  if (decls['border-radius']) set({ borders: { borderRadius: decls['border-radius'], isActive: true } });
  if (decls['border-width']) set({ borders: { borderWidth: decls['border-width'], isActive: true } });
  if (decls['border-style']) set({ borders: { borderStyle: decls['border-style'], isActive: true } });
  if (decls['border-color']) set({ borders: { borderColor: decls['border-color'], isActive: true } });
  // Per-side border-radius
  if (decls['border-top-left-radius']) set({ borders: { borderTopLeftRadius: decls['border-top-left-radius'], isActive: true } });
  if (decls['border-top-right-radius']) set({ borders: { borderTopRightRadius: decls['border-top-right-radius'], isActive: true } });
  if (decls['border-bottom-left-radius']) set({ borders: { borderBottomLeftRadius: decls['border-bottom-left-radius'], isActive: true } });
  if (decls['border-bottom-right-radius']) set({ borders: { borderBottomRightRadius: decls['border-bottom-right-radius'], isActive: true } });

  // Effects: only properties Webwow's design panel exposes natively. The
  // raw CSS values for transform/filter/transition/overflow/cursor are
  // already preserved via the imported webflow.css that we ship with the
  // import, so visually they still apply to the layer through its original
  // class selector — we just don't surface them in the design panel.
  if (decls['opacity']) set({ effects: { opacity: decls['opacity'], isActive: true } });
  if (decls['box-shadow'] && decls['box-shadow'] !== 'none') {
    set({ effects: { boxShadow: decls['box-shadow'], isActive: true } });
  }

  if (decls['object-fit']) set({ sizing: { objectFit: decls['object-fit'], isActive: true } });
  if (decls['aspect-ratio']) set({ sizing: { aspectRatio: decls['aspect-ratio'], isActive: true } });

  if (decls['position']) set({ positioning: { position: decls['position'], isActive: true } });
  if (decls['top']) set({ positioning: { top: decls['top'], isActive: true } });
  if (decls['right']) set({ positioning: { right: decls['right'], isActive: true } });
  if (decls['bottom']) set({ positioning: { bottom: decls['bottom'], isActive: true } });
  if (decls['left']) set({ positioning: { left: decls['left'], isActive: true } });
  if (decls['z-index']) set({ positioning: { zIndex: decls['z-index'], isActive: true } });

  return design;
}

function translateClassSignatureWithCss(
  classSignature: string,
  classTokenToTailwindMap: Map<string, string>,
  cssDeclarationsByClassToken: Map<string, Record<string, string>>
): { classes: string; design?: Layer['design'] } {
  const translatedTokens: string[] = [];
  let accumulatedDesign: Layer['design'] | undefined;
  const sourceTokens = splitClassesPreservingBrackets(classSignature)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of sourceTokens) {
    // Always preserve the original Webflow class — the imported webflow.css
    // contains rules like `.w-nav-menu { display:none }`, `.w-layout-grid {
    // display:grid }`, `.w-container { max-width:940px; margin:0 auto }` etc.
    // Stripping the original token would orphan those CSS selectors and break
    // layout (collapsed containers, always-open nav menu, broken grids).
    translatedTokens.push(token);

    const mapped = classTokenToTailwindMap.get(token);
    if (mapped) {
      for (const mappedToken of mapped.split(/\s+/).map((part) => part.trim()).filter(Boolean)) {
        translatedTokens.push(mappedToken);
      }
      continue;
    }

    const cssDecls = cssDeclarationsByClassToken.get(token);
    const cssDesign = declarationsToDesign(cssDecls);
    if (cssDesign) {
      // Populate the design panel from the CSS rule so it reflects the
      // imported values, but DO NOT emit equivalent Tailwind utility classes:
      // the original Webflow class already carries those rules (including
      // responsive @media variants). Adding Tailwind utilities here would
      // override the responsive Webflow rules (e.g. a stable `flex` would
      // beat `@media (max-width:991px) .w-nav-menu { display:none }`).
      accumulatedDesign = mergeDesignObjects(accumulatedDesign, cssDesign);
    }
  }

  return {
    classes: normalizeClassSignature([...new Set(translatedTokens)].join(' ')),
    design: accumulatedDesign,
  };
}

function inferCustomName(tag: string, classes: string): string | undefined {
  const classSet = new Set(splitClassesPreservingBrackets(classes).map((c) => c.trim()).filter(Boolean));
  if (classSet.has('w-layout-grid')) return 'Grid';
  if (tag === 'nav' || classSet.has('w-nav') || classSet.has('w-nav-menu')) return 'Navigation';
  if (classSet.has('w-dropdown')) return 'Dropdown';
  if (classSet.has('w-form')) return 'Form';
  if (classSet.has('w-dyn-list')) return 'Collection List';
  return undefined;
}

function collectLayerClassNames(layers: Layer[]): Set<string> {
  const classNames = new Set<string>();

  const visit = (layer: Layer) => {
    for (const className of splitClassesPreservingBrackets(getLayerClasses(layer)).filter(Boolean)) {
      classNames.add(className);
    }
    for (const child of layer.children || []) {
      visit(child);
    }
  };

  for (const layer of layers) {
    visit(layer);
  }

  return classNames;
}

function applyLayerStylesToTree(
  layers: Layer[],
  styleIdByClassSignature: Map<string, string>,
  styleClassesByClassSignature: Map<string, string>,
  styleDesignByClassSignature: Map<string, Layer['design']>,
  classTokenToTailwindMap: Map<string, string>
): Layer[] {
  const inferCustomNameFromDesign = (design?: Layer['design']): string | undefined => {
    const display = design?.layout?.display?.toLowerCase();
    if (display === 'grid') return 'Grid';
    return undefined;
  };

  const visit = (layer: Layer): Layer => {
    const classSignature = normalizeClassSignature(getLayerClasses(layer));
    const matchedStyleId = classSignature ? styleIdByClassSignature.get(classSignature) : undefined;
    const matchedClasses = classSignature ? styleClassesByClassSignature.get(classSignature) : undefined;
    const matchedDesign = classSignature ? styleDesignByClassSignature.get(classSignature) : undefined;

    const translatedUnmatchedClasses = classSignature
      ? translateClassSignatureWithCss(classSignature, classTokenToTailwindMap, new Map()).classes
      : '';

    const updated: Layer = {
      ...layer,
      ...(matchedStyleId ? { styleId: matchedStyleId } : {}),
      classes: matchedClasses || translatedUnmatchedClasses || getLayerClasses(layer),
      ...(matchedDesign ? { design: matchedDesign } : {}),
      ...(layer.customName
        ? {}
        : (inferCustomNameFromDesign(matchedDesign) ? { customName: inferCustomNameFromDesign(matchedDesign) } : {})),
    };

    if (layer.children?.length) {
      updated.children = layer.children.map(visit);
    }

    return updated;
  };

  return layers.map(visit);
}

function buildLayerStyles(
  cssSources: Array<{ filePath: string; content: string }>,
  pageLayerRows: Array<{ layers: Layer[] }>
): LayerStyleBuildResult {
  const classNames = new Set<string>();
  const classSignatures = new Set<string>();

  for (const cssFile of cssSources) {
    for (const className of extractCssClassNames(cssFile.content)) {
      classNames.add(className);
    }
    for (const classSignature of extractCssClassSignatures(cssFile.content)) {
      if (classSignature) {
        classSignatures.add(classSignature);
      }
    }
  }

  for (const pageLayerRow of pageLayerRows) {
    for (const className of collectLayerClassNames(pageLayerRow.layers || [])) {
      classNames.add(className);
    }
    const visit = (layer: Layer) => {
      const signature = normalizeClassSignature(getLayerClasses(layer));
      if (signature) {
        classSignatures.add(signature);
      }
      for (const child of layer.children || []) {
        visit(child);
      }
    };
    for (const layer of pageLayerRow.layers || []) {
      visit(layer);
    }
  }

  const styleIdByClassSignature = new Map<string, string>();
  const styleClassesByClassSignature = new Map<string, string>();
  const styleDesignByClassSignature = new Map<string, Layer['design']>();
  const classTokenToTailwindMap = new Map<string, string>(WEBFLOW_CLASS_TOKEN_TO_TAILWIND_ENTRIES);
  const cssDeclarationsByClassToken = collectCssDeclarationsByClassToken(cssSources);
  const layerStyleRows: Record<string, unknown>[] = [];

  for (const classSignature of [...classSignatures].sort((a, b) => a.localeCompare(b))) {
    const styleId = randomUUID();
    const translated = translateClassSignatureWithCss(
      classSignature,
      classTokenToTailwindMap,
      cssDeclarationsByClassToken
    );
    const translatedClasses = translated.classes;
    const styleDesign = mergeDesignObjects(classesToDesign(translatedClasses), translated.design);
    styleIdByClassSignature.set(classSignature, styleId);
    styleClassesByClassSignature.set(classSignature, translatedClasses);
    styleDesignByClassSignature.set(classSignature, styleDesign);
    layerStyleRows.push({
      id: styleId,
      name: classSignature,
      classes: translatedClasses,
      design: styleDesign,
      is_published: false,
    });
  }

  for (const className of [...classNames].sort((a, b) => a.localeCompare(b))) {
    const translated = translateClassSignatureWithCss(
      className,
      classTokenToTailwindMap,
      cssDeclarationsByClassToken
    );
    const translatedClasses = translated.classes;
    const styleDesign = mergeDesignObjects(classesToDesign(translatedClasses), translated.design);
    layerStyleRows.push({
      id: randomUUID(),
      name: className,
      classes: translatedClasses,
      design: styleDesign,
      is_published: false,
    });
  }

  return {
    layerStyleRows,
    styleIdByClassSignature,
    styleClassesByClassSignature,
    styleDesignByClassSignature,
    classTokenToTailwindMap,
  };
}

function dedupeLayerStyles(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seenNames = new Set<string>();
  const deduped: Record<string, unknown>[] = [];

  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (!name || seenNames.has(name)) {
      continue;
    }
    seenNames.add(name);
    deduped.push(row);
  }

  return deduped;
}

function layerHasClass(layer: Layer, className: string): boolean {
  const classes = getLayerClasses(layer);
  return classes.split(/\s+/).filter(Boolean).includes(className);
}

function createFieldInlineVariableTag(
  fieldId: string,
  fieldType: CollectionFieldType,
  source: 'page' | 'collection',
  collectionLayerId?: string
): string {
  const variable: Record<string, unknown> = {
    type: 'field',
    data: {
      field_id: fieldId,
      field_type: fieldType,
      relationships: [],
      source,
    },
  };

  if (collectionLayerId) {
    (variable.data as Record<string, unknown>).collection_layer_id = collectionLayerId;
  }

  return `<webwow-inline-variable>${JSON.stringify(variable)}</webwow-inline-variable>`;
}

function inferCollectionForPageSlug(
  pageSlug: string,
  collections: NormalizedCollection[]
): NormalizedCollection | null {
  const slug = pageSlug.toLowerCase();
  const byName = (needle: string) =>
    collections.find(collection => collection.name.toLowerCase().includes(needle));

  if (slug.includes('werk') || slug.includes('work')) {
    return byName('werk') || byName('work') || null;
  }

  if (slug.includes('exhibition')) {
    return byName('exhibition') || null;
  }

  return null;
}

function layerTreeHasDynItems(layers: Layer[]): boolean {
  for (const layer of layers) {
    if (layerHasClass(layer, 'w-dyn-item')) return true;
    if (layer.children?.length && layerTreeHasDynItems(layer.children)) return true;
  }
  return false;
}

/**
 * Detect Webflow CMS template pages from either:
 *   - the legacy `detail-` slug prefix (older import shape, kept for backwards
 *     compat in case the slug wasn't stripped at filename time)
 *   - the original Webflow filename (`detail_werke.html`) attached as
 *     `__sourceFilename` on the in-memory page object during import.
 */
function isLikelyDetailPage(pageSlug: string, sourceFilename?: string): boolean {
  const slug = pageSlug.toLowerCase();
  if (slug.startsWith('detail-') || slug.includes('detail_')) return true;
  if (sourceFilename) {
    const filename = sourceFilename.toLowerCase();
    if (filename.startsWith('detail-') || filename.startsWith('detail_')) return true;
  }
  return false;
}

function getCollectionFields(
  collectionId: string,
  fields: NormalizedField[]
): NormalizedField[] {
  return fields
    .filter(field => field.collectionId === collectionId)
    .sort((a, b) => a.order - b.order);
}

function getPreferredTextFields(fields: NormalizedField[]): NormalizedField[] {
  const allowed = new Set<CollectionFieldType>(['text', 'number', 'date', 'rich_text']);
  const nameField = fields.find(field => field.key === 'name');
  const rest = fields.filter(
    field =>
      field !== nameField
      && allowed.has(field.type)
      && field.key !== 'slug'
  );

  return nameField ? [nameField, ...rest] : rest;
}

function bindDynamicItemTemplate(
  layer: Layer,
  textFields: NormalizedField[],
  imageField: NormalizedField | null,
  detailPageId: string | null,
  collectionLayerId: string,
  textFieldIndexRef: { index: number }
): Layer {
  let updated: Layer = { ...layer };

  if (detailPageId && updated.settings?.tag === 'a') {
    updated = {
      ...updated,
      variables: {
        ...updated.variables,
        link: {
          type: 'page',
          page: {
            id: detailPageId,
            collection_item_id: 'current-collection',
          },
        },
      },
    };
  }

  const isImageCandidate = imageField && (
    (updated.name === 'image' && layerHasClass(updated, 'w-dyn-bind-empty'))
    || (updated.name === 'image')
    || (updated.name === 'div' && !updated.children?.length && !layerHasClass(updated, 'w-dyn-bind-empty')
        && !layerHasClass(updated, 'w-dyn-empty') && !layerHasClass(updated, 'w-dyn-items')
        && !layerHasClass(updated, 'w-dyn-list'))
  );

  if (isImageCandidate && imageField) {
    const existingImage = updated.variables?.image;
    const fieldBinding = {
      type: 'field' as const,
      data: {
        field_id: imageField.id,
        field_type: imageField.type,
        relationships: [] as string[],
        source: 'collection' as const,
        collection_layer_id: collectionLayerId,
      },
    };

    if (updated.name === 'image') {
      updated = {
        ...updated,
        variables: {
          ...updated.variables,
          image: {
            ...(existingImage || {}),
            src: fieldBinding,
            alt: existingImage?.alt || {
              type: 'dynamic_text',
              data: { content: '' },
            },
          },
        },
      };
    } else {
      updated = {
        ...updated,
        name: 'image',
        settings: { ...(updated.settings || {}), tag: 'img' },
        variables: {
          ...updated.variables,
          image: {
            src: fieldBinding,
            alt: { type: 'dynamic_text', data: { content: '' } },
          },
        },
      };
    }
  } else if (updated.name === 'div' && layerHasClass(updated, 'w-dyn-bind-empty')) {
    const nextTextField = textFields[textFieldIndexRef.index];
    if (nextTextField) {
      textFieldIndexRef.index += 1;
      updated = {
        ...updated,
        name: 'text',
        restrictions: {
          ...updated.restrictions,
          editText: true,
        },
        settings: {
          ...(updated.settings || {}),
          tag: 'div',
        },
        variables: {
          ...updated.variables,
          text: {
            type: 'dynamic_text',
            data: {
              content: createFieldInlineVariableTag(
                nextTextField.id,
                nextTextField.type,
                'collection',
                collectionLayerId
              ),
            },
          },
        },
        children: undefined,
      };
    }
  }

  if (updated.children?.length) {
    updated = {
      ...updated,
      children: updated.children.map(child =>
        bindDynamicItemTemplate(
          child,
          textFields,
          imageField,
          detailPageId,
          collectionLayerId,
          textFieldIndexRef
        )
      ),
    };
  }

  return updated;
}

/**
 * Default item limit applied to imported Webflow collection lists. Webflow
 * exports show the entire collection by default which makes the editor canvas
 * unreadable on large collections (e.g. 100+ items). Users can raise this in
 * the Collection Layer settings whenever they need it.
 */
const DEFAULT_IMPORTED_COLLECTION_LIMIT = 1;

function bindCollectionLayersForPage(
  layers: Layer[],
  collectionId: string,
  fields: NormalizedField[],
  detailPageId: string | null,
  limit?: number
): Layer[] {
  const collectionFields = getCollectionFields(collectionId, fields);
  const textFields = getPreferredTextFields(collectionFields);
  const imageField = collectionFields.find(field => field.type === 'image') || null;

  const processLayer = (layer: Layer): Layer => {
    let updated: Layer = { ...layer };

    // Webflow toggles empty states via runtime JS.
    // We do not execute Webflow JS, so hide this block by default.
    if (layerHasClass(updated, 'w-dyn-empty')) {
      const currentClasses = getLayerClasses(updated);
      const hasHidden = currentClasses.split(/\s+/).includes('hidden');
      updated = {
        ...updated,
        classes: hasHidden ? currentClasses : `${currentClasses} hidden`.trim(),
      };
    }

    if (layerHasClass(updated, 'w-dyn-item')) {
      const collectionLayerId = updated.id;
      const textFieldIndexRef = { index: 0 };

      updated = {
        ...updated,
        variables: {
          ...updated.variables,
          collection: {
            id: collectionId,
            sort_by: 'manual',
            sort_order: 'asc',
            limit: typeof limit === 'number' ? limit : DEFAULT_IMPORTED_COLLECTION_LIMIT,
          },
        },
        children: (updated.children || []).map(child =>
          bindDynamicItemTemplate(
            child,
            textFields,
            imageField,
            detailPageId,
            collectionLayerId,
            textFieldIndexRef
          )
        ),
      };

      return updated;
    }

    if (updated.children?.length) {
      updated = {
        ...updated,
        children: updated.children.map(processLayer),
      };
    }

    return updated;
  };

  return layers.map(processLayer);
}

function enhancePagesWithCmsBindings(
  builtPages: BuiltPageEntry[],
  collections: NormalizedCollection[],
  fields: NormalizedField[]
): BuiltPageEntry[] {
  const pages = builtPages.map(entry => ({
    page: { ...entry.page },
    pageLayers: { ...entry.pageLayers },
  }));

  const detailPageIdByCollectionId = new Map<string, string>();
  const dynamicPageCollectionBySlug = new Map<string, string>();

  // Pass 1: Mark dynamic detail pages and assign CMS settings
  for (const entry of pages) {
    const pageSlug = String(entry.page.slug || '');
    const sourceFilename = String(entry.page.__sourceFilename || '');
    const collection = inferCollectionForPageSlug(pageSlug || sourceFilename, collections);
    if (!collection || !isLikelyDetailPage(pageSlug, sourceFilename)) {
      continue;
    }

    const collectionFields = getCollectionFields(collection.id, fields);
    const slugField = collectionFields.find(field => field.key === 'slug')
      || collectionFields.find(field => field.name.trim().toLowerCase() === 'slug');

    if (!slugField) {
      continue;
    }

    entry.page.is_dynamic = true;
    entry.page.settings = {
      ...(entry.page.settings as Record<string, unknown> || {}),
      cms: {
        collection_id: collection.id,
        slug_field_id: slugField.id,
      },
    };

    detailPageIdByCollectionId.set(collection.id, String(entry.page.id));
    dynamicPageCollectionBySlug.set(pageSlug, collection.id);
  }

  // Pass 2: Bind Webflow dynamic item placeholders to real collection bindings
  const sortedCollections = [...collections].sort((a, b) => b.rows.length - a.rows.length);

  for (const entry of pages) {
    const pageSlug = String(entry.page.slug || '');
    const explicitCollection = inferCollectionForPageSlug(pageSlug, collections);
    const isDetailPage = dynamicPageCollectionBySlug.has(pageSlug);
    const pageLayers = (entry.pageLayers.layers as Layer[]) || [];

    if (explicitCollection) {
      const detailPageId = detailPageIdByCollectionId.get(explicitCollection.id) || null;
      entry.pageLayers.layers = bindCollectionLayersForPage(
        pageLayers,
        explicitCollection.id,
        fields,
        detailPageId,
        isDetailPage ? 3 : undefined
      );
      continue;
    }

    if (!layerTreeHasDynItems(pageLayers) || collections.length === 0) {
      continue;
    }

    let collectionIndex = 0;
    const bindDynListSubtrees = (layers: Layer[]): Layer[] => {
      return layers.map(layer => {
        if (layerHasClass(layer, 'w-dyn-list') || layerHasClass(layer, 'w-dyn-items')) {
          const coll = sortedCollections[collectionIndex % sortedCollections.length];
          collectionIndex++;
          const detailPageId = detailPageIdByCollectionId.get(coll.id) || null;
          return bindCollectionLayersForPage([layer], coll.id, fields, detailPageId)[0] || layer;
        }
        if (layer.children?.length) {
          return { ...layer, children: bindDynListSubtrees(layer.children) };
        }
        return layer;
      });
    };

    entry.pageLayers.layers = bindDynListSubtrees(pageLayers);
  }

  return pages;
}

function rewriteCssUrls(
  cssContent: string,
  cssFilePath: string,
  assetPublicUrlBySource: Map<string, string>
): string {
  return cssContent.replace(/url\(([^)]+)\)/g, (fullMatch, rawValue) => {
    const original = String(rawValue).trim().replace(/^["']|["']$/g, '');
    if (!original || original.startsWith('data:') || original.startsWith('#') || /^https?:\/\//.test(original)) {
      return fullMatch;
    }

    const cssDir = path.posix.dirname(normalizeSlashes(cssFilePath));
    const joined = path.posix.normalize(path.posix.join(cssDir, normalizeSlashes(original)));
    const normalizedCandidates = [
      normalizeSlashes(original).replace(/^\.\//, '').replace(/^\//, ''),
      joined.replace(/^\//, ''),
      stripTopLevelFolder(joined).replace(/^\//, ''),
      path.posix.basename(original),
    ];

    for (const candidate of normalizedCandidates) {
      const mapped = assetPublicUrlBySource.get(candidate);
      if (mapped) {
        return `url("${mapped}")`;
      }
    }

    return fullMatch;
  });
}

function extractEmbeddedCssFromHtml(htmlContent: string): string {
  const root = parse(htmlContent);
  const body = root.querySelector('body');
  if (!body) return '';

  const styleTags = body.querySelectorAll('style');
  const blocks: string[] = [];
  for (const tag of styleTags) {
    const css = tag.textContent.trim();
    if (css) blocks.push(`/* embedded */\n${css}`);
  }
  return blocks.join('\n\n');
}

function extractStylesheetHrefsFromHtml(htmlContent: string): string[] {
  const hrefs: string[] = [];
  const stylesheetRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;

  for (const match of htmlContent.matchAll(stylesheetRegex)) {
    const href = (match[1] || '').trim();
    if (!href || /^https?:\/\//i.test(href)) {
      continue;
    }
    hrefs.push(normalizeSlashes(href).replace(/^\.\//, '').replace(/^\//, ''));
  }

  return hrefs;
}

function orderCssFiles(
  cssFiles: Array<{ filePath: string; content: string }>,
  preferredOrder: string[]
): Array<{ filePath: string; content: string }> {
  if (preferredOrder.length === 0) {
    return [...cssFiles].sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  const byPath = new Map<string, { filePath: string; content: string }>();
  for (const file of cssFiles) {
    byPath.set(normalizeSlashes(file.filePath), file);
  }

  const ordered: Array<{ filePath: string; content: string }> = [];
  const seen = new Set<string>();

  for (const cssPath of preferredOrder) {
    const normalized = normalizeSlashes(cssPath);
    const file = byPath.get(normalized);
    if (file && !seen.has(normalized)) {
      ordered.push(file);
      seen.add(normalized);
    }
  }

  const remaining = cssFiles
    .filter(file => !seen.has(normalizeSlashes(file.filePath)))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  return [...ordered, ...remaining];
}

function buildImportedCss(
  cssFiles: Array<{ filePath: string; content: string }>,
  assetPublicUrlBySource: Map<string, string>,
  preferredOrder: string[]
): string {
  const sorted = orderCssFiles(cssFiles, preferredOrder);
  return sorted
    .map(file => `/* ${file.filePath} */\n${rewriteCssUrls(file.content, file.filePath, assetPublicUrlBySource)}`)
    .join('\n\n');
}

function parseWebflowCsv(payload: WebflowImportPayload): ParsedWebflowCsv[] {
  return payload.csvFiles.map((csvFile) => {
    const parsed = parseCSVText(csvFile.content);
    const firstRow = parsed.rows[0] || {};
    const collectionId = firstRow['Collection ID'] || randomUUID();
    const rawName = csvFile.filename.split(' - ')[1]?.split(' - ')[0] || path.basename(csvFile.filename, '.csv');
    const name = sanitizeCollectionName(rawName);

    return {
      name,
      headers: parsed.headers,
      rows: parsed.rows,
      webflowCollectionId: collectionId,
    };
  });
}

function buildTextLayer(text: string, tag: string = 'span', classes: string = ''): Layer {
  return {
    id: randomUUID(),
    name: 'text',
    classes,
    settings: { tag },
    restrictions: { editText: true },
    variables: {
      text: {
        type: 'dynamic_rich_text',
        data: {
          content: stringToTiptapContent(text),
        },
      },
    },
  };
}

function getInlineStyle(
  element: HTMLElement,
  assetPublicUrlBySource: Map<string, string>
): string | undefined {
  const raw = element.getAttribute('style');
  if (!raw) return undefined;
  return raw.replace(/url\(([^)]+)\)/g, (fullMatch, rawValue) => {
    const original = String(rawValue).trim().replace(/^["']|["']$/g, '');
    if (!original || original.startsWith('data:') || original.startsWith('#')) {
      return fullMatch;
    }
    // Remote URLs (e.g. dynamic CMS backgrounds) get pre-downloaded in the
    // importer pipeline and registered in assetPublicUrlBySource by their
    // exact URL key. Rewrite to our local public URL when available.
    if (/^https?:\/\//.test(original)) {
      const remoteMapped = assetPublicUrlBySource.get(original);
      return remoteMapped ? `url("${remoteMapped}")` : fullMatch;
    }
    const baseName = path.posix.basename(original);
    const mapped = assetPublicUrlBySource.get(normalizeSlashes(original).replace(/^\.\//, ''))
      || assetPublicUrlBySource.get(baseName);
    return mapped ? `url("${mapped}")` : fullMatch;
  });
}

/**
 * Strip `!important` flags and normalise whitespace from a captured CSS value.
 * Tailwind arbitrary values cannot contain unescaped whitespace (the value is
 * split by whitespace when written into `class=""`), so leaving `!important`
 * inside the captured value would generate broken classes like
 * `text-[1.25rem !important]` which then shatter into `text-[1.25rem`
 * + `!important]` tokens at runtime.
 */
function sanitizeCssValue(value: string): string {
  return value.replace(/\s*!important\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function parseCssDeclaration(style: string | undefined, property: string): string | null {
  if (!style) return null;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = style.match(new RegExp(`${escaped}\\s*:\\s*([^;]+)`, 'i'));
  if (!match?.[1]) return null;
  const cleaned = sanitizeCssValue(match[1]);
  return cleaned || null;
}

function inferLayoutDesign(
  tag: string,
  classes: string,
  inlineStyle?: string
): Record<string, unknown> | undefined {
  const classSet = new Set(classes.split(/\s+/).map((c) => c.trim()).filter(Boolean));
  const displayFromStyle = parseCssDeclaration(inlineStyle, 'display')?.toLowerCase();
  const isGrid = classSet.has('w-layout-grid') || displayFromStyle === 'grid';
  const isNav = tag === 'nav' || classSet.has('w-nav') || classSet.has('w-nav-menu');

  if (isGrid) {
    const gridTemplateColumns = parseCssDeclaration(inlineStyle, 'grid-template-columns') || 'repeat(2, 1fr)';
    const gap = parseCssDeclaration(inlineStyle, 'gap')
      || parseCssDeclaration(inlineStyle, 'grid-gap')
      || '16px';
    return {
      layout: {
        isActive: true,
        display: 'Grid',
        gridTemplateColumns,
        gap,
      },
    };
  }

  if (isNav) {
    return {
      layout: {
        isActive: true,
        display: 'Flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      },
    };
  }

  return undefined;
}

function mapElementToLayer(
  node: HtmlNode,
  assetIdBySource: Map<string, string>,
  warnings: string[],
  assetPublicUrlBySource?: Map<string, string>
): Layer | null {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = node.rawText.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return buildTextLayer(text, 'span');
  }

  if (node.nodeType !== NodeType.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const className = element.getAttribute('class') || '';

  if (tag === 'script' || tag === 'link' || tag === 'style' || tag === 'noscript') {
    return null;
  }

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'small', 'label', 'blockquote'].includes(tag)) {
    const text = element.text.trim();
    if (!text) return null;
    const html = element.innerHTML.trim();
    const hasInnerHtml = html.includes('<');
    return buildTextLayer(hasInnerHtml ? html : text, tag, className);
  }

  const urlMap = assetPublicUrlBySource || new Map<string, string>();

  // Native component detection: each builder is gated behind its own flag
  // so we can ship one at a time. Defaults are defined in
  // `DEFAULT_DETECTOR_FLAGS` (only verified-safe builders are enabled).
  // The richText builder is on by default because it's strictly additive:
  // it produces a TipTap-shaped layer and never touches CMS bindings or
  // collection-aware logic, so it cannot break the existing import flow.
  const nativeLayer = detectWebflowComponent(element, {
    assetIdBySource,
    assetPublicUrlBySource: urlMap,
    warnings,
    recursivelyMap: (childNode) => mapElementToLayer(childNode, assetIdBySource, warnings, assetPublicUrlBySource),
  });
  if (nativeLayer) return nativeLayer;

  const inlineStyle = getInlineStyle(element, urlMap);
  const styleAttr = inlineStyle ? { style: inlineStyle } : undefined;

  // Pass through attributes that Webflow's runtime + accessibility tooling
  // depend on. The most important is `data-w-id` — without it the IX2 engine
  // (loaded via the user's webflow.js) cannot match elements to their hover /
  // scroll / click animation definitions.
  const passthroughAttrs: Record<string, string> = {};
  for (const attr of element.attributes ? Object.keys(element.attributes) : []) {
    if (
      attr.startsWith('data-w-')
      || attr.startsWith('aria-')
      || attr === 'role'
      || attr === 'id'
      || attr === 'tabindex'
    ) {
      const value = element.getAttribute(attr);
      if (value !== null && value !== undefined) {
        passthroughAttrs[attr] = value;
      }
    }
  }
  const baseAttrs = { ...passthroughAttrs, ...(styleAttr || {}) };

  if (tag === 'img') {
    const src = element.getAttribute('src') || '';
    const normalizedSrc = normalizeSlashes(src).replace(/^\.\//, '');
    const assetId = assetIdBySource.get(normalizedSrc)
      || assetIdBySource.get(stripTopLevelFolder(normalizedSrc))
      || assetIdBySource.get(path.basename(src));
    if (!assetId) {
      warnings.push(`Asset for image "${src}" not found in import payload`);
    }

    return {
      id: randomUUID(),
      name: 'image',
      classes: className,
      settings: { tag: 'img' },
      attributes: Object.keys(baseAttrs).length > 0 ? baseAttrs : undefined,
      variables: {
        image: {
          src: assetId
            ? { type: 'asset', data: { asset_id: assetId } }
            : { type: 'dynamic_text', data: { content: src } },
          alt: { type: 'dynamic_text', data: { content: element.getAttribute('alt') || '' } },
        },
      },
    };
  }

  if (tag === 'video') {
    const srcFromTag = element.getAttribute('src');
    const sourceNode = element.querySelector('source');
    const sourceSrc = sourceNode?.getAttribute('src');
    const src = srcFromTag || sourceSrc || '';
    const normalizedSrc = normalizeSlashes(src).replace(/^\.\//, '');
    const assetId = assetIdBySource.get(normalizedSrc)
      || assetIdBySource.get(stripTopLevelFolder(normalizedSrc))
      || assetIdBySource.get(path.basename(src));

    return {
      id: randomUUID(),
      name: 'video',
      classes: className,
      attributes: {
        ...baseAttrs,
        controls: element.getAttribute('controls') !== null,
        autoPlay: element.getAttribute('autoplay') !== null,
        loop: element.getAttribute('loop') !== null,
        muted: element.getAttribute('muted') !== null,
      },
      variables: {
        video: {
          src: assetId
            ? { type: 'asset', data: { asset_id: assetId } }
            : { type: 'dynamic_text', data: { content: src } },
        },
      },
    };
  }

  if (tag === 'a') {
    const href = resolveHref(element.getAttribute('href') || '#');
    const children = element.childNodes
      .map(child => mapElementToLayer(child, assetIdBySource, warnings, assetPublicUrlBySource))
      .filter((layer): layer is Layer => !!layer);
    const design = inferLayoutDesign(tag, className, inlineStyle);

    return {
      id: randomUUID(),
      name: 'div',
      ...(inferCustomName(tag, className) ? { customName: inferCustomName(tag, className) } : {}),
      classes: className,
      settings: { tag: 'a' },
      attributes: Object.keys(baseAttrs).length > 0 ? baseAttrs : undefined,
      ...(design ? { design } : {}),
      variables: {
        link: {
          type: 'url',
          url: { type: 'dynamic_text', data: { content: href } },
        },
      },
      children: children.length > 0 ? children : [buildTextLayer(element.text.trim() || 'Link', 'span')],
    };
  }

  const children = element.childNodes
    .map(child => mapElementToLayer(child, assetIdBySource, warnings, assetPublicUrlBySource))
    .filter((layer): layer is Layer => !!layer);

  const layerName = SAFE_HTML_TAGS.has(tag) ? tag : 'div';
  const inferredDesign = inferLayoutDesign(tag, className, inlineStyle);

  if (children.length === 0 && className.includes('w-embed')) {
    return null;
  }

  if (children.length === 0) {
    const text = element.text.trim();
    if (text) {
      return buildTextLayer(text, tag === 'div' ? 'div' : tag, className);
    }
  }

  return {
    id: randomUUID(),
    name: layerName,
    ...(inferCustomName(tag, className) ? { customName: inferCustomName(tag, className) } : {}),
    classes: className,
    settings: tag !== 'div' && tag !== layerName ? { tag } : undefined,
    attributes: Object.keys(baseAttrs).length > 0 ? baseAttrs : undefined,
    ...(inferredDesign ? { design: inferredDesign } : {}),
    children,
  };
}

function buildPagesFromHtml(
  htmlFiles: Array<{ filePath: string; content: string }>,
  assetIdBySource: Map<string, string>,
  assetPublicUrlBySource: Map<string, string>,
  warnings: string[]
): Array<{ page: Record<string, unknown>; pageLayers: Record<string, unknown> }> {
  return htmlFiles.map(({ filePath, content }, index) => {
    const slug = slugFromFilename(filePath);
    const fileBaseName = path.basename(filePath, '.html');
    const pageName = fileBaseName === 'index' ? 'Homepage' : fileBaseName.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const pageId = randomUUID();

    const root = parse(content);
    const body = root.querySelector('body');
    const bodyChildren = body?.childNodes || [];
    const children = bodyChildren
      .map(child => mapElementToLayer(child, assetIdBySource, warnings, assetPublicUrlBySource))
      .filter((layer): layer is Layer => !!layer);

    const layers: Layer[] = [{
      id: randomUUID(),
      name: 'body',
      classes: body?.getAttribute('class') || '',
      children,
    }];

    return {
      page: {
        id: pageId,
        name: pageName,
        slug,
        order: index,
        depth: 0,
        is_index: slug === '',
        is_dynamic: false,
        settings: {},
        is_published: false,
        // Internal: original Webflow filename (e.g. `detail_werke.html`).
        // Stripped before the DB insert; consumed by enhancePagesWithCmsBindings
        // to recognise CMS-template pages even after the `detail_` URL prefix
        // has been removed by `slugFromFilename`.
        __sourceFilename: fileBaseName,
      },
      pageLayers: {
        id: randomUUID(),
        page_id: pageId,
        layers,
        is_published: false,
      },
    };
  });
}

function buildProjectManifest(projectName: string, stats: WebflowImportResult): ProjectManifest {
  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    source: 'opensource',
    projectName,
    tables: [
      'settings',
      'assets',
      'pages',
      'page_layers',
      'layer_styles',
      'collections',
      'collection_fields',
      'collection_items',
      'collection_item_values',
    ],
    stats: {
      pages: stats.pages,
      components: 0,
      collections: stats.collections,
      assets: stats.assets,
    },
  };
}

async function processWebflowImportInternal(
  payload: WebflowImportPayload,
  shouldImport: boolean
): Promise<ConvertWebflowToProjectExportResponse> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const result: WebflowImportResult = {
    pages: 0,
    collections: 0,
    items: 0,
    assets: 0,
  };

  try {
    const zipBuffer = Buffer.from(payload.zipBase64, 'base64');
    const zip = await JSZip.loadAsync(zipBuffer);

    const topLevelFolder = detectTopLevelFolder(zip);
    const normZipPath = (p: string) =>
      topLevelFolder ? stripTopLevelFolder(p) : normalizeSlashes(p);

    const htmlFiles: Array<{ filePath: string; content: string }> = [];
    const cssFiles: Array<{ filePath: string; content: string }> = [];
    const jsFiles: Array<{ filePath: string; content: string }> = [];
    const zipAssets: Array<{ filePath: string; buffer: Buffer; mimeType: string }> = [];

    for (const [filePath, zipObject] of Object.entries(zip.files)) {
      if (zipObject.dir) continue;
      const normalizedPath = normZipPath(filePath);
      const lowerPath = normalizedPath.toLowerCase();

      if (lowerPath.endsWith('.html')) {
        htmlFiles.push({
          filePath: normalizedPath,
          content: await zipObject.async('text'),
        });
        continue;
      }

      if (lowerPath.endsWith('.css')) {
        cssFiles.push({
          filePath: normalizedPath,
          content: await zipObject.async('text'),
        });
        continue;
      }

      if (lowerPath.endsWith('.js')) {
        // Capture JS bundles (jQuery + webflow runtime + IX2 + slider/nav toggles).
        // We do NOT redistribute these files in our codebase; they are extracted
        // from the user's own Webflow ZIP and re-attached to their published pages
        // so navigation, dropdowns, sliders and animations keep working.
        jsFiles.push({
          filePath: normalizedPath,
          content: await zipObject.async('text'),
        });
        continue;
      }

      const buffer = await zipObject.async('nodebuffer');
      zipAssets.push({
        filePath: normalizedPath,
        buffer,
        mimeType: inferMimeType(normalizedPath),
      });
    }

    htmlFiles.sort((a, b) => a.filePath.localeCompare(b.filePath));

    const importedAssets: Array<Record<string, unknown>> = [];
    const assetIdBySource = new Map<string, string>();
    const assetPublicUrlBySource = new Map<string, string>();
    const remoteAssetCache = new Map<string, string>();

    for (const asset of zipAssets) {
      try {
        const uploaded = await uploadAssetBuffer(path.basename(asset.filePath), asset.buffer, asset.mimeType);
        importedAssets.push({
          id: uploaded.id,
          source: 'webflow-import',
          filename: path.basename(asset.filePath, path.extname(asset.filePath)),
          storage_path: uploaded.storagePath,
          public_url: uploaded.publicUrl,
          file_size: asset.buffer.byteLength,
          mime_type: asset.mimeType,
          is_published: false,
        });
        const normalizedSource = normalizeSlashes(asset.filePath);
        assetIdBySource.set(normalizedSource, uploaded.id);
        if (uploaded.publicUrl) {
          assetPublicUrlBySource.set(normalizedSource, uploaded.publicUrl);
        }
        const baseName = path.basename(asset.filePath);
        if (!assetIdBySource.has(baseName)) {
          assetIdBySource.set(baseName, uploaded.id);
        }
        if (uploaded.publicUrl && !assetPublicUrlBySource.has(baseName)) {
          assetPublicUrlBySource.set(baseName, uploaded.publicUrl);
        }
      } catch (error) {
        warnings.push(`Asset "${asset.filePath}" could not be imported: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    const assetRows = [...importedAssets];

    const ingestRemoteAssetUrl = async (
      remoteUrl: string,
      contextLabel: string
    ): Promise<void> => {
      if (assetIdBySource.has(remoteUrl) || remoteAssetCache.has(remoteUrl)) {
        return;
      }
      const downloaded = await downloadRemoteAsset(remoteUrl);
      if (!downloaded) {
        warnings.push(`Remote ${contextLabel} asset "${remoteUrl}" could not be downloaded`);
        return;
      }
      const uploaded = await uploadAssetBuffer(downloaded.filename, downloaded.buffer, downloaded.mimeType);
      remoteAssetCache.set(remoteUrl, uploaded.id);
      assetIdBySource.set(remoteUrl, uploaded.id);
      if (uploaded.publicUrl) {
        assetPublicUrlBySource.set(remoteUrl, uploaded.publicUrl);
      }
      assetRows.push({
        id: uploaded.id,
        source: 'webflow-import',
        filename: downloaded.filename.replace(/\.[^/.]+$/, ''),
        storage_path: uploaded.storagePath,
        public_url: uploaded.publicUrl || '',
        file_size: downloaded.buffer.byteLength,
        mime_type: downloaded.mimeType,
        is_published: false,
      });
    };

    // Import asset URLs referenced in CSS (remote and local)
    for (const cssFile of cssFiles) {
      for (const cssUrl of extractCssUrls(cssFile.content)) {
        const normalized = normalizeSlashes(cssUrl).replace(/^\.\//, '');
        if (assetIdBySource.has(normalized) || assetIdBySource.has(stripTopLevelFolder(normalized))) {
          continue;
        }

        if (/^https?:\/\//.test(normalized)) {
          await ingestRemoteAssetUrl(normalized, 'CSS');
        }
      }
    }

    // Import asset URLs referenced inline in HTML (background-image, srcset,
    // dynamic CMS-resolved styles, etc). Webflow renders dynamic CMS
    // backgrounds as `style="background-image:url('https://cdn...')"` —
    // without this loop those URLs would stay pointing at the original CDN.
    const inlineUrlRegex = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;
    const seenInlineUrls = new Set<string>();
    for (const htmlFile of htmlFiles) {
      const styleAttrRegex = /\sstyle\s*=\s*"([^"]*)"|\sstyle\s*=\s*'([^']*)'/gi;
      for (const styleMatch of htmlFile.content.matchAll(styleAttrRegex)) {
        const styleBody = styleMatch[1] || styleMatch[2] || '';
        for (const urlMatch of styleBody.matchAll(inlineUrlRegex)) {
          const raw = (urlMatch[2] || '').trim();
          if (!raw || raw.startsWith('data:') || seenInlineUrls.has(raw)) continue;
          seenInlineUrls.add(raw);
          if (!/^https?:\/\//.test(raw)) continue;
          await ingestRemoteAssetUrl(raw, 'inline-style');
        }
      }
    }

    const parsedCsvCollections = parseWebflowCsv(payload);
    const normalizedCollections: NormalizedCollection[] = parsedCsvCollections.map((collection) => ({
      id: randomUUID(),
      webflowCollectionId: collection.webflowCollectionId,
      name: collection.name,
      headers: collection.headers.filter(header => !CSV_META_COLUMNS.has(header)),
      rows: collection.rows,
    }));

    const itemIdMap = new Map<string, string>(); // key: `${collectionId}:${oldItemId}` => newItemId
    const webflowItemIdsByCollection = new Map<string, Set<string>>();
    for (const collection of normalizedCollections) {
      const set = new Set<string>();
      for (const row of collection.rows) {
        const oldItemId = row['Item ID'];
        if (oldItemId) {
          set.add(oldItemId);
        }
      }
      webflowItemIdsByCollection.set(collection.id, set);
    }

    const fields: NormalizedField[] = [];
    for (const collection of normalizedCollections) {
      collection.headers.forEach((header, index) => {
        const values = collection.rows
          .map(row => (row[header] || '').trim())
          .filter(Boolean);

        const primitiveType = classifyPrimitiveType(values);
        const relation = inferRelationType(values, webflowItemIdsByCollection);

        const fieldType = relation.type || primitiveType || 'text';
        const referenceCollectionId = relation.targetCollectionId;

        fields.push({
          id: randomUUID(),
          collectionId: collection.id,
          csvHeader: header,
          name: header,
          key: mapFieldKeyFromHeader(header),
          type: fieldType,
          order: index,
          referenceCollectionId,
        });
      });
    }

    const fieldByCollectionAndHeader = new Map<string, NormalizedField>();
    for (const field of fields) {
      fieldByCollectionAndHeader.set(`${field.collectionId}:${field.csvHeader}`, field);
    }

    const collectionRows: Record<string, unknown>[] = normalizedCollections.map((collection, index) => ({
      id: collection.id,
      name: collection.name,
      uuid: randomUUID(),
      sorting: null,
      order: index,
      is_published: false,
    }));

    const fieldRows: Record<string, unknown>[] = fields.map((field) => ({
      id: field.id,
      collection_id: field.collectionId,
      reference_collection_id: field.referenceCollectionId,
      name: field.name,
      key: field.key,
      type: field.type,
      default: null,
      fillable: true,
      order: field.order,
      hidden: false,
      is_computed: false,
      data: {},
      is_published: false,
    }));

    const itemRows: Record<string, unknown>[] = [];
    const valueRows: Record<string, unknown>[] = [];

    for (const collection of normalizedCollections) {
      for (let rowIndex = 0; rowIndex < collection.rows.length; rowIndex++) {
        const row = collection.rows[rowIndex];
        const oldItemId = row['Item ID'] || `${collection.id}:${rowIndex}`;
        const newItemId = randomUUID();
        itemIdMap.set(`${collection.id}:${oldItemId}`, newItemId);

        itemRows.push({
          id: newItemId,
          collection_id: collection.id,
          manual_order: rowIndex,
          is_publishable: true,
          is_published: false,
        });
      }
    }

    for (const collection of normalizedCollections) {
      for (let rowIndex = 0; rowIndex < collection.rows.length; rowIndex++) {
        const row = collection.rows[rowIndex];
        const oldItemId = row['Item ID'] || `${collection.id}:${rowIndex}`;
        const newItemId = itemIdMap.get(`${collection.id}:${oldItemId}`);
        if (!newItemId) continue;

        for (const header of collection.headers) {
          const rawValue = (row[header] || '').trim();
          if (!rawValue) continue;

          const field = fieldByCollectionAndHeader.get(`${collection.id}:${header}`);
          if (!field) continue;

          let finalValue: string | null = rawValue;

          if (field.type === 'reference') {
            const oldRefId = splitReferenceCandidates(rawValue)[0];
            const targetCollectionId = field.referenceCollectionId;
            if (targetCollectionId) {
              const translatedId = itemIdMap.get(`${targetCollectionId}:${oldRefId}`);
              if (translatedId) {
                finalValue = translatedId;
              } else {
                warnings.push(`Relation value "${rawValue}" in ${collection.name}.${header} could not be translated`);
                finalValue = null;
              }
            }
          } else if (field.type === 'multi_reference') {
            const targetCollectionId = field.referenceCollectionId;
            if (targetCollectionId) {
              const translated = splitReferenceCandidates(rawValue)
                .map(oldRefId => itemIdMap.get(`${targetCollectionId}:${oldRefId}`))
                .filter((value): value is string => !!value);
              finalValue = JSON.stringify(translated);
              if (translated.length === 0) {
                warnings.push(`Multi relation "${rawValue}" in ${collection.name}.${header} produced no mapped IDs`);
              }
            }
          } else if (field.type === 'image' || field.type === 'video' || field.type === 'audio' || field.type === 'document') {
            const assetCandidates = splitReferenceCandidates(rawValue);
            const resolvedAssetIds: string[] = [];

            for (const candidateRaw of assetCandidates) {
              const normalized = normalizeSlashes(candidateRaw).replace(/^\.\//, '');
              let assetId = assetIdBySource.get(normalized) || assetIdBySource.get(stripTopLevelFolder(normalized));

              if (!assetId && /^https?:\/\//.test(normalized)) {
                if (remoteAssetCache.has(normalized)) {
                  assetId = remoteAssetCache.get(normalized);
                } else {
                  const downloaded = await downloadRemoteAsset(normalized);
                  if (downloaded) {
                    const uploaded = await uploadAssetBuffer(downloaded.filename, downloaded.buffer, downloaded.mimeType);
                    remoteAssetCache.set(normalized, uploaded.id);
                    assetIdBySource.set(normalized, uploaded.id);
                    if (uploaded.publicUrl) {
                      assetPublicUrlBySource.set(normalized, uploaded.publicUrl);
                    }
                    assetRows.push({
                      id: uploaded.id,
                      source: 'webflow-import',
                      filename: downloaded.filename.replace(/\.[^/.]+$/, ''),
                      storage_path: uploaded.storagePath,
                      public_url: uploaded.publicUrl || '',
                      file_size: downloaded.buffer.byteLength,
                      mime_type: downloaded.mimeType,
                      is_published: false,
                    });
                    assetId = uploaded.id;
                  }
                }
              }

              if (assetId) {
                resolvedAssetIds.push(assetId);
              } else {
                warnings.push(`Asset reference "${candidateRaw}" in ${collection.name}.${header} could not be downloaded/resolved`);
              }
            }

            if (resolvedAssetIds.length === 0) {
              finalValue = null;
            } else if (resolvedAssetIds.length === 1) {
              finalValue = resolvedAssetIds[0];
            } else {
              // Preserve multi-asset values from CSV exports (semicolon/comma separated URLs).
              finalValue = JSON.stringify(resolvedAssetIds);
            }
          } else if (field.type === 'boolean') {
            const lower = rawValue.toLowerCase();
            finalValue = (lower === 'true' || lower === 'yes' || lower === '1') ? 'true' : 'false';
          } else if (field.type === 'rich_text') {
            finalValue = JSON.stringify(stringToTiptapContent(rawValue));
          }

          if (finalValue !== null) {
            valueRows.push({
              id: randomUUID(),
              item_id: newItemId,
              field_id: field.id,
              value: finalValue,
              is_published: false,
            });
          }
        }
      }
    }

    const cssOrderFromHtml = Array.from(new Set(
      htmlFiles.flatMap(file => extractStylesheetHrefsFromHtml(file.content))
    ));

    // Concatenate JS bundles in a deterministic order (jQuery first, then
    // webflow runtime, then everything else). The user's own ZIP is the source
    // of truth — we don't ship any of these files in our codebase, we only
    // serve them back as part of the user's own published site.
    const sortJsForRuntime = (filename: string): number => {
      const lower = filename.toLowerCase();
      if (lower.includes('jquery')) return 0;
      if (lower.includes('webflow')) return 1;
      return 2;
    };
    const orderedJsFiles = [...jsFiles].sort((a, b) => {
      const diff = sortJsForRuntime(a.filePath) - sortJsForRuntime(b.filePath);
      if (diff !== 0) return diff;
      return a.filePath.localeCompare(b.filePath);
    });
    const importedJs = orderedJsFiles
      .map(file => `/* ${file.filePath} */\n${file.content}`)
      .join('\n;\n');

    const builtPages = buildPagesFromHtml(htmlFiles, assetIdBySource, assetPublicUrlBySource, warnings);
    const enhancedPages = enhancePagesWithCmsBindings(
      builtPages,
      normalizedCollections,
      fields
    );
    // Strip importer-internal fields (e.g. `__sourceFilename`) so the row
    // shape matches the `pages` table — extra columns would cause a knex
    // insert to fail on strict-mode databases.
    const pageRows = enhancedPages.map((entry) => {
      const { __sourceFilename, ...cleanRow } = entry.page as Record<string, unknown>;
      void __sourceFilename;
      return cleanRow;
    });
    const pageLayerRows = enhancedPages.map(entry => entry.pageLayers);
    const embeddedCssBlocks = htmlFiles
      .map(file => extractEmbeddedCssFromHtml(file.content))
      .filter(Boolean);
    const baseCss = buildImportedCss(cssFiles, assetPublicUrlBySource, cssOrderFromHtml);
    // Defaults that keep imported Webflow content readable inside Webwow:
    // - rich-text images stay inside their container (Webflow renders them
    //   intrinsic-sized and they overflow our layout otherwise)
    // - bg-image containers should not collapse when the bg url ends up
    //   missing (rare, but happens for some CMS items without an image)
    const webwowImportDefaultsCss = [
      '/* webwow: import defaults */',
      '.w-richtext img,',
      '.rich-text img,',
      '[data-rich-text] img,',
      '.w-richtext figure img {',
      '  max-width: 100%;',
      '  height: auto;',
      '  display: block;',
      '}',
      '.w-richtext figure {',
      '  max-width: 100%;',
      '}',
    ].join('\n');
    const importedCss = [baseCss, webwowImportDefaultsCss, ...embeddedCssBlocks]
      .filter(Boolean)
      .join('\n\n');
    const cssSourcesForStyleMapping = [
      ...cssFiles,
      ...embeddedCssBlocks.map((content, index) => ({
        filePath: `embedded-${index + 1}.css`,
        content,
      })),
    ];
    const {
      layerStyleRows,
      styleIdByClassSignature,
      styleClassesByClassSignature,
      styleDesignByClassSignature,
      classTokenToTailwindMap,
    } = buildLayerStyles(
      cssSourcesForStyleMapping,
      pageLayerRows as Array<{ layers: Layer[] }>
    );
    const styledPageLayerRows = pageLayerRows.map((pageLayerRow) => ({
      ...pageLayerRow,
      layers: applyLayerStylesToTree(
        (pageLayerRow.layers as Layer[]) || [],
        styleIdByClassSignature,
        styleClassesByClassSignature,
        styleDesignByClassSignature,
        classTokenToTailwindMap
      ),
    }));
    const dedupedLayerStyleRows = dedupeLayerStyles(layerStyleRows);

    // ── Self-heal pass (#29) ────────────────────────────────────────────
    // After dedupe + apply, some layers may carry a `styleId` that no longer
    // matches a row in `layer_styles` (because dedup collapsed two entries
    // with the same name, or because applyLayerStylesToTree wrote a stale
    // signature reference). Sweep the entire tree and:
    //   1. drop styleIds that point at a non-existent style row, and
    //   2. relink them to the style whose `classes` matches the layer's
    //      class signature when possible.
    // This prevents the "No collection selected" / blank-design-panel
    // symptoms that surface when the editor follows a dead reference.
    const validStyleIds = new Set<string>(
      dedupedLayerStyleRows.map((row) => String(row.id))
    );
    const styleIdByExactClasses = new Map<string, string>();
    for (const row of dedupedLayerStyleRows) {
      const classes = normalizeClassSignature(String(row.classes || ''));
      if (classes && !styleIdByExactClasses.has(classes)) {
        styleIdByExactClasses.set(classes, String(row.id));
      }
    }
    let healedRefs = 0;
    let droppedRefs = 0;
    const healLayerTree = (layers: Layer[]): Layer[] =>
      layers.map((layer) => {
        const next: Layer = { ...layer };
        const currentStyleId = (next as { styleId?: string }).styleId;
        if (currentStyleId && !validStyleIds.has(currentStyleId)) {
          const replacement = styleIdByExactClasses.get(
            normalizeClassSignature(getLayerClasses(next))
          );
          if (replacement) {
            (next as { styleId?: string }).styleId = replacement;
            healedRefs++;
          } else {
            delete (next as { styleId?: string }).styleId;
            droppedRefs++;
          }
        }
        if (next.children?.length) {
          next.children = healLayerTree(next.children);
        }
        return next;
      });
    const healedPageLayerRows = styledPageLayerRows.map((row) => ({
      ...row,
      layers: healLayerTree((row.layers as Layer[]) || []),
    }));
    if (healedRefs + droppedRefs > 0) {
      warnings.push(
        `Self-heal: relinked ${healedRefs} layer styleId references, dropped ${droppedRefs} unresolvable refs`
      );
    }

    result.pages = pageRows.length;
    result.collections = collectionRows.length;
    result.items = itemRows.length;
    result.assets = assetRows.length;

    const manifest = buildProjectManifest(
      sanitizeCollectionName(path.basename(payload.zipFilename, path.extname(payload.zipFilename))),
      result
    );

    const data: Record<string, Record<string, unknown>[]> = {
      settings: [
        { key: 'site_name', value: 'Imported from Webflow' },
        { key: 'site_description', value: 'Imported from Webflow export' },
        { key: 'webwow_version', value: '0.1.0' },
        { key: 'sitemap', value: getDefaultSitemapSettings() },
        { key: 'webwow_badge', value: false },
        { key: 'timezone', value: 'UTC' },
        { key: 'draft_css', value: importedCss },
        { key: 'published_css', value: importedCss },
        // JS extracted from the user's own Webflow ZIP (jQuery + webflow runtime
        // + IX2 + slider/nav toggles). Injected into published pages only.
        { key: 'imported_js', value: importedJs },
      ],
      assets: assetRows,
      pages: pageRows,
      page_layers: healedPageLayerRows,
      layer_styles: dedupedLayerStyleRows,
      collections: collectionRows,
      collection_fields: fieldRows,
      collection_items: itemRows,
      collection_item_values: valueRows,
    };

    if (shouldImport) {
      const importResult = await importProject(manifest, data);
      if (!importResult.success) {
        errors.push(importResult.error || 'Import in projectService failed');
      }
    }

    const exportData: ProjectExportData = {
      manifest,
      data,
    };

    return {
      success: errors.length === 0,
      result,
      warnings,
      errors,
      exportData,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown Webflow import error');
  }

  return {
    success: errors.length === 0,
    result,
    warnings,
    errors,
  };
}

export async function processWebflowImport(
  payload: WebflowImportPayload
): Promise<ProcessWebflowImportResponse> {
  const response = await processWebflowImportInternal(payload, true);
  return {
    success: response.success,
    result: response.result,
    warnings: response.warnings,
    errors: response.errors,
  };
}

export async function convertWebflowToProjectExport(
  payload: WebflowImportPayload
): Promise<ConvertWebflowToProjectExportResponse> {
  return processWebflowImportInternal(payload, false);
}

export function badRequest(message: string) {
  return noCache({ error: message }, 400);
}
