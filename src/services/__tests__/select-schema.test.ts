// ============================================================================
// LUXEDGE — PUBLIC READ SELECT ↔ MIGRATION SCHEMA CONTRACT
//
// PostgREST rejects an explicit `select` with a 400 when ANY named column does
// not exist on the table — and the whole QUERY fails, not just the column. This
// happened once: the storefront catalog select named title/description/
// price_amount/compare_at_amount/image_url (never added to public.products), so
// loadStorefrontCatalog() returned null and the shop silently rendered
// "0 products" while every other page worked. No error surfaced anywhere.
//
// This test makes that contract permanent: every column referenced by the
// exported public-read selects MUST exist in the migration-defined schema
// (supabase/migrations/*.sql is the source of truth). A missing column fails
// loudly with its `table.column` name.
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

const SELECT_CONTRACTS: Array<readonly [table: string, select: string, source: string]> = [
  ['categories', CATEGORIES_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['products', PRODUCTS_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['product_images', PRODUCT_IMAGES_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['product_variants', PRODUCT_VARIANTS_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['coupons', COUPONS_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['store_settings', STORE_SETTINGS_PUBLIC_SELECT, 'src/services/catalog.ts'],
  ['blog_posts', BLOG_LIST_PUBLIC_SELECT, 'src/services/blog.ts'],
  ['blog_posts', BLOG_DETAIL_PUBLIC_SELECT, 'src/services/blog.ts'],
];

describe('public-read selects match the migration schema', () => {
  it('parses the migration files into a non-trivial schema (parser sanity)', () => {
    // products = 31 (0001 base) + 24 (0010) + 7 (0016) + 0020/0021 extras ≈ 68.
    expect(schema.products?.size ?? 0).toBeGreaterThan(60);
    expect(schema.product_images?.size ?? 0).toBeGreaterThan(4);
    expect(schema.blog_posts?.size ?? 0).toBeGreaterThan(10);
    expect(schema.coupons?.size ?? 0).toBeGreaterThan(5);
  });

  it('every select column exists on its table — fails loudly with the named column', () => {
    const missing: string[] = [];
    for (const [table, select, source] of SELECT_CONTRACTS) {
      for (const raw of select.split(',')) {
        const col = raw.trim();
        if (col && !schema[table]?.has(col)) {
          missing.push(`${table}.${col} — referenced by ${source} but not defined in supabase/migrations/*.sql`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('products select must NOT regain the columns that 400-d the live query (bug-class guard)', () => {
    // These were never columns on public.products; a stray re-add inside the
    // select makes PostgREST reject the whole query → the shop silently empties.
    // Structure of the migration schema keeps them out; this guard stops a
    // future edit from silently sliding them back INTO the select.
    const cols = PRODUCTS_PUBLIC_SELECT.split(',').map((s) => s.trim());
    for (const forbidden of ['title', 'description', 'price_amount', 'compare_at_amount', 'image_url', 'public_url']) {
      expect(cols).not.toContain(forbidden);
    }
  });
});