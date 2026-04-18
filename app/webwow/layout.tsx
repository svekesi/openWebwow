import WebwowLayoutClient from './WebwowLayoutClient';

/**
 * Webwow Editor Layout (Server Component)
 * 
 * Forces dynamic rendering for all /webwow/* routes.
 * This is required because:
 * 1. Editor routes require authentication (user-specific)
 * 2. Client components use useSearchParams which needs dynamic context
 */

// Force all /webwow routes to be dynamic - no static prerendering
// This prevents useSearchParams errors during build
export const dynamic = 'force-dynamic';

export default function WebwowLayout({ children }: { children: React.ReactNode }) {
  return <WebwowLayoutClient>{children}</WebwowLayoutClient>;
}
