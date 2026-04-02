'use client';

/**
 * Hook to check the current auth session via the simple auth API.
 */

import { useEffect, useState } from 'react';

interface SimpleSession {
  user: {
    id: string;
    email: string;
    display_name: string;
  } | null;
}

interface AuthSessionState {
  session: SimpleSession | null;
  isLoading: boolean;
}

export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useState<SimpleSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('/ycode/api/auth/session');
        if (res.ok) {
          const data = await res.json();
          setSession(data);
        }
      } catch {
        // Auth API not available — treated as no session
      } finally {
        setIsLoading(false);
      }
    };
    checkSession();
  }, []);

  return { session, isLoading };
}
