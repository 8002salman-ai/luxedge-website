import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ProductGallery, { galleryPhotos } from '../ProductGallery';

describe('product photo gallery', () => {
  it('deduplicates photos while preserving variant image indices', () => {
    expect(galleryPhotos(['a.jpg', 'a.jpg', '', 'b.jpg'])).toEqual([{ src: 'a.jpg', index: 0 }, { src: 'b.jpg', index: 3 }]);
  });
  it('excludes failed sources without inventing replacements', () => {
    expect(galleryPhotos(['a.jpg', 'b.jpg'], ['a.jpg'])).toEqual([{ src: 'b.jpg', index: 1 }]);
  });
  it('renders selected photo, thumbnails, accessible controls and native dialog', () => {
    const html = renderToStaticMarkup(<ProductGallery name="Dog boots" images={['a.jpg', 'b.jpg']} selected={1} onSelect={() => {}} />);
    expect(html).toContain('aria-label="View product photo 2" aria-pressed="true"');
    expect(html).toContain('aria-label="Enlarge product photo"');
    expect(html).toContain('aria-label="Close enlarged photo"');
    expect(html).toContain('<dialog');
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain('<h1');
  });
  it('shows a truthful empty state for a product without photos', () => {
    const html = renderToStaticMarkup(<ProductGallery name="Dog boots" images={[]} selected={0} onSelect={() => {}} />);
    expect(html).toContain('Product photo unavailable');
    expect(html).not.toContain('aria-label="Enlarge product photo"');
  });
  it('resolves a selected duplicate variant image to the matching visible thumbnail', () => {
    const html = renderToStaticMarkup(<ProductGallery name="Boots" images={['a.jpg', 'b.jpg', 'b.jpg']} selected={2} onSelect={() => {}} />);
    expect(html).toContain('aria-label="View product photo 2" aria-pressed="true"');
  });
});
