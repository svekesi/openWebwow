'use client';

/**
 * Devtools Layout
 *
 * Requires authentication for all /webwow/devtools/* pages.
 * Redirects to /webwow (login screen) if not authenticated.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthSession } from '@/hooks/use-auth-session';
import BuilderLoading from '@/components/BuilderLoading';

export default function DevtoolsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, isLoading } = useAuthSession();

  useEffect(() => {
    if (!isLoading && !session) {
      router.push('/webwow');
    }
  }, [isLoading, session, router]);

  if (isLoading || !session) {
    return <BuilderLoading message="Checking setup" />;
  }

  return <>{children}</>;
}
