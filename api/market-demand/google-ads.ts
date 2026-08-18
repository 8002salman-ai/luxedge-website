// GET /api/market-demand/google-ads
//
// Admin-authenticated market-demand proxy (Phase 4G §E). The browser NEVER
// holds Google Ads credentials — it calls THIS endpoint with the admin JWT.
//
// Actions:
//   health             → { provider:'google-ads', health: configured|not_configured }
//                        Phase 4G: presence check only — NO live Google call
//                        (online/offline requires the owner-approved live proof).
//   historical-metrics → ?action=historical-metrics with POST body
//                        { keywords: string[], market: 'US', language: 'en' }
//                        Hard limits: max 5 keywords, USA only, English only.
//                        Phase 4G returns status 'not_configured' — no live call.
//
// SECURITY: admin JWT required; keyword/market/language validated; response
// contains NO secret values — only configured/not_configured and (future)
// official metric facts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { googleAdsConfiguredServer, googleAdsSafeError } from '../_lib/googleAds.js';

const MAX_KEYWORDS = 5;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) break;
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const uniq = [...new Set(raw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map((k) => k.trim().toLowerCase()))];
  return uniq.slice(0, MAX_KEYWORDS);
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
    // Phase 4G: presence probe only — configured / not_configured. A live
    // online/offline probe belongs to the owner-approved live-proof phase.
    const configured = googleAdsConfiguredServer();
    sendJson(res, 200, {
      provider: 'google-ads',
      health: configured ? 'configured' : 'not_configured',
      detail: configured
        ? 'Google Ads credential set is configured server-side. Live Keyword Planner calls are NOT enabled in Phase 4G (owner-approved live proof pending).'
        : 'Google Ads credentials are not configured on the server. Add the GOOGLE_ADS_* env set server-side only (never VITE_*) for a live proof.',
    });
    return;
  }

  // ---------------- historical-metrics ----------------
  if (action === 'historical-metrics' && req.method === 'POST') {
    const body = await readBody(req);
    const keywords = normalizeKeywords(body.keywords);
    if (keywords.length === 0) {
      sendJson(res, 400, { error: 'At least one keyword is required (max 5).' });
      return;
    }
    if (keywords.length > MAX_KEYWORDS) {
      sendJson(res, 400, { error: `Maximum ${MAX_KEYWORDS} keywords per proof request.` });
      return;
    }
    const market = String(body.market || 'US').trim().toUpperCase();
    if (market !== 'US' && market !== 'USA') {
      sendJson(res, 400, { error: 'USA only for Phase 4G demand proof.' });
      return;
    }
    const language = String(body.language || 'en').trim().toLowerCase();
    if (language !== 'en' && language !== 'english') {
      sendJson(res, 400, { error: 'English only for Phase 4G demand proof.' });
      return;
    }

    if (!googleAdsConfiguredServer()) {
      sendJson(res, 200, {
        provider: 'google-ads',
        status: 'not_configured',
        keywords,
        market: 'US',
        language: 'en',
        metrics: [],
        warning: 'Google Ads credentials not configured server-side — no live call made (Phase 4G).',
      });
      return;
    }

    // Phase 4G HARD RULE: NO live Google Ads calls. The live path (official
    // KeywordPlanIdeaService / GenerateKeywordHistoricalMetrics with the
    // server credential set) is implemented by the client adapter but is only
    // exercised in the owner-approved live-proof phase. Fail safe here.
    sendJson(res, 200, {
      provider: 'google-ads',
      status: 'error',
      keywords,
      market: 'US',
      language: 'en',
      metrics: [],
      errorSafe: googleAdsSafeError('live Google Ads Keyword Planner calls are not enabled in Phase 4G (owner-approved live proof required)'),
    });
    return;
  }

  sendJson(res, 400, { error: `Unknown action: ${action}` });
}
