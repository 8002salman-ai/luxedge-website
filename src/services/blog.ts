// ============================================================================
// LUXEDGE — BLOG CMS SERVICE (client)
//
// The single source of truth for blog content is the Supabase `blog_posts`
// table, NOT INIT_BLOGS in src/App.tsx. This module:
//   * loadPublishedBlogs()  — READ published posts for the storefront. Uses the
//     public anon key; RLS returns only published (scheduled_at <= now()) posts.
//     Returns NULL on genuine failure (unconfigured / unreachable / table not
//     migrated) and [] on a reachable-but-empty DB, so callers can decide the
//     migration/rollback fallback policy.
//   * admin*() methods       — authenticated READ/WRITE for the Admin Blog
//     Manager (draft/edit/publish/schedule/unpublish/archive/restore/delete),
//     always authorizing with the SIGNED-IN admin's JWT so RLS governs every
//     write. No service-role key ever reaches the browser.
//
// SECURITY: anon key + the caller's own JWT only. Blog automation writes are
// deliberately NOT exposed here — they happen server-side via /blog-automation.
// ============================================================================

import { getDb } from './db';
import type { DbAdapter } from './db';
import { getFreshAccessToken } from './supabase';
import type { BlogPost } from '../App';

/** Raw Supabase `blog_posts` row (snake_case DB columns). */
export interface CmsBlogRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  tags: string[] | null;
  author_name: string | null;
  author_id: string | null;
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  date_label?: string | null;
  seo_title?: string | null;
  meta_description?: string | null;
  target_keyword?: string | null;
  secondary_keywords?: string[] | null;
  search_intent?: string | null;
  faq?: { q: string; a: string }[] | null;
  internal_links?: unknown[] | null;
  quality_score?: number | null;
  generated_by?: string | null;
  automation_run_id?: string | null;
  automation_locked?: boolean | null;
}

export type BlogStatus = CmsBlogRow['status'];

const rowStatusToBlog = (status: CmsBlogRow['status']): BlogPost['status'] => {
  if (status === 'published') return 'published';
  if (status === 'scheduled') return 'pending'; // visible to author only pre-date
  return 'draft';
};

/** Map a DB row onto the storefront BlogPost shape (nothing invented). */
export function mapRowToBlogPost(r: CmsBlogRow): BlogPost {
  const primary = r.hero_image_url || '';
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt || r.title || '',
    content: r.content,
    image: primary,
    images: primary ? [primary] : [],
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    authorId: r.author_id || '',
    authorName: r.author_name || 'Luxedge Editorial Team',
    status: rowStatusToBlog(r.status),
    date: r.date_label || (r.published_at || r.created_at || '').slice(0, 10),
    faq: Array.isArray(r.faq) && r.faq.length ? r.faq : undefined,
  };
}

/**
 * READ published posts for the storefront.
 *
 * SECURITY: this is a PUBLIC read and must always run as the anon role. The
 * shared Supabase adapter's access token is sticky — any admin operation
 * (blog save, catalog edit, product scout) leaves the signed-in admin JWT on
 * it, and with that token RLS returns drafts/scheduled/archived posts too.
 * We therefore clear the token for this read AND pass an explicit
 * status=published filter, so a draft can never leak to visitors even if a
 * future RLS or role change regresses.
 */
export async function loadPublishedBlogs(): Promise<BlogPost[] | null> {
  const db = getDb();
  try {
    if ('setAccessToken' in db && typeof (db as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
      (db as { setAccessToken: (t: string | null) => void }).setAccessToken(null);
    }
    const rows = await db.list<CmsBlogRow>('blog_posts', { orderBy: 'published_at.desc', filters: { status: 'published' } });
    if (!Array.isArray(rows)) return null;
    return rows.map(mapRowToBlogPost);
  } catch {
    // Unreachable / table not migrated yet -> null (caller keeps its fallback).
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin (authenticated JWT — RLS sees the admin role)
// ---------------------------------------------------------------------------

async function withAdmin<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> {
  const db = getDb();
  const token = await getFreshAccessToken();
  if ('setAccessToken' in db && typeof (db as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
    (db as { setAccessToken: (t: string | null) => void }).setAccessToken(token);
  }
  try {
    return await fn(db);
  } finally {
    // Never leave the admin JWT on the shared adapter: after the op completes
    // the next storefront read must run as anon again (RLS published-only),
    // not as the admin who could see drafts/scheduled/archived posts.
    if ('setAccessToken' in db && typeof (db as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
      (db as { setAccessToken: (t: string | null) => void }).setAccessToken(null);
    }
  }
}

function maxRevision(revs: CmsBlogRevision[]): number {
  return revs.reduce((m, r) => Math.max(m, Number(r.revision) || 0), 0);
}

export interface CmsBlogRevision {
  id: string;
  blog_id: string;
  revision: number;
  previous: unknown | null;
  next: unknown | null;
  action: string;
  actor: string;
  actor_email?: string | null;
  created_at: string;
}

function revisionRow(
  blog_id: string,
  revision: number,
  action: string,
  previous: unknown,
  next: unknown,
  actor: 'admin' | 'automation',
  actor_email?: string | null,
): Record<string, unknown> {
  return { blog_id, revision, action, previous, next, actor, actor_email: actor_email || null };
}

/** All posts for the manager (admins see drafts/scheduled/archived too). */
export async function adminListAll(): Promise<CmsBlogRow[]> {
  return withAdmin(async (db) => {
    const rows = await db.list<CmsBlogRow>('blog_posts', { orderBy: 'updated_at.desc' });
    return Array.isArray(rows) ? rows : [];
  });
}

export async function adminGet(id: string): Promise<CmsBlogRow | null> {
  return withAdmin((db) => db.get<CmsBlogRow>('blog_posts', id));
}

export async function adminGetBySlug(slug: string): Promise<CmsBlogRow | null> {
  return withAdmin((db) => db.findFirst<CmsBlogRow>('blog_posts', 'slug', slug));
}

/** True when a post (other than `excludeId`) already uses `slug`. */
export async function adminCheckSlug(slug: string, excludeId?: string): Promise<boolean> {
  const hit = await adminGetBySlug(slug);
  return !!hit && hit.id !== excludeId;
}

/** Create a NEW draft post. Returns the created row. */
export async function adminCreate(input: {
  slug: string;
  title: string;
  content: string;
  excerpt?: string;
  heroImageUrl?: string;
  heroImageAlt?: string;
  tags?: string[];
  authorName?: string;
  seoTitle?: string;
  metaDescription?: string;
  targetKeyword?: string;
  secondaryKeywords?: string[];
  searchIntent?: string;
  faq?: { q: string; a: string }[];
  internalLinks?: unknown[];
  scheduleAt?: string | null;
}): Promise<CmsBlogRow> {
  const { slug } = input;
  if (await adminCheckSlug(slug)) throw new Error(`Slug "${slug}" is already in use.`);
  const created = await withAdmin(async (db) => {
    const row: CmsBlogRow & { id: string } = {
      id: crypto.randomUUID(),
      slug,
      title: input.title,
      excerpt: input.excerpt || null,
      content: input.content,
      hero_image_url: input.heroImageUrl || null,
      hero_image_alt: input.heroImageAlt || null,
      tags: input.tags || [],
      author_name: input.authorName || 'Luxedge Editorial Team',
      author_id: null,
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      scheduled_at: null,
      published_at: null,
      seo_title: input.seoTitle || null,
      meta_description: input.metaDescription || null,
      target_keyword: input.targetKeyword || null,
      secondary_keywords: input.secondaryKeywords || [],
      search_intent: input.searchIntent || null,
      faq: input.faq || [],
      internal_links: input.internalLinks || [],
      generated_by: 'manual',
      automation_locked: false,
    };
    await db.insert<CmsBlogRow & { id: string }>('blog_posts', row);
    await db.insertRaw('blog_revisions', revisionRow(row.id, 1, 'create', null, { ...row }, 'admin'));
    return row;
  });
  return created;
}

/** Save an existing post (edit/draft). Returns the updated row. */
export async function adminUpdate(
  id: string,
  patch: Partial<Omit<CmsBlogRow, 'id'>>,
): Promise<CmsBlogRow> {
  if (patch.slug) {
    const taken = await adminCheckSlug(patch.slug, id);
    if (taken) throw new Error(`Slug "${patch.slug}" is already in use.`);
  }
  return withAdmin(async (db) => {
    const before = await db.get<CmsBlogRow>('blog_posts', id);
    if (!before) throw new Error('Post not found.');
    const updated = await db.update<CmsBlogRow>('blog_posts', id, patch);
    if (!updated) throw new Error('Save failed.');
    const revs = await db.list<CmsBlogRevision>('blog_revisions');
    const revision = maxRevision(revs.filter((r) => r.blog_id === id)) + 1;
    await db.insertRaw(
      'blog_revisions',
      revisionRow(id, revision, 'edit', { ...before }, { ...updated }, 'admin'),
    );
    return updated;
  });
}

/** Lifecycle transitions — publish/schedule/unpublish/archive/restore. */
export async function adminSetLifecycle(
  id: string,
  action: 'publish' | 'schedule' | 'unpublish' | 'archive' | 'restore',
  patch: Partial<Omit<CmsBlogRow, 'id'>> = {},
): Promise<CmsBlogRow> {
  return withAdmin(async (db) => {
    const before = await db.get<CmsBlogRow>('blog_posts', id);
    if (!before) throw new Error('Post not found.');
    // Restore always returns to draft so Salman decides the next state.
    let delta: Partial<Omit<CmsBlogRow, 'id'>>;
    const now = new Date().toISOString();
    const scheduledAt = patch.scheduled_at || null;
    switch (action) {
      case 'publish':
        delta = { status: 'published', published_at: now, scheduled_at: null };
        break;
      case 'schedule':
        delta = { status: 'scheduled', scheduled_at: scheduledAt || null, published_at: null };
        break;
      case 'unpublish':
        delta = { status: 'draft', published_at: null, scheduled_at: null };
        break;
      case 'archive':
        delta = { status: 'archived', published_at: null, scheduled_at: null };
        break;
      case 'restore':
        delta = { status: 'draft', published_at: null, scheduled_at: null };
        break;
      default:
        throw new Error('Unknown lifecycle action.');
    }
    const updated = await db.update<CmsBlogRow>('blog_posts', id, { ...delta, ...patch });
    if (!updated) throw new Error('Action failed.');
    const revs = await db.list<CmsBlogRevision>('blog_revisions');
    const revision = maxRevision(revs.filter((r) => r.blog_id === id)) + 1;
    await db.insertRaw(
      'blog_revisions',
      revisionRow(id, revision, action, { ...before, status: before.status }, { ...updated }, 'admin'),
    );
    return updated;
  });
}

/** Restore a post to an earlier revision's content (full recovery). */
export async function adminRestoreRevision(blogId: string, revision: number): Promise<CmsBlogRow> {
  return withAdmin(async (db) => {
    const revs = await db.list<CmsBlogRevision>('blog_revisions');
    const rev = revs.find((r) => r.blog_id === blogId && Number(r.revision) === Number(revision) && r.next);
    if (!rev || !rev.next) throw new Error('Revision not found.');
    const snapshot = rev.next as Omit<CmsBlogRow, 'id' | 'created_at'>;
    const { id: _id, created_at: _c, ...restorable } = snapshot as CmsBlogRow & Record<string, unknown>;
    void _id; void _c;
    const restored = await db.update<CmsBlogRow>('blog_posts', blogId, restorable as Partial<Omit<CmsBlogRow, 'id'>>);
    if (!restored) throw new Error('Restore failed.');
    const all = await db.list<CmsBlogRevision>('blog_revisions');
    const nextRev = maxRevision(all.filter((r) => r.blog_id === blogId)) + 1;
    await db.insertRaw(
      'blog_revisions',
      revisionRow(blogId, nextRev, 'restore', rev.next, { ...restored }, 'admin'),
    );
    return restored;
  });
}

export async function adminListRevisions(blogId: string): Promise<CmsBlogRevision[]> {
  return withAdmin(async (db) => {
    const revs = await db.list<CmsBlogRevision>('blog_revisions');
    return (Array.isArray(revs) ? revs : [])
      .filter((r) => r.blog_id === blogId)
      .sort((a, b) => (Number(b.revision) || 0) - (Number(a.revision) || 0));
  });
}

/** Soft delete = archive. Permanent delete only behind explicit confirmation. */
export async function adminDelete(blogId: string, permanent = false): Promise<void> {
  return withAdmin(async (db) => {
    if (!permanent) {
      const before = await db.get<CmsBlogRow>('blog_posts', blogId);
      if (!before) throw new Error('Post not found.');
      const updated = await db.update<CmsBlogRow>('blog_posts', blogId, { status: 'archived' });
      const revs = await db.list<CmsBlogRevision>('blog_revisions');
      const revision = maxRevision(revs.filter((r) => r.blog_id === blogId)) + 1;
      await db.insertRaw('blog_revisions', revisionRow(blogId, revision, 'archive', { ...before }, { ...(updated || before) }, 'admin'));
      return;
    }
    await db.remove('blog_posts', blogId);
    // Revisions cascade via FK on delete.
  });
}