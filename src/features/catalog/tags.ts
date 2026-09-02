// ============================================================================
// Tolerant product tag / keyword parsing.
//
// Live `products.tags` and `products.seo_keywords` are heterogeneous: most rows
// store jsonb arrays, some CJ-import rows store comma-separated TEXT (e.g.
// "horse,grooming,brush,tack,equestrian"), and a few carry a JSON string array
// ('["a","b"]'). Every reader (storefront mapper, admin repository, CSV import)
// must normalize these identically — a strict array-only parser makes the
// string rows render tag-less and lets an admin edit silently wipe them.
// ============================================================================

/**
 * Normalize a tags/keywords value into a clean string array.
 *
 * Accepts a jsonb array, a JSON string array, or plain text separated by
 * commas / semicolons / pipes. Never throws: null/undefined/empty/non-string
 * values degrade to []. Elements are trimmed, empties dropped, and duplicates
 * removed (first occurrence wins, insertion order preserved). A value that
 * clearly intends a JSON array (starts with '[') but fails to parse also
 * degrades to [] — broken array data must never surface as junk tag text.
 */
export function parseTagList(v: unknown): string[] {
  if (Array.isArray(v)) return clean(v);
  if (typeof v !== 'string') return [];
  const s = v.trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) return clean(parsed);
    } catch {
      /* fall through to the empty result below */
    }
    return [];
  }
  return clean(s.split(/[,;|]+/));
}

function clean(items: unknown[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}