// ============================================================================
// LUXEDGE — PUBLIC READ SELECT ↔ MIGRATION SCHEMA CONTRACT
//
// PostgREST rejects an explicit `select` with a 400 when ANY named column does
// not exist on the table — and the whole QUERY fails, not just the column. This
// happened once: the storefront catalog select named title/description/
// price_amount/compare_at_amount/image_url, so loadStorefrontCatalog() returned
// null and the shop silently rendered "0 products" while every other page
// worked. No error surfaced anywhere.
//
// This test makes that contract permanent for BOTH read paths: the client
// storefront selects (src/services/catalog.ts, src/services/blog.ts) and the
// worker SSR/sitemap selects (worker/selects.ts, consumed by worker/seo-meta.ts
// and worker/sitemap.ts). Every column referenced MUST exist — on the
// migration-defined schema (supabase/migrations/*.sql is the base source of
// truth) OR in the documented live-verified out-of-band set below. A missing
// column fails loudly with its `table.column` name and the referencing file.
//
// Derivation note: the parser is intentionally small and verified against the
// actual migration files (0001/0004/0010/0016/0022 …) rather than a full SQL
// grammar — it reads CREATE TABLE column lines by type keyword and attributes
// every `add column if not exists` to its nearest preceding `alter table`.
// It is NOT a general SQL parser; when a new migration uses a different DDL
// shape, extend the parser alongside it and re-verify against the live DB.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  CATEGORIES_PUBLIC_SELECT,
  PRODUCTS_PUBLIC_SELECT,
  PRODUCT_IMAGES_PUBLIC_SELECT,
  PRODUCT_VARIANTS_PUBLIC_SELECT,
  COUPONS_PUBLIC_SELECT,
  STORE_SETTINGS_PUBLIC_SELECT,
} from '../catalog';
import { BLOG_LIST_PUBLIC_SELECT, BLOG_DETAIL_PUBLIC_SELECT } from '../blog';
import { MEDIA_LIST_PUBLIC_SELECT } from '../media';
import {
  SEO_PRODUCTS_SELECT,
  SEO_CATEGORIES_SELECT,
  SEO_BLOG_POSTS_SELECT,
  SEO_MEDIA_SELECT,
  SITEMAP_PRODUCTS_SELECT,
  SITEMAP_CATEGORIES_SELECT,
  SITEMAP_BLOG_POSTS_SELECT,
  SITEMAP_MEDIA_SELECT,
} from '../../../worker/selects';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

type Schema = Record<string, Set<string>>;

/** Column definitions from CREATE TABLE blocks + ALTER TABLE ... ADD COLUMN. */
function parseMigrationSchema(): Schema {
  const tables: Schema = {};
  const ensure = (t: string): Set<string> => (tables[t] ||= new Set<string>());

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');

    // CREATE TABLE if not exists public.<table> ( <columns> );
    // A column line is an identifier immediately followed by a known type.
    const TYPE = /\b(text|varchar|character|uuid|numeric|integer|bigint|smallint|serial|bigserial|boolean|bool|jsonb|json|timestamp|timestamptz|date|time|interval|double|real|decimal|bytea)\b/i;
    for (const m of sql.matchAll(/create table if not exists (?:public\.)?([a-z_0-9]+)\s*\(/gi)) {
      const start = (m.index ?? 0) + m[0].length;
      const block = sql.slice(start, start + 20000);
      const end = block.indexOf(');');
      for (const line of (end >= 0 ? block.slice(0, end) : block).split(/\r?\n/)) {
        const col = line.trim().match(/^([a-z_]\w*)\s+/);
        if (col && TYPE.test(line)) ensure(m[1]).add(col[1]);
      }
    }

    // ALTER TABLE ... ADD COLUMN — attribute each added column to the nearest
    // preceding `alter table` (handles single-line and DO-block multi-line DDL).
    const alters = [...sql.matchAll(/alter table (?:public\.)?([a-z_0-9]+)/gi)];
    const adds = [...sql.matchAll(/add column if not exists ([a-z_0-9]+)/gi)];
    for (const a of adds) {
      const pos = a.index ?? 0;
      let table: string | null = null;
      for (const al of alters) {
        if ((al.index ?? 0) < pos) table = al[1];
        else break;
      }
      if (table) ensure(table).add(a[1]);
    }
  }
  return tables;
}

const schema = parseMigrationSchema();

// ============================================================================
// LIVE-VERIFIED OUT-OF-BAND COLUMNS — TEMPORARY BRIDGE ONLY
//
// supabase/migrations/*.sql is the source of truth. The columns that once
// existed live but not in a migration (products.title/description/
// compare_at_amount/image_url, product_images.public_url — live-verified
// HTTP 200 via the anon key on 2026-09-01) were reconciled into migration
// 0025, so this set must be EMPTY. products.price_amount was verified absent
// (HTTP 400, PostgreSQL 42703) and is correctly NOT reconciled — it is the
// real root cause pinned by the bug-class guard below.
//
// Future out-of-band additions: do NOT leave an entry here. The rule is to
// commit the reconciling ALTER TABLE ... ADD COLUMN IF NOT EXISTS migration in
// the SAME PR (the migration need not be applied live yet — the parser reads
// the file, and IF NOT EXISTS makes it a safe no-op on live). The empty-set
// assertion below enforces that rule.
// ============================================================================
const LIVE_VERIFIED_EXTRA_COLUMNS: Record<string, ReadonlySet<string>> = {};

function isKnownColumn(table: string, col: string): boolean {
  return schema[table]?.has(col) === true || LIVE_VERIFIED_EXTRA_COLUMNS[table]?.has(col) === true;
}

/** Split a select string on commas at depth 0 (paren-aware), so embedded
 * relations with several columns, e.g. `product_images(url,public_url,is_primary)`,
 * parse as one token instead of shattering on the inner commas. */
function splitTopLevel(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of select) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** Flatten a select string into [table, column] references, resolving nested
 * embeds like `categories(name)` against the relation table. */
function columnRefs(table: string, select: string): Array<readonly [string, string]> {
  const refs: Array<readonly [string, string]> = [];
  for (const raw of splitTopLevel(select)) {
    const token = raw.trim();
    if (!token) continue;
    const embed = token.match(/^([a-z_]\w*)\((.*)\)$/);
    if (embed) {
      for (const c of embed[2].split(',')) {
        const col = c.trim();
        if (col) refs.push([embed[1], col]);
      }
    } else {
      refs.push([table, token]);
    }
  }
  return refs;
}

const SELECT_CONTRACTS: Array<readonly [table: string, select: string, source: string]> = [
  // Client storefront reads (src/services/)
  ['categories', CATEGORIES_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['products', PRODUCTS_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['product_images', PRODUCT_IMAGES_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['product_variants', PRODUCT_VARIANTS_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['coupons', COUPONS_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['store_settings', STORE_SETTINGS_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['blog_posts', BLOG_LIST_PUBLIC_SELECT, 'src/services/blog.ts'],
  ['blog_posts', BLOG_DETAIL_PUBLIC_SELECT, 'src/services/blog.ts'],
  ['media_videos', MEDIA_LIST_PUBLIC_SELECT, 'src/services/media.ts'],
  // Worker SSR + sitemap reads (constants in worker/selects.ts, consumed by
  // worker/seo-meta.ts and worker/sitemap.ts). Same 400 class: a silent
  // PostgREST error here kills prerendered product pages or empties the
  // sitemap — the AdSense-relevant SEO surface.
  ['products', SEO_PRODUCTS_SELECT, 'worker/seo-meta.ts'],
  ['categories', SEO_CATEGORIES_SELECT, 'worker/seo-meta.ts'],
  ['blog_posts', SEO_BLOG_POSTS_SELECT, 'worker/seo-meta.ts'],
  ['media_videos', SEO_MEDIA_SELECT, 'worker/seo-meta.ts'],
  ['products', SITEMAP_PRODUCTS_SELECT, 'worker/sitemap.ts'],
  ['categories', SITEMAP_CATEGORIES_SELECT, 'worker/sitemap.ts'],
  ['blog_posts', SITEMAP_BLOG_POSTS_SELECT, 'worker/sitemap.ts'],
  ['media_videos', SITEMAP_MEDIA_SELECT, 'worker/sitemap.ts'],
  ['media_videos', `${SITEMAP_MEDIA_SELECT},title,youtube_video_id,thumbnail_url,custom_thumbnail_url,published_at,duration`, 'worker/sitemap.ts (video sitemap)'],
];

describe('public-read selects match the migration schema', () => {
  it('parses the migration files into a non-trivial schema (parser sanity)', () => {
    // products = 31 (0001 base) + 24 (0010) + 7 (0016) + 0020/0021 extras ≈ 68.
    expect(schema.products?.size ?? 0).toBeGreaterThan(60);
    expect(schema.product_images?.size ?? 0).toBeGreaterThan(4);
    expect(schema.blog_posts?.size ?? 0).toBeGreaterThan(10);
    expect(schema.coupons?.size ?? 0).toBeGreaterThan(5);
    expect(schema.media_videos?.size ?? 0).toBeGreaterThan(15);
  });

  it('the live-verified bridge stays empty — out-of-band columns must be reconciled into a migration in the same PR', () => {
    // Migration 0025 reconciled the former entries; any future entry means a
    // select depends on a live column the repo schema cannot account for.
    // Commit the reconciling ADD COLUMN IF NOT EXISTS migration alongside it
    // (parser reads the file; IF NOT EXISTS is a no-op on live) instead.
    expect(LIVE_VERIFIED_EXTRA_COLUMNS).toEqual({});
  });

  it('every select column exists on its table — fails loudly with the named column', () => {
    const missing: string[] = [];
    for (const [table, select, source] of SELECT_CONTRACTS) {
      for (const [refTable, col] of columnRefs(table, select)) {
        if (!isKnownColumn(refTable, col)) {
          missing.push(
            `${refTable}.${col} — referenced by ${source} but not defined in supabase/migrations/*.sql`,
          );
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('client products select must NOT regain the column that 400-d the live query (bug-class guard)', () => {
    // The pre-fix select named title/description/price_amount/compare_at_amount/
    // image_url. Live probes (2026-09-01) proved ONLY products.price_amount is
    // genuinely absent (PostgreSQL 42703 — see LIVE_VERIFIED_EXTRA_COLUMNS);
    // the other four EXIST on the live table and are safe to fetch, so they do
    // not belong in a forbidden list. The schema contract above governs the
    // rest; this guard pins the real root-cause column so the whole pre-fix
    // select can never be blindly restored from git history.
    const cols = PRODUCTS_PUBLIC_SELECT.split(',').map((s) => s.trim());
    expect(cols).not.toContain('price_amount');
  });
});