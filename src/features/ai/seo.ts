// ============================================================================
// LUXEDGE — SHARED ONE-CLICK AI SEO (products + blog)
//
// Single generate+parse path for the "Auto SEO" buttons: runs a factual-SEO
// prompt through the configured provider chain via the secure server proxy
// (/api/ai/generate — the same proven route the product SEO tab uses), then
// extracts the JSON object. Callers map the fields onto their own entities
// (CatalogProduct or blog_posts) and save.
// ============================================================================
import { callAIProvider } from './client';
import { loadAIProviders } from './providers';

export interface SeoJson {
  seoTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  seoKeywords?: string[];
  slug?: string;
  targetKeyword?: string;
  secondaryKeywords?: string[];
  searchIntent?: string;
}

export async function generateSeoJson(prompt: string): Promise<SeoJson> {
  const text = await callAIProvider(
    prompt,
    loadAIProviders(),
    undefined,
    'You write honest, factual ecommerce SEO. Never invent claims, prices or reviews.',
  );
  const obj = text.match(/(\{[\s\S]*\})/);
  const parsed = obj ? JSON.parse(obj[1]) : null;
  if (!parsed || typeof parsed !== 'object') throw new Error('AI returned no usable SEO JSON');
  return parsed as SeoJson;
}