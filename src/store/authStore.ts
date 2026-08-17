// ============================================================================
// LUXEDGE V2 — AUTH STORE (Supabase-backed)
//
// Single source of truth for the signed-in user. Sessions come from Supabase
// Auth (src/services/supabase.ts): access/refresh tokens persist in
// localStorage and survive refresh; expiry + refresh are handled there.
//
// SECURITY:
//  - No plaintext passwords anywhere. Passwords are sent once to Supabase and
//    never stored.
//  - The role claim comes from the signed JWT (app_metadata.role) — never
//    accepted from a user-supplied field.
//  - When Supabase is not configured, sign-in fails with an honest message;
//    there is NO demo admin password fallback.
// ============================================================================

import { create } from 'zustand';
import {
  type SbUser,
  signInWithPassword,
  signUp as sbSignUp,
  signOut as sbSignOut,
  getSession,
  onAuthStateChange,
  isSupabaseConfigured,
} from '../services/supabase';
import { ensureCustomerProfile } from '../services/customer';

/** Fire-and-forget: keep a customers row in sync with the auth user. */
function syncCustomerProfile(user: SbUser | null): void {
  if (!user) return;
  void ensureCustomerProfile({ id: user.id, email: user.email, name: user.name }).then((r) => {
    if (!r.ok && r.reason !== 'not-provisioned') {
      // Honest, non-fatal: profile sync issues must never break sign-in.
      console.warn('[customer-sync]', r.reason, r.detail || '');
    }
  });
}

export interface AuthResult {
  success: boolean;
  message: string;
  user: SbUser | null;
}

interface AuthStore {
  user: SbUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  /** True once the initial session hydration finished (avoids flash-redirects). */
  ready: boolean;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  setSessionUser: (user: SbUser | null) => void;
}

let initialized = false;

export const useAuthStore = create<AuthStore>()((set) => ({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  ready: false,

  init: async () => {
    if (initialized) return;
    initialized = true;
    onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        set({ user: null, isAuthenticated: false, isAdmin: false });
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const u = getSessionUserSync();
        applyUser(set, u);
      }
    });
    const session = await getSession();
    applyUser(set, session?.user || null);
    set({ ready: true });
  },

  signIn: async (email, password) => {
    if (!isSupabaseConfigured()) {
      return {
        success: false,
        message: 'Sign-in is not configured yet (add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY). Guest checkout still works.',
        user: null,
      };
    }
    try {
      const session = await signInWithPassword(email.trim(), password);
      applyUser(set, session.user);
      syncCustomerProfile(session.user);
      return { success: true, message: 'Signed in successfully.', user: session.user };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Sign-in failed.', user: null };
    }
  },

  signUp: async (name, email, password) => {
    if (!isSupabaseConfigured()) {
      return {
        success: false,
        message: 'Account creation is not configured yet (add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY). Guest checkout still works.',
        user: null,
      };
    }
    try {
      const { session } = await sbSignUp(name.trim(), email.trim(), password);
      if (session) {
        applyUser(set, session.user);
        syncCustomerProfile(session.user);
      }
      return {
        success: true,
        message: session ? 'Account created — you are signed in.' : 'Account created — check your email to confirm.',
        user: session?.user || null,
      };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Account creation failed.', user: null };
    }
  },

  signOut: async () => {
    await sbSignOut();
    set({ user: null, isAuthenticated: false, isAdmin: false });
  },

  setSessionUser: (user) => applyUser(set, user),
}));

function getSessionUserSync(): SbUser | null {
  // Avoid a circular import: read the raw stored session directly here.
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem('luxedge_sb_session') : null;
    if (!raw) return null;
    const s = JSON.parse(raw) as { user?: SbUser };
    return s.user || null;
  } catch {
    return null;
  }
}

function applyUser(
  set: (partial: Partial<AuthStore>) => void,
  user: SbUser | null
): void {
  set({
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
  });
}
