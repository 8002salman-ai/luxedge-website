// ============================================================================
// LUXEDGE — POST /api/media/sync  (automatic YouTube import)
//
// Pulls the official channel's uploads from the YouTube Data API and upserts
// them into the `media_videos` table (migration 0026) so new videos appear on
// /media WITHOUT a redeploy. The Admin Media manager is the manual fallback
// when sync fails or a video should be edited before publishing.
//
// Required env (never in frontend code — server-side only):
//   YOUTUBE_API_KEY    — Google Cloud API key with the YouTube Data API v3 enabled
//   YOUTUBE_CHANNEL_ID — the official channel's id (e.g. UC...)
//   YOUTUBE_CHANNEL_URL — the official channel URL (used by the UI once provided)
//
// Behavior:
//   * No key/channel configured → 501 with an honest "configure me" error.
//   * Fetch order (per spec): official YouTube Data API only. No scraping,
//     and YouTube responses are cached in-process (10 min). Runs on manual
//     Sync clicks AND a Cloudflare cron trigger (wrangler.toml [triggers],
//     handled by the `scheduled` export in worker/index.ts) so new uploads
//     appear on /media automatically. The upsert is idempotent and the run
//     costs ~3 YouTube Data API quota units, so the hourly poll is cheap.
//   * Upsert keyed on youtube_video_id. Editorial fields (summary, description,
//     chapters, faq, featured, related_*, custom thumbnail) are NEVER
//     overwritten by sync — it only refreshes title/thumbnail/published_at/
//     duration/tags, and preserves an existing editorial slug.
//   * is_short derives from the real duration (<= 60s = YouTube's definition).
//   * Imported rows are published immediately (they are already public on the
//     channel) with published_at = the video's real upload date.
//   * Slug collisions get a -2, -3… suffix (mirrors product slug dedupe).
//   * Capped at the 50 most recent uploads per run.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { supabaseAdmin, supabaseHeaders, upsertAppSetting } from '../_lib/supabase.js';

const SYNC_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 50;
const MAX_TITLE = 200;

interface YouTubeItem {
  id?: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    description?: string;
    thumbnails?: Record<string, { url?: string }>;
    resourceId?: { videoId?: string };
    tags?: string[];
    channelId?: string;
  };
  contentDetails?: { duration?: string };
}

const youtubeCache = new Map<string, { ts: number; data: unknown }>();

async function youtubeGet<T>(path: string): Promise<T | null> {
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  const hit = youtubeCache.get(path);
  if (hit && Date.now() - hit.ts < SYNC_CACHE_TTL_MS) return hit.data as T;
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(data?.error?.message || `YouTube API error (HTTP ${res.status})`);
    youtubeCache.set(path, { ts: Date.now(), data });
    return data;
  } catch (e) {
    youtubeCache.delete(path);
    return null;
  }
}

function slugifyMediaTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

interface MediaRow {
  id: string;
  slug: string;
  youtube_video_id: string | null;
  title: string;
  summary: string | null;
  description: string | null;
  thumbnail_url: string | null;
  custom_thumbnail_url: string | null;
  category: string | null;
  is_short: boolean | null;
  featured: boolean | null;
  published_at: string | null;
  duration: string | null;
  status: 'draft' | 'published' | 'archived';
}

async function rest<T>(cfg: { url: string; serviceRole: string }, path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...init,
      headers: { ...supabaseHeaders(cfg.serviceRole, init?.method === 'POST' || init?.method === 'PATCH'), ...(init?.headers || {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : (null as T | null);
  } catch {
    return null;
  }
}

export interface MediaSyncResult {
  ok: boolean;
  status?: number;
  error?: string;
  missing?: { YOUTUBE_API_KEY: boolean; YOUTUBE_CHANNEL_ID: boolean };
  synced?: number;
  created?: number;
  updated?: number;
  videos?: { slug: string; url: string; title: string }[];
  note?: string;
}

/** Where a sync run came from — shown in the Admin Media Hub "Last synced" stamp. */
export type SyncSource = 'manual' | 'cron';

/**
 * app_settings key holding the last COMPLETED sync run (only ok:true runs
 * record it), read by GET /api/media/status for the Admin Media Hub header.
 * Value: JSON { at, source, synced, created, updated }.
 */
export const MEDIA_LAST_SYNC_KEY = 'MEDIA_LAST_SYNC';

async function recordLastSync(
  source: SyncSource,
  r: Pick<MediaSyncResult, 'synced' | 'created' | 'updated'>,
): Promise<void> {
  await upsertAppSetting(
    MEDIA_LAST_SYNC_KEY,
    JSON.stringify({
      at: new Date().toISOString(),
      source,
      synced: r.synced ?? 0,
      created: r.created ?? 0,
      updated: r.updated ?? 0,
    }),
  );
}

/**
 * Shared sync core — runs the YouTube → media_videos import with no HTTP or
 * auth layer, so BOTH the admin endpoint (POST /api/media/sync) and the
 * Cloudflare scheduled cron (worker/index.ts) execute the same code. Every
 * failure path returns an honest structured result instead of throwing.
 */
export async function runMediaSync(source: SyncSource = 'manual'): Promise<MediaSyncResult> {
  const cfg = supabaseAdmin();
  if (!cfg) return { ok: false, status: 500, error: 'Supabase is not configured on the server.' };

  const apiKey = (process.env.YOUTUBE_API_KEY || '').trim();
  const channelId = (process.env.YOUTUBE_CHANNEL_ID || '').trim();

  if (!apiKey || !channelId) {
    return {
      ok: false,
      status: 501,
      error:
        'YouTube sync is not configured yet. Add YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID as worker secrets/environment variables (see .env.example), then retry. Until then, add videos manually from the Media manager.',
      missing: { YOUTUBE_API_KEY: !apiKey, YOUTUBE_CHANNEL_ID: !channelId },
    };
  }

  // 1. Resolve the uploads playlist id for the channel.
  const channel = await youtubeGet<{ items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>(
    `channels?part=contentDetails&id=${encodeURIComponent(channelId)}&maxResults=1`,
  );
  const uploads = channel?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!uploads) {
    return { ok: false, status: 502, error: 'Could not resolve the channel uploads playlist — check YOUTUBE_CHANNEL_ID.' };
  }

  // 2. List recent uploads (cached 10 min).
  const list = await youtubeGet<{ items?: YouTubeItem[] }>(
    `playlistItems?part=snippet&playlistId=${encodeURIComponent(uploads)}&maxResults=${MAX_RESULTS}`,
  );
  const items = (list?.items || []).filter((i) => i?.snippet?.resourceId?.videoId);
  if (items.length === 0) {
    await recordLastSync(source, { synced: 0, created: 0, updated: 0 });
    return { ok: true, synced: 0, created: 0, updated: 0, videos: [], note: 'No uploads found on this channel yet.' };
  }

  // 3. Enrich with durations (videos.list supports up to 50 ids per call).
  const ids = items.map((i) => i.snippet!.resourceId!.videoId!);
  const details = await youtubeGet<{ items?: YouTubeItem[] }>(
    `videos?part=snippet,contentDetails&id=${encodeURIComponent(ids.join(','))}&maxResults=${MAX_RESULTS}`,
  );
  const byId = new Map((details?.items || []).map((v) => [v.id, v]));

  // 4. Fetch existing rows keyed on youtube_video_id (one round trip).
  const existing = await rest<MediaRow[]>(
    cfg,
    `media_videos?select=id,slug,youtube_video_id,title,summary,description,thumbnail_url,custom_thumbnail_url,category,is_short,featured,published_at,duration,status&youtube_video_id=in.(${ids.map((i) => `"${i}"`).join(',')})`,
  );
  const existingByYt = new Map((existing || []).filter((r) => r.youtube_video_id).map((r) => [r.youtube_video_id!, r]));
  const existingSlugs = new Set((existing || []).map((r) => r.slug));

  let created = 0;
  let updated = 0;
  const videos: { slug: string; url: string; title: string }[] = [];

  for (const item of items) {
    const ytId = item.snippet!.resourceId!.videoId!;
    const det = byId.get(ytId);
    const title = (item.snippet?.title || '').trim().slice(0, MAX_TITLE);
    if (!title) continue;
    const publishedAt = item.snippet?.publishedAt || null;
    const duration = det?.contentDetails?.duration || null;
    const tags = Array.isArray(det?.snippet?.tags) ? det!.snippet!.tags.slice(0, 30) : [];
    const thumbs = item.snippet?.thumbnails || {};
    const thumbnailUrl =
      thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null;
    // YouTube's own Shorts definition: total duration <= 60 seconds.
    const durM = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration || '');
    const isShort = !!durM && !durM[1] && (Number(durM[2] || 0) * 60 + Number(durM[3] || 0)) <= 60;

    const existingRow = existingByYt.get(ytId);
    if (existingRow) {
      // Refresh only channel facts — editorial fields stay untouched.
      const patch: Partial<MediaRow> = {};
      if (title && title !== existingRow.title) patch.title = title;
      if (thumbnailUrl && thumbnailUrl !== existingRow.thumbnail_url) patch.thumbnail_url = thumbnailUrl;
      if (publishedAt && publishedAt !== existingRow.published_at) patch.published_at = publishedAt;
      if (duration && duration !== existingRow.duration) patch.duration = duration;
      if (Object.keys(patch).length > 0) {
        await rest(cfg, `media_videos?id=eq.${existingRow.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...patch, source_notes: { channel_id: channelId, synced_at: new Date().toISOString() } }),
        });
        updated += 1;
      }
      videos.push({ slug: existingRow.slug, url: `/media/${existingRow.slug}`, title });
      continue;
    }

    // New video — unique slug with -2, -3… dedupe.
    let slug = slugifyMediaTitle(title);
    if (existingSlugs.has(slug)) {
      let n = 2;
      while (existingSlugs.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
    existingSlugs.add(slug);

    const row = {
      slug,
      youtube_video_id: ytId,
      title,
      summary: null,
      description: null,
      thumbnail_url: thumbnailUrl,
      custom_thumbnail_url: null,
      category: 'product-education',
      is_short: isShort,
      featured: false,
      published_at: publishedAt || new Date().toISOString(),
      duration,
      transcript: null,
      chapters: [],
      tags,
      related_product_ids: [],
      related_article_slugs: [],
      related_video_slugs: [],
      faq: [],
      status: 'published',
      source_notes: { channel_id: channelId, synced_at: new Date().toISOString() },
    };
    const inserted = await rest<MediaRow[]>(cfg, 'media_videos', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (inserted && inserted[0]) {
      created += 1;
      videos.push({ slug, url: `/media/${slug}`, title });
    }
  }

  await recordLastSync(source, { synced: videos.length, created, updated });
  return {
    ok: true,
    synced: videos.length,
    created,
    updated,
    videos,
    note: 'Imported videos are published immediately. Edit titles, summaries, chapters and related content from Admin → Media.',
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed — POST only' });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return; // 401/403 already sent

  const out = await runMediaSync();
  sendJson(res, out.status || (out.ok ? 200 : 500), out);
}