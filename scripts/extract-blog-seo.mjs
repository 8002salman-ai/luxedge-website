// Extract published blog posts from INIT_BLOGS (src/App.tsx) into
// public/blog-seo.json so the Cloudflare Worker can inject per-post
// server-side SEO meta (title/description/canonical/BlogPosting + FAQPage
// JSON-LD) for crawlers — the blog content itself stays in the frontend
// bundle.
//
// Usage: node scripts/extract-blog-seo.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');

// The INIT_BLOGS array is plain JS object literals. Extract the array literal
// and evaluate it directly — robust against nested FAQ `{ q, a }` objects,
// apostrophes inside content, and `];` sequences inside strings.
const start = src.indexOf('const INIT_BLOGS');
// Skip the `BlogPost[]` type annotation and anchor on the `[` after ` = `.
const assign = src.indexOf('= [', start);
const arrOpen = assign >= 0 ? assign + 2 : src.indexOf('[', start);
if (arrOpen < 0 || src[arrOpen] !== '[') {
  console.error('extract-blog-seo: could not locate INIT_BLOGS array');
  process.exit(1);
}
// End the slice at the next top-level declaration.
const after = src.indexOf('export const CAT_LIST', start);
const slice = after > arrOpen ? src.slice(arrOpen, after) : src.slice(arrOpen, src.indexOf('];', arrOpen) + 2);
// Trim trailing `;` (and whitespace) so the slice is a bare array literal.
const arrLiteral = slice.replace(/;\s*$/, '').trim();

let postsSource;
try {
  // eslint-disable-next-line no-new-func
  postsSource = new Function(`return ${arrLiteral}`)();
} catch (err) {
  console.error('extract-blog-seo: failed to evaluate INIT_BLOGS:', err.message);
  process.exit(1);
}
if (!Array.isArray(postsSource)) {
  console.error('extract-blog-seo: INIT_BLOGS did not evaluate to an array');
  process.exit(1);
}

// Extract the article's REAL, visible internal links ([label](/path) markdown in
// the body) so the worker can expose them in crawler-delivered HTML. These are
// the same links the client renders — never schema-only or hidden.
function extractInternalLinks(content = '') {
  const seen = new Set();
  const links = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const href = m[2];
    if (!/^\/(blog|category|product)\//.test(href)) continue; // same-domain content links only
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ label: m[1].replace(/\s+/g, ' ').trim(), href });
  }
  return links;
}

const posts = postsSource
  .filter((p) => p && p.status === 'published' && p.slug)
  .map((p) => {
    const links = extractInternalLinks(p.content || '');
    return {
      id: p.id,
      slug: p.slug,
      title: p.title || p.slug,
      excerpt: p.excerpt || p.title || '',
      image: p.image || undefined,
      date: p.date || undefined,
      authorName: p.authorName || undefined,
      ...(links.length ? { links } : {}),
      ...(Array.isArray(p.faq) && p.faq.length ? { faq: p.faq } : {}),
    };
  });

// Guard: we must have a sane number of published posts, otherwise fail loudly
// instead of silently writing an empty registry.
if (posts.length < 10) {
  console.error(`extract-blog-seo: expected >=10 published posts, got ${posts.length} — aborting.`);
  process.exit(1);
}

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  posts,
};

const outPath = path.join(root, 'public', 'blog-seo.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`extract-blog-seo: wrote ${posts.length} published posts -> ${outPath}`);