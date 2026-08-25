// Extract published blog posts from INIT_BLOGS (src/App.tsx) into
// public/blog-seo.json so the Cloudflare Worker can inject per-post
// server-side SEO meta (title/description/canonical/BlogPosting JSON-LD)
// for crawlers — the blog content itself stays in the frontend bundle.
//
// Usage: node scripts/extract-blog-seo.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');

// INIT_BLOGS entries are written one-per-line as:
//   { id:'b1', slug:'...', title:'...', excerpt:'...', ... status:'published', date:'...' },
const LINE_RE = /\{\s*id:'([^']*)',\s*slug:'([^']*)',\s*title:'((?:[^'\\]|\\.)*)',\s*excerpt:'((?:[^'\\]|\\.)*)',/g;

const unescapeJs = (s) =>
  s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');

const posts = [];
let m;
while ((m = LINE_RE.exec(src)) !== null) {
  const [, id, slug, title, excerpt] = m;
  // Find status/date/author within the same line (stops at the line's closing brace).
  const lineEnd = src.indexOf('}', m.index);
  const line = src.slice(m.index, lineEnd);
  const status = line.match(/status:'([^']*)'/)?.[1] || 'published';
  const date = line.match(/date:'([^']*)'/)?.[1] || '';
  const authorName = line.match(/authorName:'([^']*)'/)?.[1] || '';
  const image = line.match(/image:'((?:[^'\\]|\\.)*)'/)?.[1] || '';
  if (status !== 'published') continue;
  posts.push({
    id,
    slug,
    title: unescapeJs(title),
    excerpt: unescapeJs(excerpt),
    image: unescapeJs(image),
    date,
    authorName,
  });
}

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
