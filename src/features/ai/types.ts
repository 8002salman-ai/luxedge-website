// ============================================================================
// LUXEDGE V2 — AI FEATURE TYPES
//
// Security contract: provider configuration carried by the client contains
// NO API keys. Keys live only in server-side environment variables and are
// read by the /api/ai/* serverless functions.
// ============================================================================

export interface AIProvider {
  id: string;
  name: string;
  models: string[];
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface ImportHistoryEntry {
  id: string;
  source: string;
  sourceType: 'url' | 'html' | 'text' | 'clipboard' | 'image';
  date: string;
  provider: string;
  model: string;
  productTitle: string;
  status: 'success' | 'failed' | 'partial';
  importTime: number;
}

export interface AIExtractedProduct {
  title: string;
  luxuryTitle: string;
  seoTitle: string;
  slug: string;
  brand: string;
  manufacturer: string;
  category: string;
  subcategory: string;
  collection: string;
  shortDescription: string;
  longDescription: string;
  features: string[];
  benefits: string[];
  specifications: Record<string, string>;
  packageIncludes: string[];
  weight: string;
  dimensions: string;
  origin: string;
  materials: string[];
  colors: string[];
  sizes: string[];
  sku: string;
  barcode: string;
  hsCode: string;
  stock: number;
  costPrice: number;
  sellingPrice: number;
  comparePrice: number;
  shippingWeight: string;
  tags: string[];
  seoKeywords: string[];
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  images: string[];
  faqs: { q: string; a: string }[];
  warranty: string;
  careInstructions: string;
  safetyNotes: string;
  confidence: Record<string, number>;
}

export interface EnterpriseVariant {
  id: string;
  combo: Record<string, string>;
  sku: string;
  barcode: string;
  costPrice: number;
  sellingPrice: number;
  comparePrice: number;
  inventory: number;
  weight: string;
  dimensions: string;
  image: string;
  status: 'active' | 'inactive' | 'draft';
  lowStockThreshold: number;
}

export interface VariantAttribute {
  id: string;
  name: string;
  values: string[];
  autoDetected: boolean;
}

export interface SEOData {
  title: string;
  metaDescription: string;
  keywords: string[];
  slug: string;
  canonicalUrl: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  imageAlt: string;
  imageTitle: string;
  imageCaption: string;
}

export interface SocialSEO {
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterCard: string;
  twitterTitle: string;
  twitterDescription: string;
  pinterestDescription: string;
  pinterestImage: string;
}

export interface ContentData {
  premiumTitle: string;
  luxuryDescription: string;
  shortDescription: string;
  bulletFeatures: string[];
  specifications: Record<string, string>;
  benefits: string[];
  useCases: string[];
  careInstructions: string;
  packageContents: string[];
  warrantyText: string;
  shippingInfo: string;
  focusKeyword: string;
  faqs: { q: string; a: string }[];
}

export interface SEOScore {
  overall: number;
  readability: number;
  keywordDensity: number;
  metaLength: number;
  titleLength: number;
  missingAlt: number;
  issues: { type: 'error' | 'warning' | 'good'; msg: string }[];
}

export interface StructuredSchemas {
  product: string;
  breadcrumb: string;
  organization: string;
  website: string;
  faq: string;
}
