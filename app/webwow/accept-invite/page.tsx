'use client';

/**
 * Accept Invite Page
 *
 * Handles user invitation flow - allows invited users to set their password
 * and complete their account setup.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
// Supabase auth removed - invite flow handled via fetch API
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from '@/components/ui/field';

export default function AcceptInvitePage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Ensure dark mode is applied
  useEffect(() => {
    document.documentElement.classList.add('dark');

    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, []);

  // Verify the invite token on mount
  useEffect(() => {
    const verifyInvite = async () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');

        if (type === 'invite' && accessToken && refreshToken) {
          const response = await fetch('/webwow/api/auth/verify-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
          });

          if (!response.ok) {
            setError('Invalid or expired invitation link. Please request a new invite.');
            setVerifying(false);
            return;
          }

          const data = await response.json();
          if (data.email) {
            setUserEmail(data.email);
          }

          setVerifying(false);
          return;
        }

        setError('Invalid invitation link. Please check your email for the correct link or request a new invite.');
        setVerifying(false);
      } catch (err) {
        console.error('Error verifying invite:', err);
        setError('Failed to verify invitation. Please try again.');
        setVerifying(false);
      }
    };

    verifyInvite();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate passwords
    if (!password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/webwow/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to set password');
        setLoading(false);
        return;
      }

      router.push('/webwow');
    } catch (err) {
      console.error('Error setting password:', err);
      setError('Failed to set password. Please try again.');
      setLoading(false);
    }
  };

  // Show loading while verifying
  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="flex flex-col items-center gap-4">
          <Spinner />
          <Label variant="muted">Verifying invitation...</Label>
        </div>
      </div>
    );
  }

  // Show error state if verification failed
  if (error && !userEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="w-full max-w-md p-8">
          <div className="flex flex-col items-center gap-6">
            <svg
              className="size-10 fill-current"
              viewBox="0 0 12.506 11.972"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M7.456,4.644A5.558,5.558,0,0,1,10.062.112L10.023.044A8.685,8.685,0,0,1,11.159,5.08a15.806,15.806,0,0,1-.993,4.688A5.439,5.439,0,0,1,7.456,4.644ZM1.328,4.87.005,0,7.448,4.822,0,9.7ZM10.007.019l.016.025Z"
                transform="translate(0.833 1.13)"
              />
            </svg>

            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>

            <Button
              variant="secondary"
              onClick={() => router.push('/login')}
            >
              Go to Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show password setup form
  return (
    <div className="min-h-screen flex flex-col bg-neutral-950">
      <div className="pt-12 pb-8 flex items-center justify-center">
        <svg
          className="size-5 fill-current"
          viewBox="0 0 12.506 11.972"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7.456,4.644A5.558,5.558,0,0,1,10.062.112L10.023.044A8.685,8.685,0,0,1,11.159,5.08a15.806,15.806,0,0,1-.993,4.688A5.439,5.439,0,0,1,7.456,4.644ZM1.328,4.87.005,0,7.448,4.822,0,9.7ZM10.007.019l.016.025Z"
            transform="translate(0.833 1.13)"
          />
        </svg>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-10">
        <div className="w-full max-w-md px-8">
          <form onSubmit={handleSubmit}>
            <FieldGroup
              className="animate-in fade-in slide-in-from-bottom-1 duration-700"
              style={{ animationFillMode: 'both' }}
            >
              {userEmail && (
                <div className="text-center mb-6">
                  <Label variant="muted" size="sm">
                    Setting up account for {userEmail}
                  </Label>
                </div>
              )}

              <FieldSet>
                <FieldGroup className="gap-6">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Field>
                    <FieldLabel htmlFor="password" size="sm">
                      Password
                    </FieldLabel>
                    <Input
                      type="password"
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      size="sm"
                      autoFocus
                    />
                    <FieldDescription>At least 6 characters</FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="confirmPassword" size="sm">
                      Confirm password
                    </FieldLabel>
                    <Input
                      type="password"
                      id="confirmPassword"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={loading}
                      size="sm"
                    />
                  </Field>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full mt-4"
                  >
                    {loading ? <Spinner /> : 'Create account'}
                  </Button>
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </form>
        </div>
      </div>
    </div>
  );
}
