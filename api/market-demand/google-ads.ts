// GET/POST /api/market-demand/google-ads
//
// Admin-authenticated market-demand proxy (Phase 4G §E, hardened 4G.1).
// The browser NEVER holds Google Ads credentials — it calls THIS endpoint
// with the admin JWT; the server performs OAuth + the official v25 call.
//
// Actions:
//   health             → { provider:'google-ads', health: not_configured|configured }
//                        NOT CONFIGURED: required env missing.
//                        CONFIGURED: env present (no live probe yet — ONLINE is
//                        only reported after a successful authorized request).
//   historical-metrics → POST { keywords[], market:'US', language:'en' }
//                        Hard limit: max 5 UNIQUE normalized keywords — a
//                        6-keyword request is rejected with HTTP 400
//                        (MAX_KEYWORDS_EXCEEDED), never silently truncated.
//                        USA only, English only. When the credential set is
//                        configured the server performs the official v25 call.
//
// SECURITY: admin JWT required; keyword/market/language validated; the
// response contains structured metric FACTS and safe errors only — never
// tokens, secrets, or raw Google error bodies with sensitive context.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import {
  googleAdsConfiguredServer, generateKeywordHistoricalMetrics,
  googleAdsEnvStatus, type GoogleHistoricalMetricsOutcome,
} from '../_lib/googleAds.js';

const MAX_KEYWORDS = 5;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer | string) => {
      raw += chunk.toString();
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Normalize WITHOUT truncating: returns every unique normalized keyword.
 * The >5 rejection must be reachable — the route checks the full count below
 * instead of silently slicing to 5 (Phase 4G.1 §A3).
 */
function normalizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map((k) => k.trim().toLowerCase()))];
}

function safeOutcome(o: GoogleHistoricalMetricsOutcome): Record<string, unknown> {
  return {
    provider: 'google-ads',
    status: o.status,
    requestedKeywords: o.requestedKeywords,
    keywordsRequested: o.requestedKeywords.length,
    keywordsReturned: o.results.length,
    results: o.results,
    errorCode: o.errorCode,
    errorSafe: o.errorSafe,
    requestId: o.requestId,
    cacheHit: o.cacheHit,
    observedAt: new Date().toISOString(),
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  const url = new URL(req.url || '/', 'http://localhost');
  const action = (url.searchParams.get('action') || 'health').toLowerCase();

  // ---------------- health ----------------
  if (action === 'health') {
    const status = googleAdsEnvStatus();
    const health = status.configured ? 'configured' : 'not_configured';
    sendJson(res, 200, {
      provider: 'google-ads',
      health,
      detail: status.configured
        ? 'Google Ads credential set is configured server-side. ONLINE is only reported after a successful authorized Google API request (live proof).'
        : 'Google Ads credentials are not configured on the server. Add the GOOGLE_ADS_* env set server-side only (never VITE_*) for a live proof.',
      missing: status.configured ? [] : status.missing,
    });
    return;
  }

  // ---------------- historical-metrics ----------------
  if (action === 'historical-metrics' && req.method === 'POST') {
    const body = await readBody(req);
    const keywords = normalizeKeywords(body.keywords);
    if (keywords.length === 0) {
      sendJson(res, 400, { error: 'At least one keyword is required.' });
      return;
    }
    // Strict rejection — never silently truncate an oversized request.
    if (keywords.length > MAX_KEYWORDS) {
      sendJson(res, 400, { errorCode: 'MAX_KEYWORDS_EXCEEDED', error: `Maximum ${MAX_KEYWORDS} keywords per proof request (received ${keywords.length}).` });
      return;
    }
    const market = String(body.market || 'US').trim().toUpperCase();
    if (market !== 'US' && market !== 'USA') {
      sendJson(res, 400, { error: 'USA only for the demand proof.' });
      return;
    }
    const language = String(body.language || 'en').trim().toLowerCase();
    if (language !== 'en' && language !== 'english') {
      sendJson(res, 400, { error: 'English only for the demand proof.' });
      return;
    }

    if (!googleAdsConfiguredServer()) {
      sendJson(res, 200, {
        provider: 'google-ads',
        status: 'not_configured',
        requestedKeywords: keywords,
        keywordsRequested: keywords.length,
        keywordsReturned: 0,
        results: [],
        errorCode: null,
        errorSafe: null,
        requestId: null,
        cacheHit: false,
        warning: 'Google Ads credentials not configured server-side — no live call made.',
        observedAt: new Date().toISOString(),
      });
      return;
    }

    // Real-capable path (Phase 4G.1): the server performs the official v25
    // GenerateKeywordHistoricalMetrics call with its own OAuth access token.
    const outcome = await generateKeywordHistoricalMetrics(keywords);
    if (outcome.status === 'error' && outcome.errorCode === 'NOT_CONFIGURED') {
      sendJson(res, 200, { ...safeOutcome(outcome), warning: 'Google Ads credentials not configured server-side — no live call made.' });
      return;
    }
    if (outcome.status === 'error') {
      // Safe structured error — no raw Google error body, no tokens.
      sendJson(res, 200, safeOutcome(outcome));
      return;
    }
    sendJson(res, 200, safeOutcome(outcome));
    return;
  }

  sendJson(res, 400, { error: `Unknown action: ${action}` });
}
