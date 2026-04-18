'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import BuilderLoading from '@/components/BuilderLoading';

/**
 * Migration Checker Component: Checks for and runs pending migrations before allowing
 * builder access. This prevents the builder from trying to query tables that don't exist yet.
 */

interface MigrationCheckerProps {
  onComplete: () => void;
}

interface SetupStatusResponse {
  is_configured: boolean;
  is_setup_complete: boolean;
}

async function parseResponseSafely(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch {
      return { error: rawText || 'Invalid JSON response' };
    }
  }

  return { error: rawText || `HTTP ${response.status}: ${response.statusText}` };
}

export default function MigrationChecker({ onComplete }: MigrationCheckerProps) {
  const [isChecking, setIsChecking] = useState(true);
  const [progress, setProgress] = useState('Checking database status...');
  const [error, setError] = useState<string | null>(null);

  // Ref to ensure migration only runs once (prevents React Strict Mode double-run)
  const hasRunRef = useRef(false);

  const checkAndRunMigrations = useCallback(async () => {
    try {
      setIsChecking(true);
      setProgress('Checking database status...');
      setError(null);

      const statusResponse = await fetch('/webwow/api/setup/status', {
        method: 'GET',
      });
      const statusResult = await parseResponseSafely(statusResponse) as SetupStatusResponse & { error?: string };

      if (!statusResponse.ok) {
        console.error('Setup status request failed', statusResult);
        onComplete(); // Do not block builder on status check failure
        return;
      }

      if (statusResult.is_setup_complete) {
        onComplete();
        return;
      }

      setProgress('Running database migrations...');

      // Setup is incomplete - run migrations once.
      const response = await fetch('/webwow/api/setup/migrate', {
        method: 'POST',
      });
      const result = await parseResponseSafely(response);

      if (!response.ok) {
        console.error('Migration request failed');
        console.error(result);
        onComplete(); // Allow builder to load anyway
        return;
      }

      if (result.error) {
        setError(result.error);
        setIsChecking(false);
        return;
      }

      // Successfully ran migrations, allow builder to load
      onComplete();
    } catch (err) {
      console.error('Failed to run migrations:', err);
      setError(err instanceof Error ? err.message : 'Migration failed');
      setIsChecking(false);
    }
  }, [onComplete]);

  useEffect(() => {
    // Skip if already run (React Strict Mode protection)
    if (hasRunRef.current) {
      return;
    }
    hasRunRef.current = true;
    checkAndRunMigrations();
  }, [checkAndRunMigrations]);

  const handleRetry = () => {
    setError(null);
    checkAndRunMigrations();
  };

  const handleSkip = () => {
    // Allow user to skip and try to use builder anyway (risky but their choice)
    onComplete();
  };

  // Always show this component while checking migrations
  if (!isChecking && !error) {
    return null;
  }

  // Show error state
  if (error) {
    return (
      <div className="fixed inset-0 z-[100] bg-neutral-950 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="flex-1 flex items-center text-center flex-col gap-1">
            <Label size="sm">
              Migration failed
            </Label>
            <Label variant="muted" size="sm">
              {error}
            </Label>
            <div className="w-full max-w-xs grid grid-cols-2 gap-3 mt-2">
              <Button onClick={handleRetry}>
                Retry migration
              </Button>
              <Button
                variant="secondary"
                onClick={handleSkip}
              >
                <span>Skip</span>
                <span className="text-[10px] opacity-60">Not recommended</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state
  return <BuilderLoading message={progress} />;
}
