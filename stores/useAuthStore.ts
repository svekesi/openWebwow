/**
 * Auth Store
 *
 * Manages authentication state using simple password-based auth.
 */

import { create } from 'zustand';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  authEnabled: boolean;
}

interface AuthActions {
  initialize: () => Promise<void>;
  signIn: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  setError: (error: string | null) => void;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>((set, get) => ({
  authenticated: false,
  loading: false,
  initialized: false,
  error: null,
  authEnabled: true,

  initialize: async () => {
    if (get().initialized) return;

    try {
      const response = await fetch('/ycode/api/auth/session');
      const data = await response.json();

      set({
        authenticated: data.authenticated ?? false,
        authEnabled: data.authEnabled ?? true,
        initialized: true,
        error: null,
      });
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize auth',
        initialized: true,
      });
    }
  },

  signIn: async (password) => {
    set({ loading: true, error: null });

    try {
      const response = await fetch('/ycode/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        const message = data.error || 'Login failed';
        set({ loading: false, error: message });
        return { error: message };
      }

      set({
        authenticated: true,
        loading: false,
      });

      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      set({ loading: false, error: message });
      return { error: message };
    }
  },

  signOut: async () => {
    set({ loading: true, error: null });

    try {
      await fetch('/ycode/api/auth/logout', { method: 'POST' });

      set({
        authenticated: false,
        loading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign out failed';
      set({ loading: false, error: message });
    }
  },

  setError: (error) => {
    set({ error });
  },
}));
