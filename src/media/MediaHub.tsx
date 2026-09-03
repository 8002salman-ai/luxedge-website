// ============================================================================
// LUXEDGE — MEDIA HUB (storefront)
//
// Premium US editorial video hub. The official YouTube channel is the primary
// video host: these pages embed official YouTube videos (click-to-load, never
// autoplay) and send viewers back to the channel. Every editorial field comes
// from the Supabase `media_videos` table (migration 0026) — nothing here is
// invented; empty sections simply don't render.
//
// YOUTUBE_CHANNEL_URL is a documented placeholder until Salman provides the
// real channel URL. It is the ONLY place this value lives on the client; the
// worker uses the same placeholder (see worker/seo-meta.ts) so Subscribe CTAs
// and structured data stay consistent until the real URL is supplied.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  Copy,
  FacebookLogo,
  LinkedinLogo,
  Play,
  ShareNetwork,
  WhatsappLogo,
  XLogo,
  YoutubeLogo,
} from '@phosphor-icons/react';
import { useApp } from '../App';
import type { Product } from '../App';
import { trackEvent, utmParams } from '../lib/marketing';
import {
  loadPublishedMedia,
  loadPublishedMediaBySlug,
  mediaThumbnail,
  formatDuration,
} from '../services/media';
import type { MediaVideo } from '../services/media';
import { loadPublishedBlogs } from '../services/blog';
import type { BlogPost } from '../App';

/**
 * Official Luxedge channel (AI With Salman) — verified from the owner data of
 * the channel's real video YOBlXCyOh28 (channel id UCPvPDstYz61AebGhKzKS1lw).
 * This is the single client-side source for Subscribe CTAs + the footer link.
 */
export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@TheAIWithSalman';
export const YOUTUBE_CHANNEL_ID = 'UCPvPDstYz61AebGhKzKS1lw';

export const MEDIA_CATEGORIES = [
  { id: 'product-education', label: 'Product Education', blurb: 'How our products are made, what they do, and why they earn their place.' },
  { id: 'pet-animal-care', label: 'Pet & Animal Care', blurb: 'Practical care guidance for dogs, cats, horses and more.' },
  { id: 'himalayan-salt', label: 'Himalayan Salt & Natural Products', blurb: 'Salt licks, blocks and natural essentials — sourcing, science and use.' },
  { id: 'how-to-guides', label: 'How-To Guides', blurb: 'Step-by-step video guides with real demonstrations.' },
  { id: 'buying-guides', label: 'Buying Guides', blurb: 'What to look for, what to avoid, and how to choose well.' },
  { id: 'behind-the-brand', label: 'Behind the Brand', blurb: 'Stories from the Luxedge team and how we source.' },
] as const;

export const MEDIA_COPYRIGHT =
  '© Luxedge. Original video content may not be reproduced or redistributed without permission, except where permitted by applicable law.';

function categoryLabel(id: string): string {
  return MEDIA_CATEGORIES.find((c) => c.id === id)?.label || 'Videos';
}

function productPath(p: Pick<Product, 'id' | 'slug'>): string {
  return `/product/${p.slug || p.id}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Analytics — the five media events (first-party site_events + GA via gtag)
// ---------------------------------------------------------------------------
function mediaEvent(name: string, extra: Record<string, unknown> = {}): void {
  trackEvent(name, { ...extra, ...utmParams() });
}

// ---------------------------------------------------------------------------
// Click-to-load YouTube embed — no iframe until the visitor clicks play.
// ---------------------------------------------------------------------------
function YouTubeEmbed({
  videoId,
  title,
  start,
}: {
  videoId: string;
  title: string;
  start?: number | null;
}) {
  const [active, setActive] = useState(false);
  const startSec = start && start > 0 ? start : null;
  const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  if (active) {
    const qs = new URLSearchParams({ rel: '0', modestbranding: '1' });
    if (startSec) qs.set('start', String(startSec));
    return (
      <div className="relative w-full aspect-video bg-luxe-black rounded-2xl overflow-hidden">
        <iframe
          key={startSec ?? 'main'}
          className="absolute inset-0 w-full h-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?${qs.toString()}`}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setActive(true);
        mediaEvent('media_video_play', { video_id: videoId, title });
      }}
      className="relative block w-full aspect-video rounded-2xl overflow-hidden group focus-visible:outline-2 focus-visible:outline-luxe-gold"
      aria-label={`Play video: ${title}`}
    >
      <img
        src={thumb}
        alt={title}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-luxe-black/60 via-transparent to-transparent" aria-hidden="true" />
      <span
        className="absolute inset-0 m-auto w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-luxe-gold text-white flex items-center justify-center shadow-gold group-hover:scale-110 transition-transform duration-300"
        aria-hidden="true"
      >
        <Play size={26} weight="fill" />
      </span>
      <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-luxe-black/80 text-white text-[11px] font-semibold flex items-center gap-1">
        <Play size={10} weight="fill" aria-hidden="true" /> Play
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Media card — lazy thumbnail, duration badge, editorial metadata.
// ---------------------------------------------------------------------------
function MediaCard({ video, priority = false }: { video: MediaVideo; priority?: boolean }) {
  const thumb = mediaThumbnail(video);
  const dur = formatDuration(video.duration);
  return (
    <article className="group">
      <Link to={`/media/${video.slug}`} className="block focus-visible:outline-luxe-gold rounded-2xl" aria-label={video.title}>
        <div className="relative aspect-video rounded-2xl overflow-hidden bg-luxe-black/5">
          {thumb ? (
            <img
              src={thumb}
              alt={video.title}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-luxe-black text-luxe-gold-light">
              <YoutubeLogo size={34} weight="fill" aria-hidden="true" />
            </div>
          )}
          {dur && (
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-luxe-black/85 text-white text-[11px] font-semibold flex items-center gap-1" aria-label={`Duration ${dur}`}>
              <Clock size={10} weight="fill" aria-hidden="true" /> {dur}
            </span>
          )}
          {video.isShort && (
            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-luxe-gold text-luxe-black text-[10px] font-bold uppercase tracking-wide">
              Short
            </span>
          )}
        </div>
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-luxe-gold-dark">{categoryLabel(video.category)}</p>
          <h3 className="mt-1 font-serif text-[15px] font-bold text-luxe-black leading-snug line-clamp-2 group-hover:text-luxe-gold-dark transition-colors">
            {video.title}
          </h3>
          {video.publishedAt && (
            <p className="mt-1 text-xs text-luxe-black/55">{formatDate(video.publishedAt)}</p>
          )}
        </div>
      </Link>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Subscribe CTA band (used on the hub and every video page).
// ---------------------------------------------------------------------------
function SubscribeBand({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? 'mt-10' : 'mt-14'} aria-label="Subscribe on YouTube">
      <div className="rounded-3xl bg-luxe-black text-luxe-white px-6 py-8 sm:px-10 sm:py-10 flex flex-col sm:flex-row items-center gap-6 justify-between overflow-hidden relative">
        <div aria-hidden="true" className="absolute -top-20 -right-16 w-64 h-64 rounded-full bg-luxe-gold/10 blur-[80px]" />
        <div className="relative text-center sm:text-left">
          <p className="eyebrow mb-1 text-luxe-gold-light">Never Miss a Video</p>
          <h2 className="font-serif text-xl sm:text-2xl font-bold tracking-tight">Subscribe on YouTube</h2>
          <p className="mt-1.5 text-sm text-luxe-white/65 max-w-md">
            New guides and stories go live on the official Luxedge channel first.
          </p>
        </div>
        <a
          href={YOUTUBE_CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => mediaEvent('media_subscribe_click')}
          className="relative inline-flex items-center gap-2 px-6 py-3 rounded-full bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold text-sm transition-all hover:-translate-y-0.5 shadow-gold"
        >
          <YoutubeLogo size={18} weight="fill" aria-hidden="true" /> Subscribe
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// /media — the hub
// ---------------------------------------------------------------------------
export function MediaHubPage() {
  const [videos, setVideos] = useState<MediaVideo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPublishedMedia().then((v) => {
      if (!cancelled) setVideos(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const list = videos || [];
  const featured = list.find((v) => v.featured) || list[0] || null;
  const rest = list.filter((v) => v.slug !== featured?.slug);
  const latest = rest.slice(0, 8);
  const shorts = list.filter((v) => v.isShort).slice(0, 6);
  const byCategory = useMemo(() => {
    const out = new Map<string, MediaVideo[]>();
    for (const v of list) {
      if (v.isShort || v.slug === featured?.slug) continue;
      const arr = out.get(v.category) || [];
      arr.push(v);
      out.set(v.category, arr);
    }
    return out;
  }, [list, featured]);

  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="relative bg-luxe-black text-luxe-white overflow-hidden">
        <div aria-hidden="true" className="absolute -top-28 right-0 w-[26rem] h-[26rem] rounded-full bg-luxe-gold/10 blur-[110px]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-10 sm:pt-16 sm:pb-14">
          <p className="eyebrow text-luxe-gold-light">Luxedge Media</p>
          <h1 className="mt-2 font-serif text-3xl sm:text-5xl font-bold tracking-tight max-w-2xl">
            Films, guides & stories from the Luxedge team
          </h1>
          <p className="mt-3 text-sm sm:text-base text-luxe-white/65 max-w-xl">
            How our products are made, how to care for the animals you love, and the honest
            buying advice behind every choice — first on YouTube, archived here.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href={YOUTUBE_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => mediaEvent('media_subscribe_click')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm font-bold transition-all hover:-translate-y-0.5 shadow-gold"
            >
              <YoutubeLogo size={16} weight="fill" aria-hidden="true" /> Subscribe on YouTube
            </a>
            {videos === null && (
              <span className="text-xs text-luxe-white/50">Videos load from the Luxedge Media library.</span>
            )}
          </div>
        </div>
      </section>

      {list.length === 0 && (
        <section className="max-w-3xl mx-auto px-4 py-16 text-center">
          <YoutubeLogo size={40} weight="fill" className="mx-auto text-luxe-gold-dark" aria-hidden="true" />
          <h2 className="mt-4 font-serif text-2xl font-bold text-luxe-black">Videos are on the way</h2>
          <p className="mt-2 text-sm text-luxe-black/60">
            The media library is being built. New videos from the official channel will appear here automatically —
            subscribe on YouTube to catch them first.
          </p>
          <a
            href={YOUTUBE_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => mediaEvent('media_subscribe_click')}
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-luxe-black text-white text-sm font-bold hover:bg-luxe-gold hover:text-white transition-colors"
          >
            <YoutubeLogo size={16} weight="fill" aria-hidden="true" /> Subscribe on YouTube
          </a>
        </section>
      )}

      {featured && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14" aria-label="Featured video">
          <div className="grid lg:grid-cols-5 gap-8 items-center">
            <div className="lg:col-span-3">
              <YouTubeEmbed videoId={featured.youtubeVideoId || ''} title={featured.title} />
            </div>
            <div className="lg:col-span-2">
              <p className="eyebrow text-luxe-gold-dark">Featured Video</p>
              <h2 className="mt-1 font-serif text-2xl sm:text-3xl font-bold text-luxe-black tracking-tight">{featured.title}</h2>
              {featured.publishedAt && <p className="mt-2 text-xs text-luxe-black/50">{formatDate(featured.publishedAt)}</p>}
              {featured.summary && <p className="mt-3 text-sm leading-relaxed text-luxe-black/70">{featured.summary}</p>}
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to={`/media/${featured.slug}`}
                  onClick={() => mediaEvent('media_related_video_click', { video_slug: featured.slug, surface: 'featured' })}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-luxe-black text-white text-sm font-bold hover:bg-luxe-gold-dark transition-colors"
                >
                  Read & watch <ArrowRight size={14} weight="bold" aria-hidden="true" />
                </Link>
                {featured.youtubeVideoId && (
                  <a
                    href={`https://www.youtube.com/watch?v=${featured.youtubeVideoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => mediaEvent('media_watch_youtube_click', { video_id: featured.youtubeVideoId })}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-luxe-black/20 text-luxe-black text-sm font-bold hover:border-luxe-gold-dark hover:text-luxe-gold-dark transition-colors"
                  >
                    Watch on YouTube <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Latest */}
      {latest.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10" aria-label="Latest videos">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-luxe-gold-dark">Fresh from the Channel</p>
              <h2 className="mt-1 font-serif text-2xl font-bold text-luxe-black">Latest Videos</h2>
            </div>
            <Link to={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-luxe-gold-dark hover:text-luxe-black transition-colors" onClick={() => mediaEvent('media_watch_youtube_click')}>
              All videos on YouTube <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-9">
            {latest.map((v, i) => (
              <MediaCard key={v.id} video={v} priority={i < 4} />
            ))}
          </div>
        </section>
      )}

      {/* Shorts */}
      {shorts.length > 0 && (
        <section className="bg-luxe-black/5 py-10" aria-label="YouTube Shorts">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="eyebrow text-luxe-gold-dark">Quick Hits</p>
            <h2 className="mt-1 font-serif text-2xl font-bold text-luxe-black">YouTube Shorts</h2>
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {shorts.map((v) => (
                <article key={v.id} className="group">
                  <Link to={`/media/${v.slug}`} className="block focus-visible:outline-luxe-gold rounded-2xl" aria-label={v.title}>
                    <div className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-luxe-black/5">
                      <img
                        src={mediaThumbnail(v) || ''}
                        alt={v.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                      />
                      <span className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-luxe-gold/90 text-white flex items-center justify-center" aria-hidden="true">
                        <Play size={16} weight="fill" />
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] font-semibold text-luxe-black leading-snug line-clamp-2 group-hover:text-luxe-gold-dark transition-colors">{v.title}</p>
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Category sections */}
      {byCategory.size > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12" aria-label="Browse by category">
          <p className="eyebrow text-luxe-gold-dark">Browse the Library</p>
          <h2 className="mt-1 font-serif text-2xl font-bold text-luxe-black">Explore by Topic</h2>
          <div className="mt-8 space-y-12">
            {MEDIA_CATEGORIES.map((cat) => {
              const items = byCategory.get(cat.id);
              if (!items || items.length === 0) return null;
              return (
                <div key={cat.id}>
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <h3 className="font-serif text-lg font-bold text-luxe-black">{cat.label}</h3>
                      <p className="text-xs text-luxe-black/55 mt-0.5">{cat.blurb}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8">
                    {items.slice(0, 4).map((v) => (
                      <MediaCard key={v.id} video={v} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <SubscribeBand compact />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share row
// ---------------------------------------------------------------------------
function ShareRow({ video }: { video: MediaVideo }) {
  const url = `https://luxedge.us/media/${video.slug}`;
  const text = `${video.title} — Luxedge Media`;
  const encoded = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const [copied, setCopied] = useState(false);

  const links: { label: string; href: string; icon: React.ReactNode }[] = [
    { label: 'Share on Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`, icon: <FacebookLogo size={16} weight="fill" /> },
    { label: 'Share on X', href: `https://twitter.com/intent/tweet?url=${encoded}&text=${encodedText}`, icon: <XLogo size={16} weight="fill" /> },
    { label: 'Share on WhatsApp', href: `https://wa.me/?text=${encodedText}%20${encoded}`, icon: <WhatsappLogo size={16} weight="fill" /> },
    { label: 'Share on LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`, icon: <LinkedinLogo size={16} weight="fill" /> },
    { label: 'Share by email', href: `mailto:?subject=${encodedText}&body=${encoded}`, icon: <ShareNetwork size={16} weight="fill" /> },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
    mediaEvent('media_share', { video_slug: video.slug, method: 'copy' });
  };

  return (
    <div className="flex items-center gap-2" aria-label="Share this video">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={l.label}
          title={l.label}
          onClick={() => mediaEvent('media_share', { video_slug: video.slug, method: l.label.replace('Share on ', '').toLowerCase() })}
          className="w-9 h-9 rounded-full border border-luxe-black/15 text-luxe-black/70 hover:text-luxe-white hover:bg-luxe-black hover:border-luxe-black flex items-center justify-center transition-colors"
        >
          {l.icon}
        </a>
      ))}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy link"
        title="Copy link"
        className="w-9 h-9 rounded-full border border-luxe-black/15 text-luxe-black/70 hover:text-luxe-white hover:bg-luxe-black hover:border-luxe-black flex items-center justify-center transition-colors"
      >
        <Copy size={15} weight="fill" />
      </button>
      {copied && <span className="text-xs font-semibold text-luxe-gold-dark">Link copied!</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// /media/:slug — the individual video page
// ---------------------------------------------------------------------------
export function MediaVideoPage() {
  const { slug } = useParams<{ slug: string }>();
  const { products } = useApp();
  const [video, setVideo] = useState<MediaVideo | null>(null);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [blogs, setBlogs] = useState<BlogPost[]>([]);
  const [allVideos, setAllVideos] = useState<MediaVideo[]>([]);

  useEffect(() => {
    window.scrollTo(0, 0);
    let cancelled = false;
    setVideo(null);
    setStartAt(null);
    if (!slug) return () => { cancelled = true; };
    void loadPublishedMediaBySlug(slug).then((row) => {
      if (!cancelled && row) setVideo(row);
    });
    void loadPublishedMedia().then((v) => {
      if (!cancelled && v) setAllVideos(v);
    });
    void loadPublishedBlogs().then((b) => {
      if (!cancelled && b) setBlogs(b);
    });
    return () => { cancelled = true; };
  }, [slug]);

  // SEO head: title, description, canonical, OG/Twitter, VideoObject JSON-LD.
  useEffect(() => {
    if (!video) return;
    const setMeta = (n: string, c: string) => {
      let el = document.head.querySelector(`meta[name="${n}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', n); document.head.appendChild(el); }
      el.setAttribute('content', c);
    };
    const setProp = (p: string, c: string) => {
      let el = document.head.querySelector(`meta[property="${p}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', p); document.head.appendChild(el); }
      el.setAttribute('content', c);
    };
    const canonical = `https://luxedge.us/media/${video.slug}`;
    const title = (video.seoTitle || video.title).replace(/\s*\|\s*Luxedge\s*$/i, '') + ' | Luxedge';
    const desc = (video.metaDescription || video.summary || video.description || '').slice(0, 200);
    document.title = title;
    setMeta('description', desc);
    setProp('og:title', title);
    setProp('og:description', desc);
    setProp('og:type', 'video.other');
    setProp('og:url', canonical);
    const thumb = mediaThumbnail(video);
    if (thumb) {
      setProp('og:image', thumb);
      setMeta('twitter:image', thumb);
    }
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', title);
    setMeta('twitter:description', desc);
    let canonicalEl = document.head.querySelector('link[rel="canonical"]');
    if (!canonicalEl) { canonicalEl = document.createElement('link'); canonicalEl.setAttribute('rel', 'canonical'); document.head.appendChild(canonicalEl); }
    canonicalEl.setAttribute('href', canonical);

    const jsonLd: Record<string, unknown>[] = [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://luxedge.us/' },
          { '@type': 'ListItem', position: 2, name: 'Media', item: 'https://luxedge.us/media' },
          { '@type': 'ListItem', position: 3, name: video.title, item: canonical },
        ],
      },
    ];
    if (video.youtubeVideoId) {
      const vobj: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: video.title,
        description: desc || video.title,
        thumbnailUrl: thumb || undefined,
        uploadDate: video.publishedAt || undefined,
        embedUrl: `https://www.youtube.com/embed/${video.youtubeVideoId}`,
        contentUrl: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
      };
      if (video.duration) vobj.duration = video.duration;
      jsonLd.push(vobj);
    }
    if (video.faq && video.faq.length > 0) {
      jsonLd.push({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: video.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      });
    }
    let script = document.head.querySelector('script[data-media-jsonld]');
    if (!script) {
      script = document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      script.setAttribute('data-media-jsonld', '');
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);
    return () => {
      const s = document.head.querySelector('script[data-media-jsonld]');
      if (s) s.remove();
    };
  }, [video]);

  const relatedVideos = useMemo(() => {
    const bySlug = new Map(allVideos.map((v) => [v.slug, v]));
    const picked = (video?.relatedVideoSlugs || []).map((s) => bySlug.get(s)).filter((v): v is MediaVideo => !!v);
    const rest = allVideos.filter((v) => v.slug !== video?.slug && !picked.some((p) => p.slug === v.slug));
    return [...picked, ...rest].slice(0, 4);
  }, [allVideos, video]);

  const relatedProducts = useMemo(() => {
    const ids = new Set(video?.relatedProductIds || []);
    if (ids.size === 0) return [];
    return products.filter((p) => ids.has(p.id) || (p.slug && ids.has(p.slug))).slice(0, 4);
  }, [products, video]);

  const relatedArticles = useMemo(() => {
    const bySlug = new Map(blogs.map((b) => [b.slug, b]));
    const picked = (video?.relatedArticleSlugs || []).map((s) => bySlug.get(s)).filter((b): b is BlogPost => !!b);
    return picked.slice(0, 3);
  }, [blogs, video]);

  if (!video) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="font-serif text-2xl font-bold text-luxe-black">Video not found</h1>
        <p className="mt-2 text-sm text-luxe-black/60">This video is no longer available or hasn't been published yet.</p>
        <Link to="/media" className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-luxe-black text-white text-sm font-bold hover:bg-luxe-gold-dark transition-colors">
          Browse all videos <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const thumb = mediaThumbnail(video);
  const dur = formatDuration(video.duration);
  const jumpTo = (t: string) => {
    const parts = t.split(':').map((n) => Number(n) || 0);
    const secs = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
    setStartAt(secs);
    mediaEvent('media_video_play', { video_id: video.youtubeVideoId || video.slug, title: video.title, chapter: t });
  };

  return (
    <div className="bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="text-xs text-luxe-black/50 mb-5">
          <Link to="/" className="hover:text-luxe-gold-dark">Home</Link>
          <span className="mx-2" aria-hidden="true">/</span>
          <Link to="/media" className="hover:text-luxe-gold-dark">Media</Link>
          <span className="mx-2" aria-hidden="true">/</span>
          <span className="text-luxe-black/80">{video.title}</span>
        </nav>

        <div className="grid lg:grid-cols-3 gap-10">
          {/* Main column */}
          <div className="lg:col-span-2">
            <p className="eyebrow text-luxe-gold-dark">{categoryLabel(video.category)}{video.isShort ? ' · Short' : ''}</p>
            <h1 className="mt-1.5 font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-luxe-black tracking-tight leading-tight">
              {video.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-luxe-black/55">
              {video.publishedAt && <span>{formatDate(video.publishedAt)}</span>}
              {dur && <span className="inline-flex items-center gap-1"><Clock size={12} weight="fill" aria-hidden="true" /> {dur}</span>}
              {video.youtubeVideoId && (
                <a
                  href={`https://www.youtube.com/watch?v=${video.youtubeVideoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => mediaEvent('media_watch_youtube_click', { video_id: video.youtubeVideoId })}
                  className="inline-flex items-center gap-1.5 font-semibold text-luxe-gold-dark hover:text-luxe-black transition-colors"
                >
                  Watch on YouTube <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
                </a>
              )}
            </div>

            <div className="mt-6">
              {video.youtubeVideoId ? (
                <YouTubeEmbed videoId={video.youtubeVideoId} title={video.title} start={startAt} />
              ) : (
                thumb && (
                  <div className="aspect-video rounded-2xl overflow-hidden bg-luxe-black/5">
                    <img src={thumb} alt={video.title} className="w-full h-full object-cover" />
                  </div>
                )
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-4 flex-wrap">
              <ShareRow video={video} />
              {video.youtubeVideoId && (
                <a
                  href={`https://www.youtube.com/watch?v=${video.youtubeVideoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => mediaEvent('media_watch_youtube_click', { video_id: video.youtubeVideoId })}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-luxe-black text-white text-xs font-bold hover:bg-luxe-gold-dark transition-colors"
                >
                  <YoutubeLogo size={14} weight="fill" aria-hidden="true" /> Watch on YouTube
                </a>
              )}
            </div>

            {/* Editorial body */}
            {(video.summary || video.description) && (
              <div className="mt-8 prose-editorial">
                {video.summary && <p className="font-serif text-lg text-luxe-black/85 leading-relaxed">{video.summary}</p>}
                {video.description && (
                  <div className="mt-4 text-sm leading-relaxed text-luxe-black/70 whitespace-pre-line">{video.description}</div>
                )}
              </div>
            )}

            {/* Chapters */}
            {video.chapters.length > 0 && (
              <section className="mt-9" aria-label="Chapters">
                <h2 className="font-serif text-xl font-bold text-luxe-black">Chapters</h2>
                <ol className="mt-4 divide-y divide-luxe-black/10 border-y border-luxe-black/10">
                  {video.chapters.map((c, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => jumpTo(c.t)}
                        className="w-full text-left py-3 flex items-baseline gap-3 text-sm hover:text-luxe-gold-dark transition-colors group"
                      >
                        <span className="font-mono text-xs text-luxe-gold-dark font-semibold shrink-0">{c.t}</span>
                        <span className="text-luxe-black/80 group-hover:text-luxe-gold-dark">{c.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Transcript */}
            {video.transcript && (
              <section className="mt-9" aria-label="Transcript">
                <h2 className="font-serif text-xl font-bold text-luxe-black">Transcript</h2>
                <details className="mt-3 group">
                  <summary className="cursor-pointer text-sm font-semibold text-luxe-gold-dark hover:text-luxe-black transition-colors">
                    Read the full transcript
                  </summary>
                  <div className="mt-3 max-h-80 overflow-y-auto rounded-2xl bg-luxe-black/5 p-4 text-[13px] leading-relaxed text-luxe-black/75 whitespace-pre-line">
                    {video.transcript}
                  </div>
                </details>
              </section>
            )}

            {/* FAQ */}
            {video.faq && video.faq.length > 0 && (
              <section className="mt-9" aria-label="Frequently asked questions">
                <h2 className="font-serif text-xl font-bold text-luxe-black">Frequently Asked Questions</h2>
                <div className="mt-4 space-y-3">
                  {video.faq.map((f, i) => (
                    <details key={i} className="rounded-2xl border border-luxe-black/10 px-5 py-4 group">
                      <summary className="cursor-pointer text-sm font-semibold text-luxe-black list-none flex items-center justify-between gap-3">
                        {f.q}
                        <span className="text-luxe-gold-dark transition-transform group-open:rotate-45 text-lg leading-none" aria-hidden="true">+</span>
                      </summary>
                      <p className="mt-2.5 text-sm leading-relaxed text-luxe-black/70">{f.a}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}

            <p className="mt-10 text-[11px] leading-relaxed text-luxe-black/45">{MEDIA_COPYRIGHT}</p>
          </div>

          {/* Sidebar */}
          <aside className="space-y-10">
            <SubscribeBand compact />

            {relatedProducts.length > 0 && (
              <section aria-label="Shop related products">
                <h2 className="font-serif text-lg font-bold text-luxe-black">Shop Related Products</h2>
                <div className="mt-4 space-y-4">
                  {relatedProducts.map((p) => (
                    <Link
                      key={p.id}
                      to={productPath(p)}
                      onClick={() => mediaEvent('media_related_product_click', { product_id: p.id, video_slug: video.slug })}
                      className="flex gap-3 items-center rounded-2xl border border-luxe-black/10 p-3 hover:border-luxe-gold-dark hover:shadow-sm transition-all group"
                    >
                      <img
                        src={p.images.find((i) => i) || '/luxedge-mark.png'}
                        alt={p.name}
                        loading="lazy"
                        decoding="async"
                        className="w-16 h-16 rounded-xl object-cover bg-luxe-black/5 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-luxe-black leading-snug line-clamp-2 group-hover:text-luxe-gold-dark transition-colors">{p.name}</p>
                        <p className="mt-1 text-sm font-bold text-luxe-gold-dark">${p.price.toFixed(2)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {relatedArticles.length > 0 && (
              <section aria-label="Related articles">
                <h2 className="font-serif text-lg font-bold text-luxe-black">Related Articles</h2>
                <div className="mt-4 space-y-4">
                  {relatedArticles.map((b) => (
                    <Link key={b.id} to={`/blog/${b.slug}`} className="block group">
                      <p className="text-[13px] font-semibold text-luxe-black leading-snug line-clamp-2 group-hover:text-luxe-gold-dark transition-colors">{b.title}</p>
                      <p className="mt-1 text-xs text-luxe-black/50">{b.date}</p>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {relatedVideos.length > 0 && (
              <section aria-label="Watch next">
                <h2 className="font-serif text-lg font-bold text-luxe-black">Watch Next</h2>
                <div className="mt-4 space-y-4">
                  {relatedVideos.map((v) => (
                    <Link
                      key={v.id}
                      to={`/media/${v.slug}`}
                      onClick={() => mediaEvent('media_related_video_click', { video_slug: v.slug, surface: 'watch_next' })}
                      className="flex gap-3 items-center rounded-2xl hover:bg-luxe-black/5 p-2 -m-2 transition-colors group"
                    >
                      <div className="relative w-24 aspect-video rounded-xl overflow-hidden bg-luxe-black/5 shrink-0">
                        <img src={mediaThumbnail(v) || ''} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        {formatDuration(v.duration) && (
                          <span className="absolute bottom-1 right-1 px-1 rounded bg-luxe-black/85 text-white text-[9px] font-semibold">{formatDuration(v.duration)}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-luxe-black leading-snug line-clamp-2 group-hover:text-luxe-gold-dark transition-colors">{v.title}</p>
                        <p className="mt-1 text-[11px] text-luxe-black/50">{categoryLabel(v.category)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Homepage widget — Latest from Luxedge Media
// ---------------------------------------------------------------------------
export function MediaLatestSection() {
  const [videos, setVideos] = useState<MediaVideo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPublishedMedia().then((v) => {
      if (!cancelled && v && v.length > 0) setVideos(v.slice(0, 3));
    });
    return () => { cancelled = true; };
  }, []);

  if (!videos || videos.length === 0) return null;

  return (
    <section className="bg-luxe-black/5 py-12 sm:py-16" aria-label="Latest from Luxedge Media">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow text-luxe-gold-dark">Watch & Learn</p>
            <h2 className="mt-1 font-serif text-2xl sm:text-3xl font-bold text-luxe-black tracking-tight">
              Latest from Luxedge Media
            </h2>
          </div>
          <Link
            to="/media"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-luxe-gold-dark hover:text-luxe-black transition-colors"
          >
            Explore All Videos <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-9">
          {videos.map((v, i) => (
            <MediaCard key={v.id} video={v} priority={i === 0} />
          ))}
        </div>
        <div className="mt-8 text-center sm:hidden">
          <Link to="/media" className="inline-flex items-center gap-1.5 text-sm font-bold text-luxe-gold-dark hover:text-luxe-black transition-colors">
            Explore All Videos <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}