// Compact executable contract for the blog CMS mapping (Phase G/H):
// a DB row maps to the storefront BlogPost shape exactly as documented, with
// status/lifecycle/date/FAQ behavior the storefront + schema rely on.
import { describe, it, expect } from 'vitest';
import { mapRowToBlogPost, type CmsBlogRow } from '../blog';

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