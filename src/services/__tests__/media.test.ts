// ============================================================================
// LUXEDGE — MEDIA HUB HELPER TESTS
//
// Pins the pure helpers the hub depends on: slug generation, YouTube id
// extraction (watch/shorts/embed/youtu.be/raw), duration formatting, and the
// DB-row → storefront mapping contract. Nothing here touches the network.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  slugifyMediaTitle,
  youtubeIdFromUrl,
  formatDuration,
  mapRowToMediaVideo,
  mediaThumbnail,
  type CmsMediaRow,
} from '../media';

describe('slugifyMediaTitle', () => {
  it('produces a clean URL slug', () => {
    expect(slugifyMediaTitle('How Himalayan Salt Licks Are Made')).toBe('how-himalayan-salt-licks-are-made');
  });

  it('handles ampersands, punctuation and Unicode', () => {
    expect(slugifyMediaTitle('Dog & Cat Toys — 2026!')).toBe('dog-and-cat-toys-2026');
  });

  it('never returns an empty slug', () => {
    expect(slugifyMediaTitle('!!!')).toBe('video');
  });

  it('caps length at 80 chars', () => {
    const long = slugifyMediaTitle('a'.repeat(200));
    expect(long.length).toBeLessThanOrEqual(80);
  });
});

describe('youtubeIdFromUrl', () => {
  const ID = 'dQw4w9WgXcQ';
  it('accepts a raw 11-char id', () => {
    expect(youtubeIdFromUrl(ID)).toBe(ID);
  });

  it('parses watch URLs with and without www', () => {
    expect(youtubeIdFromUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeIdFromUrl(`https://youtube.com/watch?v=${ID}&t=42`)).toBe(ID);
  });

  it('parses shorts and embed URLs', () => {
    expect(youtubeIdFromUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(youtubeIdFromUrl(`https://www.youtube.com/embed/${ID}?rel=0`)).toBe(ID);
  });

  it('parses youtu.be links', () => {
    expect(youtubeIdFromUrl(`https://youtu.be/${ID}`)).toBe(ID);
  });

  it('rejects non-YouTube hosts and malformed ids', () => {
    expect(youtubeIdFromUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(youtubeIdFromUrl('https://www.youtube.com/watch?v=tooshort')).toBeNull();
    expect(youtubeIdFromUrl('')).toBeNull();
    expect(youtubeIdFromUrl('not a url at all')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats ISO-8601 durations like YouTube returns them', () => {
    expect(formatDuration('PT5M30S')).toBe('5:30');
    expect(formatDuration('PT1H2M3S')).toBe('1:02:03');
    expect(formatDuration('PT45S')).toBe('0:45');
  });

  it('returns null for unknown or zero durations (never fabricates)', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration('')).toBeNull();
    expect(formatDuration('PT0S')).toBeNull();
    expect(formatDuration('garbage')).toBeNull();
  });
});

describe('mapRowToMediaVideo + mediaThumbnail', () => {
  const row: CmsMediaRow = {
    id: 'v1',
    slug: 'how-salt-licks-are-made',
    youtube_video_id: 'dQw4w9WgXcQ',
    title: 'How Salt Licks Are Made',
    summary: 'A short intro.',
    description: 'A longer description.',
    seo_title: null,
    meta_description: null,
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    custom_thumbnail_url: 'https://luxedge.us/img/editorial-thumb.jpg',
    category: 'himalayan-salt',
    is_short: false,
    featured: true,
    published_at: '2026-09-01T12:00:00Z',
    duration: 'PT5M30S',
    transcript: null,
    chapters: [{ t: '0:00', title: 'Intro' }],
    tags: ['salt', 'horses'],
    related_product_ids: ['p1'],
    related_article_slugs: ['salt-guide'],
    related_video_slugs: ['another-video'],
    faq: [{ q: 'Q?', a: 'A.' }],
    status: 'published',
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
  };

  it('maps DB columns 1:1 without inventing values', () => {
    const v = mapRowToMediaVideo(row);
    expect(v.title).toBe('How Salt Licks Are Made');
    expect(v.youtubeVideoId).toBe('dQw4w9WgXcQ');
    expect(v.duration).toBe('PT5M30S');
    expect(v.chapters).toEqual([{ t: '0:00', title: 'Intro' }]);
    expect(v.faq).toEqual([{ q: 'Q?', a: 'A.' }]);
    expect(v.isShort).toBe(false);
    expect(v.featured).toBe(true);
  });

  it('custom editorial thumbnail wins; YouTube thumbnail is the fallback', () => {
    expect(mediaThumbnail(mapRowToMediaVideo(row))).toBe('https://luxedge.us/img/editorial-thumb.jpg');
    expect(mediaThumbnail({ ...mapRowToMediaVideo(row), customThumbnailUrl: null })).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    expect(mediaThumbnail({ customThumbnailUrl: null, thumbnailUrl: null, youtubeVideoId: 'dQw4w9WgXcQ' })).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    expect(mediaThumbnail({ customThumbnailUrl: null, thumbnailUrl: null, youtubeVideoId: null })).toBeNull();
  });

  it('drops malformed chapters instead of leaking them', () => {
    const dirty = mapRowToMediaVideo({ ...row, chapters: [{ t: '0:00', title: 'Ok' }, { junk: true }] });
    expect(dirty.chapters).toEqual([{ t: '0:00', title: 'Ok' }]);
  });
});