// Compact executable contract for the blog CMS mapping (Phase G/H):
// a DB row maps to the storefront BlogPost shape exactly as documented, with
// status/lifecycle/date/FAQ behavior the storefront + schema rely on. Plus a
// regression test that the PUBLIC read never leaks drafts — even when the
// shared adapter still holds a signed-in admin JWT from a prior admin op.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mapRowToBlogPost, loadPublishedBlogs, type CmsBlogRow } from '../blog';
import { getDb, resetDbForTests, __setDbConfigForTests } from '../db';

const base: CmsBlogRow = {
  id: 'a1b2',
  slug: 'horse-salt-lick-buyers-guide',
  title: 'Himalayan Salt Lick for Horses',
  excerpt: 'How long it lasts & how to pick one.',
  content: 'Factual buyer guidance.',
  hero_image_url: 'https://img.example/horse.jpg',
  hero_image_alt: 'Salt lick for horses',
  tags: ['horse', 'salt'],
  author_name: 'Salman',
  author_id: 'uuid-1',
  status: 'published',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  published_at: '2026-08-01T00:00:00Z',
  scheduled_at: null,
  faq: [{ q: 'How long does it last?', a: 'Weeks to months for one horse.' }],
};

describe('mapRowToBlogPost', () => {
  it('maps published rows to published posts preserving slug/content/faq', () => {
    const p = mapRowToBlogPost(base);
    expect(p.id).toBe('a1b2');
    expect(p.slug).toBe('horse-salt-lick-buyers-guide');
    expect(p.title).toBe('Himalayan Salt Lick for Horses');
    expect(p.excerpt).toBe(base.excerpt);
    expect(p.content).toBe(base.content);
    expect(p.status).toBe('published');
    expect(p.image).toBe(base.hero_image_url);
    expect(p.images).toEqual([base.hero_image_url]);
    expect(p.tags).toEqual(['horse', 'salt']);
    expect(p.authorName).toBe('Salman');
    expect(p.faq).toEqual(base.faq);
  });

  it('uses the published date and falls back to created_at when no date_label', () => {
    expect(mapRowToBlogPost(base).date).toBe('2026-08-01');
    const noPublished = { ...base, published_at: null };
    expect(mapRowToBlogPost(noPublished).date).toBe('2026-08-01'); // created_at
    const withLabel = { ...base, date_label: '2025-03-10' };
    expect(mapRowToBlogPost(withLabel).date).toBe('2025-03-10');
  });

  it('derives storefront status from lifecycle (published/scheduled/draft/archived)', () => {
    expect(mapRowToBlogPost({ ...base, status: 'published' }).status).toBe('published');
    expect(mapRowToBlogPost({ ...base, status: 'scheduled' }).status).toBe('pending');
    expect(mapRowToBlogPost({ ...base, status: 'draft' }).status).toBe('draft');
    expect(mapRowToBlogPost({ ...base, status: 'archived' }).status).toBe('draft');
  });

  it('omits FAQ when empty and defaults author/image gracefully', () => {
    const row: CmsBlogRow = {
      ...base,
      hero_image_url: null,
      author_name: null,
      faq: [],
    };
    const p = mapRowToBlogPost(row);
    expect(p.image).toBe('');
    expect(p.images).toEqual([]);
    expect(p.authorName).toBe('Luxedge');
    expect(p.faq).toBeUndefined();
  });
});

describe('loadPublishedBlogs — draft leak regression', () => {
  beforeEach(() => {
    resetDbForTests();
    __setDbConfigForTests({ url: 'https://x.supabase.co', anonKey: 'anon-key' });
  });
  afterEach(() => {
    resetDbForTests();
    __setDbConfigForTests(undefined);
    vi.unstubAllGlobals();
  });

  it('runs as ANON (clears a sticky admin JWT) and requests status=published, so drafts cannot leak', async () => {
    // Server-side RLS, given an anon request, returns published rows only —
    // that is what the storefront receives.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([base]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // Simulate a prior admin operation: the shared adapter still holds the
    // signed-in admin JWT (the exact condition that leaked drafts on mobile).
    (getDb() as unknown as { setAccessToken: (t: string | null) => void }).setAccessToken('admin-jwt');

    const posts = await loadPublishedBlogs();

    // The request must carry NO admin Authorization header (RLS then applies
    // the published-only policy), and must filter status=published explicitly
    // so even a role regression cannot leak a draft.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(url).toContain('status=eq.published');

    expect(posts).not.toBeNull();
    expect(posts!.map((p) => p.status)).toEqual(['published']);
    expect(posts!.map((p) => p.slug)).toEqual(['horse-salt-lick-buyers-guide']);
  });

  it('clears the sticky token so a LATER public read is also anon', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([base]), { status: 200 })));
    (getDb() as unknown as { setAccessToken: (t: string | null) => void }).setAccessToken('admin-jwt');

    await loadPublishedBlogs();

    // After the public read the token must be gone — a second read sends no
    // Authorization header either.
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([base]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await loadPublishedBlogs();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});