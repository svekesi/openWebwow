/**
 * Webflow → Webwow Native Component Detector
 *
 * Central pattern-detection layer that converts Webflow's semantic markup
 * (`.w-dyn-list`, `.w-richtext`, `.w-slider`, …) into Webwow's native layer
 * components BEFORE the generic div-mapping fallback runs.
 *
 * Why this exists:
 *   The previous import strategy treated every Webflow element as a generic
 *   `<div>` with translated CSS classes. That kept the visual output close
 *   most of the time but lost ALL native integration: collection lists got
 *   no field bindings, sliders couldn't be edited as carousels, rich-text
 *   embeds couldn't be opened in the TipTap editor.
 *
 *   Webwow already has first-class layer types for every major Webflow
 *   semantic component (`collection`, `slider`, `richText`, …). Mapping
 *   straight to those gives:
 *     - Editor: real native UI (carousel arrows, CMS field picker, etc.)
 *     - Runtime: native React rendering, no jQuery/IX2 dependency for these
 *     - Less translation surface = far fewer edge-case bugs
 */
import { randomUUID } from 'crypto';
import { parse, type HTMLElement, NodeType, type Node as HtmlNode } from 'node-html-parser';
import path from 'path';
import type { Layer, CollectionFieldType } from '@/types';
import { stringToTiptapContent } from '@/lib/text-format-utils';

// ─── Types ──────────────────────────────────────────────────────────────

export interface DetectorContext {
  assetIdBySource: Map<string, string>;
  assetPublicUrlBySource: Map<string, string>;
  warnings: string[];
  /**
   * Recursive mapper from the calling importer. The detector calls back
   * into this for nested elements that should still go through the generic
   * div-mapping path.
   */
  recursivelyMap: (node: HtmlNode) => Layer | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function classSet(element: HTMLElement): Set<string> {
  return new Set(
    (element.getAttribute('class') || '')
      .split(/\s+/)
      .map((c) => c.trim())
      .filter(Boolean)
  );
}

function hasClass(element: HTMLElement, className: string): boolean {
  return classSet(element).has(className);
}

function findFirstByClass(root: HTMLElement, className: string): HTMLElement | null {
  return root.querySelector(`.${className}`) as HTMLElement | null;
}

function normalizeAssetSrc(src: string): string {
  return src.replace(/\\/g, '/').replace(/^\.\//, '');
}

function lookupAssetId(
  src: string,
  assetIdBySource: Map<string, string>
): string | undefined {
  if (!src) return undefined;
  const normalized = normalizeAssetSrc(src);
  return (
    assetIdBySource.get(normalized)
    || assetIdBySource.get(normalized.split('/').slice(1).join('/'))
    || assetIdBySource.get(path.basename(src))
    || (/^https?:\/\//.test(src) ? assetIdBySource.get(src) : undefined)
  );
}

// ─── Builder: Native Rich Text ──────────────────────────────────────────

/**
 * Convert Webflow's `.w-richtext` div (containing real HTML: h1..h6, p, ul,
 * ol, blockquote, img, a) into a native Webwow `richText` layer with
 * TipTap-shaped content. The native layer is editable with our TipTap
 * editor and renders bullet/numbered lists, headings, links, images, etc.
 * with consistent typography instead of the broken Webflow inline rules.
 */
export function buildNativeRichText(
  element: HTMLElement,
  context: DetectorContext
): Layer {
  const html = element.innerHTML.trim();
  const tiptapContent = htmlToTiptap(html, context);

  const className = element.getAttribute('class') || '';

  return {
    id: randomUUID(),
    name: 'richText',
    customName: 'Rich Text',
    classes: className,
    restrictions: { editText: true },
    variables: {
      text: {
        type: 'dynamic_rich_text',
        data: { content: tiptapContent },
      },
    },
  } as unknown as Layer;
}

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

function htmlToTiptap(html: string, context: DetectorContext): TiptapNode {
  if (!html) {
    return stringToTiptapContent('');
  }

  // Use node-html-parser (already a project dependency) for robust nested
  // structure handling. The previous regex approach choked on combinations
  // like `<p>text <a>link <strong>bold</strong></a> tail</p>` and on
  // self-closing elements inside paragraphs (`<br>`, `<img>`).
  const root = parse(`<div>${html}</div>`);
  const wrapper = root.firstChild as HTMLElement;
  if (!wrapper) {
    return stringToTiptapContent('');
  }

  const blocks: TiptapNode[] = [];
  for (const child of wrapper.childNodes) {
    const block = nodeToBlock(child, context);
    if (block) blocks.push(block);
  }

  if (blocks.length === 0) {
    return stringToTiptapContent('');
  }

  return { type: 'doc', content: blocks };
}

function nodeToBlock(node: HtmlNode, context: DetectorContext): TiptapNode | null {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const raw = (node as unknown as { rawText: string }).rawText;
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return { type: 'paragraph', content: [{ type: 'text', text }] };
  }

  if (node.nodeType !== NodeType.ELEMENT_NODE) {
    return null;
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return {
      type: 'heading',
      attrs: { level },
      content: nodeChildrenToInline(el),
    };
  }

  if (tag === 'p') {
    const inline = nodeChildrenToInline(el);
    if (inline.length === 0) return null;
    return { type: 'paragraph', content: inline };
  }

  if (tag === 'blockquote') {
    return {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: nodeChildrenToInline(el) }],
    };
  }

  if (tag === 'ul' || tag === 'ol') {
    const items: TiptapNode[] = [];
    for (const li of el.childNodes) {
      if (li.nodeType !== NodeType.ELEMENT_NODE) continue;
      const liEl = li as HTMLElement;
      if (liEl.tagName.toLowerCase() !== 'li') continue;
      items.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: nodeChildrenToInline(liEl) }],
      });
    }
    return {
      type: tag === 'ul' ? 'bulletList' : 'orderedList',
      content: items,
    };
  }

  if (tag === 'figure') {
    const img = el.querySelector('img') as HTMLElement | null;
    if (img) {
      return imageNode(img, context);
    }
    // Fallback: treat figure content as paragraph
    const inline = nodeChildrenToInline(el);
    if (inline.length === 0) return null;
    return { type: 'paragraph', content: inline };
  }

  if (tag === 'img') {
    return imageNode(el, context);
  }

  // Unknown block: degrade gracefully into paragraph with extracted text
  const inline = nodeChildrenToInline(el);
  if (inline.length === 0) return null;
  return { type: 'paragraph', content: inline };
}

function imageNode(el: HTMLElement, context: DetectorContext): TiptapNode | null {
  const src = (el.getAttribute('src') || '').trim();
  if (!src) return null;
  const assetId = lookupAssetId(src, context.assetIdBySource);
  const url = assetId
    ? (context.assetPublicUrlBySource.get(normalizeAssetSrc(src))
        || context.assetPublicUrlBySource.get(path.basename(src))
        || src)
    : src;
  const alt = (el.getAttribute('alt') || '').trim();
  return {
    type: 'image',
    attrs: { src: url, alt: alt || null },
  };
}

function nodeChildrenToInline(el: HTMLElement): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const child of el.childNodes) {
    out.push(...nodeToInline(child, []));
  }
  return out;
}

function nodeToInline(node: HtmlNode, marks: TiptapNode['marks']): TiptapNode[] {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const raw = (node as unknown as { rawText: string }).rawText;
    const text = raw.replace(/\s+/g, ' ');
    if (!text || !text.trim()) return [];
    return [{ type: 'text', marks: marks?.length ? marks : undefined, text }];
  }

  if (node.nodeType !== NodeType.ELEMENT_NODE) return [];

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    return [{ type: 'hardBreak' }];
  }

  let nextMarks = marks ? [...marks] : [];

  if (tag === 'strong' || tag === 'b') {
    nextMarks = [...nextMarks, { type: 'bold' }];
  } else if (tag === 'em' || tag === 'i') {
    nextMarks = [...nextMarks, { type: 'italic' }];
  } else if (tag === 'u') {
    nextMarks = [...nextMarks, { type: 'underline' }];
  } else if (tag === 's' || tag === 'strike' || tag === 'del') {
    nextMarks = [...nextMarks, { type: 'strike' }];
  } else if (tag === 'code') {
    nextMarks = [...nextMarks, { type: 'code' }];
  } else if (tag === 'a') {
    const href = (el.getAttribute('href') || '#').trim();
    nextMarks = [
      ...nextMarks,
      { type: 'richTextLink', attrs: { href, linkType: 'url' } },
    ];
  } else if (tag === 'img') {
    // Inline image inside a paragraph — TipTap usually wants this as a block,
    // but for richtext we keep it inline so paragraph flow isn't broken.
    return [];
  }

  const out: TiptapNode[] = [];
  for (const child of el.childNodes) {
    out.push(...nodeToInline(child, nextMarks));
  }
  return out;
}

// ─── Builder: Native Collection List ────────────────────────────────────

/**
 * Convert Webflow's `.w-dyn-list` (containing `.w-dyn-items` →
 * `.w-dyn-item` template + `.w-dyn-empty`) into a native Webwow
 * `collection` layer. The actual collection_id + field bindings are
 * applied later by `enhancePagesWithCmsBindings()` in the importer —
 * this builder just normalises the structure so the binder finds the
 * `w-dyn-item` template at the expected position.
 */
export function buildNativeCollection(
  element: HTMLElement,
  context: DetectorContext
): Layer {
  const className = element.getAttribute('class') || '';
  const itemsWrapper =
    findFirstByClass(element, 'w-dyn-items')
    || element;

  const itemTemplate = findFirstByClass(itemsWrapper, 'w-dyn-item');
  const emptyState = findFirstByClass(element, 'w-dyn-empty');

  // Map the item template through the generic mapper so it inherits all
  // the regular div→layer translation. We then wrap it so the existing
  // `bindCollectionLayersForPage()` step can find and bind it.
  const itemLayer = itemTemplate ? context.recursivelyMap(itemTemplate) : null;
  const emptyLayer = emptyState ? context.recursivelyMap(emptyState) : null;

  const itemsLayer: Layer = {
    id: randomUUID(),
    name: 'div',
    customName: 'Collection Items',
    classes: 'flex flex-col gap-[16px] w-dyn-items',
    children: itemLayer ? [itemLayer] : [],
  } as unknown as Layer;

  const children: Layer[] = [itemsLayer];
  if (emptyLayer) children.push(emptyLayer);

  return {
    id: randomUUID(),
    name: 'div',
    customName: 'Collection List',
    classes: className,
    children,
    variables: {
      collection: {
        // Collection id + sort/limit get filled in by the importer's
        // `bindCollectionLayersForPage()` step. Default limit:1 keeps the
        // editor canvas readable on first import.
        id: '',
        sort_by: 'manual',
        sort_order: 'asc',
        limit: 1,
      },
    },
  } as unknown as Layer;
}

// ─── Builder: Native Slider ─────────────────────────────────────────────

/**
 * Convert Webflow's `.w-slider` markup into a native Webwow `slider` layer
 * powered by Swiper. Each `.w-slide` becomes a child slide with the same
 * inner layer tree (mapped recursively).
 *
 * Slider behaviour (autoplay, loop, transition, navigation, pagination,
 * duration, easing) is auto-detected from Webflow's `data-*` attributes
 * on the `.w-slider` element so the imported slider behaves like the live
 * Webflow site without manual configuration.
 *
 * Webflow's JS-rendered chrome (`.w-slider-arrow-left/right`, `.w-slider-nav`,
 * `.w-slider-dot`) is dropped — Swiper renders its own arrows + pagination
 * inside the native template. Visual styling for those is handled by the
 * Webwow slider layer's own classes.
 */
export function buildNativeSlider(
  element: HTMLElement,
  context: DetectorContext
): Layer {
  const className = element.getAttribute('class') || '';

  // Auto-detect slider settings from Webflow data attributes.
  // (See https://help.webflow.com/hc/en-us/articles/33961421149459 for the
  // canonical list — animation, autoplay, duration, easing, infinite, etc.)
  const animation = (element.getAttribute('data-animation') || '').toLowerCase();
  const autoplay = element.getAttribute('data-autoplay') === '1'
    || element.getAttribute('data-autoplay') === 'true';
  const loopRaw = element.getAttribute('data-infinite');
  const loop = loopRaw === '1' || loopRaw === 'true' ? 'all' : 'none';
  const easing = element.getAttribute('data-easing') || 'ease-in-out';
  const durationMs = parseFloat(element.getAttribute('data-duration') || '500');
  const duration = Number.isFinite(durationMs) ? String(durationMs / 1000) : '0.5';
  const delayMs = parseFloat(element.getAttribute('data-delay') || '4000');
  const delay = Number.isFinite(delayMs) ? String(delayMs / 1000) : '4';
  const hideArrows = element.getAttribute('data-hide-arrows') === '1'
    || element.getAttribute('data-hide-arrows') === 'true';
  const disableSwipe = element.getAttribute('data-disable-swipe') === '1'
    || element.getAttribute('data-disable-swipe') === 'true';

  const slideMaskOrWrapper =
    findFirstByClass(element, 'w-slider-mask')
    || element;

  const slideElements = Array.from(slideMaskOrWrapper.childNodes)
    .filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE && hasClass(n as HTMLElement, 'w-slide'));

  const slideLayers: Layer[] = slideElements
    .map((slide) => context.recursivelyMap(slide))
    .filter((layer): layer is Layer => !!layer)
    .map((layer) => ({
      ...layer,
      name: 'slide',
      customName: 'Slide',
      classes: 'flex-shrink-0 w-full h-full',
      restrictions: { copy: true, delete: true, ancestor: 'slider' },
    }));

  if (slideLayers.length === 0) {
    context.warnings.push('Slider element had no detectable .w-slide children — falling back to empty slider');
  }

  const slidesWrapper: Layer = {
    id: randomUUID(),
    name: 'slides',
    customName: 'Slides',
    classes: 'flex w-full h-full overflow-visible',
    children: slideLayers,
    restrictions: { copy: false, delete: false, ancestor: 'slider' },
  } as unknown as Layer;

  return {
    id: randomUUID(),
    name: 'slider',
    customName: 'Slider',
    // Keep the original Webflow class so any custom CSS (`.my-hero-slider`)
    // still applies, plus a defensive set of layout classes to ensure it
    // always renders as a flex container with overflow:hidden even before
    // the user opens the design panel.
    classes: `${className} relative overflow-hidden`,
    settings: {
      tag: 'div',
      slider: {
        navigation: !hideArrows,
        groupSlide: 1,
        slidesPerGroup: 1,
        loop,
        centered: false,
        touchEvents: !disableSwipe,
        slideToClicked: false,
        mousewheel: false,
        pagination: true,
        paginationType: 'bullets',
        paginationClickable: true,
        autoplay,
        pauseOnHover: true,
        delay,
        animationEffect: animation === 'cross' || animation === 'fade' ? 'fade' : 'slide',
        easing,
        duration,
      },
    },
    children: [slidesWrapper],
  } as unknown as Layer;
}

// ─── Builder: Native Tabs (.w-tabs) ─────────────────────────────────────

/**
 * Convert Webflow's tabs widget into a Webwow representation that keeps
 * the original DOM structure (for CSS continuity) but adds native click
 * handlers via the imported webflow.js — Webflow ships a tab toggler in
 * its runtime, so we don't need to reimplement it. We just preserve all
 * `data-w-*` and ARIA attributes so the runtime can find the elements.
 *
 * Webflow tabs DOM:
 *   .w-tabs
 *     .w-tab-menu
 *       .w-tab-link[data-w-tab="Tab 1"]
 *     .w-tab-content
 *       .w-tab-pane[data-w-tab="Tab 1"]
 */
export function buildNativeTabs(
  element: HTMLElement,
  context: DetectorContext
): Layer {
  const className = element.getAttribute('class') || '';

  // Tabs widget is heavy on data-w-* attrs that webflow.js needs. Children
  // are mapped through the generic pipeline, which preserves classes and
  // data attrs (we added attribute passthrough earlier).
  const childLayers: Layer[] = [];
  for (const child of element.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const layer = context.recursivelyMap(child);
    if (layer) childLayers.push(layer);
  }

  return {
    id: randomUUID(),
    name: 'div',
    customName: 'Tabs',
    classes: className,
    children: childLayers,
  } as unknown as Layer;
}

// ─── Builder: Native Lightbox (.w-lightbox) ─────────────────────────────

/**
 * Convert Webflow's `.w-lightbox` link wrapper into a Webwow `lightbox`
 * layer. Webflow lightboxes carry a JSON payload in a `<script class="w-json">`
 * child describing the gallery items (thumbnail URL, full-resolution URL,
 * caption). We extract that payload, map the asset references to local IDs
 * where possible, and configure the native Webwow lightbox layer with the
 * collected files.
 */
export function buildNativeLightbox(
  element: HTMLElement,
  context: DetectorContext
): Layer {
  const className = element.getAttribute('class') || '';
  const groupId = element.getAttribute('data-w-lb') || '';

  // The thumbnail content (the visible <img> inside the lightbox link).
  // Map it through the generic pipeline so CSS + data-w-id are preserved.
  const visibleChildren: Layer[] = [];
  for (const child of element.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const childEl = child as HTMLElement;
    if (childEl.tagName.toLowerCase() === 'script') continue;
    const layer = context.recursivelyMap(childEl);
    if (layer) visibleChildren.push(layer);
  }

  // Optional: parse the embedded JSON payload to discover the gallery's
  // additional images. Not required — the visible thumbnail alone gives
  // us a working lightbox trigger.
  const jsonScript = element.querySelector('script.w-json') as HTMLElement | null;
  const fileIds: string[] = [];
  if (jsonScript) {
    try {
      const raw = (jsonScript as unknown as { rawText?: string }).rawText || '';
      if (raw.trim()) {
        const payload = JSON.parse(raw);
        const items = Array.isArray(payload?.items) ? payload.items : [];
        for (const item of items) {
          const url = item?.url || item?.originalSrc;
          if (typeof url === 'string') {
            const assetId = lookupAssetId(url, context.assetIdBySource);
            if (assetId) fileIds.push(assetId);
          }
        }
      }
    } catch {
      // Malformed lightbox payload — fall back to a single-thumbnail lightbox.
    }
  }

  return {
    id: randomUUID(),
    name: 'lightbox',
    customName: 'Lightbox',
    classes: className,
    settings: {
      tag: 'div',
      lightbox: {
        files: fileIds,
        filesSource: 'files',
        filesField: null,
        thumbnails: true,
        navigation: true,
        pagination: true,
        zoom: false,
        doubleTapZoom: false,
        mousewheel: false,
        overlay: 'light',
        groupId,
        animationEffect: 'slide',
        easing: 'ease-in-out',
        duration: '0.5',
      },
    },
    children: visibleChildren,
  } as unknown as Layer;
}

// ─── Builder: Native Form (.w-form) ─────────────────────────────────────

/**
 * Convert Webflow's `<div class="w-form">` (containing a `<form>` plus
 * `.w-form-done` success state and `.w-form-fail` error state) into a
 * native Webwow `form` layer. The inner inputs/textareas/selects/buttons
 * are mapped recursively through the generic pipeline so their classes,
 * styles and Webflow's CSS continue to apply.
 *
 * The native form layer registers itself with Webwow's form-submission
 * handler — that's what makes the form actually submit to a backend
 * (vs. doing nothing or attempting Webflow's own form endpoint, which
 * isn't reachable from a self-hosted clone).
 */
export function buildNativeForm(
  element: HTMLElement,
  context: DetectorContext
): Layer {
  const className = element.getAttribute('class') || '';
  const inner = element.querySelector('form') as HTMLElement | null
    || element;
  const formId = (inner.getAttribute('id') || 'imported-form').trim();

  // Recursively map all direct children of the inner <form> as form fields.
  const fieldLayers: Layer[] = [];
  for (const child of inner.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const layer = context.recursivelyMap(child);
    if (layer) fieldLayers.push(layer);
  }

  return {
    id: randomUUID(),
    name: 'form',
    customName: 'Form',
    classes: `${className} flex flex-col gap-[16px] w-full`,
    settings: {
      id: formId,
    },
    design: {
      layout: { isActive: true, display: 'Flex', flexDirection: 'column', gap: '16px' },
      sizing: { isActive: true, width: '100%' },
    },
    children: fieldLayers,
  } as unknown as Layer;
}

// ─── Builder: Native Columns (.w-row + .w-col-X) ────────────────────────

/**
 * Convert Webflow's legacy 12-column grid (`.w-row` + `.w-col-1`..`.w-col-12`)
 * into a native Webwow `columns` layer. Each `.w-col-N` becomes a flex
 * column with the correct width percentage (N/12 × 100%).
 *
 * Why a dedicated builder: Webflow's `.w-row` uses a CSS reset based on
 * `display:flex`, but the per-column widths come from `.w-col-N` rules
 * with very specific percentages. Our generic div-mapping preserves the
 * `.w-col-N` class so Webflow's CSS still applies, BUT the resulting layer
 * tree shows up as nameless `<div>`s in the editor — which makes it
 * impossible to edit. The native columns layer is editable as a unit and
 * lets users add/remove columns from the design panel.
 */
export function buildNativeColumns(
  element: HTMLElement,
  context: DetectorContext
): Layer {
  const className = element.getAttribute('class') || '';
  const colChildren = Array.from(element.childNodes).filter(
    (n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE
      && (n as HTMLElement).getAttribute('class')?.includes('w-col') === true
  );

  const columnLayers: Layer[] = colChildren.map((col) => {
    const colClass = col.getAttribute('class') || '';
    // Match `.w-col-N` (or `.w-col-tiny-N`, `.w-col-small-N` etc. for
    // responsive variants — we honour the desktop default for the layer
    // width, mobile/tablet variants stay in CSS via the original classes).
    const desktopMatch = colClass.match(/\bw-col-(\d{1,2})\b/);
    const span = desktopMatch ? Math.min(12, Math.max(1, parseInt(desktopMatch[1], 10))) : 12;
    const widthPct = `${(span / 12) * 100}%`;

    const innerLayer = context.recursivelyMap(col);

    return {
      id: randomUUID(),
      name: 'div',
      customName: `Column (${span}/12)`,
      classes: `${colClass} flex flex-col`,
      design: {
        layout: { isActive: true, display: 'Flex', flexDirection: 'column' },
        sizing: { isActive: true, width: widthPct },
      },
      children: innerLayer?.children ?? (innerLayer ? [innerLayer] : []),
    } as unknown as Layer;
  });

  return {
    id: randomUUID(),
    name: 'div',
    customName: 'Columns',
    classes: `${className} flex`,
    design: {
      layout: { isActive: true, display: 'Flex' },
    },
    children: columnLayers,
  } as unknown as Layer;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Per-component feature flags so we can ship one builder at a time and roll
 * each one back individually if it regresses. Defaults intentionally err on
 * the side of OFF — a builder is enabled here only after it's verified
 * against a real imported site.
 */
export interface DetectorFlags {
  richText?: boolean;
  collection?: boolean;
  slider?: boolean;
  form?: boolean;
  tabs?: boolean;
  lightbox?: boolean;
  columns?: boolean;
}

export const DEFAULT_DETECTOR_FLAGS: Required<DetectorFlags> = {
  richText: true,    // ← enabled: TipTap-shaped output, well isolated
  collection: false, // ← disabled: previously broke binding (writes empty collection.id on wrapper)
  slider: true,      // ← enabled: native swiper, settings auto-detected from data-* attrs
  form: true,        // ← enabled: native Webwow form-submission handler hooks up
  tabs: true,        // ← enabled: Webwow div with preserved attrs, webflow.js drives toggle
  lightbox: true,    // ← enabled: native Webwow lightbox layer, embedded JSON payload parsed
  columns: true,     // ← enabled: .w-row + .w-col-N → native columns with width %
};

/**
 * Inspect the element's classes and return a native Webwow Layer when one
 * of the supported Webflow patterns matches AND the corresponding flag is
 * enabled. Returns `null` for elements that should fall through to the
 * generic div-mapping path.
 */
export function detectWebflowComponent(
  element: HTMLElement,
  context: DetectorContext,
  flags: DetectorFlags = DEFAULT_DETECTOR_FLAGS
): Layer | null {
  const cls = classSet(element);
  const f = { ...DEFAULT_DETECTOR_FLAGS, ...flags };

  // Order matters: rich-text and dyn-list are leaf-shaped (we control their
  // children), slider produces its own slide hierarchy. We check the most
  // specific markers first.
  if (f.richText && cls.has('w-richtext')) {
    return buildNativeRichText(element, context);
  }

  if (f.collection && cls.has('w-dyn-list')) {
    return buildNativeCollection(element, context);
  }

  if (f.slider && cls.has('w-slider')) {
    return buildNativeSlider(element, context);
  }

  if (f.columns && cls.has('w-row')) {
    return buildNativeColumns(element, context);
  }

  if (f.form && cls.has('w-form')) {
    return buildNativeForm(element, context);
  }

  if (f.tabs && cls.has('w-tabs')) {
    return buildNativeTabs(element, context);
  }

  if (f.lightbox && cls.has('w-lightbox')) {
    return buildNativeLightbox(element, context);
  }

  return null;
}

// Suppress unused export warnings — these are referenced via detectWebflowComponent
export type { CollectionFieldType };
