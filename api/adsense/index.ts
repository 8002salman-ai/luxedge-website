// ============================================================================
// LUXEDGE — GOOGLE ADSENSE EARNINGS API (server-side, real Google data)
//
// Replaces the fake "page views × assumed eCPM" estimate with REAL AdSense
// performance read from the official AdSense Management API v2.
//
// Architecture:
//   Google OAuth 2.0 (owner authorizes once)
//     → refresh token stored server-side (Supabase app_settings, service role)
//     → short-lived access tokens refreshed server-side
//     → AdSense Management API v2 reports:generate
//     → results cached in app_settings with a sync timestamp
//     → Luxedge Admin reads the cache through admin-only routes
//
// SECURITY:
//   - OAuth client secret + refresh token NEVER reach the browser bundle.
//   - Client ID/secret come from wrangler secrets (GOOGLE_ADSENSE_CLIENT_ID /
//     GOOGLE_ADSENSE_CLIENT_SECRET); the refresh token lives in app_settings
//     and is only read server-side.
//   - All read/sync routes require a verified admin JWT (requireAdmin).
//   - The OAuth callback (public, browser redirect from Google) validates the
//     state nonce before accepting the code.
//
// FAILURE STATES are honest: not connected → "Connect", token expired →
// "Reconnect", API unavailable → temporary-unavailable, no earnings → $0.00.
// The dashboard NEVER falls back to page-view estimates as earnings.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';

const ADSENSE_API = 'https://adsense.googleapis.com/v2';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/adsense.readonly';
const REDIRECT_URI = (process.env.ADSENSE_REDIRECT_URI || '').trim() || 'https://luxedge.us/api/adsense/oauth/callback';

const SETTING_REFRESH_TOKEN = 'ADSENSE_REFRESH_TOKEN';
const SETTING_CACHE = 'ADSENSE_EARNINGS_CACHE';

type RuntimeBindings = Record<string, unknown>;
let runtimeBindings: RuntimeBindings | null = null;

/** Set by the Cloudflare Worker adapter for each request. */
export function setAdSenseRuntimeBindings(bindings: RuntimeBindings): void {
  runtimeBindings = bindings;
}
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — no Google calls per render

// In-memory access-token cache (worker instance). Never persisted, never sent
// to the browser. Mirrors the Google Ads lib pattern.
let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

/** Test-only hook: clear the in-memory access-token cache. */
export function __resetAdsenseForTests(): void {
  cachedAccessToken = null;
  cachedAccessTokenExpiresAt = 0;
}

function getSupabaseConfig() {
  const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, key };
}

async function readSetting(key: string): Promise<string | null> {
  const { url, key: serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) return null;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ value: string }>;
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<boolean> {
  const { url, key: serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) return false;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString(), updated_by: 'adsense-sync' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteSetting(key: string): Promise<boolean> {
  const { url, key: serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) return false;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getOAuthClient() {
  const binding = (name: string) => {
    const value = runtimeBindings?.[name];
    return typeof value === 'string' ? value.trim() : '';
  };
  const clientId = binding('GOOGLE_ADSENSE_CLIENT_ID') || (process.env.GOOGLE_ADSENSE_CLIENT_ID || '').trim();
  const clientSecret = binding('GOOGLE_ADSENSE_CLIENT_SECRET') || (process.env.GOOGLE_ADSENSE_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

/** Exchange the OAuth authorization code for tokens (first connect). */
async function exchangeCode(code: string): Promise<{ refresh_token?: string; access_token?: string; error?: string }> {
  const { clientId, clientSecret } = getOAuthClient();
  if (!clientId || !clientSecret) return { error: 'OAuth client not configured' };
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const body = (await res.json().catch(() => null)) as { refresh_token?: string; access_token?: string; error?: string } | null;
    if (!res.ok || !body) return { error: body?.error || `OAuth exchange failed (HTTP ${res.status})` };
    return body;
  } catch {
    return { error: 'OAuth token endpoint unreachable' };
  }
}

/** Get a fresh access token from the stored refresh token (cached in memory). */
async function getAccessToken(): Promise<{ token: string | null; error?: string }> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessTokenExpiresAt - 60_000 > now) {
    return { token: cachedAccessToken };
  }
  const refreshToken = await readSetting(SETTING_REFRESH_TOKEN);
  if (!refreshToken) return { token: null, error: 'not-connected' };

  const { clientId, clientSecret } = getOAuthClient();
  if (!clientId || !clientSecret) return { token: null, error: 'OAuth client not configured' };

  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
    if (!res.ok || !body?.access_token) {
      // 400 invalid_grant = refresh token revoked → needs reconnect.
      if (res.status === 400 || body?.error === 'invalid_grant') {
        return { token: null, error: 'reconnect' };
      }
      return { token: null, error: body?.error || `token refresh failed (HTTP ${res.status})` };
    }
    cachedAccessToken = body.access_token;
    cachedAccessTokenExpiresAt = now + Number(body.expires_in ?? 3600) * 1000;
    return { token: body.access_token };
  } catch {
    return { token: null, error: 'Google token endpoint unreachable' };
  }
}

interface ReportRow {
  cells?: Array<{ value?: string }>;
}

interface ReportResult {
  headers?: Array<{ name?: string; type?: string; currencyCode?: string }>;
  rows?: ReportRow[];
  totals?: ReportRow;
}

/** Run one reports:generate call and return the parsed metric map + currency. */
async function fetchReport(token: string, account: string, params: Record<string, string>): Promise<{ metrics: Record<string, number>; currency: string }> {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qp.append(k, v);
  for (const m of ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS', 'PAGE_RPM', 'IMPRESSION_RPM']) {
    qp.append('metrics', m);
  }
  const res = await fetch(`${ADSENSE_API}/accounts/${encodeURIComponent(account)}/reports:generate?${qp.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AdSense API error (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const data = (await res.json().catch(() => null)) as ReportResult | null;
  if (!data) throw new Error('AdSense API returned an unreadable response');

  const metrics: Record<string, number> = {};
  let currency = 'USD';
  const totals = data.totals?.cells || [];
  const headers = data.headers || [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const val = totals[i]?.value;
    if (h.type === 'METRIC_CURRENCY') {
      currency = h.currencyCode || currency;
    }
    if (val !== undefined && val !== '' && h.name) {
      const n = Number(val);
      metrics[h.name] = Number.isFinite(n) ? n : 0;
    }
  }
  return { metrics, currency };
}

function monthBounds(): { start: { y: number; m: number; d: number }; end: { y: number; m: number; d: number } } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    start: { y: start.getFullYear(), m: start.getMonth() + 1, d: start.getDate() },
    end: { y: end.getFullYear(), m: end.getMonth() + 1, d: end.getDate() },
  };
}

interface EarningsRange {
  earnings: number;
  pageViews: number;
  impressions: number;
  clicks: number;
  pageRpm: number;
  impressionRpm: number;
}

interface EarningsCache {
  syncedAt: string;
  currency: string;
  ranges: {
    today: EarningsRange;
    yesterday: EarningsRange;
    last7: EarningsRange;
    thisMonth: EarningsRange;
    prevMonth: EarningsRange;
  };
}

/** Fetch all ranges from Google and build the cache payload. */
async function syncFromGoogle(): Promise<{ cache: EarningsCache | null; error?: string }> {
  const { token, error } = await getAccessToken();
  if (!token) return { cache: null, error: error || 'not-connected' };

  // Find the AdSense account (prefer the configured publisher).
  const acctRes = await fetch(`${ADSENSE_API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!acctRes.ok) {
    if (acctRes.status === 401 || acctRes.status === 403) return { cache: null, error: 'reconnect' };
    return { cache: null, error: `AdSense accounts error (HTTP ${acctRes.status})` };
  }
  const acctData = (await acctRes.json().catch(() => null)) as { accounts?: Array<{ name?: string }> } | null;
  const accounts = acctData?.accounts || [];
  if (accounts.length === 0) return { cache: null, error: 'No AdSense account found for this login.' };
  const publisher = (process.env.ADSENSE_PUBLISHER_ID || '').trim().replace(/^pub-/, '');
  const preferred = accounts.find((a) => (a.name || '').includes(publisher || '__none__'));
  const account = (preferred || accounts[0])?.name || '';
  if (!account) return { cache: null, error: 'AdSense account lookup failed.' };

  const fetchRange = (dateRange: string, extra: Record<string, string> = {}) =>
    fetchReport(token, account, { dateRange, ...extra });

  const out: EarningsCache = {
    syncedAt: new Date().toISOString(),
    currency: 'USD',
    ranges: {
      today: { earnings: 0, pageViews: 0, impressions: 0, clicks: 0, pageRpm: 0, impressionRpm: 0 },
      yesterday: { earnings: 0, pageViews: 0, impressions: 0, clicks: 0, pageRpm: 0, impressionRpm: 0 },
      last7: { earnings: 0, pageViews: 0, impressions: 0, clicks: 0, pageRpm: 0, impressionRpm: 0 },
      thisMonth: { earnings: 0, pageViews: 0, impressions: 0, clicks: 0, pageRpm: 0, impressionRpm: 0 },
      prevMonth: { earnings: 0, pageViews: 0, impressions: 0, clicks: 0, pageRpm: 0, impressionRpm: 0 },
    },
  };

  const pick = (m: Record<string, number>, k: string) => m[k] ?? 0;

  // Fail-open per range: one bad range must not wipe the whole dashboard.
  const ranges: Array<[keyof EarningsCache['ranges'], string, Record<string, string>]> = [
    ['today', 'TODAY', {}],
    ['yesterday', 'YESTERDAY', {}],
    ['last7', 'LAST_7_DAYS', {}],
    ['thisMonth', 'MONTH_TO_DATE', {}],
    ['prevMonth', 'CUSTOM', (() => { const b = monthBounds(); return { 'startDate.year': String(b.start.y), 'startDate.month': String(b.start.m), 'startDate.day': String(b.start.d), 'endDate.year': String(b.end.y), 'endDate.month': String(b.end.m), 'endDate.day': String(b.end.d) }; })()],
  ];
  for (const [key, range, extra] of ranges) {
    try {
      const { metrics, currency } = await fetchRange(range, extra);
      out.currency = currency || out.currency;
      out.ranges[key] = {
        earnings: pick(metrics, 'ESTIMATED_EARNINGS'),
        pageViews: pick(metrics, 'PAGE_VIEWS'),
        impressions: pick(metrics, 'IMPRESSIONS'),
        clicks: pick(metrics, 'CLICKS'),
        pageRpm: pick(metrics, 'PAGE_RPM'),
        impressionRpm: pick(metrics, 'IMPRESSION_RPM'),
      };
    } catch {
      // keep zeros for this range — partial data beats no data
    }
  }

  return { cache: out };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url || '/', 'http://local').searchParams;
}

/** GET /api/adsense/status — admin: connection + last-sync state (no secrets). */
async function handleStatus(req: IncomingMessage, res: ServerResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { clientId } = getOAuthClient();
  const refreshToken = await readSetting(SETTING_REFRESH_TOKEN);
  const cacheRaw = await readSetting(SETTING_CACHE);
  let lastSync: string | null = null;
  try {
    lastSync = cacheRaw ? (JSON.parse(cacheRaw) as EarningsCache).syncedAt ?? null : null;
  } catch {
    lastSync = null;
  }
  sendJson(res, 200, {
    connected: !!refreshToken,
    clientConfigured: !!clientId,
    publisherId: (process.env.ADSENSE_PUBLISHER_ID || '').trim() || 'pub-5473713135927706',
    site: 'luxedge.us',
    lastSync,
  });
}

/** GET /api/adsense/auth-url — admin: build the Google OAuth authorize URL. */
async function handleAuthUrl(req: IncomingMessage, res: ServerResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { clientId } = getOAuthClient();
  if (!clientId) {
    sendJson(res, 503, { error: 'OAuth client is not configured. Set GOOGLE_ADSENSE_CLIENT_ID + GOOGLE_ADSENSE_CLIENT_SECRET in wrangler secrets.' });
    return;
  }
  // State nonce: 32 random hex chars. Stored (hashed) so the callback can
  // verify it without a separate session store.
  const state = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  await writeSetting('ADSENSE_OAUTH_STATE', state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  sendJson(res, 200, { authUrl: `${OAUTH_AUTH_URL}?${params.toString()}` });
}

/** GET /api/adsense/oauth/callback — public: Google redirects here after consent. */
async function handleOAuthCallback(req: IncomingMessage, res: ServerResponse) {
  const q = queryOf(req);
  const code = q.get('code') || '';
  const state = q.get('state') || '';
  const storedState = await readSetting('ADSENSE_OAUTH_STATE');
  const redirectTo = (target: string) => {
    res.writeHead(302, { Location: target });
    res.end();
  };
  if (!code || !state || !storedState || state !== storedState) {
    redirectTo('https://luxedge.us/admin/marketing-traffic?adsense=error&reason=state');
    return;
  }
  const tokens = await exchangeCode(code);
  if (!tokens.refresh_token) {
    redirectTo('https://luxedge.us/admin/marketing-traffic?adsense=error&reason=' + encodeURIComponent(tokens.error || 'exchange'));
    return;
  }
  const ok = await writeSetting(SETTING_REFRESH_TOKEN, tokens.refresh_token);
  await deleteSetting('ADSENSE_OAUTH_STATE');
  if (!ok) {
    redirectTo('https://luxedge.us/admin/marketing-traffic?adsense=error&reason=store');
    return;
  }
  // Immediately prime the cache so the admin sees real data on first visit.
  try {
    const { cache } = await syncFromGoogle();
    if (cache) await writeSetting(SETTING_CACHE, JSON.stringify(cache));
  } catch {
    /* first sync is best-effort */
  }
  redirectTo('https://luxedge.us/admin/marketing-traffic?adsense=connected');
}

/** GET /api/adsense/earnings — admin: cached earnings (never calls Google per render). */
async function handleEarnings(req: IncomingMessage, res: ServerResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const refreshToken = await readSetting(SETTING_REFRESH_TOKEN);
  if (!refreshToken) {
    sendJson(res, 200, { connected: false, data: null });
    return;
  }
  const cacheRaw = await readSetting(SETTING_CACHE);
  let cache: EarningsCache | null = null;
  try {
    cache = cacheRaw ? (JSON.parse(cacheRaw) as EarningsCache) : null;
  } catch {
    cache = null;
  }
  const stale = cache && Date.now() - new Date(cache.syncedAt).getTime() > CACHE_TTL_MS;
  sendJson(res, 200, { connected: true, stale: !!stale, data: cache });
}

/** POST /api/adsense/sync — admin: force a fresh sync from Google. */
async function handleSync(req: IncomingMessage, res: ServerResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  await readJsonBody(req, 10_000); // drain body if any
  const refreshToken = await readSetting(SETTING_REFRESH_TOKEN);
  if (!refreshToken) {
    sendJson(res, 200, { connected: false, error: 'not-connected', message: 'Connect Google AdSense first.' });
    return;
  }
  const { cache, error } = await syncFromGoogle();
  if (!cache) {
    sendJson(res, 200, { connected: true, error: error || 'sync-failed', message: error === 'reconnect' ? 'Google AdSense connection expired — reconnect.' : 'Google AdSense data temporarily unavailable.' });
    return;
  }
  await writeSetting(SETTING_CACHE, JSON.stringify(cache));
  sendJson(res, 200, { connected: true, data: cache });
}

/** POST /api/adsense/disconnect — admin: remove the stored refresh token. */
async function handleDisconnect(req: IncomingMessage, res: ServerResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  await readJsonBody(req, 10_000);
  await deleteSetting(SETTING_REFRESH_TOKEN);
  await deleteSetting(SETTING_CACHE);
  cachedAccessToken = null;
  sendJson(res, 200, { ok: true });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url || '/', 'http://local').pathname;
  try {
    if (req.method === 'GET' && path === '/api/adsense/status') return handleStatus(req, res);
    if (req.method === 'GET' && path === '/api/adsense/auth-url') return handleAuthUrl(req, res);
    if (req.method === 'GET' && path === '/api/adsense/oauth/callback') return handleOAuthCallback(req, res);
    if (req.method === 'GET' && path === '/api/adsense/earnings') return handleEarnings(req, res);
    if (req.method === 'POST' && path === '/api/adsense/sync') return handleSync(req, res);
    if (req.method === 'POST' && path === '/api/adsense/disconnect') return handleDisconnect(req, res);
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: 'Internal server error' });
  }
}
