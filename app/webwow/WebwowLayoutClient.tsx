'use client';

import { Suspense, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import WebwowBuilder from './components/WebwowBuilderMain';
import { useEditorUrl } from '@/hooks/use-editor-url';
import { useAuthStore } from '@/stores/useAuthStore';

/**
 * Webwow Editor Layout (Client Component)
 *
 * This layout wraps all /webwow routes and renders WebwowBuilder once.
 * By keeping WebwowBuilder at the layout level, it persists across route changes,
 * preventing remounts and avoiding duplicate API calls on navigation.
 *
 * Routes:
 * - /webwow - Base editor
 * - /webwow/pages/[id] - Page editing
 * - /webwow/layers/[id] - Layer editing
 * - /webwow/collections/[id] - Collection management
 * - /webwow/components/[id] - Component editing
 * - /webwow/settings - Settings pages
 * - /webwow/localization - Localization pages
 * - /webwow/profile - Profile pages
 *
 * Excluded routes:
 * - /webwow/preview - Preview routes are excluded and render independently
 *
 * WebwowBuilder uses useEditorUrl() to detect route changes and update
 * the UI accordingly without remounting.
 */

// Inner component that uses useSearchParams (via useEditorUrl)
function WebwowLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { routeType } = useEditorUrl();
  const { initialize } = useAuthStore();

  // Initialize auth only within /webwow routes (not on public pages)
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Exclude standalone routes from WebwowBuilder
  // These routes should render independently without the editor UI
  const prefixRoutes = ['/webwow/preview', '/webwow/devtools/'];
  const exactRoutes = ['/webwow/welcome', '/webwow/accept-invite'];

  if (
    prefixRoutes.some(route => pathname?.startsWith(route))
    || exactRoutes.includes(pathname || '')
  ) {
    return <>{children}</>;
  }

  // For settings, localization, profile, forms, and integrations routes, pass children to WebwowBuilder so it can render them
  if (routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations') {
    return <WebwowBuilder>{children}</WebwowBuilder>;
  }

  // WebwowBuilder handles all rendering based on URL
  // Children are ignored - routes are just for URL structure
  return <WebwowBuilder />;
}

// Client layout wrapped in Suspense to handle useSearchParams
// Required by Next.js 14+ to prevent static rendering bailout
export default function WebwowLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <WebwowLayoutInner>{children}</WebwowLayoutInner>
    </Suspense>
  );
}
