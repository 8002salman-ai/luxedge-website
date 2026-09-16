import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * An article's inline images ARE its content, so `alt=""` hides them from a
 * screen reader and leaves the post with no image description. The public
 * article page shipped exactly that, and a real browser QA run caught it on the
 * fly-mask guide at every width — it was the only genuine missing-alt image on
 * the site (the other empty alts are the product card's hover duplicate and the
 * gallery thumbnail, both decorative inside a labelled control).
 *
 * This pins the public path. The admin write form's own cover/thumbnail previews
 * are deliberately alt-less decoration inside a form control, not public copy.
 */
const blog = readFileSync(resolve(process.cwd(), 'src/pages/BlogPages.tsx'), 'utf8');

describe('public blog image alt text', () => {
  it('describes the article inline images instead of hiding them', () => {
    expect(blog).not.toMatch(/post\.images\.map\(\(img, i\) => <img[^>]*alt=""/);
    expect(blog).toMatch(/post\.images\.map\(\(img, i\) => \(\s*<img[^>]*alt=\{`\$\{post\.title\} — image \$\{i \+ 1\}`\}/);
  });

  it('keeps a real alt on the article hero and related-post thumbnails', () => {
    // Both go through BlogImage/Cover with an explicit alt already; this guards
    // against a refactor quietly dropping it.
    expect(blog).toMatch(/<BlogImage\s+src=\{post\.image\}\s+alt=\{post\.title\}/);
    expect(blog).toMatch(/<BlogImage\s+src=\{r\.image\}\s+alt=\{r\.title\}/);
  });
});
