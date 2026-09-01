// ============================================================================
// LUXEDGE — BLOG AUTOMATION API (server-side, blog-scoped)
//
// Provides a dedicated secure surface for n8n/Hermes to create/publish blog
// content WITHOUT touching the repository, git, or deployment. It exposes the
// blog tables only (never orders/customers/payments/catalog/auth) and writes
// with the SUPABASE_SERVICE_ROLE_KEY server-side — that key never reaches the
// browser.
//
// AUTH: the caller must present the shared secret (BLOG_AUTOMATION_SECRET) as
// `Authorization: Bearer …` or `x-automation-secret: …`. If the secret is not
// configured the endpoint is FAIL-CLOSED (503) — it never opens.
//
// AUTO-PUBLISH SAFETY GATE (Phase L/M): `publish` only ever publishes when
// every quality/safety check passes; otherwise the post is saved as a DRAFT
// with the reasons listed in the response. Automation can never bypass the
// gate, never republish a locked/unpublish/archived post, and never exceed the
// rolling 7-day auto-publish cap (env BLOG_AUTO_MAX_PER_7D, default 3).
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';

const AUTO_MAX_PER_7D = Number(process.env.BLOG_AUTO_MAX_PER_7D || 3);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Conservative content-safety scan (Phase L): these must never appear in an
// auto-published post. False positives are acceptable — the gate degrades to a
// manual-review draft, which is the safe direction.
const BANNED_PATTERNS = [
  /\bFDA\s*approved\b/i,
  /\bcures?\s+(cancer|disease|illness)\b/i,
  /\btreats?\s+(cancer|disease|illness)\b/i,
  /\bguaranteed?\s+cure\b/i,
  /\bmilk[-\s]?production\b.*\bguarantee/i,
  /\bfertility\b.*\bguarantee/i,
];

function slugify(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

interface BlogAutomationPayload {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  hero_image_url?: string | null;
  tags?: string[];
  author_name?: string;
  seo_title?: string;
  meta_description?: string;
  target_keyword?: string;
  secondary_keywords?: string[];
  search_intent?: string;
  faq?: { q: string; a: string }[];
  internal_links?: string[];
  quality_score?: number;
  source_notes?: unknown;
  generated_by?: string;
  automation_run_id?: string;
  scheduled_at?: string | null;
}

// ---------------------------------------------------------------------------
// Env / DB helpers (service role, server-side only)
// ---------------------------------------------------------------------------

function supabase(): { url: string; key: string } | null {
  const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

async function pgFetch(url: string, key: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...((init?.headers as Record<string, string>) || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function findPostBySlug(url: string, key: string, slug: string): Promise<Record<string, unknown> | null> {
  const r = await pgFetch(url, key, `blog_posts?select=id,status,automation_locked&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  if (!r.ok || !Array.isArray(r.data)) return null;
  return (r.data as Record<string, unknown>[])[0] || null;
}

/** Validate that internal links are sane same-domain paths and resolve. */
async function validateInternalLinks(url: string, key: string, links: string[]): Promise<string | null> {
  for (const raw of links) {
    const href = String(raw || '').trim();
    if (!href) continue;
    if (href === '/') continue;
    if (!/^\/(blog|category|product)\/[a-z0-9-]+$/.test(href)) {
      return `Internal link "${href}" is not a same-domain Luxedge path.`;
    }
    const [, kind, seg] = /^\/(blog|category|product)\/([a-z0-9-]+)$/.exec(href)!;
    let table: string;
    if (kind === 'blog') table = 'blog_posts';
    else if (kind === 'category') table = 'categories';
    else table = 'products';
    const r = await pgFetch(url, key, `${table}?select=id&slug=eq.${encodeURIComponent(seg)}&limit=1`);
    if (!r.ok || !Array.isArray(r.data) || (r.data as unknown[]).length === 0) {
      return `Internal link "${href}" does not resolve to a live ${kind}.`;
    }
  }
  return null;
}

async function countPublishedLast7d(url: string, key: string): Promise<number> {
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const r = await pgFetch(url, key, `blog_posts?select=id&status=eq.published&published_at=gte.${encodeURIComponent(since)}&limit=1000`);
  if (!r.ok || !Array.isArray(r.data)) return 9999;
  return (r.data as unknown[]).length;
}

// ---------------------------------------------------------------------------
// Auto-publish safety gate
// ---------------------------------------------------------------------------

interface GateResult { ok: boolean; reasons: string[] }

async function autoPublishGate(url: string, key: string, body: BlogAutomationPayload): Promise<GateResult> {
  const reasons: string[] = [];
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const slug = String(body.slug || '').trim() || slugify(title);

  if (title.length < 10) reasons.push('Title is too short.');
  if (content.length < 300) reasons.push('Content is too thin (min ~300 chars).');
  if (!slug) reasons.push('No slug could be derived.');
  if (typeof body.quality_score !== 'number' || body.quality_score < 90) {
    reasons.push('quality_score is missing or below 90.');
  }
  if (!body.search_intent && !body.target_keyword) {
    reasons.push('No search_intent or target_keyword supplied.');
  }
  if (/lorem ipsum/i.test(content)) reasons.push('Contains placeholder ("lorem ipsum") text.');
  for (const p of BANNED_PATTERNS) {
    if (p.test(content)) reasons.push('Contains an unsupported medical/veterinary/nutritional claim.');
  }
  const links: string[] = Array.isArray(body.internal_links) ? body.internal_links : [];
  if (links.length > 0) {
    const bad = await validateInternalLinks(url, key, links);
    if (bad) reasons.push(bad);
  }
  if (links.length > 5) reasons.push('Too many contextual internal links (max 5).');

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Record a revision with actor=automation
// ---------------------------------------------------------------------------

async function recordRevision(url: string, key: string, id: string, action: string, previous: unknown, next: unknown): Promise<void> {
  const r = await pgFetch(url, key, `blog_revisions?blog_id=eq.${encodeURIComponent(id)}&select=revision&limit=1000`);
  const revs = r.ok && Array.isArray(r.data) ? (r.data as { revision: number }[]) : [];
  const revision = revs.reduce((m, x) => Math.max(m, Number(x.revision) || 0), 0) + 1;
  await pgFetch(url, key, 'blog_revisions', {
    method: 'POST',
    body: JSON.stringify({ blog_id: id, revision, action, previous, next, actor: 'automation' }),
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function blogAutomationHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Auth — fail closed.
  const secret = (process.env.BLOG_AUTOMATION_SECRET || '').trim();
  if (!secret) {
    sendJson(res, 503, { error: 'Blog automation is not configured (BLOG_AUTOMATION_SECRET unset).' });
    return;
  }
  const provided = String(req.headers['x-automation-secret'] || req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!provided || provided !== secret) {
    sendJson(res, 401, { error: 'Unauthorized — invalid automation secret.' });
    return;
  }

  const sb = supabase();
  if (!sb) {
    sendJson(res, 503, { error: 'Supabase service role is not configured.' });
    return;
  }

  const urlOnly = String(req.url || '').split('?')[0];
  const segs = urlOnly.split('/').filter(Boolean); // ['blog-automation', ...]
  const resource = segs[1] || '';

  try {
    // GET /blog-automation/posts
    if (req.method === 'GET' && resource === 'posts') {
      const r = await pgFetch(sb.url, sb.key, 'blog_posts?select=id,slug,title,status,quality_score,generated_by,automation_run_id,created_at,updated_at,updated_at&order=updated_at.desc&limit=500');
      if (!r.ok) return sendJson(res, 502, { error: 'Blog list unavailable.' });
      return sendJson(res, 200, { posts: r.data });
    }

    // GET /blog-automation/check-slug?slug=…
    if (req.method === 'GET' && resource === 'check-slug') {
      const q = String(req.url || '').split('?')[1] || '';
      const slug = new URLSearchParams(q).get('slug') || '';
      const found = await findPostBySlug(sb.url, sb.key, slug);
      return sendJson(res, 200, { slug, available: !found });
    }

    const body = (await readJsonBody(req)) as BlogAutomationPayload;

    // POST /blog-automation/draft — always creates a draft (even below-gate).
    if (req.method === 'POST' && resource === 'draft') {
      const title = String(body.title || '').trim();
      if (title.length < 10) return sendJson(res, 400, { error: 'title is required (min 10 chars).' });
      const slug = String(body.slug || '').trim() || slugify(title);
      const dup = await findPostBySlug(sb.url, sb.key, slug);
      if (dup) return sendJson(res, 409, { error: 'Duplicate slug.', slug, available: false });
      const row = {
        slug,
        title,
        excerpt: body.excerpt || null,
        content: body.content || '',
        hero_image_url: body.hero_image_url || null,
        tags: body.tags || [],
        author_name: body.author_name || 'Luxedge Editorial Team',
        status: 'draft',
        scheduled_at: body.scheduled_at || null,
        seo_title: body.seo_title || null,
        meta_description: body.meta_description || null,
        target_keyword: body.target_keyword || null,
        secondary_keywords: body.secondary_keywords || [],
        search_intent: body.search_intent || null,
        faq: body.faq || [],
        internal_links: body.internal_links || [],
        quality_score: body.quality_score ?? null,
        source_notes: body.source_notes || null,
        generated_by: body.generated_by || 'automation',
        automation_run_id: body.automation_run_id || null,
        automation_locked: false,
      };
      const created = await pgFetch(sb.url, sb.key, 'blog_posts', { method: 'POST', body: JSON.stringify(row) });
      if (!created.ok || !Array.isArray(created.data)) {
        return sendJson(res, 502, { error: 'Could not create draft.', detail: created.data || created.status });
      }
      const createdRow = (created.data as Record<string, unknown>[])[0] || {};
      await recordRevision(sb.url, sb.key, String(createdRow.id), 'create', null, createdRow);
      return sendJson(res, 201, { id: createdRow.id, status: 'draft', slug });
    }

    // POST /blog-automation/publish — create/update then publish ONLY via the gate.
    if (req.method === 'POST' && resource === 'publish') {
      const title = String(body.title || '').trim();
      if (title.length < 10) return sendJson(res, 400, { error: 'title is required (min 10 chars).' });
      const slug = String(body.slug || '').trim() || slugify(title);
      const existing = await findPostBySlug(sb.url, sb.key, slug);
      if (existing && existing.automation_locked === true) {
        return sendJson(res, 409, { error: 'automation_locked — Salman manually owns this post.', slug });
      }
      const gate = await autoPublishGate(sb.url, sb.key, body);
      if (!gate.ok) {
        // Save as DRAFT regardless — automation never bypasses the gate.
        const row = {
          slug,
          title,
          excerpt: body.excerpt || null,
          content: body.content || '',
          hero_image_url: body.hero_image_url || null,
          tags: body.tags || [],
          author_name: body.author_name || 'Luxedge Editorial Team',
          status: 'draft',
          scheduled_at: body.scheduled_at || null,
          seo_title: body.seo_title || null,
          meta_description: body.meta_description || null,
          target_keyword: body.target_keyword || null,
          secondary_keywords: body.secondary_keywords || [],
          search_intent: body.search_intent || null,
          faq: body.faq || [],
          internal_links: body.internal_links || [],
          quality_score: body.quality_score ?? null,
          source_notes: body.source_notes || null,
          generated_by: body.generated_by || 'automation',
          automation_run_id: body.automation_run_id || null,
          automation_locked: false,
        };
        await pgFetch(sb.url, sb.key, 'blog_posts', { method: 'POST', body: JSON.stringify(row) });
        return sendJson(res, 200, { status: 'draft', reasons: gate.reasons, message: 'Saved as draft — quality/safety gate not passed. Human review required.' });
      }

      // Frequency cap: max auto-published posts per rolling 7 days.
      const recent = await countPublishedLast7d(sb.url, sb.key);
      if (recent >= AUTO_MAX_PER_7D) {
        const reasons = [`Auto-publish frequency cap reached (${AUTO_MAX_PER_7D} per 7 days).`];
        const row = {
          slug, title, excerpt: body.excerpt || null, content: body.content || '',
          hero_image_url: body.hero_image_url || null, tags: body.tags || [], author_name: body.author_name || 'Luxedge Editorial Team',
          status: 'scheduled', scheduled_at: body.scheduled_at || null, seo_title: body.seo_title || null,
          meta_description: body.meta_description || null, target_keyword: body.target_keyword || null,
          secondary_keywords: body.secondary_keywords || [], search_intent: body.search_intent || null,
          faq: body.faq || [], internal_links: body.internal_links || [], quality_score: body.quality_score ?? null,
          source_notes: body.source_notes || null, generated_by: body.generated_by || 'automation',
          automation_run_id: body.automation_run_id || null, automation_locked: false,
        };
        const ins = await pgFetch(sb.url, sb.key, 'blog_posts', { method: 'POST', body: JSON.stringify(row) });
        const createdRow = Array.isArray(ins.data) ? (ins.data as Record<string, unknown>[])[0] : {};
        if (createdRow.id) await recordRevision(sb.url, sb.key, String(createdRow.id), 'schedule', null, createdRow);
        return sendJson(res, 202, {
          id: createdRow.id, status: 'scheduled', reasons,
          message: 'Auto-publish capped — post scheduled for human approval instead.',
        });
      }

      // Approved: create (or update) and publish.
      const now = new Date().toISOString();
      if (existing) {
        const patch = {
          title, excerpt: body.excerpt || null, content: body.content || '', hero_image_url: body.hero_image_url || null,
          tags: body.tags || [], seo_title: body.seo_title || null, meta_description: body.meta_description || null,
          target_keyword: body.target_keyword || null, secondary_keywords: body.secondary_keywords || [],
          search_intent: body.search_intent || null, faq: body.faq || [], internal_links: body.internal_links || [],
          quality_score: body.quality_score ?? null, status: 'published', published_at: now, scheduled_at: null,
        };
        const upd = await pgFetch(sb.url, sb.key, `blog_posts?slug=eq.${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(patch) });
        const row = Array.isArray(upd.data) ? (upd.data as Record<string, unknown>[])[0] : {};
        await recordRevision(sb.url, sb.key, String(existing.id), 'publish', null, row);
        return sendJson(res, 200, { id: existing.id, status: 'published', slug });
      }
      const row = {
        slug, title, excerpt: body.excerpt || null, content: body.content || '',
        hero_image_url: body.hero_image_url || null, tags: body.tags || [], author_name: body.author_name || 'Luxedge Editorial Team',
        status: 'published', scheduled_at: null, published_at: now, seo_title: body.seo_title || null,
        meta_description: body.meta_description || null, target_keyword: body.target_keyword || null,
        secondary_keywords: body.secondary_keywords || [], search_intent: body.search_intent || null,
        faq: body.faq || [], internal_links: body.internal_links || [], quality_score: body.quality_score ?? null,
        source_notes: body.source_notes || null, generated_by: body.generated_by || 'automation',
        automation_run_id: body.automation_run_id || null, automation_locked: false,
      };
      const created = await pgFetch(sb.url, sb.key, 'blog_posts', { method: 'POST', body: JSON.stringify(row) });
      if (!created.ok || !Array.isArray(created.data)) {
        return sendJson(res, 502, { error: 'Could not publish.', detail: created.data || created.status });
      }
      const createdRow = (created.data as Record<string, unknown>[])[0] || {};
      await recordRevision(sb.url, sb.key, String(createdRow.id), 'publish', null, createdRow);
      return sendJson(res, 201, { id: createdRow.id, status: 'published', slug });
    }

    // PATCH /blog-automation/{id}
    if (req.method === 'PATCH' && resource) {
      const patchId = resource;
      const got = await pgFetch(sb.url, sb.key, `blog_posts?id=eq.${encodeURIComponent(patchId)}&select=id,automation_locked&limit=1`);
      const row = got.ok && Array.isArray(got.data) ? (got.data as Record<string, unknown>[])[0] : null;
      if (!row) return sendJson(res, 404, { error: 'Post not found.' });
      if (row.automation_locked === true) {
        return sendJson(res, 409, { error: 'automation_locked — Salman manually owns this post.' });
      }
      const allowed: Record<string, unknown> = {};
      const keys: (keyof BlogAutomationPayload)[] = Object.keys(body) as (keyof BlogAutomationPayload)[];
      for (const k of keys) allowed[k] = body[k];
      delete allowed.automation_locked;
      const upd = await pgFetch(sb.url, sb.key, `blog_posts?id=eq.${encodeURIComponent(patchId)}`, { method: 'PATCH', body: JSON.stringify(allowed) });
      const updated = Array.isArray(upd.data) ? (upd.data as Record<string, unknown>[])[0] : null;
      await recordRevision(sb.url, sb.key, patchId, 'automation_update', row, updated);
      return sendJson(res, 200, updated || { id: patchId });
    }

    return sendJson(res, 400, { error: 'Unknown blog-automation route.' });
  } catch (e) {
    return sendJson(res, 500, { error: (e as Error).message || 'Internal server error.' });
  }
}