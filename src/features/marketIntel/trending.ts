// ============================================================================
// LUXEDGE — TRENDING PET PRODUCTS (merge + dedupe)
//
// Sources: Google Trends rising, Amazon Movers & Shakers / Best Sellers, eBay
// market research, supplier database. AI-normalized + deterministic dedupe:
// "dog grooming vacuum" and "pet grooming vacuum cleaner" may be one family;
// genuinely different items are never merged.
// ============================================================================

import type { TrendingPetProduct } from './types';

/** Deterministic keyword family key — normalized tokens in sorted order. */
export function familyKey(keyword: string): string {
  const tokens = keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 3)
    // Functional stopwords that don't change the product family.
    .filter((t) => !['pet', 'dog', 'cat', 'for', 'the', 'with', 'and', 'best', 'top', 'new', 'your', 'free'].includes(t));
  return [...new Set(tokens)].sort().join('|');
}

export interface MergeInput {
  keyword: string;
  source: string;
  trendDirection?: TrendingPetProduct['trendDirection'];
  trendScore?: number | null;
  opportunityScore?: number | null;
  confidence?: number | null;
}

/**
 * Merge a batch of discovered keywords into trending product families.
 * Deterministic family matching by shared tokens: two keywords are the same
 * family when one's significant tokens are a subset of the other's (or they
 * share >= 2 significant tokens). "dog grooming vacuum" + "pet grooming
 * vacuum cleaner" merge; "cat water fountain" stays separate. AI
 * normalization can be layered on top but never merges disjoint families.
 */
export function mergeTrending(inputs: MergeInput[]): TrendingPetProduct[] {
  const families: { key: string; tokens: string[]; product: TrendingPetProduct }[] = [];
  for (const item of inputs) {
    const tokens = familyKey(item.keyword).split('|').filter(Boolean);
    if (!tokens.length) continue;
    const existing = families.find((f) => {
      const shared = f.tokens.filter((t) => tokens.includes(t)).length;
      const subset = tokens.every((t) => f.tokens.includes(t)) || f.tokens.every((t) => tokens.includes(t));
      return shared >= 2 || (subset && shared >= 1);
    });
    if (existing) {
      existing.product.aliases.push(item.keyword);
      if (!existing.product.sources.includes(item.source)) existing.product.sources.push(item.source);
      continue;
    }
    const product: TrendingPetProduct = {
      keyword: item.keyword,
      aliases: [],
      sources: [item.source],
      trendDirection: item.trendDirection ?? 'INSUFFICIENT_DATA',
      trendScore: item.trendScore ?? null,
      opportunityScore: item.opportunityScore ?? null,
      confidence: item.confidence ?? null,
      verdict: null,
    };
    families.push({ key: tokens.join('|'), tokens, product });
  }
  return families.map((f) => f.product);
}
