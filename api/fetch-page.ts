// GET /api/fetch-page?url=...
//
// Credential-backed page fetching. When SCRAPE_DO_TOKEN is configured on the
// server, scraping goes through scrape.do from the server (token never ships
// to the browser). Falls back to the public Jina Reader when no token is set.
//
// SECURITY:
//  - Admin-only (Phase 3A): valid Supabase admin JWT required. Arbitrary URL
//    fetching is an abuse/SSRF vector, so unauthenticated access is denied.
//  - SSRF-guarded: the target hostname is DNS-resolved and blocked if it
//    resolves to any private/reserved range; redirects are re-validated per
//    hop; non-http(s) URLs, embedded credentials and non-standard ports rejected.
//  - Rate-limited per instance.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendText, rateLimited, clientIp } from './_lib/providers.js';
import { validateFetchTarget } from './_lib/ssrf.js';
import { requireAdmin } from './_lib/auth.js';

const MAX_REDIRECTS = 3;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await handle(req, res);
  } catch (e) {
    // Never let an unexpected error surface as Vercel's opaque 502 page —
    // always answer with a clean JSON error (no secrets, no stack traces).
    sendJson(res, 502, { error: `Could not fetch page (${(e as Error).message || 'unexpected error'})` });
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  // Admin session required — arbitrary page fetching must not be open.
  if (!(await requireAdmin(req, res))) return;

  const url = new URL(req.url || '/', 'http://localhost').searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    sendJson(res, 400, { error: 'A valid http(s) url parameter is required' });
    return;
  }

  const guardErr = await validateFetchTarget(url);
  if (guardErr) {
    sendJson(res, 400, { error: `URL rejected: ${guardErr}` });
    return;
  }

  const token = (process.env.SCRAPE_DO_TOKEN || '').trim();
  const targets: { label: string; url: string }[] = token
    ? [{ label: 'scrape.do', url: `https://api.scrape.do/?token=${encodeURIComponent(token)}&url=${encodeURIComponent(url)}&render=true&countryCode=US` }]
    : [{ label: 'Jina Reader', url: `https://r.jina.ai/${encodeURIComponent(url)}` }];

  let lastErr = 'no proxy available';
  // AliExpress alternates between the real product page, its anti-bot
  // "punish" page, and transient 5xx — a single attempt frequently fails even
  // though the product IS retrievable. Retry a few times with backoff before
  // giving up (live finding: same URL returned punish page then real page).
  const MAX_ATTEMPTS = 3;
  for (const { label, url: proxyUrl } of targets) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const text = await fetchWithRedirectValidation(proxyUrl, MAX_REDIRECTS);
        if (text === null) {
          lastErr = `${label}: redirect blocked`;
          if (attempt < MAX_ATTEMPTS) { await sleep(1200 * attempt); continue; }
          break;
        }
        if (text.trim().length < 100) {
          lastErr = `${label}: too little content`;
          if (attempt < MAX_ATTEMPTS) { await sleep(1200 * attempt); continue; }
          break;
        }
      // Jina Reader returns "Warning: <host> URL returned error <code>: ..."
      // for failed pages (429/403/404/…) and BLOCKED-SNAPSHOT pages (e.g.
      // "## www.target.com is blocked … ERR_BLOCKED_BY_CLIENT") when its own
      // crawl was blocked. Neither is a page — they must never be returned as
      // successful content (Phase 4E/4E.2 honesty fix).
      const lower = text.toLowerCase();
      if (/^Warning:\s+.+?\bURL returned error\s+\d{3}\b/im.test(text) ||
        (text.length < 15000 && (lower.includes('err_blocked_by_client') || lower.includes('page has been blocked by chrome') || lower.includes('this page has been blocked')))) {
        lastErr = `${label}: proxy error/block page (target not retrievable)`;
        continue;
      }
      // AliExpress anti-bot "punish" page (sufei) — served instead of the
      // product page to scrapers. Contains zero product data; never serve it
      // as successful page content.
      if (text.length < 15000 && (lower.includes('sufei-punish') || lower.includes('punish-page') || lower.includes('bx-pu-') || /punish\?recaptcha=1/i.test(lower))) {
        lastErr = `${label}: AliExpress anti-bot punish page (no product data)`;
        // Punish pages are transient — the very next request often returns
        // the real product page. Retry before declaring failure.
        if (attempt < MAX_ATTEMPTS) { await sleep(1200 * attempt); continue; }
        break;
      }
      sendText(res, 200, text);
      return;
    } catch (e) {
      lastErr = `${label}: ${(e as Error).message}`;
      if (attempt < MAX_ATTEMPTS) { await sleep(1200 * attempt); continue; }
    }
    }
  }
  sendJson(res, 502, { error: `Could not fetch page (${lastErr})` });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch following redirects manually, validating every hop against the SSRF
 * guard so a redirect cannot bypass the initial host check. Returns null when
 * a hop was blocked; throws on network failure.
 */
async function fetchWithRedirectValidation(startUrl: string, maxHops: number): Promise<string | null> {
  let current = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const err = await validateFetchTarget(current);
    if (err) return null;
    const r = await fetch(current, {
      signal: AbortSignal.timeout(40_000),
      redirect: 'manual',
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  return null;
}
