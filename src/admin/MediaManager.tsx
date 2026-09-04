// ============================================================================
// LUXEDGE — ADMIN MEDIA MANAGER (Media Hub)
//
// Database-backed media CMS manager for the /media hub. Creating/editing/
// publishing a video here writes to Supabase `media_videos` — NO repo change,
// commit, build or deployment is ever needed for content operations.
// Publishing updates the storefront, the worker SEO path, /sitemap.xml and
// /video-sitemap.xml automatically.
//
// Two ways in:
//   1. Sync from YouTube — pulls the official channel's latest uploads via
//      POST /api/media/sync (requires YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID on
//      the server). Honest 501 when not configured.
//   2. Manual fallback — add a video by YouTube URL/id (or without one) and
//      fill the editorial fields. Used when sync fails or a video needs
//      editing before publishing.
//
// Every write authorizes with the signed-in admin's JWT; RLS governs access.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, FloppyDisk, Trash, PencilLine, YoutubeLogo, ArrowCounterClockwise,
  MagnifyingGlass, Play, CheckCircle,
} from '@phosphor-icons/react';
import { useApp } from '../App';
import { getAccessToken } from '../services/supabase';
import {
  adminMediaListAll, adminMediaCreate, adminMediaUpdate, adminMediaDelete,
  slugifyMediaTitle, youtubeIdFromUrl, mediaThumbnail,
  type CmsMediaRow,
} from '../services/media';
import { MEDIA_CATEGORIES } from '../media/MediaHub';

const STATUS_META: Record<CmsMediaRow['status'], { label: string; cls: string }> = {
  published: { label: 'Published', cls: 'bg-green-100 text-green-700' },
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-600' },
  archived: { label: 'Archived', cls: 'bg-red-100 text-red-600' },
};

const label = 'block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1';
const input =
  'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-luxe-gold/40 bg-white';

interface LastSyncInfo {
  at: string;
  source: 'manual' | 'cron';
  synced: number;
  created: number;
  updated: number;
}

/** Compact relative time for the "Last synced" stamp (e.g. "5 min ago"). */
const timeAgo = (iso: string): string => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
};

const emptyRow = (): CmsMediaRow => ({
  id: '', slug: '', youtube_video_id: null, title: '', summary: null, description: null,
  seo_title: null, meta_description: null, thumbnail_url: null, custom_thumbnail_url: null,
  category: 'product-education', is_short: false, featured: false, published_at: null,
  duration: null, transcript: null, chapters: [], tags: [], related_product_ids: [],
  related_article_slugs: [], related_video_slugs: [], faq: [], status: 'draft',
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
});

export default function MediaManager() {
  const { notify } = useApp();
  const [rows, setRows] = useState<CmsMediaRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CmsMediaRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CmsMediaRow>(emptyRow());
  const [chaptersText, setChaptersText] = useState('');
  const [faqText, setFaqText] = useState('[]');
  const [tagsText, setTagsText] = useState('');
  const [relatedProductsText, setRelatedProductsText] = useState('');
  const [relatedArticlesText, setRelatedArticlesText] = useState('');
  const [relatedVideosText, setRelatedVideosText] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [confirm, setConfirm] = useState<CmsMediaRow | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [lastSync, setLastSync] = useState<LastSyncInfo | null>(null);

  const loadStatus = async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/media/status', { headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; lastSync?: LastSyncInfo | null };
      setLastSync(res.ok && data.ok ? (data.lastSync ?? null) : null);
    } catch {
      setLastSync(null);
    }
  };

  const load = async () => {
    try {
      setRows(await adminMediaListAll());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || 'Could not load media.');
    }
    void loadStatus();
  };

  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    const c = { published: 0, draft: 0, archived: 0 };
    for (const r of rows || []) c[r.status] += 1;
    return c;
  }, [rows]);

  const startCreate = () => {
    setForm(emptyRow());
    setChaptersText(''); setFaqText('[]'); setTagsText('');
    setRelatedProductsText(''); setRelatedArticlesText(''); setRelatedVideosText('');
    setCreating(true); setEditing(null);
  };

  const startEdit = (r: CmsMediaRow) => {
    setForm({ ...r });
    setChaptersText(Array.isArray(r.chapters) ? r.chapters.map((c) => `${(c as { t?: string }).t || ''}|${(c as { title?: string }).title || ''}`).join('\n') : '');
    setFaqText(Array.isArray(r.faq) && r.faq.length ? JSON.stringify(r.faq, null, 1) : '[]');
    setTagsText(Array.isArray(r.tags) ? r.tags.join(', ') : '');
    setRelatedProductsText(Array.isArray(r.related_product_ids) ? r.related_product_ids.join(', ') : '');
    setRelatedArticlesText(Array.isArray(r.related_article_slugs) ? r.related_article_slugs.join(', ') : '');
    setRelatedVideosText(Array.isArray(r.related_video_slugs) ? r.related_video_slugs.join(', ') : '');
    setCreating(false); setEditing(r);
  };

  const parseChapters = (text: string): { t: string; title: string }[] =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const i = line.indexOf('|');
        return i > 0
          ? { t: line.slice(0, i).trim(), title: line.slice(i + 1).trim() }
          : { t: '', title: line };
      })
      .filter((c) => c.title);

  const parseFaq = (text: string): { q: string; a: string }[] => {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed)
        ? parsed.filter((f) => f && typeof f.q === 'string' && typeof f.a === 'string')
        : [];
    } catch {
      return [];
    }
  };

  const save = async () => {
    if (!form.title.trim()) { notify('Title is required.', 'error'); return; }
    const slug = form.slug || slugifyMediaTitle(form.title);
    if (!slug) { notify('A valid slug is required.', 'error'); return; }
    setBusy(true);
    const input = {
      slug,
      youtubeVideoId: form.youtube_video_id || null,
      title: form.title.trim(),
      summary: form.summary || undefined,
      description: form.description || undefined,
      seoTitle: form.seo_title || undefined,
      metaDescription: form.meta_description || undefined,
      thumbnailUrl: form.thumbnail_url || undefined,
      customThumbnailUrl: form.custom_thumbnail_url || undefined,
      category: form.category || 'product-education',
      isShort: form.is_short === true,
      featured: form.featured === true,
      publishedAt: form.published_at || null,
      duration: form.duration || undefined,
      transcript: form.transcript || undefined,
      chapters: parseChapters(chaptersText),
      tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
      relatedProductIds: relatedProductsText.split(',').map((t) => t.trim()).filter(Boolean),
      relatedArticleSlugs: relatedArticlesText.split(',').map((t) => t.trim()).filter(Boolean),
      relatedVideoSlugs: relatedVideosText.split(',').map((t) => t.trim()).filter(Boolean),
      faq: parseFaq(faqText),
      status: form.status,
    };
    try {
      if (creating) {
        await adminMediaCreate(input);
        notify('Created. Publish it when ready.');
      } else if (editing) {
        await adminMediaUpdate(editing.id, input);
        notify('Saved.');
      }
      await load();
      setCreating(false); setEditing(null);
    } catch (e) {
      notify((e as Error).message || 'Save failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (r: CmsMediaRow) => {
    setBusy(true);
    try {
      const next = r.status === 'published' ? 'archived' : 'published';
      await adminMediaUpdate(r.id, {
        title: r.title, slug: r.slug, status: next,
        youtubeVideoId: r.youtube_video_id, category: r.category || 'product-education',
      });
      notify(next === 'published' ? 'Published — live on /media now.' : 'Archived — hidden from /media.');
      await load();
    } catch (e) {
      notify((e as Error).message || 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await adminMediaDelete(confirm.id);
      notify('Deleted permanently.');
      await load();
    } catch (e) {
      notify((e as Error).message || 'Delete failed.', 'error');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const runSync = async () => {
    setSyncBusy(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/media/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; synced?: number; created?: number; updated?: number;
        videos?: { slug: string; title: string }[]; note?: string;
      };
      if (!res.ok || !data.ok) {
        notify(data.error || `Sync failed (HTTP ${res.status}).`, 'error');
        return;
      }
      notify(`Sync complete — ${data.created ?? 0} new, ${data.updated ?? 0} refreshed.`);
      await load();
    } catch (e) {
      notify((e as Error).message || 'Sync failed.', 'error');
    } finally {
      setSyncBusy(false);
    }
  };

  const addFromYoutubeUrl = () => {
    const id = youtubeIdFromUrl(youtubeUrl);
    if (!id) { notify('That does not look like a valid YouTube video URL or id.', 'error'); return; }
    startCreate();
    setForm((f) => ({ ...f, youtube_video_id: id, thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }));
    setYoutubeUrl('');
    notify('YouTube id attached — fill the title and editorial fields, then publish.');
  };

  const filtered = (rows || []).filter((r) => {
    const q = query.trim().toLowerCase();
    return !q || r.title.toLowerCase().includes(q) || (r.youtube_video_id || '').includes(q) || r.slug.includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Media Hub</h1>
          <p className="text-xs text-gray-500 mt-1">
            Videos live in the Supabase CMS — publishing takes effect immediately with no code/deploy. YouTube is the
            primary host; these pages embed official videos and link back to the channel.
          </p>
          {lastSync ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-500"
              title={`Last full sync: ${new Date(lastSync.at).toLocaleString()}`}>
              <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${Date.now() - new Date(lastSync.at).getTime() < 90 * 60 * 1000 ? 'bg-green-500' : 'bg-amber-400'}`} />
              Last synced {timeAgo(lastSync.at)}
              {lastSync.created + lastSync.updated > 0
                ? ` — ${lastSync.created} new, ${lastSync.updated} refreshed`
                : ' — no changes'}
              {lastSync.source === 'cron' ? ' · hourly cron' : ' · manual sync'}
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-gray-400">
              Never synced yet — new uploads auto-import hourly (or click Sync from YouTube).
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={runSync} disabled={syncBusy}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <ArrowCounterClockwise size={15} className={syncBusy ? 'animate-spin' : ''} /> {syncBusy ? 'Syncing…' : 'Sync from YouTube'}
          </button>
          <button onClick={startCreate} className="flex items-center gap-2 px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm rounded-lg">
            <Plus size={16} /> Add Video
          </button>
        </div>
      </div>

      {/* Manual YouTube URL quick-add (the fallback when sync is not configured) */}
      {!creating && !editing && (
        <div className="flex gap-2 items-center bg-white rounded-xl border p-3">
          <YoutubeLogo size={18} className="text-red-500 shrink-0" weight="fill" />
          <input className={input} value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="Paste a YouTube URL (watch/shorts/embed) to start from it" aria-label="YouTube URL" />
          <button onClick={addFromYoutubeUrl} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 whitespace-nowrap">
            Start from URL
          </button>
        </div>
      )}

      {/* Dashboard counts */}
      {!creating && !editing && (
        <div className="grid grid-cols-3 gap-3">
          {(['published', 'draft', 'archived'] as const).map((key) => (
            <div key={key} className="p-4 rounded-xl border bg-white">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_META[key].cls}`}>{STATUS_META[key].label}</span>
              <div className="text-2xl font-bold mt-2">{counts[key]}</div>
            </div>
          ))}
        </div>
      )}

      {loadError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">Failed to load media: {loadError}</div>}

      {/* Editor */}
      {(creating || editing) && (
        <div className="bg-white rounded-2xl border shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold">{creating ? 'Add Video' : `Editing: ${editing!.title}`}</h2>
            <div className="flex gap-2">
              <button onClick={() => { setCreating(false); setEditing(null); }} className="px-3 py-1.5 text-sm border rounded-lg">Cancel</button>
              <button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-luxe-gold text-white rounded-lg disabled:opacity-50">
                <FloppyDisk size={14} /> Save
              </button>
            </div>
          </div>

          {editing?.status === 'published' && editing.slug && (
            <div className="flex items-center justify-between gap-3 mb-5 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              <span className="flex items-center gap-2"><CheckCircle size={17} weight="fill" /> This video is <strong className="font-semibold">LIVE</strong> — changes take effect instantly, no deploy needed.</span>
              <Link to={`/media/${editing.slug}`} className="inline-flex items-center gap-1 text-green-700 font-semibold underline whitespace-nowrap">View live page →</Link>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div>
                <label className={label}>YouTube video id (from the official channel)</label>
                <input className={input} value={form.youtube_video_id || ''} onChange={(e) => setForm({ ...form, youtube_video_id: e.target.value.trim() || null })}
                  placeholder="11-character id, or leave empty for non-YouTube media" />
              </div>
              <div>
                <label className={label}>Title *</label>
                <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: creating && !form.slug ? slugifyMediaTitle(e.target.value) : form.slug })} placeholder="Video title" />
              </div>
              <div>
                <label className={label}>Slug (URL) *</label>
                <input className={input} value={form.slug} onChange={(e) => setForm({ ...form, slug: slugifyMediaTitle(e.target.value) })} placeholder="how-himalayan-salt-licks-are-made" />
              </div>
              <div>
                <label className={label}>Category</label>
                <select className={input} value={form.category || 'product-education'} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {MEDIA_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.is_short === true} onChange={(e) => setForm({ ...form, is_short: e.target.checked })} /> Short (&le;60s)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.featured === true} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured
                </label>
              </div>
              <div>
                <label className={label}>Published date</label>
                <input type="datetime-local" className={input} value={(form.published_at || '').slice(0, 16)} onChange={(e) => setForm({ ...form, published_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </div>
              <div>
                <label className={label}>Duration (ISO-8601, e.g. PT5M30S — leave empty when unknown)</label>
                <input className={input} value={form.duration || ''} onChange={(e) => setForm({ ...form, duration: e.target.value.trim() || null })} placeholder="PT5M30S" />
              </div>
              <div>
                <label className={label}>YouTube thumbnail URL (auto-filled from the id when empty)</label>
                <input className={input} value={form.thumbnail_url || ''} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value || null })} />
              </div>
              <div>
                <label className={label}>Custom editorial thumbnail URL (overrides the YouTube one)</label>
                <input className={input} value={form.custom_thumbnail_url || ''} onChange={(e) => setForm({ ...form, custom_thumbnail_url: e.target.value || null })} />
              </div>
              <div>
                <label className={label}>Tags (comma separated)</label>
                <input className={input} value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="himalayan salt, horse, natural minerals" />
              </div>
              <div>
                <label className={label}>Status</label>
                <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CmsMediaRow['status'] })}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className={label}>Short editorial intro (1–2 sentences)</label>
                <textarea className={input} rows={2} value={form.summary || ''} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
              </div>
              <div>
                <label className={label}>Detailed description / article body</label>
                <textarea className={`${input} font-mono`} rows={6} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label className={label}>Chapters — one per line: <span className="normal-case">0:00|Title</span></label>
                <textarea className={`${input} font-mono`} rows={3} value={chaptersText} onChange={(e) => setChaptersText(e.target.value)} placeholder={'0:00|Introduction\n1:30|How salt licks are made'} />
              </div>
              <div>
                <label className={label}>FAQ — JSON array of {"{ q, a }"}</label>
                <textarea className={`${input} font-mono`} rows={4} value={faqText} onChange={(e) => setFaqText(e.target.value)} placeholder='[{"q":"Question","a":"Answer"}]' />
              </div>
              <div>
                <label className={label}>Transcript</label>
                <textarea className={`${input} font-mono`} rows={4} value={form.transcript || ''} onChange={(e) => setForm({ ...form, transcript: e.target.value })} />
              </div>
              <div>
                <label className={label}>SEO title (max 60)</label>
                <input className={input} maxLength={60} value={form.seo_title || ''} onChange={(e) => setForm({ ...form, seo_title: e.target.value })} />
                <span className="text-[10px] text-gray-400">{(form.seo_title || '').length}/60</span>
              </div>
              <div>
                <label className={label}>Meta description (max 160)</label>
                <textarea className={input} rows={2} maxLength={160} value={form.meta_description || ''} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} />
                <span className="text-[10px] text-gray-400">{(form.meta_description || '').length}/160</span>
              </div>
              <div>
                <label className={label}>Related product ids/slugs (comma separated)</label>
                <input className={input} value={relatedProductsText} onChange={(e) => setRelatedProductsText(e.target.value)} placeholder="product-slug-1, product-slug-2" />
              </div>
              <div>
                <label className={label}>Related article slugs (comma separated)</label>
                <input className={input} value={relatedArticlesText} onChange={(e) => setRelatedArticlesText(e.target.value)} placeholder="blog-slug-1, blog-slug-2" />
              </div>
              <div>
                <label className={label}>Related video slugs (comma separated)</label>
                <input className={input} value={relatedVideosText} onChange={(e) => setRelatedVideosText(e.target.value)} placeholder="other-video-slug" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {!creating && !editing && (
        <div className="bg-white rounded-2xl border shadow-sm">
          <div className="p-4 border-b flex items-center gap-3">
            <MagnifyingGlass size={15} className="text-gray-400" />
            <input className="flex-1 text-sm focus:outline-none" placeholder="Search title, id or slug…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search media" />
          </div>
          {filtered.length === 0 && (
            <div className="p-10 text-center text-sm text-gray-500">
              {rows === null ? 'Loading…' : 'No videos yet. Sync from YouTube or add one manually — new uploads appear on /media as soon as they are published here.'}
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {filtered.map((r) => {
              const thumb = mediaThumbnail({ customThumbnailUrl: r.custom_thumbnail_url, thumbnailUrl: r.thumbnail_url, youtubeVideoId: r.youtube_video_id });
              return (
                <li key={r.id} className="flex items-center gap-4 p-3.5 hover:bg-gray-50">
                  <Link to={r.status === 'published' ? `/media/${r.slug}` : '#'} onClick={(e) => { if (r.status !== 'published') e.preventDefault(); }}
                    className="w-24 aspect-video rounded-lg overflow-hidden bg-gray-100 shrink-0 relative group" aria-label={r.status === 'published' ? `View ${r.title}` : r.title}>
                    {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <span className="w-full h-full flex items-center justify-center text-gray-300"><Play size={18} /></span>}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{r.title}</p>
                      {r.is_short === true && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-bold uppercase">Short</span>}
                      {r.featured === true && <span className="px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-600 text-[10px] font-bold uppercase">Featured</span>}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                      /media/{r.slug}{r.youtube_video_id ? ` · youtube: ${r.youtube_video_id}` : ''}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_META[r.status].cls}`}>{STATUS_META[r.status].label}</span>
                  <div className="flex items-center gap-1">
                    {r.youtube_video_id && (
                      <a href={`https://www.youtube.com/watch?v=${r.youtube_video_id}`} target="_blank" rel="noopener noreferrer"
                        className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100" aria-label="Open on YouTube" title="Open on YouTube">
                        <YoutubeLogo size={16} />
                      </a>
                    )}
                    <button onClick={() => toggleStatus(r)} disabled={busy}
                      className="p-2 text-gray-400 hover:text-luxe-gold rounded-lg hover:bg-gray-100" aria-label={r.status === 'published' ? 'Archive' : 'Publish'} title={r.status === 'published' ? 'Archive' : 'Publish'}>
                      {r.status === 'published' ? <Play size={16} /> : <CheckCircle size={16} />}
                    </button>
                    <button onClick={() => startEdit(r)} className="p-2 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-gray-100" aria-label="Edit" title="Edit">
                      <PencilLine size={16} />
                    </button>
                    <button onClick={() => setConfirm(r)} className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100" aria-label="Delete" title="Delete">
                      <Trash size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Delete confirm */}
      {confirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm delete">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold">Delete video?</h3>
            <p className="text-sm text-gray-500 mt-2">“{confirm.title}” will be permanently removed from the media library. This cannot be undone.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
              <button onClick={doDelete} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}