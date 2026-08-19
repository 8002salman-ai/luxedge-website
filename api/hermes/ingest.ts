// POST/GET /api/hermes/ingest
//
// RESEARCH-ONLY ingestion for Hermes / Salman OS intelligence.
//
// Architecture boundary (Luxedge is the main execution system):
//   Hermes → Salman OS → THIS endpoint → hermes_* research tables
//   → Luxedge's OWN review/scoring pipeline decides what (if anything) to do.
//
// SECURITY:
//   - Admin JWT required (same guard as /api/ai/* and /api/fetch-page).
//   - Body is strictly schema-validated by src/features/hermes/ingest.ts:
//     unknown fields are DROPPED, text is sanitized/capped, URLs must be
//     http(s), numbers must be finite and in-range.
//   - This endpoint can ONLY insert into the research tables
//     (hermes_recommendations / hermes_seo_suggestions /
//     hermes_marketing_intel). It can NEVER create, edit, publish, price or
//     delete a Luxedge product, touch settings, run code, or place an order.
//   - Writes run as the caller's admin JWT through PostgREST, so RLS
//     (migration 0012, admin-only) governs every mutation.
//   - Command-looking content is stored as inert text at most — never
//     interpreted, never executed. GET returns research rows only.
//
// Never returns credentials, tokens, or provider keys.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin, getBearerToken } from '../_lib/auth.js';
import { parseIngestBody, flagSuspiciousContent } from '../../src/features/hermes/ingest.js';
import { productInputToRow, seoInputToRow, marketingInputToRow } from '../../src/features/hermes/rows.js';
import type { HermesIngestInput } from '../../src/features/hermes/types.js';

const TABLES: Record<HermesIngestInput['kind'], string> = {
  product: 'hermes_recommendations',
  seo: 'hermes_seo_suggestions',
  marketing: 'hermes_marketing_intel',
};

const RESEARCH_TABLES = ['hermes_recommendations', 'hermes_seo_suggestions', 'hermes_marketing_intel', 'ads_readiness'] as const;

/** PostgREST fetch as the caller's admin JWT (RLS enforces admin-only writes). */
async function rest(
  method: 'GET' | 'POST',
  table: string,
  token: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!base || !anonKey) {
    return { ok: false, status: 503, data: { error: 'Supabase is not configured on this deployment.' } };
  }
  const headers: Record<string, string> = {
    apikey: anonKey,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    Authorization: `Bearer ${token}`,
  };
  try {
    const res = await fetch(`${base}/rest/v1/${table}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { ok: false, status: res.status, data: { error: 'database request rejected' } };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

function buildRow(kind: HermesIngestInput['kind'], data: HermesIngestInput['data']): { id: string } {
  if (kind === 'product') return productInputToRow(data as Parameters<typeof productInputToRow>[0]);
  if (kind === 'seo') return seoInputToRow(data as Parameters<typeof seoInputToRow>[0]);
  return marketingInputToRow(data as Parameters<typeof marketingInputToRow>[0]);
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
  const token = getBearerToken(req);

  // -------------------------------------------------------------------------
  // GET — read-only research feeds (admin review)
  // -------------------------------------------------------------------------
  if (req.method === 'GET') {
    const out: Record<string, unknown> = {};
    for (const table of RESEARCH_TABLES) {
      const r = await rest('GET', `${table}?order=created_at.desc&limit=50`, token);
      if (!r.ok) {
        sendJson(res, r.status, r.data);
        return;
      }
      out[table] = r.data;
    }
    sendJson(res, 200, out);
    return;
  }

  // -------------------------------------------------------------------------
  // POST — validate + store research evidence (never executes anything)
  // -------------------------------------------------------------------------
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }

  const parsed = parseIngestBody(body);
  if (!parsed.ok || !parsed.input) {
    sendJson(res, 400, { error: 'Invalid research payload', errors: parsed.errors });
    return;
  }

  // Advisory only: flag shell/SQL/script-looking text so reviewers can see it.
  // The content is still stored as inert text — it is never executed.
  const flagged = flagSuspiciousContent(JSON.stringify(parsed.input));

  const { kind, data } = parsed.input;
  const row = buildRow(kind, data);
  const table = TABLES[kind];

  const r = await rest('POST', table, token, row);
  if (!r.ok) {
    sendJson(res, r.status, { error: (r.data as { error?: string })?.error ?? 'Could not store research record.' });
    return;
  }

  sendJson(res, 201, {
    ok: true,
    id: row.id,
    kind,
    table,
    status: 'stored',
    researchOnly: true, // research evidence only — Luxedge decides what to do with it
    flagged: flagged.length ? flagged : undefined,
  });
}
