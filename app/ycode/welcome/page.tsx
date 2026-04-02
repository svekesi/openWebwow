'use client';

/**
 * Welcome Wizard Page
 *
 * First-run setup experience for Ycode
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSetupStore } from '@/stores/useSetupStore';
import { useAuthSession } from '@/hooks/use-auth-session';
import { connectDatabase, runMigrations } from '@/lib/api/setup';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend, FieldSeparator,
  FieldSet
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BuilderLoading from '@/components/BuilderLoading';
import { Spinner } from '@/components/ui/spinner';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { TemplateGallery } from '@/components/templates/TemplateGallery';

function LogoBottomRight() {
  return (
    <div className="pt-12 pb-8 flex items-center justify-center">
    <svg
      className="size-5 fill-current"
      viewBox="0 0 24 24"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        id="Symbols"
        stroke="none"
        strokeWidth="1"
        fill="none"
        fillRule="evenodd"
      >
        <g id="Sidebar" transform="translate(-30.000000, -30.000000)">
          <g id="Ycode">
            <g transform="translate(30.000000, 30.000000)">
              <rect
                id="Rectangle"
                x="0"
                y="0"
                width="24"
                height="24"
              />
              <path
                id="CurrentFill"
                d="M11.4241533,0 L11.4241533,5.85877951 L6.024,8.978 L12.6155735,12.7868008 L10.951,13.749 L23.0465401,6.75101349 L23.0465401,12.6152717 L3.39516096,23.9856666 L3.3703726,24 L3.34318129,23.9827156 L0.96,22.4713365 L0.96,16.7616508 L3.36417551,18.1393242 L7.476,15.76 L0.96,11.9090099 L0.96,6.05375516 L11.4241533,0 Z"
                className="fill-current"
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
    </div>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const { currentStep, setStep, markComplete } = useSetupStore();
  const { session, isLoading: isAuthLoading } = useAuthSession();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);

  const [databaseUrl, setDatabaseUrl] = useState('');
  const [databasePhase, setDatabasePhase] = useState<'input' | 'env'>('input');

  // Ensure dark mode is applied on client-side navigation
  useEffect(() => {
    document.documentElement.classList.add('dark');

    // Cleanup: remove dark class when leaving the page
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, []);

  // Copy to clipboard handler
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const handleCopy = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Check if running on Vercel and if env vars are configured
  // Redirect unauthenticated users to /ycode if setup is already complete
  useEffect(() => {
    if (isAuthLoading) return;

    const checkEnvironment = async () => {
      try {
        const response = await fetch('/ycode/api/setup/status');
        const data = await response.json();

        // If setup is complete, redirect unauthenticated users to /ycode (login screen)
        // Logged-in users can still access this page
        if (data.is_setup_complete && !session) {
          router.push('/ycode');
          return; // Keep showing loading screen during redirect
        }

        setStatusChecked(true);
      } catch (err) {
        console.error('Failed to check environment:', err);
        setStatusChecked(true);
      }
    };
    checkEnvironment();
  }, [router, isAuthLoading, session]);

  useEffect(() => {
    if (currentStep === 'database') {
      setDatabasePhase('input');
      setError(null);
    }
  }, [currentStep]);

  // Block rendering until checks complete (prevents flash before redirect)
  if (isAuthLoading || !statusChecked) {
    return <BuilderLoading message="Checking setup" />;
  }

  // Step 1: Welcome
  if (currentStep === 'welcome') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 overflow-y-auto py-8">

          <div className="flex-1 flex items-center text-center flex-col gap-1 text-balance">

            <svg
              className="size-10 fill-current absolute animate-out fade-out slide-in-from-bottom-1 duration-700"
              style={{ animationDelay: '2000ms', animationFillMode: 'both' }}
              viewBox="0 0 24 24"
              version="1.1" xmlns="http://www.w3.org/2000/svg"
            >
              <g
                id="Symbols" stroke="none"
                strokeWidth="1" fill="none"
                fillRule="evenodd"
              >
                <g id="Sidebar" transform="translate(-30.000000, -30.000000)">
                  <g id="Ycode">
                    <g transform="translate(30.000000, 30.000000)">
                      <rect
                        id="Rectangle" x="0"
                        y="0" width="24"
                        height="24"
                      />
                      <path
                        id="CurrentFill" d="M11.4241533,0 L11.4241533,5.85877951 L6.024,8.978 L12.6155735,12.7868008 L10.951,13.749 L23.0465401,6.75101349 L23.0465401,12.6152717 L3.39516096,23.9856666 L3.3703726,24 L3.34318129,23.9827156 L0.96,22.4713365 L0.96,16.7616508 L3.36417551,18.1393242 L7.476,15.76 L0.96,11.9090099 L0.96,6.05375516 L11.4241533,0 Z"
                        className="fill-current"
                      />
                    </g>
                  </g>
                </g>
              </g>
            </svg>

            <Label
              className="animate-in fade-in slide-in-from-bottom-1 duration-700"
              size="sm"
              style={{ animationDelay: '2500ms', animationFillMode: 'both' }}
            >
              Welcome to Ycode
            </Label>
            <Label
              variant="muted"
              size="sm"
              className="animate-in fade-in slide-in-from-bottom-1 duration-700"
              style={{ animationDelay: '2700ms', animationFillMode: 'both' }}
            >
              Let&apos;s get you set up in just a few steps.
            </Label>

            <div
              className="mt-4 animate-in fade-in slide-in-from-bottom-1 duration-700"
              style={{ animationDelay: '3700ms', animationFillMode: 'both' }}
            >
              <Button onClick={() => setStep('database')}>
                Get started
              </Button>
            </div>

          </div>

      </div>
    );
  }

  // Step 2: DATABASE_URL — validate connection, then instruct to persist in environment
  if (currentStep === 'database') {
    const envLine = `DATABASE_URL=${databaseUrl}`;

    const handleDatabaseSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setLoading(true);
      setError(null);

      try {
        const result = await connectDatabase(databaseUrl.trim());

        if (result.error) {
          setError(result.error);
          return;
        }

        setDatabasePhase('env');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
      } finally {
        setLoading(false);
      }
    };

    const handleVerifyHostedEnv = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/ycode/api/setup/status');
        const data = await response.json();

        if (data.is_configured) {
          setStep('migrate');
        } else if (data.error) {
          setError(data.error);
        } else {
          setError(
            'DATABASE_URL is not set in the server environment. Add it in your host settings and redeploy or restart.'
          );
        }
      } catch {
        setError('Failed to check configuration');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="min-h-screen flex flex-col bg-neutral-950">

        <LogoBottomRight />

        <div className="flex-1 flex flex-col items-center justify-center py-6">

          <div className="grid grid-cols-3 gap-4 w-full max-w-xl">

            <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
              <Label variant="muted">Step 1</Label>
              <Label size="sm">Database</Label>
            </div>

            <div className="border-t-2 border-white/50 py-4 flex flex-col gap-0.5 opacity-50">
              <Label variant="muted">Step 2</Label>
              <Label size="sm">Run migrations</Label>
            </div>

            <div className="border-t-2 border-white/50 py-4 flex flex-col gap-0.5 opacity-50">
              <Label variant="muted">Step 3</Label>
              <Label size="sm">Template</Label>
            </div>

          </div>

          <div className="w-full max-w-xl py-10">

            <FieldGroup className="animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {databasePhase === 'env' ? (
                <>
                  <FieldSet>
                    <FieldLegend>Save DATABASE_URL</FieldLegend>
                    <FieldDescription>
                      Add this line to <span className="text-white/85">.env.local</span> (local) or to your host&apos;s environment variables, then restart the app. For hosted deployments, redeploy after saving.
                    </FieldDescription>
                    <Field className="mt-4">
                      <InputGroup size="sm">
                        <InputGroupInput
                          value={envLine} readOnly
                          size="sm"
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            type="button"
                            onClick={() => handleCopy(envLine, 'envline')}
                          >
                            <Icon name={copiedField === 'envline' ? 'check' : 'copy'} />
                            {copiedField === 'envline' ? 'Copied' : 'Copy'}
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                    </Field>
                  </FieldSet>

                  <FieldSeparator />

                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      onClick={() => setStep('migrate')}
                    >
                      Continue to migrations
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleVerifyHostedEnv}
                      disabled={loading}
                    >
                      {loading ? <Spinner /> : 'I use hosted env — verify DATABASE_URL'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setDatabasePhase('input')}
                      disabled={loading}
                    >
                      Edit connection string
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStep('welcome')}
                      disabled={loading}
                    >
                      Go back
                    </Button>
                  </div>
                </>
              ) : (
                <form onSubmit={handleDatabaseSubmit}>
                  <FieldSet>
                    <FieldGroup className="gap-8">
                      <Field>
                        <FieldLabel htmlFor="database_url" size="sm">
                          DATABASE_URL
                        </FieldLabel>
                        <Input
                          id="database_url"
                          name="database_url"
                          value={databaseUrl}
                          onChange={(e) => setDatabaseUrl(e.target.value)}
                          placeholder="postgresql://user:password@localhost:5432/ycode"
                          required
                          size="sm"
                          autoComplete="off"
                        />
                        <FieldDescription>
                          PostgreSQL connection string (same value you will set as <span className="text-white/85">DATABASE_URL</span> in the environment).
                        </FieldDescription>
                      </Field>

                      <div className="flex flex-col gap-2 mt-4">
                        <Button type="submit" disabled={loading}>
                          {loading ? <Spinner /> : 'Test connection'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setStep('welcome')}
                          disabled={loading}
                        >
                          Go back
                        </Button>
                      </div>
                    </FieldGroup>
                  </FieldSet>
                </form>
              )}

            </FieldGroup>

          </div>

        </div>

      </div>
    );
  }

  // Step 3: Run Migrations (Automatic)
  if (currentStep === 'migrate') {
    const handleMigrate = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await runMigrations();

        if (result.error) {
          setError(result.error);
          return;
        }

        markComplete();
        setStep('template');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Migration failed');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="min-h-screen flex flex-col bg-neutral-950">

        <LogoBottomRight />

        <div className="flex-1 flex flex-col items-center justify-center py-10">

          <div className="grid grid-cols-3 gap-4 w-full max-w-xl">

            <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
              <Label variant="muted">Step 1</Label>
              <Label size="sm">Database</Label>
            </div>

            <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
              <Label variant="muted">Step 2</Label>
              <Label size="sm">Run migrations</Label>
            </div>

            <div className="border-t-2 border-white/50 py-4 flex flex-col gap-0.5 opacity-50">
              <Label variant="muted">Step 3</Label>
              <Label size="sm">Template</Label>
            </div>

          </div>

          <div className="w-full max-w-xl py-10">

            {error && (
              <div className="bg-red-950 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>

              <div className="flex-1 flex items-center text-center flex-col gap-2 bg-white/5 py-10 rounded-2xl">
                <Icon name="database" className="size-4 mb-2" />
                <Label size="sm">Setup database</Label>
                <Label
                  variant="muted" size="sm"
                  className="leading-relaxed max-w-96"
                >
                  Creates and updates tables via Knex migrations. Ensure <span className="text-white/85">DATABASE_URL</span> is set in the environment before running.
                </Label>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleMigrate}
                  disabled={loading}
                >
                  {loading ? <Spinner /> : 'Run migrations'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep('database')}
                  disabled={loading}
                >
                  Go back
                </Button>
              </div>

            </div>
          </div>

        </div>

      </div>
    );
  }

  // Step 4: Choose a Template or Start from Scratch
  if (currentStep === 'template') {
    return (
      <div className="min-h-screen flex flex-col bg-neutral-950">

        <LogoBottomRight />

        <div className="flex-1 flex flex-col items-center justify-center py-10">

          <div className="w-full max-w-4xl animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>

            <div className="flex flex-col items-center text-center gap-1 mb-10">
              <Label size="sm">Choose a template</Label>
              <Label
                variant="muted"
                size="sm"
              >
                Pick a pre-built design or start with a blank canvas.
              </Label>
              <Label
                variant="muted" size="sm"
                className="max-w-md mt-2"
              >
                Optional: set <span className="text-white/85">ADMIN_PASSWORD</span> in your environment to protect the builder with a login.
              </Label>
            </div>

            <TemplateGallery
              startFromScratchHref="/ycode"
              applyImmediately
            />

          </div>

        </div>

      </div>
    );
  }

  return null;
}
