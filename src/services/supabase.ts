// ============================================================================
// LUXEDGE V2 — MINIMAL SUPABASE AUTH CLIENT (browser)
//
// Thin fetch-based client for Supabase Auth (email/password). No SDK
// dependency: keeps the storefront bundle lean and the surface area small.
// Only what Luxedge needs is implemented: password sign-in, sign-up, refresh,
// sign-out, session persistence and role mapping.
//
// SECURITY:
//  - Uses the PUBLIC anon key only. The service-role key and the JWT secret
//    never appear in browser code, localStorage, logs or the bundle.
//  - The role claim (app_metadata.role) comes from the SIGNED JWT returned by
//    Supabase — it is never invented client-side and never accepted from a
//    user-supplied field.
//  - No plaintext passwords are ever stored.
//
// When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent this module is
// inert: callers must show an honest "not configured" state instead of a fake
// login (enforced by the auth store and the login pages).
// ============================================================================

export interface SbUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'buyer';
}

export interface SbSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  user: SbUser;
}

export type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';

const SESSION_KEY = 'luxedge_sb_session';
const REFRESH_LEAD_MS = 60_000; // refresh when the token is this close to expiring

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
let configOverride: { url: string; anonKey: string } | null | undefined = undefined;

/**
 * Resolve the Supabase project configuration from Vite env vars. Returns null
 * when not configured — callers must show an honest "not configured" state.
 */
export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  if (configOverride !== undefined) return configOverride;
  const env = (import.meta as { env?: Record<string, string> }).env || {};
  const url = env.VITE_SUPABASE_URL || '';
  const anonKey = env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/$/, ''), anonKey };
}

/**
 * Test-only hook: override the resolved config (null = simulate unconfigured,
 * undefined = restore real env resolution). Never called by app code.
 */
export function __setSupabaseConfigForTests(config: { url: string; anonKey: string } | null | undefined): void {
  configOverride = config;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

// ---------------------------------------------------------------------------
// Session storage (localStorage — survives refresh; contains no secrets
// beyond the access/refresh tokens, which is exactly how Supabase sessions
// are designed to work client-side)
// ---------------------------------------------------------------------------
function readStoredSession(): SbSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<SbSession>;
    if (
      typeof s.accessToken === 'string' && s.accessToken &&
      typeof s.refreshToken === 'string' && s.refreshToken &&
      typeof s.expiresAt === 'number' &&
      s.user && typeof s.user.id === 'string'
    ) {
      return s as SbSession;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: SbSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage full or unavailable — session simply won't survive refresh */
  }
}

function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Synchronous access token read — used to stamp Authorization headers. */
export function getAccessToken(): string | null {
  return readStoredSession()?.accessToken || null;
}

/** The currently known user (from a stored session), without any token. */
export function getSessionUser(): SbUser | null {
  return readStoredSession()?.user || null;
}

// ---------------------------------------------------------------------------
// Auth change events
// ---------------------------------------------------------------------------
type Listener = (event: AuthChangeEvent) => void;
const listeners = new Set<Listener>();
function emit(event: AuthChangeEvent): void {
  listeners.forEach((cb) => {
    try {
      cb(event);
    } catch {
      /* listener errors must not break auth */
    }
  });
}
export function onAuthStateChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---------------------------------------------------------------------------
// Supabase REST helpers
// ---------------------------------------------------------------------------
interface RawAuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: Record<string, unknown>;
  error?: string;
  error_description?: string;
  msg?: string;
}

function mapRawUser(raw: Record<string, unknown>): SbUser {
  const appMeta = (raw.app_metadata || {}) as Record<string, unknown>;
  const userMeta = (raw.user_metadata || {}) as Record<string, unknown>;
  const email = String(raw.email || '');
  const name = String(userMeta.name || userMeta.full_name || email.split('@')[0] || '');
  const role = appMeta.role === 'admin' ? 'admin' : 'buyer';
  return { id: String(raw.id || ''), email, name, role };
}

async function parseAuthResponse(res: Response): Promise<RawAuthResponse> {
  let data: RawAuthResponse = {};
  try {
    data = (await res.json()) as RawAuthResponse;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const detail = data.error_description || data.error || data.msg || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data;
}

async function authRequest(path: string, init: RequestInit & { config: { url: string; anonKey: string } }): Promise<Response> {
  const { config } = init;
  const headers: Record<string, string> = {
    apikey: config.anonKey,
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  return res;
}

function toSession(data: RawAuthResponse): SbSession | null {
  if (!data.access_token || !data.refresh_token || !data.user) return null;
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    user: mapRawUser(data.user),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Sign in with email + password. Throws an honest Error on failure. */
export async function signInWithPassword(email: string, password: string): Promise<SbSession> {
  const config = getSupabaseConfig();
  if (!config) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  const res = await authRequest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    config,
    body: JSON.stringify({ email, password }),
  });
  const data = await parseAuthResponse(res);
  const session = toSession(data);
  if (!session) throw new Error('Sign-in did not return a session');
  writeStoredSession(session);
  emit('SIGNED_IN');
  return session;
}

/** Create an account. Throws on failure (e.g. email already registered). */
export async function signUp(name: string, email: string, password: string): Promise<{ session: SbSession | null }> {
  const config = getSupabaseConfig();
  if (!config) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  const res = await authRequest('/auth/v1/signup', {
    method: 'POST',
    config,
    body: JSON.stringify({ email, password, data: { name } }),
  });
  const data = await parseAuthResponse(res);
  const session = toSession(data);
  if (session) {
    writeStoredSession(session);
    emit('SIGNED_IN');
  }
  return { session };
}

/** Sign out: revoke server-side (best effort) and clear the local session. */
export async function signOut(): Promise<void> {
  const token = getAccessToken();
  const config = getSupabaseConfig();
  clearStoredSession();
  emit('SIGNED_OUT');
  if (token && config) {
    try {
      await fetch(`${config.url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
      });
    } catch {
      /* network failure — local session is already cleared */
    }
  }
}

/**
 * Load the current session, refreshing the access token when it is close to
 * expiring. Returns null when signed out. Never throws for "no session".
 */
export async function getSession(): Promise<SbSession | null> {
  const session = readStoredSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() > REFRESH_LEAD_MS) return session;

  const config = getSupabaseConfig();
  if (!config) {
    // Supabase was deconfigured — drop the stale session rather than keep it.
    clearStoredSession();
    return null;
  }
  try {
    const res = await authRequest('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      config,
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    const data = await parseAuthResponse(res);
    const refreshed = toSession(data);
    if (!refreshed) throw new Error('refresh returned no session');
    writeStoredSession(refreshed);
    emit('TOKEN_REFRESHED');
    return refreshed;
  } catch {
    // Refresh failed (revoked/expired refresh token) — sign out cleanly.
    clearStoredSession();
    emit('SIGNED_OUT');
    return null;
  }
}

/** Change the password for the signed-in user. Throws an honest Error. */
export async function updatePassword(newPassword: string): Promise<void> {
  const token = getAccessToken();
  const config = getSupabaseConfig();
  if (!token || !config) throw new Error('Not signed in');
  const res = await fetch(`${config.url}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: newPassword }),
  });
  await parseAuthResponse(res);
}

/** Update profile metadata (name) for the signed-in user. */
export async function updateUserMetadata(patch: { name?: string }): Promise<void> {
  const token = getAccessToken();
  const config = getSupabaseConfig();
  if (!token || !config) throw new Error('Not signed in');
  const res = await fetch(`${config.url}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: patch }),
  });
  await parseAuthResponse(res);
}
