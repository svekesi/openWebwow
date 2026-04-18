/**
 * Canvas configuration constants and shared utilities
 */

/**
 * Border/padding around the iframe canvas (in pixels)
 * Applied on all sides (top, right, bottom, left)
 */
export const CANVAS_BORDER = 20;

/**
 * Total padding (border on both sides)
 * Used for calculations: left + right or top + bottom
 */
export const CANVAS_PADDING = CANVAS_BORDER * 2;

/**
 * Shared HTML template for canvas-style iframes with Tailwind Browser CDN.
 * Used by both the editor Canvas and the thumbnail capture hook.
 * @param mountId - The ID of the mount point div (default: 'canvas-mount')
 */
export function getCanvasIframeHtml(mountId: string = 'canvas-mount'): string {
  return `<!DOCTYPE html>
<html class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
    @custom-variant current (&[aria-current]);
    @custom-variant disabled (&:is(:disabled, [aria-disabled]));
    @theme {
      /* Editor UI colors for context menus portaled into the iframe */
      --color-popover: oklch(0.269 0 0);
      --color-popover-foreground: oklch(0.708 0 0);
      --color-accent: oklch(0.32 0 0);
      --color-accent-foreground: oklch(0.985 0 0);
      --color-muted-foreground: oklch(0.708 0 0);
      --color-foreground: oklch(0.985 0 0);
      --color-border: oklch(1 0 0 / 5%);
      --color-destructive: oklch(0.704 0.191 22.216);
    }
  </style>
  <style id="webwow-fonts-style">
    /* Font CSS (Google @import + custom @font-face) injected dynamically */
  </style>
  <style>
    /* Custom dropdown chevron for styled select elements */
    select.appearance-none {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
      background-repeat: no-repeat !important;
      background-position: right 12px center !important;
      background-size: 16px 16px !important;
    }
  </style>
  <link rel="stylesheet" href="/canvas.css?v=0.2.1.1">
</head>
<body class="h-full">
  <div id="${mountId}" class="contents"></div>
</body>
</html>`;
}
