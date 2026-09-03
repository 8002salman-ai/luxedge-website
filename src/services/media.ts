// ============================================================================
// LUXEDGE — MEDIA HUB SERVICE (client)
//
// The single source of truth for the /media hub and /media/:slug video pages
// is the Supabase `media_videos` table (migration 0026), NOT any static array.
// This module:
//   * loadPublishedMedia()      — READ published videos for the storefront.
//     Uses the public anon key; RLS returns only published rows. Returns NULL
//     on genuine failure and [] on a reachable-but-empty DB.
//   * admin*() methods          — authenticated READ/WRITE for the Admin Media
//     manager (create/edit/publish/archive/delete), always authorizing with
//     the SIGNED-IN admin's JWT so RLS governs every write.
//
// SECURITY: anon key + the caller's own JWT only. YouTube sync writes happen
// server-side via /api/media/sync (service role) — never in the browser.
// ============================================================================

import { getDb } from './db';
import type { DbAdapter } from './db';
import { getFreshAccessToken } from './supabase';

/** Storefront-facing shape (nothing invented — maps DB columns 1:1). */
export interface MediaVideo {
  id: string;
  slug: string;
  youtubeVideoId: string | null;
  title: string;
  summary: string;
  description: string;
  seoTitle: string | null;
  metaDescription: string | null;
  thumbnailUrl: string | null;
  customThumbnailUrl: string | null;
  category: string;
  isShort: boolean;
  featured: boolean;
  publishedAt: string | null;
  duration: string | null; // ISO-8601 (PT1H2M3S) when YouTube provided it
  transcript: string | null;
  chapters: { t: string; title: string }[];
  tags: string[];
  relatedProductIds: string[];
  relatedArticleSlugs: string[];
  relatedVideoSlugs: string[];
  faq: { q: string; a: string }[] | null;
}

/** Raw Supabase `media_videos` row (snake_case DB columns). */
export interface CmsMediaRow {
  id: string;
  slug: string;
  youtube_video_id: string | null;
  title: string;
  summary: string | null;
  description: string | null;
  seo_title: string | null;
  meta_description: string | null;
  thumbnail_url: string | null;
  custom_thumbnail_url: string | null;
  category: string | null;
  is_short: boolean | null;
  featured: boolean | null;
  published_at: string | null;
  duration: string | null;
  transcript: string | null;
  chapters: unknown[] | null;
  tags: string[] | null;
  related_product_ids: string[] | null;
  related_article_slugs: string[] | null;
  related_video_slugs: string[] | null;
  faq: unknown[] | null;
  status: 'draft' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
}

// Column-scoped public reads — every column MUST exist on media_videos (the
// schema contract is enforced by select-schema.test.ts against
// supabase/migrations/*.sql; a missing column 400s the whole query).
export const MEDIA_LIST_PUBLIC_SELECT =
  'id,slug,youtube_video_id,title,summary,description,seo_title,meta_description,thumbnail_url,custom_thumbnail_url,category,is_short,featured,published_at,duration,transcript,chapters,tags,related_product_ids,related_article_slugs,related_video_slugs,faq,status,created_at,updated_at';
export const MEDIA_DETAIL_PUBLIC_SELECT = MEDIA_LIST_PUBLIC_SELECT;

const PUBLIC_MEDIA_CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in src/services/__tests__/media.test.ts)
// ---------------------------------------------------------------------------

/** URL-safe slug from a video title. */
export function slugifyMediaTitle(title: string, existing?: string): string {
  const base = (existing || title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return base || 'video';
}

/** Extract a YouTube video id from a watch/shorts/embed URL, or raw id. */
export function youtubeIdFromUrl(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, '');
    if (!/(youtube\.com|youtu\.be)$/.test(host)) return null;
    if (host === 'youtu.be') return u.pathname.split('/')[1] || null;
    if (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/v/')) {
      const id = u.pathname.split('/')[2];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = u.searchParams.get('v');
    return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** ISO-8601 duration (PT1H2M3S) → human "12:34" / "1:02:34". */
export function formatDuration(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso.trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  if (h === 0 && min === 0 && s === 0) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

/** Map a DB row onto the storefront MediaVideo shape (nothing invented). */
export function mapRowToMediaVideo(r: CmsMediaRow): MediaVideo {
  return {
    id: r.id,
    slug: r.slug,
    youtubeVideoId: r.youtube_video_id || null,
    title: r.title,
    summary: r.summary || '',
    description: r.description || '',
    seoTitle: r.seo_title || null,
    metaDescription: r.meta_description || null,
    thumbnailUrl: r.thumbnail_url || null,
    customThumbnailUrl: r.custom_thumbnail_url || null,
    category: r.category || 'product-education',
    isShort: r.is_short === true,
    featured: r.featured === true,
    publishedAt: r.published_at || null,
    duration: r.duration || null,
    transcript: r.transcript || null,
    chapters: Array.isArray(r.chapters)
      ? r.chapters.filter(
          (c): c is { t: string; title: string } =>
            !!c && typeof (c as { t?: unknown }).t === 'string' && typeof (c as { title?: unknown }).title === 'string',
        )
      : [],
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    relatedProductIds: Array.isArray(r.related_product_ids)
      ? r.related_product_ids.filter((t): t is string => typeof t === 'string')
      : [],
    relatedArticleSlugs: Array.isArray(r.related_article_slugs)
      ? r.related_article_slugs.filter((t): t is string => typeof t === 'string')
      : [],
    relatedVideoSlugs: Array.isArray(r.related_video_slugs)
      ? r.related_video_slugs.filter((t): t is string => typeof t === 'string')
      : [],
    faq: Array.isArray(r.faq) && r.faq.length ? (r.faq as { q: string; a: string }[]) : null,
  };
}

/** Display thumbnail: custom editorial override wins, else YouTube's real one. */
export function mediaThumbnail(v: Pick<MediaVideo, 'customThumbnailUrl' | 'thumbnailUrl' | 'youtubeVideoId'>): string | null {
  if (v.customThumbnailUrl) return v.customThumbnailUrl;
  if (v.thumbnailUrl) return v.thumbnailUrl;
  if (v.youtubeVideoId) return `https://i.ytimg.com/vi/${v.youtubeVideoId}/hqdefault.jpg`;
  return null;
}

// ---------------------------------------------------------------------------
// Public reads (anon role — RLS returns published only)
// ---------------------------------------------------------------------------

function readMediaCache(): MediaVideo[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem('luxedge:published-media:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; data?: MediaVideo[] };
    if (!parsed.ts || Date.now() - parsed.ts > PUBLIC_MEDIA_CACHE_TTL_MS) return null;
    return Array.isArray(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeMediaCache(videos: MediaVideo[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem('luxedge:published-media:v1', JSON.stringify({ ts: Date.now(), data: videos }));
  } catch {
    /* storage unavailable - live request already succeeded */
  }
}

/** Clear the anon token off the shared adapter (see loadPublishedBlogs note). */
async function asAnon<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> {
  const db = getDb();
  try {
    if ('setAccessToken' in db && typeof (db as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
      (db as { setAccessToken: (t: string | null) => void }).setAccessToken(null);
    }
    return await fn(db);
  } finally {
    if ('setAccessToken' in db && typeof (db as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
      (db as { setAccessToken: (t: string | null) => void }).setAccessToken(null);
    }
  }
}

/** READ published videos for the storefront (cached 5 min in sessionStorage). */
export async function loadPublishedMedia(opts: { forceFresh?: boolean } = {}): Promise<MediaVideo[] | null> {
  if (!opts.forceFresh) {
    const cached = readMediaCache();
    if (cached) return cached;
  }
  try {
    const rows = await asAnon((db) =>
      db.list<CmsMediaRow>('media_videos', {
        select: MEDIA_LIST_PUBLIC_SELECT,
        orderBy: 'published_at.desc',
        filters: { status: 'published' },
      }),
    );
    if (!Array.isArray(rows)) return null;
    const videos = rows.map(mapRowToMediaVideo);
    writeMediaCache(videos);
    return videos;
  } catch {
    return null;
  }
}

export async function loadPublishedMediaBySlug(slug: string): Promise<MediaVideo | null> {
  try {
    const rows = await asAnon((db) =>
      db.list<CmsMediaRow>('media_videos', {
        select: MEDIA_DETAIL_PUBLIC_SELECT,
        limit: 1,
        filters: { status: 'published', slug },
      }),
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    return mapRowToMediaVideo(rows[0]);
  } catch {
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
    if ('setAccessToken' in db && typeof (db as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
      (db as { setAccessToken: (t: string | null) => void }).setAccessToken(null);
    }
  }
}

/** All videos for the manager (admins see drafts/archived too). */
export async function adminMediaListAll(): Promise<CmsMediaRow[]> {
  return withAdmin(async (db) => {
    const rows = await db.list<CmsMediaRow>('media_videos', { orderBy: 'updated_at.desc' });
    return Array.isArray(rows) ? rows : [];
  });
}

export async function adminMediaGetBySlug(slug: string): Promise<CmsMediaRow | null> {
  return withAdmin((db) => db.findFirst<CmsMediaRow>('media_videos', 'slug', slug));
}

export interface MediaInput {
  slug?: string;
  youtubeVideoId?: string | null;
  title: string;
  summary?: string;
  description?: string;
  seoTitle?: string;
  metaDescription?: string;
  thumbnailUrl?: string;
  customThumbnailUrl?: string;
  category?: string;
  isShort?: boolean;
  featured?: boolean;
  publishedAt?: string | null;
  duration?: string;
  transcript?: string;
  chapters?: { t: string; title: string }[];
  tags?: string[];
  relatedProductIds?: string[];
  relatedArticleSlugs?: string[];
  relatedVideoSlugs?: string[];
  faq?: { q: string; a: string }[];
  status?: 'draft' | 'published' | 'archived';
}

/** Create a new media row. Returns the created row. */
export async function adminMediaCreate(input: MediaInput): Promise<CmsMediaRow> {
  return withAdmin(async (db) => {
    const row: CmsMediaRow & { id: string } = {
      id: crypto.randomUUID(),
      slug: input.slug || slugifyMediaTitle(input.title),
      youtube_video_id: input.youtubeVideoId || null,
      title: input.title,
      summary: input.summary || null,
      description: input.description || null,
      seo_title: input.seoTitle || null,
      meta_description: input.metaDescription || null,
      thumbnail_url: input.thumbnailUrl || null,
      custom_thumbnail_url: input.customThumbnailUrl || null,
      category: input.category || 'product-education',
      is_short: !!input.isShort,
      featured: !!input.featured,
      published_at: input.publishedAt || (input.status === 'published' ? new Date().toISOString() : null),
      duration: input.duration || null,
      transcript: input.transcript || null,
      chapters: input.chapters || [],
      tags: input.tags || [],
      related_product_ids: input.relatedProductIds || [],
      related_article_slugs: input.relatedArticleSlugs || [],
      related_video_slugs: input.relatedVideoSlugs || [],
      faq: input.faq || [],
      status: input.status || 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await db.insert<CmsMediaRow & { id: string }>('media_videos', row);
    return row;
  });
}

/** Update an existing media row by id. */
export async function adminMediaUpdate(id: string, input: MediaInput): Promise<CmsMediaRow> {
  return withAdmin(async (db) => {
    const before = await db.get<CmsMediaRow>('media_videos', id);
    if (!before) throw new Error('Media not found.');
    const row: Partial<CmsMediaRow> = {
      slug: input.slug || slugifyMediaTitle(input.title),
      title: input.title,
      summary: input.summary || null,
      description: input.description || null,
      seo_title: input.seoTitle || null,
      meta_description: input.metaDescription || null,
      thumbnail_url: input.thumbnailUrl || null,
      custom_thumbnail_url: input.customThumbnailUrl || null,
      category: input.category || 'product-education',
      is_short: !!input.isShort,
      featured: !!input.featured,
      duration: input.duration || null,
      transcript: input.transcript || null,
      chapters: input.chapters || [],
      tags: input.tags || [],
      related_product_ids: input.relatedProductIds || [],
      related_article_slugs: input.relatedArticleSlugs || [],
      related_video_slugs: input.relatedVideoSlugs || [],
      faq: input.faq || [],
      status: input.status || 'draft',
    };
    if (input.youtubeVideoId) row.youtube_video_id = input.youtubeVideoId;
    else row.youtube_video_id = null;
    if (input.publishedAt !== undefined) row.published_at = input.publishedAt;
    if (input.status === 'published' && !input.publishedAt) row.published_at = new Date().toISOString();
    const updated = await db.update<CmsMediaRow>('media_videos', id, row);
    if (!updated) throw new Error('Save failed.');
    return updated;
  });
}

/** Hard-delete (manager only; archived rows keep history when preferred). */
export async function adminMediaDelete(id: string): Promise<void> {
  return withAdmin((db) => db.remove('media_videos', id));
}