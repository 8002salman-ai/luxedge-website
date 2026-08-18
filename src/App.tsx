import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import MarketingManager from './components/MarketingManager';
import AdSenseAd from './components/AdSenseAd';
import CookieConsent from './components/CookieConsent';
import { trackEvent, utmParams } from './lib/marketing';
import { useAuthStore } from './store/authStore';
import {
  ShoppingBag, Menu, X, Search, User as UserIcon, LogOut, Package,
  Shield, Star, Truck, RotateCcw, Zap, ArrowRight, Mail, Phone,
  MapPin, Plus, Minus, Trash2, Lock, Loader2, CheckCircle, CreditCard,
  LayoutDashboard, AlertTriangle, Eye,
  ChevronDown, ChevronRight, ArrowLeft, Upload,
  Globe, Clock, Send, Headphones, Sparkles,
  PenLine, Calendar, Tag, BookOpen, EyeOff,
  Moon, Heart, SlidersHorizontal,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================
export interface ProductVariant {
  id: string; color: string; size: string; price: number; salePrice: number;
  stock: number; sku: string; image?: string;
}
export interface Product {
  id: string; name: string; shortDesc: string; description: string; price: number;
  originalPrice: number; category: string; stock: number;
  images: string[]; rating: number; reviews: number; isActive: boolean;
  brand: string; condition: string; tags: string[];
  weight: string; dimensions: string; origin: string;
  freeShipping: boolean; shippingCost: string;
  variants: ProductVariant[];
}
interface CartItem { product: Product; quantity: number; }
interface AppUser { id: string; email: string; password: string; name: string; role: 'admin' | 'buyer'; isBlocked?: boolean; joined?: string; }
export interface Order {
  id: string; userId: string; userName: string; items: CartItem[];
  total: number; status: string; date: string; address?: string;
}
export interface Review {
  id: string; productId: string; productName: string; userName: string;
  rating: number; comment: string; status: 'pending' | 'approved' | 'rejected';
  date: string;
}
export interface AdminCategory { id: string; name: string; isActive: boolean; subs: { id: string; name: string; isActive: boolean; }[]; }
export interface BlogPost {
  id: string; slug: string; title: string; excerpt: string; content: string;
  image: string; images: string[]; tags: string[];
  authorId: string; authorName: string;
  status: 'published' | 'draft' | 'pending';
  date: string;
}


// ============================================================================
// AI IMPORT ENGINE — TYPES & CONSTANTS
// ============================================================================
export interface AIProvider {
  id: string; name: string; models: string[]; defaultModel: string;
  apiKey: string; enabled: boolean; isDefault: boolean;
}
export interface ImportHistoryEntry {
  id: string; source: string; sourceType: 'url'|'html'|'text'|'clipboard'|'image';
  date: string; provider: string; model: string; productTitle: string;
  status: 'success'|'failed'|'partial'; importTime: number;
}
export interface AIExtractedProduct {
  title: string; luxuryTitle: string; seoTitle: string; slug: string;
  brand: string; manufacturer: string; category: string; subcategory: string;
  collection: string; shortDescription: string; longDescription: string;
  features: string[]; benefits: string[]; specifications: Record<string,string>;
  packageIncludes: string[]; weight: string; dimensions: string; origin: string;
  materials: string[]; colors: string[]; sizes: string[];
  sku: string; barcode: string; hsCode: string;
  stock: number; costPrice: number; sellingPrice: number; comparePrice: number;
  shippingWeight: string; tags: string[]; seoKeywords: string[];
  metaTitle: string; metaDescription: string; focusKeyword: string;
  images: string[]; faqs: {q:string;a:string}[];
  warranty: string; careInstructions: string; safetyNotes: string;
  confidence: Record<string,number>;
}
export interface EnterpriseVariant {
  id: string; combo: Record<string,string>;
  sku: string; barcode: string; costPrice: number; sellingPrice: number;
  comparePrice: number; inventory: number; weight: string; dimensions: string;
  image: string; status: 'active'|'inactive'|'draft'; lowStockThreshold: number;
}
export interface VariantAttribute {
  id: string; name: string; values: string[]; autoDetected: boolean;
}
export interface SEOData {
  title: string; metaDescription: string; keywords: string[];
  slug: string; canonicalUrl: string; focusKeyword: string;
  secondaryKeywords: string[]; imageAlt: string; imageTitle: string; imageCaption: string;
}
export interface SocialSEO {
  ogTitle: string; ogDescription: string; ogImage: string;
  twitterCard: string; twitterTitle: string; twitterDescription: string;
  pinterestDescription: string; pinterestImage: string;
}
export interface ContentData {
  premiumTitle: string; luxuryDescription: string; shortDescription: string;
  bulletFeatures: string[]; specifications: Record<string,string>;
  benefits: string[]; useCases: string[]; careInstructions: string;
  packageContents: string[]; warrantyText: string; shippingInfo: string;
  focusKeyword: string;
  faqs: { q: string; a: string }[];
}
export interface SEOScore {
  overall: number; readability: number; keywordDensity: number;
  metaLength: number; titleLength: number; missingAlt: number;
  issues: { type: 'error'|'warning'|'good'; msg: string }[];
}
export interface StructuredSchemas {
  product: string; breadcrumb: string; organization: string; website: string; faq: string;
}

const DEFAULT_AI_PROVIDERS: AIProvider[] = [
  { id:'openrouter', name:'OpenRouter', models:['google/gemini-2.0-flash-exp:free','meta-llama/llama-3.1-8b-instruct:free','mistralai/mistral-7b-instruct:free','gpt-4o-mini'], defaultModel:'google/gemini-2.0-flash-exp:free', apiKey:'', enabled:true, isDefault:false },
  { id:'gemini', name:'Google Gemini', models:['gemini-2.0-flash-exp','gemini-1.5-flash','gemini-1.5-pro'], defaultModel:'gemini-2.0-flash-exp', apiKey:'', enabled:true, isDefault:false },
  { id:'deepseek', name:'DeepSeek', models:['deepseek-chat','deepseek-reasoner'], defaultModel:'deepseek-chat', apiKey:'', enabled:true, isDefault:false },
  { id:'openai', name:'OpenAI', models:['gpt-4o-mini','gpt-4o','gpt-3.5-turbo'], defaultModel:'gpt-4o-mini', apiKey:'', enabled:true, isDefault:true },
  { id:'anthropic', name:'Anthropic Claude', models:['claude-haiku-4-5-20251001','claude-sonnet-4-6','claude-opus-4-8'], defaultModel:'claude-haiku-4-5-20251001', apiKey:'', enabled:true, isDefault:false },
];

// ── AI provider API calls (provider-independent) ──────────────────────────
async function _callOpenAI(prompt: string, p: AIProvider): Promise<string> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${p.apiKey}`},
    body:JSON.stringify({model:p.defaultModel,messages:[{role:'user',content:prompt}],temperature:0.2,max_tokens:4096})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||`OpenAI error ${r.status}`);
  return d.choices[0].message.content;
}
async function _callGemini(prompt: string, p: AIProvider): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.defaultModel}:generateContent?key=${p.apiKey}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:4096}})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||`Gemini error ${r.status}`);
  return d.candidates[0].content.parts[0].text;
}
async function _callOpenRouter(prompt: string, p: AIProvider): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${p.apiKey}`,'HTTP-Referer':'https://luxedge.us','X-Title':'Luxedge Admin'},
    body:JSON.stringify({model:p.defaultModel,messages:[{role:'user',content:prompt}],temperature:0.2})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||`OpenRouter error ${r.status}`);
  return d.choices[0].message.content;
}
async function _callAnthropic(prompt: string, p: AIProvider): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':p.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({model:p.defaultModel,max_tokens:4096,messages:[{role:'user',content:prompt}]})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||`Anthropic error ${r.status}`);
  return d.content[0].text;
}
async function _callDeepSeek(prompt: string, p: AIProvider): Promise<string> {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${p.apiKey}`},
    body:JSON.stringify({model:p.defaultModel,messages:[{role:'user',content:prompt}],temperature:0.2,max_tokens:4096})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||`DeepSeek error ${r.status}`);
  return d.choices[0].message.content;
}

export async function callAIProvider(prompt: string, providers: AIProvider[], onProgress?: (m:string)=>void): Promise<string> {
  const active = providers.filter(p => p.enabled && p.apiKey.trim());
  if (!active.length) throw new Error('No AI provider configured. Go to Settings → AI Providers and add an API key.');
  const provider = active.find(p => p.isDefault) || active[0];
  onProgress?.(`Using ${provider.name} (${provider.defaultModel})…`);
  if (provider.id === 'openai') return _callOpenAI(prompt, provider);
  if (provider.id === 'gemini') return _callGemini(prompt, provider);
  if (provider.id === 'openrouter') return _callOpenRouter(prompt, provider);
  if (provider.id === 'anthropic') return _callAnthropic(prompt, provider);
  if (provider.id === 'deepseek') return _callDeepSeek(prompt, provider);
  throw new Error('Unknown AI provider');
}

export function loadAIProviders(): AIProvider[] {
  try {
    const stored = JSON.parse(localStorage.getItem('luxedge_ai_providers') || 'null');
    if (!Array.isArray(stored) || !stored.length) return DEFAULT_AI_PROVIDERS;
    const merged = [...stored];
    for (const def of DEFAULT_AI_PROVIDERS) {
      if (!merged.some((p: AIProvider) => p.id === def.id)) merged.push(def);
    }
    return merged;
  } catch { return DEFAULT_AI_PROVIDERS; }
}

function looksLikeBotPage(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw.length < 15000 && (
    lower.includes('just a moment') || lower.includes('cf-challenge') || lower.includes('challenge-platform') ||
    lower.includes('captcha') || lower.includes('unusual traffic') || lower.includes('access denied') ||
    lower.includes('are you a robot') || lower.includes('verify you are human') || lower.includes('one more step') ||
    lower.includes('security check') || lower.includes('pardon our interruption') || lower.includes('robot check')
  );
}

export async function fetchPageContent(url: string, scrapedoKey?: string): Promise<string> {
  const isAli = /aliexpress\.(com|us)/i.test(url);
  const timeout = isAli ? 35000 : 25000;
  const proxies: { label: string; url: string; timeout: number }[] = [
    scrapedoKey?.trim() ? { label: 'scrape.do', url: `https://api.scrape.do/?token=${scrapedoKey.trim()}&url=${encodeURIComponent(url)}&render=true&countryCode=US`, timeout: 40000 } : { label: 'scrape.do', url: '', timeout: 40000 },
    { label: 'Jina Reader', url: `https://r.jina.ai/${url}`, timeout },
    { label: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, timeout },
    { label: 'codetabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, timeout },
    { label: 'corsproxy', url: `https://corsproxy.io/?${encodeURIComponent(url)}`, timeout },
    { label: 'Wayback', url: `https://web.archive.org/web/2024id_/${url}`, timeout },
  ].filter(p => p.url);
  let lastErr = '';
  for (const { label, url: proxy, timeout: t } of proxies) {
    try {
      const r = await fetch(proxy, { signal: AbortSignal.timeout(t), redirect: 'follow' });
      if (r.ok) {
        const raw = await r.text();
        if (raw.length < 200) { lastErr = `${label}: empty response`; continue; }
        if (looksLikeBotPage(raw)) { lastErr = `${label}: bot check`; continue; }
        if (label === 'corsproxy' && raw.toLowerCase().includes('fix cors errors')) { lastErr = `${label}: proxy homepage`; continue; }
        const isHtml = raw.trimStart().startsWith('<') || raw.includes('<html') || raw.includes('<!doctype');
        let text = ''; let imgs: string[] = [];
        if (isHtml) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(raw, 'text/html');
          const ogT = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
          const ogD = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
          const jsonLd = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent || '').join('\n');
          doc.querySelectorAll('script,style,nav,footer,aside').forEach(el => el.remove());
          doc.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
            if (src.startsWith('http') && (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp'))) imgs.push(src);
          });
          const bodyText = (doc.body?.innerText || '').trim();
          text = [ogT, ogD, jsonLd ? `JSON-LD:\n${jsonLd}` : '', bodyText].filter(Boolean).join('\n').slice(0, 12000);
        } else {
          text = raw.slice(0, 12000);
          const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g; let m;
          while ((m = re.exec(raw))) { if (m[1].includes('.jpg') || m[1].includes('.jpeg') || m[1].includes('.png') || m[1].includes('.webp')) imgs.push(m[1]); }
        }
        if (isAli && label === 'Jina Reader') {
          const titleLine = raw.match(/^Title:\s*(.+)$/m);
          if (!titleLine || !titleLine[1] || !titleLine[1].trim() || titleLine[1].trim().toLowerCase() === 'captcha interception') {
            lastErr = `${label}: AliExpress shell/captcha (product loads via JS)`;
            continue;
          }
        }
        if (isAli && text.length < 400 && (text.includes('Download the AliExpress app') || text.includes("I'm shopping for"))) {
          lastErr = `${label}: AliExpress shell page`;
          continue;
        }
        if (text.trim().length < 100) { lastErr = `${label}: too little content`; continue; }
        return JSON.stringify({ text, images: [...new Set(imgs)].slice(0, 30) });
      } else {
        lastErr = `${label}: HTTP ${r.status}`;
      }
    } catch (e: any) { lastErr = `${label}: ${e.message}`; }
  }
  if (isAli) {
    throw new Error(`Could not load AliExpress product (${lastErr}). AliExpress blocks automated fetching. Add a FREE scrape.do token in AI Hub → Web Scraping Configuration, or paste the product HTML/text instead.`);
  }
  throw new Error(`Could not fetch page (${lastErr}). Try pasting HTML or text instead.`);
}

export function buildExtractionPrompt(rawContent: string, sourceType: string): string {
  return `You are an expert e-commerce product data analyst for Luxedge, a premium US dropshipping store.

Extract ALL product information from this ${sourceType} content and return ONLY a valid JSON object.

CONTENT:
${rawContent.slice(0, 10000)}

Return this EXACT JSON structure (use empty string/array/0 if not found):
{
  "title": "exact product title",
  "luxuryTitle": "premium rewritten title for luxury brand",
  "seoTitle": "SEO optimized title with main keyword (60 chars max)",
  "slug": "url-friendly-slug",
  "brand": "brand name",
  "manufacturer": "manufacturer",
  "category": "best matching: Dog Supplies | Cat Supplies | Pet Beds | Pet Toys | Feeding & Water | Grooming | Pet Accessories",
  "subcategory": "specific subcategory",
  "collection": "product collection name",
  "shortDescription": "2-3 sentence product summary",
  "longDescription": "detailed 3-4 paragraph product description",
  "features": ["feature 1", "feature 2", "feature 3"],
  "benefits": ["benefit 1", "benefit 2"],
  "specifications": {"spec name": "value"},
  "packageIncludes": ["item 1", "item 2"],
  "weight": "e.g. 0.5 lbs",
  "dimensions": "e.g. 10 x 5 x 2 inches",
  "origin": "country of origin",
  "materials": ["material 1"],
  "colors": ["color 1", "color 2"],
  "sizes": ["S", "M", "L"],
  "sku": "suggested SKU",
  "barcode": "",
  "hsCode": "",
  "stock": 100,
  "costPrice": 0,
  "sellingPrice": 0,
  "comparePrice": 0,
  "shippingWeight": "",
  "tags": ["tag1", "tag2", "tag3"],
  "seoKeywords": ["keyword1", "keyword2"],
  "metaTitle": "SEO meta title (60 chars)",
  "metaDescription": "SEO meta description (160 chars)",
  "focusKeyword": "primary SEO keyword",
  "images": [],
  "faqs": [{"q": "question?", "a": "answer"}],
  "warranty": "warranty info",
  "careInstructions": "care instructions",
  "safetyNotes": "safety notes",
  "confidence": {
    "title": 95, "price": 80, "description": 85, "specifications": 70, "images": 60, "brand": 75, "category": 90, "tags": 80
  }
}

Rules:
- luxuryTitle: make it sound premium, e.g. "Orthopedic Memory Foam Dog Bed" → "Luxe Joint-Support Memory Foam Bed | LuxePaws"
- sellingPrice: use actual price from content; if not found estimate market price
- comparePrice: 20-30% higher than sellingPrice (to show "was" price)
- costPrice: 40-50% of sellingPrice  
- confidence: 0-100 how certain you are about each field
- Return ONLY the JSON, absolutely no other text`;
}


// ============================================================================
// DATA
// ============================================================================
const DP: Omit<Product,'id'|'name'|'description'|'price'|'originalPrice'|'category'|'stock'|'images'|'rating'|'reviews'|'isActive'> = { shortDesc:'', brand:'Luxedge', condition:'New', tags:[], weight:'', dimensions:'', origin:'China', freeShipping:true, shippingCost:'0', variants:[] };
const INIT_PRODUCTS: Product[] = [
  { ...DP, id:'1', name:'Orthopedic Memory Foam Dog Bed', shortDesc:'Joint-supporting dog bed', description:'Orthopedic memory foam dog bed with a washable, removable cover. Supports joints and relieves pressure points so your dog sleeps deeply and wakes up refreshed.', price:49.99, originalPrice:89.99, category:'Pet Beds', stock:64, images:['https://upload.wikimedia.org/wikipedia/commons/f/f4/Dog_sleeping_in_a_dog_bed.JPG'], rating:4.9, reviews:1123, isActive:true, brand:'LuxePaws', weight:'4.2 lbs', tags:['dog bed','memory foam','orthopedic'], variants:[{id:'v1',color:'Gray',size:'Medium',price:49.99,salePrice:49.99,stock:30,sku:'PB-M-GY'},{id:'v2',color:'Gray',size:'Large',price:62.99,salePrice:62.99,stock:34,sku:'PB-L-GY'}] },
  { ...DP, id:'2', name:'Interactive Cat Feather Toy', shortDesc:'Motion-activated cat teaser', description:'Motion-activated interactive feather toy that mimics prey movement. Keeps indoor cats active, entertained, and mentally stimulated for hours.', price:24.99, originalPrice:44.99, category:'Pet Toys', stock:132, images:['https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Miyako_is_playing_with_a_fishing-rod_toy_%287756356192%29.jpg/960px-Miyako_is_playing_with_a_fishing-rod_toy_%287756356192%29.jpg'], rating:4.7, reviews:876, isActive:true, brand:'WhiskerWand', weight:'0.6 lbs', tags:['cat toy','interactive','feather'] },
  { ...DP, id:'3', name:'Stainless Steel Pet Water Fountain', shortDesc:'Triple-filter fountain', description:'3-liter stainless steel pet water fountain with triple filtration and a quiet pump. Encourages pets to drink more fresh, filtered water every day.', price:34.99, originalPrice:59.99, category:'Feeding & Water', stock:76, images:['https://upload.wikimedia.org/wikipedia/commons/4/4e/A_cat_drinking_water.jpg'], rating:4.8, reviews:521, isActive:true, brand:'AquaPure', weight:'2.3 lbs', tags:['water fountain','hydration','stainless steel'] },
  { ...DP, id:'4', name:'Adjustable No-Pull Dog Harness', shortDesc:'Reflective walking harness', description:'No-pull reflective dog harness with padded chest and fully adjustable straps. Ensures comfortable, secure walks for dogs of all sizes.', price:29.99, originalPrice:54.99, category:'Dog Supplies', stock:98, images:['https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Dog_in_a_harness.jpg/960px-Dog_in_a_harness.jpg'], rating:4.8, reviews:654, isActive:true, brand:'TrailMate', weight:'0.8 lbs', tags:['dog harness','walking','reflective'], variants:[{id:'v3',color:'Black',size:'Medium',price:29.99,salePrice:29.99,stock:50,sku:'DH-M-BK'},{id:'v4',color:'Black',size:'Large',price:32.99,salePrice:32.99,stock:48,sku:'DH-L-BK'}] },
  { ...DP, id:'5', name:'Self-Cleaning Slicker Grooming Brush', shortDesc:'Deshedding grooming brush', description:'Self-cleaning slicker brush with retractable bristles for easy cleanup. Gently removes loose fur, tangles, and mats while massaging your pet\u2019s skin.', price:19.99, originalPrice:39.99, category:'Grooming', stock:210, images:['https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Dog_brush.JPG/960px-Dog_brush.JPG'], rating:4.6, reviews:432, isActive:true, brand:'FurFresh', weight:'1.1 lbs', tags:['grooming','brush','deshedding'] },
  { ...DP, id:'6', name:'Premium Cat Scratching Post', shortDesc:'Sturdy sisal scratch tower', description:'Premium sisal scratching post with a cozy perch and dangling toy. Satisfies your cat\u2019s natural scratching instinct while protecting your furniture.', price:45.99, originalPrice:79.99, category:'Cat Supplies', stock:57, images:['https://upload.wikimedia.org/wikipedia/commons/5/58/Baukasten_Cathome.jpg'], rating:4.8, reviews:389, isActive:true, brand:'CatHaven', weight:'8.5 lbs', tags:['scratching post','sisal','cat furniture'] },
  { ...DP, id:'7', name:'Slow Feeder Dog Bowl', shortDesc:'Anti-gulp puzzle bowl', description:'Non-slip slow feeder bowl with raised ridges that slows down fast eaters. Reduces bloating and improves digestion for happier mealtimes.', price:17.99, originalPrice:29.99, category:'Feeding & Water', stock:143, images:['https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Blue_Slow_Feeder_Dog_Bowl_with_Raised_Studs_and_Ridges.jpg/960px-Blue_Slow_Feeder_Dog_Bowl_with_Raised_Studs_and_Ridges.jpg'], rating:4.7, reviews:298, isActive:true, brand:'BowlWell', weight:'0.9 lbs', tags:['slow feeder','bowl','anti-gulp'] },
  { ...DP, id:'8', name:'Portable Pet Travel Water Bottle', shortDesc:'Leak-proof one-hand dispenser', description:'Portable pet travel water bottle with a one-hand dispensing cup and leak-proof design. Perfect for walks, hikes, and road trips with your furry friend.', price:15.99, originalPrice:27.99, category:'Pet Accessories', stock:188, images:['https://images.pexels.com/photos/127028/pexels-photo-127028.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.6, reviews:245, isActive:true, brand:'TravelPaw', weight:'0.7 lbs', tags:['travel','water bottle','portable'] },
  { ...DP, id:'9', name:'Durable Rope Dog Toy Set', shortDesc:'Chew & fetch rope toys', description:'Set of 3 durable cotton rope dog toys designed for chewing, tug-of-war, and fetch. Helps clean teeth and satisfies natural chewing instincts.', price:14.99, originalPrice:24.99, category:'Pet Toys', stock:201, images:['https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Maltipoo_with_rope_toy_%2895554%29.jpg/960px-Maltipoo_with_rope_toy_%2895554%29.jpg'], rating:4.7, reviews:512, isActive:true, brand:'PlayBone', weight:'0.5 lbs', tags:['rope toy','chew','fetch'] },
  { ...DP, id:'10', name:'Cozy Calming Cat Bed', shortDesc:'Cuddler donut cat bed', description:'Cozy donut-shaped cat bed with a raised rim for security and warmth. Machine-washable plush design gives cats a calm, snug place to curl up.', price:32.99, originalPrice:54.99, category:'Pet Beds', stock:84, images:['https://upload.wikimedia.org/wikipedia/commons/0/0c/A_cat_bed_%2831681254268%29.jpg'], rating:4.9, reviews:734, isActive:true, brand:'SnugglePet', weight:'1.8 lbs', tags:['cat bed','calming','cuddler'] },
  { ...DP, id:'11', name:'Automatic Pet Food Dispenser', shortDesc:'Programmable meal feeder', description:'Automatic pet food dispenser with programmable portions and a built-in voice recorder. Keeps your pet on a consistent feeding schedule even when you are away.', price:54.99, originalPrice:89.99, category:'Feeding & Water', stock:46, images:['https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Futterautomat_mit_RFID_-_pet_feeder%2C_cat_feeder%2C_RFID_controlled.JPG/960px-Futterautomat_mit_RFID_-_pet_feeder%2C_cat_feeder%2C_RFID_controlled.JPG'], rating:4.7, reviews:318, isActive:true, brand:'SmartFeed', weight:'3.6 lbs', tags:['food dispenser','automatic','programmable'] },
  { ...DP, id:'12', name:'Pet Car Seat Protector', shortDesc:'Waterproof car seat cover', description:'Waterproof, scratch-resistant pet car seat protector with a non-slip base and easy straps. Keeps your car clean from fur, dirt, and spills on every ride.', price:36.99, originalPrice:59.99, category:'Pet Accessories', stock:72, images:['https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Dog_wearing_seat_belt.jpg/960px-Dog_wearing_seat_belt.jpg'], rating:4.6, reviews:276, isActive:true, brand:'RoadDog', weight:'2.1 lbs', tags:['car seat','protector','waterproof'] },
  { ...DP, id:'13', name:'SonicGlow Electric Toothbrush', shortDesc:'Sonic toothbrush, 5 modes', description:'Sonic electric toothbrush with 5 cleaning modes, smart 2-minute timer, and 30-day battery on a single charge. Includes 4 DuPont brush heads and a travel case. IPX7 waterproof. A hygiene bestseller across AliExpress and Amazon.', price:26.99, originalPrice:54.99, category:'Wellness', stock:88, images:['https://images.pexels.com/photos/6621462/pexels-photo-6621462.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.7, reviews:2456, isActive:true, brand:'SonicGlow', weight:'0.3 lbs', tags:['toothbrush','electric','oral care'], variants:[{id:'v13a',color:'White',size:'One Size',price:26.99,salePrice:26.99,stock:44,sku:'SG-WHT'},{id:'v13b',color:'Black',size:'One Size',price:26.99,salePrice:26.99,stock:44,sku:'SG-BLK'}] },
  { ...DP, id:'14', name:'FlexCore Adjustable Dumbbell', shortDesc:'5-in-1 adjustable dumbbell', description:'Space-saving adjustable dumbbell that replaces 5 sets of weights (5–25 lbs) with a quick-select dial. Anti-slip handle and durable steel plates. Perfect for home gyms. Trending fitness equipment on Amazon Movers & Shakers.', price:64.99, originalPrice:119.99, category:'Wellness', stock:42, images:['https://images.pexels.com/photos/4239013/pexels-photo-4239013.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.8, reviews:1367, isActive:true, brand:'FlexCore', weight:'25 lbs', tags:['dumbbell','home gym','fitness'] },
  { ...DP, id:'15', name:'AuroraCharge 3-in-1 Wireless Station', shortDesc:'3-in-1 wireless charger', description:'Foldable 15W wireless charging station for phone, earbuds, and smartwatch simultaneously. MagSafe-compatible, fast-charge, and travel-friendly design. Includes 20W adapter. A must-have desk gadget trending on Amazon.', price:33.99, originalPrice:59.99, category:'Tech & Gadgets', stock:130, images:['https://images.pexels.com/photos/1092644/pexels-photo-1092644.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.6, reviews:2078, isActive:true, brand:'AuroraCharge', weight:'0.5 lbs', tags:['wireless charger','magsafe','desk'] },
  { ...DP, id:'16', name:'ZenMist Ultrasonic Aroma Diffuser', shortDesc:'300ml essential-oil diffuser', description:'300ml ultrasonic essential-oil diffuser with 7-color LED mood lighting, whisper-quiet mist, and auto shut-off. Covers rooms up to 320 sq ft. Perfect for relaxation and better sleep. A top home-wellness seller on AliExpress.', price:21.99, originalPrice:39.99, category:'Home & Living', stock:156, images:['https://images.pexels.com/photos/3735218/pexels-photo-3735218.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.8, reviews:3945, isActive:true, brand:'ZenMist', weight:'0.8 lbs', tags:['diffuser','aromatherapy','home'] },
  { ...DP, id:'17', name:'CoreFlex Non-Slip Yoga Mat', shortDesc:'6mm TPE yoga mat', description:'Extra-thick 6mm TPE yoga mat with dual-sided non-slip texture and alignment lines. Eco-friendly, sweat-resistant, and includes a carrying strap. Lightweight for home and studio. A wellness bestseller across Amazon and AliExpress.', price:19.99, originalPrice:36.99, category:'Wellness', stock:187, images:['https://images.pexels.com/photos/4498151/pexels-photo-4498151.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.7, reviews:2611, isActive:true, brand:'CoreFlex', weight:'2.2 lbs', tags:['yoga mat','fitness','non-slip'], variants:[{id:'v17a',color:'Blue',size:'6mm',price:19.99,salePrice:19.99,stock:94,sku:'CF-BLU'},{id:'v17b',color:'Pink',size:'6mm',price:19.99,salePrice:19.99,stock:93,sku:'CF-PNK'}] },
  { ...DP, id:'18', name:'ClarityPro Blue-Light Glasses', shortDesc:'Anti-blue-light computer glasses', description:'Anti-blue-light computer glasses that reduce eye strain and improve sleep. Lightweight TR90 frame, anti-glare and anti-scratch coating, unisex design. Includes case and cleaning cloth. A trending everyday accessory on Amazon.', price:17.99, originalPrice:34.99, category:'Accessories', stock:164, images:['https://images.pexels.com/photos/2872879/pexels-photo-2872879.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.6, reviews:1743, isActive:true, brand:'ClarityPro', weight:'0.05 lbs', tags:['glasses','blue light','eye care'] },
  { ...DP, id:'19', name:'ChillBreeze Portable Neck Fan', shortDesc:'Bladeless hands-free neck fan', description:'Hands-free bladeless neck fan with 3 speed settings, 360° airflow, and a rechargeable 4000mAh battery lasting up to 16 hours. Lightweight, whisper-quiet, and hair-safe — perfect for commutes, travel, and outdoor work. A viral summer bestseller on TikTok and Amazon.', price:23.99, originalPrice:42.99, category:'Tech & Gadgets', stock:140, images:['https://images.pexels.com/photos/4491881/pexels-photo-4491881.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.6, reviews:2734, isActive:true, brand:'ChillBreeze', weight:'0.4 lbs', tags:['neck fan','portable','bladeless','summer'], variants:[{id:'v19a',color:'White',size:'One Size',price:23.99,salePrice:23.99,stock:70,sku:'CB-WHT'},{id:'v19b',color:'Black',size:'One Size',price:23.99,salePrice:23.99,stock:70,sku:'CB-BLK'}] },
  { ...DP, id:'20', name:'RelaxEye Heated Eye Massager', shortDesc:'Bluetooth heated eye massager', description:'Rechargeable heated eye massager with air-compression, gentle vibration, and soothing warmth to relieve eye strain, puffiness, and headaches. Built-in Bluetooth music, 5 modes, and a foldable travel design. A top self-care gadget trending on Amazon and AliExpress.', price:38.99, originalPrice:74.99, category:'Wellness', stock:82, images:['https://images.pexels.com/photos/3865711/pexels-photo-3865711.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.7, reviews:1988, isActive:true, brand:'RelaxEye', weight:'0.7 lbs', tags:['eye massager','relaxation','self care','bluetooth'] },
  { ...DP, id:'21', name:'PostureFix Smart Posture Corrector', shortDesc:'Vibrating smart posture trainer', description:'Discreet smart posture corrector that gently vibrates when you slouch, retraining your back and shoulders for a healthier posture. Adjustable, breathable, and unisex — pairs with a free app to track progress. A viral wellness bestseller for desk workers.', price:27.99, originalPrice:49.99, category:'Wellness', stock:110, images:['https://images.pexels.com/photos/4056723/pexels-photo-4056723.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.5, reviews:1524, isActive:true, brand:'PostureFix', weight:'0.3 lbs', tags:['posture corrector','back support','wellness','smart'] },
  { ...DP, id:'22', name:'AquaTrack Smart Water Bottle', shortDesc:'LED reminder insulated bottle', description:'Smart insulated stainless-steel water bottle with an LED hydration reminder and temperature display in the cap. Keeps drinks cold 24h / hot 12h, 500ml, BPA-free, and leak-proof. A trending health-and-fitness gadget across Amazon and TikTok.', price:25.99, originalPrice:46.99, category:'Wellness', stock:125, images:['https://images.pexels.com/photos/1000084/pexels-photo-1000084.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.6, reviews:2103, isActive:true, brand:'AquaTrack', weight:'0.6 lbs', tags:['water bottle','smart','hydration','insulated'], variants:[{id:'v22a',color:'Silver',size:'500ml',price:25.99,salePrice:25.99,stock:63,sku:'AT-SLV'},{id:'v22b',color:'Black',size:'500ml',price:25.99,salePrice:25.99,stock:62,sku:'AT-BLK'}] },
  { ...DP, id:'23', name:'LumaStrip RGB LED Light Strip', shortDesc:'App & music-sync LED strip 16ft', description:'16ft app-controlled RGB LED light strip with 16 million colors, music sync, and voice control (Alexa & Google). Easy peel-and-stick install, remote included, and dimmable scenes for gaming setups and bedrooms. One of the top-selling home-decor items on Amazon.', price:18.99, originalPrice:35.99, category:'Home & Living', stock:198, images:['https://images.pexels.com/photos/1616403/pexels-photo-1616403.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.7, reviews:4562, isActive:true, brand:'LumaStrip', weight:'0.5 lbs', tags:['led strip','rgb','home decor','gaming'] },
  { ...DP, id:'24', name:'TurboVac Cordless Car Vacuum', shortDesc:'Portable handheld car vacuum', description:'Powerful 9000Pa cordless handheld vacuum for cars, desks, and pet hair. USB-C rechargeable, lightweight, and low-noise with washable HEPA filter and multiple nozzles. A best-selling car accessory trending on Amazon and AliExpress.', price:29.99, originalPrice:54.99, category:'Tech & Gadgets', stock:96, images:['https://images.pexels.com/photos/4489732/pexels-photo-4489732.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940'], rating:4.5, reviews:1876, isActive:true, brand:'TurboVac', weight:'1.1 lbs', tags:['car vacuum','portable','cordless','cleaning'] },
];

// ═══════════ 120-Product Catalog — extends the 12 featured products to a full store ═══════════
const EXTRA_IMGS = [
  'https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=600',
  'https://images.pexels.com/photos/1170986/pexels-photo-1170986.jpeg?auto=compress&cs=tinysrgb&w=600',
  'https://images.pexels.com/photos/3777622/pexels-photo-3777622.jpeg?auto=compress&cs=tinysrgb&w=600',
  'https://images.pexels.com/photos/164186/pexels-photo-164186.jpeg?auto=compress&cs=tinysrgb&w=600',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Miyako_is_playing_with_a_fishing-rod_toy_%287756356192%29.jpg/960px-Miyako_is_playing_with_a_fishing-rod_toy_%287756356192%29.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/4/4e/A_cat_drinking_water.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Dog_brush.JPG/960px-Dog_brush.JPG',
  'https://upload.wikimedia.org/wikipedia/commons/5/58/Baukasten_Cathome.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Blue_Slow_Feeder_Dog_Bowl_with_Raised_Studs_and_Ridges.jpg/960px-Blue_Slow_Feeder_Dog_Bowl_with_Raised_Studs_and_Ridges.jpg',
  'https://images.pexels.com/photos/127028/pexels-photo-127028.jpeg?auto=compress&cs=tinysrgb&w=600',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Maltipoo_with_rope_toy_%2895554%29.jpg/960px-Maltipoo_with_rope_toy_%2895554%29.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/0/0c/A_cat_bed_%2831681254268%29.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Futterautomat_mit_RFID_-_pet_feeder%2C_cat_feeder%2C_RFID_controlled.JPG/960px-Futterautomat_mit_RFID_-_pet_feeder%2C_cat_feeder%2C_RFID_controlled.JPG',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Dog_wearing_seat_belt.jpg/960px-Dog_wearing_seat_belt.jpg',
];

const EXTRA_PRODUCT_NAMES: Record<string, string[]> = {
  'Dog Supplies': ['No-Pull Dog Harness', 'Reflective Dog Leash', 'Comfort Dog Collar', 'Dog Training Treat Pouch', 'Dog Raincoat Waterproof', 'Cooling Dog Vest', 'Dog Boots Anti-Slip', 'Dog Car Seat Belt', 'Dog Paw Cleaner Cup', 'Dog Whistle Trainer', 'Dog Poop Bag Holder', 'Elevated Dog Bowl Stand', 'Dog First Aid Kit', 'Dog Dental Chew Set', 'GPS Dog Tracker Collar', 'Dog Agility Tunnel'],
  'Cat Supplies': ['Cat Tree Tower', 'Cat Window Perch', 'Cat Tunnel Play Tube', 'Cat Litter Mat', 'Cat Collar with Bell', 'Cat Grooming Glove', 'Cat Nail Clipper Kit', 'Cat Carrier Backpack', 'Catnip Toy Variety Pack', 'Cat Scratching Board', 'Cat Food Puzzle Feeder', 'Cat Water Fountain Filter', 'Cat Bed Cave Plush', 'Cat Harness Escape-Proof', 'Cat Grass Growing Kit', 'Cat Laser Pointer Toy'],
  'Pet Beds': ['Heated Dog Bed', 'Elevated Cot Dog Bed', 'Donut Cuddler Cat Bed', 'Waterproof Outdoor Dog Bed', 'Cave Den Dog Bed', 'Pet Sofa Bed Large', 'Memory Foam Puppy Bed', 'Travel Folding Pet Bed', 'Cooling Gel Dog Bed', 'Bolster Dog Bed', 'Orthopedic Cooling Bed', 'Nest Calming Cat Bed', 'Washable Plush Pet Bed', 'Cozy Fur Lined Dog Bed', 'Fleece Cat Bed Round'],
  'Pet Toys': ['Squeaky Plush Dog Toys', 'Rubber Chew Bone Toy', 'Tennis Ball Launcher', 'Frisbee Flying Disc', 'Cat Feather Wand Toy', 'Dog Snuffle Mat', 'Cat Laser Pointer', 'Interactive Treat Ball', 'Tug Rope Toy with Handle', 'Dog Puzzle Hide Toy', 'Cat Spring Toy Pack', 'Plush Squeaky Chicken', 'Ball Pit Cat Playpen', 'Dog Bite Ring Toy', 'Cat Toy Mouse Pack', 'Puppy Teething Toys'],
  'Feeding & Water': ['Ceramic Pet Bowl Set', 'Non-Slip Silicone Bowl Mat', 'Collapsible Travel Pet Bowl', 'Pet Water Bottle Dispenser', 'Elevated Feeding Station', 'Smart Feeder with Camera', 'Double Stainless Bowl', 'Pet Food Storage Bin', 'Gravity Water Dispenser', 'Anti-Skid Puppy Bowl', 'Fountain Replacement Pump', 'Insulated Pet Water Bottle', 'Cascade Cat Water Fountain', 'Slow Feed Puzzle Mat', 'Stainless Pet Food Bowl', 'Portable Pet Feeder Set'],
  'Grooming': ['Low Noise Pet Hair Dryer', 'Cordless Dog Clipper Kit', 'Pet Nail Grinder', 'Deshedding Undercoat Rake', 'Pet Shampoo Brush', 'Detangling Spray for Pets', 'Dog Toothbrush Kit', 'Pet Fur Remover Roller', 'Cat Shedding Comb', 'Grooming Scissors Set', 'Pet Cologne Freshener', 'Electric Pet Trimmer', 'Pet Bathing Massager Brush', 'Dog Ear Cleaner Kit', 'Pet Hair Catcher Towel'],
  'Pet Accessories': ['LED Dog Collar Light', 'Custom Pet ID Tag', 'Pet Stroller', 'Pet Backpack Carrier', 'Waterproof Pet Blanket', 'Dog Seat Belt Clip', 'Pet Steps for Bed', 'Pet Car Ramp', 'Pet Safety Vest', 'Pet Fountain Travel Bowl', 'Dog Bandana Set', 'Pet GPS Tracker', 'Pet Hammock Car Seat', 'Pet Window Sill Bed'],
};

const EXTRA_BRANDS = ['LuxePaws', 'WhiskerWand', 'AquaPure', 'TrailMate', 'FurFresh', 'CatHaven', 'BowlWell', 'TravelPaw', 'PlayBone', 'SnugglePet', 'SmartFeed', 'RoadDog', 'PawPerfect', 'ZenPet', 'HappyTails', 'PetPro'];

let __pid = 1000;
const EXTRA_PRODUCTS: Product[] = Object.entries(EXTRA_PRODUCT_NAMES).flatMap(([cat, names]) =>
  names.map((nm, i) => {
    __pid++;
    const base = 9.99 + ((i * 7 + cat.length * 3) % 40);
    const price = +(base + 0.99).toFixed(2);
    const originalPrice = +(price * (1.35 + ((i * 13) % 40) / 100)).toFixed(2);
    return {
      ...DP, id: String(__pid), name: nm,
      shortDesc: `${cat} essential`, description: `${nm} — handpicked premium pet essentials from Luxedge. Quality you can trust, priced honestly, delivered to your door.`,
      price, originalPrice, category: cat, stock: 20 + ((i * 17) % 180),
      images: [EXTRA_IMGS[(i + cat.length) % EXTRA_IMGS.length]],
      rating: +(4.2 + ((i * 3) % 8) / 10).toFixed(1), reviews: 20 + ((i * 29) % 420),
      isActive: true, brand: EXTRA_BRANDS[(i + cat.length) % EXTRA_BRANDS.length],
      weight: `${(0.4 + ((i * 5) % 25) / 10).toFixed(1)} lbs`, tags: [cat.toLowerCase(), 'premium', 'luxedge'],
    };
  })
);

const ALL_PRODUCTS: Product[] = [...INIT_PRODUCTS, ...EXTRA_PRODUCTS];

const INIT_ADMIN: AppUser = { id: 'adm', email: 'admin@luxedge.us', password: 'admin123', name: 'Admin', role: 'admin', joined: '2024-01-01' };
const INIT_USERS: AppUser[] = [
  { id: 'u1', email: 'john@test.com', password: 'password123', name: 'John Smith', role: 'buyer', joined: '2024-01-15' },
  { id: 'u2', email: 'sarah@test.com', password: 'password123', name: 'Sarah Johnson', role: 'buyer', joined: '2024-02-20' },
  { id: 'u3', email: 'mike@test.com', password: 'password123', name: 'Mike Williams', role: 'buyer', joined: '2024-03-01' },
];

const INIT_ORDERS: Order[] = [
  { id: 'ORD-001', userId: 'u1', userName: 'John Smith', items: [{ product: INIT_PRODUCTS[0], quantity: 1 }], total: 49.99, status: 'Delivered', date: '2024-03-01', address: '123 Main St, Austin TX' },
  { id: 'ORD-002', userId: 'u2', userName: 'Sarah Johnson', items: [{ product: INIT_PRODUCTS[2], quantity: 2 }], total: 69.98, status: 'Shipped', date: '2024-03-10', address: '456 Oak Ave, Dallas TX' },
  { id: 'ORD-003', userId: 'u1', userName: 'John Smith', items: [{ product: INIT_PRODUCTS[4], quantity: 1 }], total: 19.99, status: 'Processing', date: '2024-03-14', address: '123 Main St, Austin TX' },
  { id: 'ORD-004', userId: 'u3', userName: 'Mike Williams', items: [{ product: INIT_PRODUCTS[6], quantity: 1 }, { product: INIT_PRODUCTS[7], quantity: 1 }], total: 33.98, status: 'Pending', date: '2024-03-15', address: '789 Pine St, Houston TX' },
];

const INIT_REVIEWS: Review[] = [
  { id: 'r1', productId: '1', productName: 'Orthopedic Memory Foam Dog Bed', userName: 'John Smith', rating: 5, comment: 'Best dog bed ever! My pup sleeps great.', status: 'approved', date: '2024-03-05' },
  { id: 'r2', productId: '3', productName: 'Stainless Steel Pet Water Fountain', userName: 'Sarah Johnson', rating: 4, comment: 'Great fountain, my cat drinks way more now.', status: 'approved', date: '2024-03-08' },
  { id: 'r3', productId: '5', productName: 'Self-Cleaning Slicker Grooming Brush', userName: 'Mike Williams', rating: 5, comment: 'Sleek and functional! Shedding is under control.', status: 'pending', date: '2024-03-14' },
  { id: 'r4', productId: '6', productName: 'Premium Cat Scratching Post', userName: 'Sarah Johnson', rating: 5, comment: 'Furniture is safe now. Kitty loves the perch!', status: 'pending', date: '2024-03-15' },
];

const INIT_CATEGORIES: AdminCategory[] = [
  { id: 'c1', name: 'Dog Supplies', isActive: true, subs: [{ id: 'c1s1', name: 'Dogs', isActive: true }, { id: 'c1s2', name: 'Puppies', isActive: true }] },
  { id: 'c2', name: 'Cat Supplies', isActive: true, subs: [{ id: 'c2s1', name: 'Cats', isActive: true }, { id: 'c2s2', name: 'Kittens', isActive: true }] },
  { id: 'c3', name: 'Pet Beds', isActive: true, subs: [] },
  { id: 'c4', name: 'Pet Toys', isActive: true, subs: [] },
  { id: 'c5', name: 'Feeding & Water', isActive: true, subs: [] },
  { id: 'c6', name: 'Grooming', isActive: true, subs: [] },
  { id: 'c7', name: 'Pet Accessories', isActive: true, subs: [] },
];

const INIT_BLOGS: BlogPost[] = [
  { id:'b1', slug:'essential-supplies-new-puppy', title:'10 Essential Supplies Every New Puppy Needs', excerpt:'From comfy beds to chew-proof toys, here are the must-have products for welcoming a puppy into your home.', content:'Bringing home a puppy is exciting — and a little overwhelming. Here are the essentials every new pet parent needs.\n\n## 1. A Comfortable Bed\nThe Orthopedic Memory Foam Dog Bed supports growing joints and gives your puppy a cozy place to recharge after all that play.\n\n## 2. A No-Pull Harness\nPuppies pull! An Adjustable No-Pull Dog Harness makes walks comfortable and teaches good leash manners from day one.\n\n## 3. Durable Chew Toys\nPuppies teethe — a lot. A set of rope toys gives them something safe to chew instead of your furniture.\n\n## 4. Slow Feeder Bowl\nPuppies eat fast. A slow feeder bowl slows them down and prevents bloating.\n\n## 5. Grooming Basics\nA self-cleaning slicker brush keeps their coat shiny and makes grooming a bonding moment.\n\n## 6. Training Treats & More\nStock up on quality food, treats, and a sturdy collar. Preparation makes the first few weeks smooth and fun for everyone.', image:'https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['puppy','dog supplies','new pet','essentials'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-03-10' },
  { id:'b2', slug:'cozy-corner-for-your-cat', title:'How to Create the Perfect Cozy Corner for Your Cat', excerpt:'Cats love having a place to call their own. Here\u2019s how to build a calming space your feline will adore.', content:'Every cat deserves a sanctuary. Here\u2019s how to design a cozy corner your kitty will love.\n\n## Choose the Right Bed\nCats feel safest when they can curl up with their back protected. A donut-style Cozy Calming Cat Bed with raised edges is perfect.\n\n## Add a Scratching Post\nScratching is instinct. A sturdy Premium Cat Scratching Post keeps claws happy and your sofa safe.\n\n## Include a View\nCats love watching the world go by. Place their bed near a window for hours of gentle entertainment.\n\n## Keep It Quiet\nChoose a corner away from high-traffic areas. Calm, quiet, and warm is the winning formula.\n\n## Fresh Water Close By\nA Stainless Steel Pet Water Fountain encourages hydration and fits beautifully in their new space.', image:'https://images.pexels.com/photos/416160/pexels-photo-416160.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['cat','cat bed','cozy','home'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-03-05' },
  { id:'b3', slug:'grooming-routine-long-haired-pets', title:'A Simple Grooming Routine for Long-Haired Pets', excerpt:'Keep mats, tangles, and shedding under control with this easy weekly grooming routine.', content:'Long-haired pets are gorgeous — and high-maintenance. A simple routine keeps them healthy and comfortable.\n\n## Brush Daily, If You Can\nDaily brushing with a self-cleaning slicker brush removes loose fur before it becomes mats. It also spreads natural oils for a shinier coat.\n\n## Detangle Gently\nWork from the tips toward the skin. Never yank — patience prevents pain and keeps grooming a positive experience.\n\n## Watch the Pads\nLong fur grows between paw pads too. Regular trims prevent slipping and keep paws clean.\n\n## Make It a Ritual\nEnd each session with a treat. Your pet will start looking forward to grooming time instead of dreading it.\n\n## Seasonal Shedding\nExpect heavier shedding in spring and fall. Extra brushing during these months keeps your home much cleaner.', image:'https://images.pexels.com/photos/2173872/pexels-photo-2173872.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['grooming','long hair','brushing','coat care'], authorId:'u1', authorName:'John Smith', status:'published', date:'2025-02-28' },
  { id:'b4', slug:'best-gifts-under-50-for-pets', title:'Best Gift Ideas Under $50 for Dogs and Cats', excerpt:'Surprise your furry best friend with these thoughtful, premium pet gifts that cost less than fifty dollars.', content:'Your pet deserves the best — without breaking the bank. Here are gift ideas under $50.\n\n## 1. Orthopedic Dog Bed ($49.99)\nThe gift of great sleep. Joint-supporting memory foam keeps senior dogs and puppies comfortable.\n\n## 2. Interactive Cat Toy ($24.99)\nA motion-activated feather toy that mimics prey keeps indoor cats active and entertained for hours.\n\n## 3. Self-Cleaning Grooming Brush ($19.99)\nPractical and appreciated — less shedding around the house is a gift for you too.\n\n## 4. Slow Feeder Bowl ($17.99)\nHealthier mealtimes for fast eaters. A thoughtful upgrade to the everyday bowl.\n\n## 5. Travel Water Bottle ($15.99)\nPerfect for pet parents on the go. Fresh water during walks, hikes, and road trips.', image:'https://images.pexels.com/photos/5732487/pexels-photo-5732487.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['gifts','budget','under 50','pets'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-02-20' },
  { id:'b5', slug:'interactive-toys-pet-enrichment', title:'Interactive Toys: A Beginner\u2019s Guide to Pet Enrichment', excerpt:'Mental stimulation is just as important as exercise. Learn how interactive toys keep pets happy and sharp.', content:'Enrichment isn\u2019t a luxury — it\u2019s essential for a happy, well-behaved pet.\n\n## Why Enrichment Matters\nBored pets develop destructive habits. Interactive toys channel natural instincts like hunting and foraging into healthy play.\n\n## Start with Feather Toys\nMotion-activated teasers like the Interactive Cat Feather Toy simulate prey and trigger your cat\u2019s hunting instinct.\n\n## Add Tug & Chew Toys\nRope toys are perfect for tug-of-war and chewing. They clean teeth and satisfy your dog\u2019s urge to chew.\n\n## Rotate the Fun\nPets get bored of the same toys. Rotate a small selection weekly to keep playtime fresh and exciting.\n\n## Play Together\nInteractive play strengthens your bond. Ten minutes of focused play a day makes a world of difference.', image:'https://images.pexels.com/photos/1170986/pexels-photo-1170986.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['enrichment','toys','play','cats and dogs'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-02-15' },
  { id:'b6', slug:'get-pet-to-drink-more-water', title:'How to Get Your Pet to Drink More Water', excerpt:'Dehydration is a common pet health issue. These proven tricks encourage healthier hydration.', content:'Pets often don\u2019t drink enough water. Here\u2019s how to keep them properly hydrated.\n\n## Upgrade to a Fountain\nMany pets prefer running water. A Stainless Steel Pet Water Fountain with triple filtration is irresistible to most cats and dogs.\n\n## Keep Bowls Clean\nPets refuse stale water. Wash bowls daily and refresh water at least twice a day.\n\n## Add Water to Food\nMix a little warm water into dry kibble or add broth to increase daily intake.\n\n## Multiple Stations\nPlace water bowls in several rooms so water is always nearby.\n\n## Watch the Signs\nCheck for dry gums, lethargy, or loss of appetite. If you\u2019re worried about dehydration, contact your vet.', image:'https://images.pexels.com/photos/3777622/pexels-photo-3777622.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['hydration','water fountain','health','cat and dog'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-02-10' },
  { id:'b7', slug:'traveling-with-pets-tips', title:'Traveling with Pets: 7 Essential Tips', excerpt:'Plan a smooth, stress-free trip with your furry copilot using these expert travel tips.', content:'Traveling with pets is rewarding — and requires planning. Here are 7 tips for a smooth journey.\n\n## 1. Hydrate on the Go\nCarry a Portable Pet Travel Water Bottle so fresh water is always one hand away.\n\n## 2. Protect Your Car\nA waterproof Pet Car Seat Protector keeps your car clean from fur, dirt, and spills.\n\n## 3. Pack a Routine\nFamiliar food, bowls, and a favorite toy reduce travel anxiety.\n\n## 4. Take Breaks\nStop every 2-3 hours for bathroom breaks, water, and leg stretching.\n\n## 5. Never Leave Alone in a Car\nEven with windows cracked, cars heat up dangerously fast. Never leave your pet unattended.\n\n## 6. Update ID Tags\nEnsure your pet\u2019s tags and microchip info are current before you leave.\n\n## 7. Book Pet-Friendly Stays\nConfirm pet policies in advance so there are no surprises at check-in.', image:'https://images.pexels.com/photos/127028/pexels-photo-127028.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['travel','road trip','pet accessories','tips'], authorId:'u2', authorName:'Sarah Johnson', status:'published', date:'2025-02-05' },
  { id:'b8', slug:'slow-feeding-explained', title:'Slow Feeding Explained: Why Your Dog Gobbles Food', excerpt:'Fast eating can cause bloating and digestive issues. Here\u2019s how slow feeder bowls help.', content:'Does your dog inhale dinner in seconds? Slow feeding might be the answer.\n\n## The Danger of Fast Eating\nGobbling causes air swallowing, bloating, and vomiting. In deep-chested breeds, it can even lead to a dangerous condition called gastric dilatation-volvulus.\n\n## How Slow Feeders Work\nRaised ridges and maze-like patterns force your dog to work for each mouthful, slowing them down naturally.\n\n## Benefits Beyond Speed\nSlow feeders turn mealtime into a mini puzzle — great mental enrichment for energetic dogs.\n\n## Making the Switch\nTransition gradually by mixing old and new bowls. Most dogs adapt within a few days.\n\n## When to Consult a Vet\nIf your dog refuses food entirely or shows signs of distress, consult your veterinarian.', image:'https://images.pexels.com/photos/5732487/pexels-photo-5732487.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['slow feeder','feeding','digestion','dog'], authorId:'u3', authorName:'Mike Williams', status:'published', date:'2025-01-30' },
  { id:'b9', slug:'online-pet-shopping-safety-tips', title:'10 Online Pet Shopping Safety Tips to Protect Your Money', excerpt:'Stay safe while buying pet supplies online. Expert tips to avoid scams and protect your personal information.', content:'Online shopping for pet supplies is convenient but requires awareness. Protect yourself with these tips.\n\n## 1. Shop on Secure Sites\nLook for HTTPS and the lock icon. Curated stores like Luxedge use 256-bit SSL encryption.\n\n## 2. Use Strong Passwords\nNever reuse passwords across shopping sites. Use a password manager.\n\n## 3. Check Return Policies\nBefore buying, know the return policy. Luxedge offers 30-day hassle-free returns.\n\n## 4. Read Real Reviews\nLook for verified purchase reviews with photos. Be wary of generic 5-star ratings.\n\n## 5. Use Credit Cards, Not Debit\nCredit cards offer better fraud protection than debit cards.\n\n## 6. Avoid Public WiFi\nNever enter payment info on public networks.\n\n## 7. Monitor Your Statements\nCheck bank statements regularly for unauthorized charges.\n\n## 8. Be Wary of Too-Good Deals\nIf a price seems impossibly low, it probably is.\n\n## 9. Use Trusted Payment Methods\nPayPal and Stripe provide buyer protection layers.\n\n## 10. Keep Software Updated\nUpdated browsers and devices have the latest security patches.', image:'https://images.pexels.com/photos/164186/pexels-photo-164186.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['online shopping','safety','security','tips'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-01-25' },
  { id:'b10', slug:'choosing-the-right-dog-bed', title:'Choosing the Right Dog Bed: A Complete Guide', excerpt:'Size, support, and washability — here\u2019s everything you need to pick the perfect bed for your dog.', content:'The right bed can transform your dog\u2019s sleep. Here\u2019s how to choose.\n\n## Consider Age & Health\nSenior dogs and large breeds benefit from orthopedic memory foam that supports joints and relieves pressure points.\n\n## Size Matters\nYour dog should stretch out fully with room to spare. Measure your dog from nose to tail and add a few inches.\n\n## Think About Cleanup\nDogs bring dirt and shedding inside. Choose a bed with a removable, washable cover.\n\n## Match the Personality\nCurlers love donut-style cuddler beds. Stretchers prefer flat, open beds. Watch how your dog sleeps to pick the right shape.\n\n## Location, Location\nPlace the bed somewhere quiet and draft-free. Your dog should feel safe and secure in their spot.', image:'https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['dog bed','sleep','orthopedic','guide'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-01-20' },
  { id:'b11', slug:'sustainable-pet-care', title:'Sustainable Pet Care: How to Buy Better, Not More', excerpt:'Make environmentally conscious choices for your pets without sacrificing quality or comfort.', content:'Sustainability starts with intentional purchasing decisions — even for your pets.\n\n## Buy Quality Over Quantity\nOne well-made pet bed that lasts years beats five cheap ones that fall apart in months. Luxedge curates for durability.\n\n## Choose Durable Materials\nStainless steel fountains and bowls outlast plastic and are easier to keep hygienic.\n\n## Support Transparent Brands\nBrands that share their sourcing and manufacturing processes are worth your support.\n\n## Reduce Packaging Waste\nChoose retailers that use minimal, recyclable packaging.\n\n## Care for What You Own\nWash beds and toys properly to extend their life. Replace only what\u2019s truly worn out.\n\n## The 30-Day Rule\nBefore impulse buying, wait 30 days. If your pet still needs it, it\u2019s a genuine purchase — not a passing urge.', image:'https://images.pexels.com/photos/2607544/pexels-photo-2607544.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['sustainable','eco friendly','conscious shopping','pets'], authorId:'u2', authorName:'Sarah Johnson', status:'published', date:'2025-01-15' },
  { id:'b12', slug:'habits-happier-healthier-pet', title:'15 Everyday Habits for a Happier, Healthier Pet', excerpt:'Small daily routines make a huge difference. Here are 15 habits your pet will thank you for.', content:'Consistency is the secret to a happy pet. Here are 15 habits that genuinely work.\n\n## 1. Fixed Feeding Times\nRegular meal schedules support digestion and potty training.\n\n## 2. Fresh Water Daily\nRefill bowls twice a day — or invest in a pet water fountain for constant freshness.\n\n## 3. Daily Playtime\nTen minutes of active play burns energy and strengthens your bond.\n\n## 4. Weekly Grooming\nRegular brushing prevents mats and spreads healthy oils.\n\n## 5. Regular Walks\nDogs need daily walks for exercise, mental stimulation, and socialization.\n\n## 6. Weight Checks\nKeep your pet at a healthy weight with regular check-ins.\n\n## 7. Dental Care\nDental treats and regular brushing protect long-term health.\n\n## 8-15: Advanced Habits\nSchedule vet checkups. Rotate toys. Reward calm behavior. Keep a consistent bedtime. Trim nails monthly. Clean bedding weekly. Watch for changes in appetite. And most importantly — give plenty of love every single day.', image:'https://images.pexels.com/photos/2194261/pexels-photo-2194261.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['habits','health','routine','pets'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-01-10' },
];

export const CAT_LIST = ['All', 'Dog Supplies', 'Cat Supplies', 'Pet Beds', 'Pet Toys', 'Feeding & Water', 'Grooming', 'Pet Accessories'];
const CAT_META: Record<string, { icon: string; emoji: string; desc: string; img: string }> = {
  'Dog Supplies': { icon: '🐕', emoji: '🐶', desc: 'Harnesses, training & dog essentials', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Dog_in_a_harness.jpg/960px-Dog_in_a_harness.jpg' },
  'Cat Supplies': { icon: '🐈', emoji: '🐱', desc: 'Scratchers, towers & cat must-haves', img: 'https://upload.wikimedia.org/wikipedia/commons/5/58/Baukasten_Cathome.jpg' },
  'Pet Beds': { icon: '🛏️', emoji: '😴', desc: 'Orthopedic & cozy beds for deep sleep', img: 'https://upload.wikimedia.org/wikipedia/commons/f/f4/Dog_sleeping_in_a_dog_bed.JPG' },
  'Pet Toys': { icon: '🧸', emoji: '🪀', desc: 'Interactive toys for play & enrichment', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Miyako_is_playing_with_a_fishing-rod_toy_%287756356192%29.jpg/960px-Miyako_is_playing_with_a_fishing-rod_toy_%287756356192%29.jpg' },
  'Feeding & Water': { icon: '🍽️', emoji: '🥣', desc: 'Bowls, fountains & smart feeders', img: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/A_cat_drinking_water.jpg' },
  'Grooming': { icon: '✂️', emoji: '🐾', desc: 'Brushes, clippers & coat care', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Dog_brush.JPG/960px-Dog_brush.JPG' },
  'Pet Accessories': { icon: '🎒', emoji: '🐾', desc: 'Travel, car care & everyday extras', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Dog_wearing_seat_belt.jpg/960px-Dog_wearing_seat_belt.jpg' },
};
const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const fromSlug = (slug: string) => CAT_LIST.find(c => toSlug(c) === slug) || 'All';

// ============================================================================
// CONTEXT
// ============================================================================
interface Ctx {
  user: AppUser | null; cart: CartItem[]; orders: Order[];
  products: Product[]; users: AppUser[]; reviews: Review[]; categories: AdminCategory[];
  blogs: BlogPost[]; setBlogs: React.Dispatch<React.SetStateAction<BlogPost[]>>;
  adminCreds: AppUser;
  login: (e: string, p: string, admin?: boolean) => boolean;
  guestLogin: () => void;
  logout: () => void; signup: (n: string, e: string, p: string) => boolean;
  changePassword: (current: string, newPass: string) => { ok: boolean; msg: string };
  updateAdminProfile: (name: string, email: string) => void;
  addToCart: (p: Product) => void; removeFromCart: (id: string) => void;
  updateQty: (id: string, q: number) => void; clearCart: () => void;
  placeOrder: (addr: string) => string;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>;
  setCategories: React.Dispatch<React.SetStateAction<AdminCategory[]>>;
  cartOpen: boolean; openCart: () => void; closeCart: () => void;
  notif: string | null; notify: (m: string, type?: 'success' | 'error' | 'info') => void;
}
const AC = createContext<Ctx | null>(null);
export function useApp() { const c = useContext(AC); if (!c) throw new Error('no ctx'); return c; }

const CART_STORAGE_KEY = 'luxedge_cart';

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: CartItem[] = [];
    for (const entry of parsed) {
      const e = entry as Partial<CartItem>;
      if (
        e && typeof e === 'object' &&
        e.product && typeof e.product.id === 'string' &&
        typeof e.quantity === 'number' && e.quantity > 0
      ) {
        items.push({ product: e.product, quantity: Math.floor(e.quantity) });
      }
    }
    return items;
  } catch {
    return [];
  }
}

const SESSION_STORAGE_KEY = 'luxedge_session';

function loadSession(): AppUser | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const u = parsed as Partial<AppUser>;
    if (
      typeof u.id === 'string' &&
      typeof u.email === 'string' &&
      typeof u.password === 'string' &&
      typeof u.name === 'string' &&
      (u.role === 'admin' || u.role === 'buyer')
    ) {
      return { id: u.id, email: u.email, password: u.password, name: u.name, role: u.role, isBlocked: u.isBlocked, joined: u.joined };
    }
    return null;
  } catch {
    return null;
  }
}

function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(loadSession);
  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [orders, setOrders] = useState<Order[]>(INIT_ORDERS);
  // PRODUCTION CATALOG RESET HOTFIX (Phase 4E.2): the customer storefront must
  // NOT initialize from demo products. Zero demo product may be reachable on
  // the customer storefront path — the catalog starts empty until genuinely
  // approved products exist. (Demo fixtures above remain only as admin/dev
  // data and are never the storefront source of truth.)
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<AppUser[]>(INIT_USERS);
  const [reviews, setReviews] = useState<Review[]>(INIT_REVIEWS);
  const [categories, setCategories] = useState<AdminCategory[]>(INIT_CATEGORIES);
  const [blogs, setBlogs] = useState<BlogPost[]>(INIT_BLOGS);
  const [adminCreds, setAdminCreds] = useState<AppUser>(INIT_ADMIN);
  const [notif, setNotif] = useState<string | null>(null);
  const notify = (m: string, _type?: 'success' | 'error' | 'info') => { setNotif(m); setTimeout(() => setNotif(null), 3000); };
  const [cartOpen, setCartOpen] = useState(false);
  const openCart = useCallback(() => setCartOpen(true), []);
  const closeCart = useCallback(() => setCartOpen(false), []);

  // Persist the cart so items survive a page refresh.
  useEffect(() => {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch { /* storage full or unavailable */ }
  }, [cart]);

  // Persist the signed-in user so the session survives a page refresh.
  useEffect(() => {
    try {
      if (user) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch { /* storage full or unavailable */ }
  }, [user]);

  const login = (e: string, p: string, admin = false) => {
    // Admin login — checks against live adminCreds state
    if (admin) {
      if (e === adminCreds.email && p === adminCreds.password) {
        setUser({ ...adminCreds });
        useAuthStore.getState().adminLogin(e, p);
        notify('Welcome Admin!');
        return true;
      }
      return false;
    }
    // Admin credentials also work through the storefront login
    if (e.toLowerCase() === adminCreds.email.toLowerCase() && p === adminCreds.password) {
      setUser({ ...adminCreds });
      useAuthStore.getState().adminLogin(e, p);
      notify('Welcome Admin!');
      return true;
    }
    // Buyer login — check registered users first, then allow new
    const existing = users.find(u => u.email.toLowerCase() === e.toLowerCase());
    if (existing) {
      if (existing.password === p) {
        if (existing.isBlocked) { notify('Account blocked. Contact support.'); return false; }
        setUser(existing);
        useAuthStore.getState().login(e, p);
        notify('Login successful!');
        return true;
      }
      return false; // wrong password for existing user
    }
    // New user auto-register
    if (p.length >= 6) {
      const newUser: AppUser = { id: `u${Date.now()}`, email: e, password: p, name: e.split('@')[0], role: 'buyer', joined: new Date().toISOString().slice(0, 10) };
      setUsers(prev => [...prev, newUser]);
      setUser(newUser);
      notify('Account created & logged in!');
      return true;
    }
    return false;
  };

  const guestLogin = () => {
    const guest: AppUser = { id: `guest-${Date.now()}`, email: 'guest@luxedge.us', password: '', name: 'Guest', role: 'buyer', joined: new Date().toISOString().slice(0, 10) };
    setUser(guest);
    notify('Shopping as guest — no account needed!');
  };

  const logout = () => { setUser(null); notify('Logged out'); };

  const signup = (n: string, e: string, p: string) => {
    if (users.some(u => u.email.toLowerCase() === e.toLowerCase())) { notify('Email already registered'); return false; }
    if (p.length >= 6) {
      const newUser: AppUser = { id: `u${Date.now()}`, email: e, password: p, name: n, role: 'buyer', joined: new Date().toISOString().slice(0, 10) };
      setUsers(prev => [...prev, newUser]);
      setUser(newUser);
      useAuthStore.getState().signup(n, e, p);
      notify('Account created!');
      return true;
    }
    return false;
  };

  const changePassword = (current: string, newPass: string): { ok: boolean; msg: string } => {
    if (!user) return { ok: false, msg: 'Not logged in' };
    // Check current password
    if (user.role === 'admin') {
      if (current !== adminCreds.password) return { ok: false, msg: 'Current password is incorrect' };
      if (newPass.length < 6) return { ok: false, msg: 'New password must be at least 6 characters' };
      const updated = { ...adminCreds, password: newPass };
      setAdminCreds(updated);
      setUser(updated);
      useAuthStore.getState().changePassword(current, newPass);
      return { ok: true, msg: 'Password updated successfully!' };
    } else {
      if (current !== user.password) return { ok: false, msg: 'Current password is incorrect' };
      if (newPass.length < 6) return { ok: false, msg: 'New password must be at least 6 characters' };
      const updated = { ...user, password: newPass };
      setUser(updated);
      setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
      useAuthStore.getState().changePassword(current, newPass);
      return { ok: true, msg: 'Password updated successfully!' };
    }
  };

  const updateAdminProfile = (name: string, email: string) => {
    if (user?.role === 'admin') {
      const updated = { ...adminCreds, name, email };
      setAdminCreds(updated);
      setUser(updated);
      notify('Profile updated!');
    }
  };
  const addToCart = (p: Product) => { setCart(prev => { const ex = prev.find(i => i.product.id === p.id); return ex ? prev.map(i => i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i) : [...prev, { product: p, quantity: 1 }]; }); setCartOpen(true); trackEvent('add_to_cart', { currency: 'USD', value: p.price, items: [{ item_id: p.id, item_name: p.name, price: p.price, quantity: 1 }], ...utmParams() }); notify(`Added to cart!`); };
  const removeFromCart = (id: string) => setCart(p => p.filter(i => i.product.id !== id));
  const updateQty = (id: string, q: number) => { if (q <= 0) removeFromCart(id); else setCart(p => p.map(i => i.product.id === id ? { ...i, quantity: q } : i)); };
  const clearCart = () => setCart([]);
  const placeOrder = (addr: string) => { const oid = `ORD-${Date.now()}`; const t = cart.reduce((s, i) => s + i.product.price * i.quantity, 0); setOrders(p => [{ id: oid, userId: user?.id || '', userName: user?.name || '', items: [...cart], total: t, status: 'Pending', date: new Date().toISOString(), address: addr }, ...p]); trackEvent('purchase', { currency: 'USD', value: t, transaction_id: oid, items: cart.map(i => ({ item_id: i.product.id, item_name: i.product.name, price: i.product.price, quantity: i.quantity })), ...utmParams() }); clearCart(); return oid; };

  return <AC.Provider value={{ user, cart, orders, products, users, reviews, categories, blogs, setBlogs, adminCreds, login, guestLogin, logout, signup, changePassword, updateAdminProfile, addToCart, removeFromCart, updateQty, clearCart, placeOrder, setProducts, setOrders, setUsers, setReviews, setCategories, cartOpen, openCart, closeCart, notif, notify }}>{children}</AC.Provider>;
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================
function Toast() { const { notif } = useApp(); if (!notif) return null; return <div className="fixed bottom-6 right-6 z-[200] animate-fade-in"><div className="bg-gray-900 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm"><CheckCircle size={18} className="text-green-400" />{notif}</div></div>; }

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ============================================================================
// HEADER + FOOTER (STORE)
// ============================================================================
// ── Header mega menu data (maps to real category routes) ──
const MEGA_MENU: { label: string; to: string; icon: string; groups: { title: string; links: { label: string; to: string }[] }[] }[] = [
  {
    label: 'Dog', to: '/category/dog-supplies', icon: '🐶',
    groups: [
      { title: 'Walking & Gear', links: [{ label: 'Harnesses & Collars', to: '/category/dog-supplies' }, { label: 'Travel Accessories', to: '/category/pet-accessories' }] },
      { title: 'Comfort', links: [{ label: 'Beds', to: '/category/pet-beds' }, { label: 'Blankets & Mats', to: '/category/pet-beds' }] },
      { title: 'Feeding', links: [{ label: 'Bowls & Feeders', to: '/category/feeding-water' }, { label: 'Water Bottles', to: '/category/feeding-water' }] },
      { title: 'Grooming', links: [{ label: 'Brushes', to: '/category/grooming' }, { label: 'Grooming Tools', to: '/category/grooming' }] },
      { title: 'Play', links: [{ label: 'Chew Toys', to: '/category/pet-toys' }, { label: 'Rope & Tug Toys', to: '/category/pet-toys' }] },
    ],
  },
  {
    label: 'Cat', to: '/category/cat-supplies', icon: '🐱',
    groups: [
      { title: 'Play', links: [{ label: 'Toys & Wands', to: '/category/pet-toys' }, { label: 'Scratching', to: '/category/cat-supplies' }] },
      { title: 'Comfort', links: [{ label: 'Beds & Caves', to: '/category/pet-beds' }, { label: 'Perches & Towers', to: '/category/cat-supplies' }] },
      { title: 'Feeding', links: [{ label: 'Bowls & Fountains', to: '/category/feeding-water' }, { label: 'Feeders', to: '/category/feeding-water' }] },
      { title: 'Grooming', links: [{ label: 'Brushes', to: '/category/grooming' }, { label: 'Nail Care', to: '/category/grooming' }] },
    ],
  },
];

function Header() {
  const [mob, setMob] = useState(false);
  const [um, setUm] = useState(false);
  const [hq, setHq] = useState('');
  const [mega, setMega] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  const goTo = useNavigate();
  const { user, cart, logout, openCart } = useApp();
  const cc = cart.reduce((s, i) => s + i.quantity, 0);

  // Elevate the header with a soft shadow once the page is scrolled
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const submitSearch = (ev: React.FormEvent) => {
    ev.preventDefault();
    const t = hq.trim();
    if (t) trackEvent('search', { search_term: t, ...utmParams() });
    goTo(t ? `/shop?q=${encodeURIComponent(t)}` : '/shop');
    setHq('');
    setMob(false);
  };
  useEffect(() => { setMob(false); setUm(false); setMega(null); }, [loc.pathname]);
  const nav = [{ p: '/', l: 'Home' }, { p: '/shop', l: 'Shop' }, { p: '/blog', l: 'Blog' }, { p: '/about', l: 'About' }, { p: '/contact', l: 'Contact' }];
  const catNav = [
    { l: 'Dog', to: '/category/dog-supplies' },
    { l: 'Cat', to: '/category/cat-supplies' },
    { l: 'Food & Feeding', to: '/category/feeding-water' },
    { l: 'Toys', to: '/category/pet-toys' },
    { l: 'Beds', to: '/category/pet-beds' },
    { l: 'Grooming', to: '/category/grooming' },
    { l: 'Travel & Accessories', to: '/category/pet-accessories' },
  ];
  const isActive = (p: string) => (p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p));

  return (<>
    {/* ── Top utility bar ── */}
    <div className="bg-luxe-gold text-white text-center px-4 py-1.5 text-[11px] tracking-wide font-medium">
      <span className="inline-flex items-center gap-1.5 text-white/95"><Truck size={12} /> Free Shipping $50+</span>
      <span className="mx-2.5 text-white/40 hidden sm:inline" aria-hidden="true">|</span>
      <span className="hidden sm:inline-flex items-center gap-1.5 text-white/95"><RotateCcw size={12} /> Easy 30-Day Returns</span>
      <span className="mx-2.5 text-white/40 hidden md:inline" aria-hidden="true">|</span>
      <span className="hidden md:inline-flex items-center gap-1.5 text-white/95"><Headphones size={12} /> Customer Support</span>
    </div>

    {/* ── Main header ── */}
    <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/90 backdrop-blur-xl shadow-[0_10px_34px_-14px_rgba(16,26,46,0.22)]' : 'bg-white/95 backdrop-blur-md'} border-b border-luxe-silver/70`}>
      <div className="max-w-7xl mx-auto px-4 h-16 lg:h-[4.5rem] flex items-center justify-between gap-3">
        <button onClick={() => setMob(!mob)} aria-label="Menu" aria-expanded={mob} className="lg:hidden p-2 -ml-1.5 hover:bg-luxe-cream rounded-lg text-luxe-black transition-colors">{mob ? <X size={20} /> : <Menu size={20} />}</button>
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group" aria-label="Luxedge home">
          <img src="/luxedge-mark.svg" alt="" className="h-9 sm:h-10 w-auto transition-transform duration-300 group-hover:scale-105" />
          <span className="flex flex-col leading-none">
            <span className="font-brand text-lg sm:text-xl font-bold tracking-[0.18em] text-luxe-black">LUXEDGE</span>
            <span className="hidden sm:block text-[7.5px] tracking-[0.3em] text-luxe-gold mt-1.5">PREMIUM PET ESSENTIALS</span>
          </span>
        </Link>

        {/* Search — refined pill */}
        <form onSubmit={submitSearch} role="search" className="hidden md:flex flex-1 max-w-xl mx-4">
          <div className="flex items-center w-full bg-luxe-cream border border-luxe-silver rounded-full overflow-hidden focus-within:border-luxe-gold focus-within:ring-4 focus-within:ring-luxe-gold/10 transition-all">
            <Search size={15} className="ml-4 text-luxe-gray shrink-0" />
            <input value={hq} onChange={e => setHq(e.target.value)} placeholder="Search beds, toys, grooming & more" aria-label="Search products"
              className="flex-1 px-3 py-2.5 text-sm text-luxe-black placeholder-luxe-gray/70 focus:outline-none bg-transparent" />
            <button type="submit" className="m-1 px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-[10px] font-bold uppercase tracking-widest rounded-full transition-colors">
              Search
            </button>
          </div>
        </form>

        <div className="flex items-center gap-0.5 sm:gap-1">
          {user ? (
            <div className="relative">
              <button onClick={() => setUm(!um)} aria-label="Account menu" aria-expanded={um} className="flex items-center gap-1.5 p-2 hover:bg-luxe-cream rounded-lg text-luxe-charcoal transition-colors">
                <span className="w-8 h-8 rounded-full bg-luxe-gold text-white flex items-center justify-center text-[12px] font-bold ring-1 ring-luxe-white/40">{user.name[0]}</span>
                <span className="hidden lg:block text-xs font-medium">{user.name.split(' ')[0]}</span>
              </button>
              {um && <><div className="fixed inset-0 z-40" onClick={() => setUm(false)} /><div className="absolute right-0 top-full mt-1.5 w-56 rounded-2xl shadow-xl border border-luxe-silver bg-white py-1.5 z-50 animate-scale-in">
                <div className="px-3.5 py-2.5 border-b border-luxe-silver/70"><p className="font-semibold text-xs text-luxe-black">{user.name}</p><p className="text-[10px] text-luxe-gray mt-0.5">{user.email}</p></div>
                {user.role === 'admin' && <Link to="/admin" className="flex items-center gap-2 px-3.5 py-2 text-xs text-luxe-charcoal hover:bg-luxe-cream transition-colors"><LayoutDashboard size={14} className="text-luxe-gold" />Admin Panel</Link>}
                <Link to="/orders" className="flex items-center gap-2 px-3.5 py-2 text-xs text-luxe-charcoal hover:bg-luxe-cream transition-colors"><Package size={14} className="text-luxe-gray" />My Orders</Link>
                <button onClick={logout} className="flex items-center gap-2 px-3.5 py-2 text-xs text-luxe-red hover:bg-luxe-cream w-full text-left transition-colors"><LogOut size={14} />Log Out</button>
              </div></>}
            </div>
          ) : (
            <Link to="/login" className="flex items-center gap-1.5 p-2 hover:bg-luxe-cream rounded-lg text-luxe-charcoal transition-colors">
              <UserIcon size={18} /><span className="hidden sm:inline text-xs font-medium">Sign In</span>
            </Link>
          )}
          <button onClick={openCart} className="relative p-2 hover:bg-luxe-cream rounded-lg text-luxe-charcoal transition-colors" aria-label={`Open cart, ${cc} item${cc === 1 ? '' : 's'}`}>
            <ShoppingBag size={19} />
            {cc > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-luxe-gold text-white flex items-center justify-center text-[9px] font-bold">{cc}</span>}
          </button>
        </div>
      </div>

      {/* ── Pet navigation bar ── */}
      <nav className="hidden lg:block border-t border-luxe-silver/60 bg-white/70 backdrop-blur-md" aria-label="Shop categories">
        <div className="max-w-7xl mx-auto px-4 flex items-center">
          {MEGA_MENU.map(m => (
            <div key={m.label} className="relative" onMouseEnter={() => setMega(m.label)} onMouseLeave={() => setMega(null)}>
              <Link to={m.to} className="nav-underline flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-luxe-charcoal hover:text-luxe-black transition-colors">
                <span aria-hidden="true">{m.icon}</span>{m.label}<ChevronDown size={13} className={`text-luxe-gray transition-transform duration-200 ${mega === m.label ? 'rotate-180' : ''}`} />
              </Link>
              {mega === m.label && (
                <div className="absolute left-0 top-full pt-2 z-50 w-[580px]">
                  <div className="bg-white rounded-2xl border border-luxe-silver shadow-xl p-6 animate-fade-in-up">
                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-luxe-silver/70">
                      <p className="font-brand text-[11px] font-bold uppercase tracking-[0.18em] text-luxe-black">{m.icon} Shop {m.label}</p>
                      <Link to={m.to} className="text-[11px] font-bold text-luxe-gold hover:text-luxe-gold-dark transition-colors">View All →</Link>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                      {m.groups.map(g => (
                        <div key={g.title}>
                          <p className="eyebrow mb-2">{g.title}</p>
                          {g.links.map(l => <Link key={l.label} to={l.to} className="block py-1 text-[13px] text-luxe-gray hover:text-luxe-gold hover:translate-x-0.5 transition-all">{l.label}</Link>)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {catNav.filter(c => !MEGA_MENU.some(m => m.label === c.l)).map(c => (
            <Link key={c.l} to={c.to} className="nav-underline px-4 py-2.5 text-sm font-semibold text-luxe-charcoal hover:text-luxe-black transition-colors">{c.l}</Link>
          ))}
          <Link to="/shop?q=deal" className="ml-auto px-4 py-2.5 text-sm font-bold text-luxe-gold hover:text-luxe-gold-dark transition-colors flex items-center gap-1.5"><Zap size={13} /> Deals</Link>
        </div>
      </nav>

      {/* ── Mobile menu ── */}
      {mob && <div className="lg:hidden border-t border-luxe-silver/70 px-3 py-2 space-y-1 animate-fade-in-up bg-white">
        <form onSubmit={submitSearch} role="search" className="flex items-center bg-luxe-cream border border-luxe-silver rounded-full overflow-hidden mb-2">
          <Search size={15} className="ml-3 text-luxe-gray shrink-0" />
          <input value={hq} onChange={e => setHq(e.target.value)} placeholder="Search products..." aria-label="Search products"
            className="flex-1 px-2.5 py-2 text-sm text-luxe-black placeholder-luxe-gray/70 focus:outline-none bg-transparent" />
          <button type="submit" className="px-3.5 py-2 bg-luxe-gold text-white text-[10px] font-bold uppercase tracking-wider rounded-full">Go</button>
        </form>
        <div className="flex flex-wrap gap-1.5 pt-1 pb-2 border-b border-luxe-silver/70">
          {catNav.map(c => <Link key={c.l} to={c.to} className="px-3 py-1.5 rounded-full bg-luxe-cream text-[11px] font-semibold text-luxe-charcoal hover:bg-luxe-gold hover:text-white transition-colors">{c.l}</Link>)}
          <Link to="/shop?q=deal" className="px-3 py-1.5 rounded-full bg-luxe-gold-soft text-[11px] font-bold text-luxe-gold-dark hover:bg-luxe-gold hover:text-white transition-colors">Deals</Link>
        </div>
        {nav.map(i => <Link key={i.p} to={i.p} aria-current={isActive(i.p) ? 'page' : undefined} className="block px-3 py-2 text-[13px] font-medium rounded-lg text-luxe-charcoal hover:bg-luxe-cream transition-colors">{i.l}</Link>)}
        {!user && <Link to="/login" className="block px-3 py-2 text-[13px] font-medium rounded-lg text-luxe-gold hover:bg-luxe-cream transition-colors">Sign In</Link>}
      </div>}
    </header>
  </>);
}

function Footer() {
  const { categories } = useApp();

  const FL = 'block text-sm text-luxe-white/70 hover:text-luxe-gold-light transition-colors py-1';
  const COLT = 'font-brand text-xs font-bold uppercase tracking-[0.22em] text-luxe-gold-light mb-4';

  return (
    <footer className="bg-luxe-black text-luxe-white">
      {/* Gold hairline divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-luxe-gold/60 to-transparent" aria-hidden="true" />

      {/* ── Main Footer Grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-10">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-8 gap-y-10">

          {/* Col 1 — Brand */}
          <div className="col-span-2">
            <Link to="/" className="flex items-center gap-3 mb-5 group w-fit" aria-label="Luxedge home">
              <img src="/luxedge-mark.svg" alt="" className="w-11 h-11 transition-transform duration-300 group-hover:scale-105" />
              <span className="flex flex-col leading-none">
                <span className="font-brand text-xl font-bold tracking-[0.18em] text-luxe-white">LUXEDGE</span>
                <span className="text-[8px] tracking-[0.3em] text-luxe-gold-light mt-1.5">PREMIUM PET ESSENTIALS</span>
              </span>
            </Link>
            <p className="text-luxe-white/60 text-sm leading-relaxed mb-6 max-w-xs">
              Curating the world's best pet essentials so you shop with confidence. Premium quality, honest prices, delivered to your door.
            </p>
            <div className="flex gap-2.5">
              {[
                { label: 'Facebook', letter: 'f' },
                { label: 'Instagram', letter: 'i' },
                { label: 'TikTok', letter: 'T' },
                { label: 'YouTube', letter: 'Y' },
              ].map(s => (
                <a key={s.label} href="#" title={s.label} aria-label={s.label}
                  className="w-9 h-9 bg-luxe-white/5 border border-luxe-white/15 hover:bg-luxe-gold hover:border-luxe-gold rounded-lg flex items-center justify-center transition-all duration-300 group">
                  <span className="text-luxe-white/70 group-hover:text-luxe-black text-sm font-bold">{s.letter.toUpperCase()}</span>
                </a>
              ))}
            </div>
          </div>

          {/* Col 2 — Shop */}
          <div>
            <h4 className={COLT}>Shop</h4>
            <nav className="space-y-0.5" aria-label="Shop">
              <Link to="/category/dog-supplies" className={FL}>Dog</Link>
              <Link to="/category/cat-supplies" className={FL}>Cat</Link>
              <Link to="/category/pet-toys" className={FL}>Toys</Link>
              <Link to="/category/pet-beds" className={FL}>Beds</Link>
              <Link to="/category/feeding-water" className={FL}>Feeding</Link>
              <Link to="/category/grooming" className={FL}>Grooming</Link>
              <Link to="/shop" className={FL}>Deals</Link>
            </nav>
          </div>

          {/* Col 3 — Help */}
          <div>
            <h4 className={COLT}>Help</h4>
            <nav className="space-y-0.5" aria-label="Help">
              <Link to="/contact" className={FL}>Contact Us</Link>
              <Link to="/faq" className={FL}>FAQs</Link>
              <Link to="/shipping-policy" className={FL}>Shipping</Link>
              <Link to="/returns" className={FL}>Returns</Link>
              <Link to="/orders" className={FL}>Track Order</Link>
            </nav>
          </div>

          {/* Col 4 — Company */}
          <div>
            <h4 className={COLT}>Company</h4>
            <nav className="space-y-0.5" aria-label="Company">
              <Link to="/about" className={FL}>About</Link>
              <Link to="/blog" className={FL}>Blog</Link>
              <Link to="/privacy" className={FL}>Privacy</Link>
              <Link to="/terms" className={FL}>Terms</Link>
              <Link to="/careers" className={FL}>Careers</Link>
            </nav>
          </div>

          {/* Col 5 — Contact */}
          <div className="col-span-2 md:col-span-1">
            <h4 className={COLT}>Contact</h4>
            <div className="space-y-2.5">
              <a href="mailto:hello@luxedge.us" className="flex items-start gap-2.5 text-sm text-luxe-white/70 hover:text-luxe-gold-light transition-colors">
                <Mail size={15} className="text-luxe-gold-light mt-0.5 shrink-0" />
                hello@luxedge.us
              </a>
              <a href="tel:4409418002" className="flex items-start gap-2.5 text-sm text-luxe-white/70 hover:text-luxe-gold-light transition-colors">
                <Phone size={15} className="text-luxe-gold-light mt-0.5 shrink-0" />
                (440) 941-8002
              </a>
              <div className="flex items-start gap-2.5 text-sm text-luxe-white/70">
                <MapPin size={15} className="text-luxe-gold-light mt-0.5 shrink-0" />
                Irving, TX 75038, USA
              </div>
              <div className="flex items-start gap-2.5 text-sm text-luxe-white/70">
                <Clock size={15} className="text-luxe-gold-light mt-0.5 shrink-0" />
                Mon – Fri, 9AM – 6PM CT
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Categories Bar ── */}
      <div className="border-t border-luxe-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="font-brand text-xs font-semibold uppercase tracking-[0.18em] text-luxe-gold-light">Shop by Category:</span>
            {categories.filter(c => c.isActive).map(c => (
              <Link key={c.id} to={`/category/${toSlug(c.name)}`} className="text-xs text-luxe-white/60 hover:text-luxe-gold-light transition-colors">{c.name}</Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── Trust & Payment Bar ── */}
      <div className="border-t border-luxe-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex flex-wrap items-center gap-5">
              {[
                { icon: Shield, text: 'Secure Checkout' },
                { icon: Truck, text: 'Free Shipping $50+' },
                { icon: RotateCcw, text: '30-Day Returns' },
                { icon: Headphones, text: 'Customer Support' },
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-luxe-white/70">
                  <b.icon size={14} className="text-luxe-gold-light" />
                  <span>{b.text}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-luxe-white/50 mr-1">We accept:</span>
              {['VISA', 'MC', 'AMEX', 'PayPal', 'Apple Pay'].map(c => (
                <span key={c} className="px-2.5 py-1 bg-luxe-white/5 border border-luxe-white/15 rounded-md text-[10px] font-bold text-luxe-white/80 tracking-wide">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Bar ── */}
      <div className="border-t border-luxe-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-luxe-white/50">
              © {new Date().getFullYear()} Luxedge. All rights reserved. | Irving, TX, USA
            </p>
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <Link to="/privacy" className="text-xs text-luxe-white/60 hover:text-luxe-gold-light transition-colors">Privacy Policy</Link>
              <span className="text-luxe-white/20" aria-hidden="true">|</span>
              <Link to="/terms" className="text-xs text-luxe-white/60 hover:text-luxe-gold-light transition-colors">Terms of Service</Link>
              <span className="text-luxe-white/20" aria-hidden="true">|</span>
              <Link to="/returns" className="text-xs text-luxe-white/60 hover:text-luxe-gold-light transition-colors">Return Policy</Link>
              <span className="text-luxe-white/20" aria-hidden="true">|</span>
              <Link to="/shop" className="text-xs text-luxe-white/60 hover:text-luxe-gold-light transition-colors">Sitemap</Link>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-luxe-white/50">
              <Globe size={12} className="text-luxe-gold-light" /> USD ($) · English
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function PCard({ product }: { product: Product }) {
  const { addToCart, user, notify } = useApp(); const nav = useNavigate();
  const d = Math.round((1 - product.price / product.originalPrice) * 100);
  const sold = product.reviews > 0 ? Math.floor(product.reviews * 0.87) : 0;
  return (
    <Link to={`/product/${product.id}`} className="block group">
      <div className="bg-white rounded-2xl overflow-hidden border border-luxe-silver/80 hover:border-luxe-gold/50 hover:shadow-[0_20px_44px_-18px_rgba(16,26,46,0.28)] hover:-translate-y-1 transition-all duration-300">
        <div className="relative bg-luxe-cream overflow-hidden">
          <img src={product.images[0]} alt={product.name} aria-hidden="true" loading="lazy" decoding="async" className="w-full aspect-square object-cover group-hover:scale-[1.05] transition-transform duration-500" />
          {d > 0 && <span className="absolute top-2.5 left-2.5 px-2 py-1 bg-sale text-white text-[10px] font-bold rounded-full leading-none shadow-sm">-{d}%</span>}
          <button aria-label="Save to wishlist"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); notify('Saved to wishlist ♥'); }}
            className="absolute top-2.5 right-2.5 w-8 h-8 bg-white/90 backdrop-blur rounded-full flex items-center justify-center text-luxe-gray hover:text-sale shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110">
            <Heart size={13} />
          </button>
          {product.stock <= 10 && product.stock > 0 && <span className="absolute top-12 right-2.5 px-1.5 py-0.5 bg-luxe-warning/95 text-white text-[9px] font-bold rounded-full leading-none">Low Stock</span>}
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); user ? addToCart(product) : nav('/login'); }}
            className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-[calc(100%-1.25rem)] py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white rounded-xl text-[11px] font-semibold shadow-lg translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-1.5">
            <ShoppingBag size={12} /> {user ? 'Add to Cart' : 'Sign in to Buy'}
          </button>
        </div>
        <div className="px-3.5 py-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="eyebrow truncate">{product.category}</p>
            <div className="flex items-center gap-1 shrink-0">
              <Star size={10} className="text-star fill-star" />
              <span className="text-[10px] font-semibold text-luxe-charcoal">{product.rating.toFixed(1)}</span>
            </div>
          </div>
          <h3 className="text-[13px] font-semibold text-luxe-black leading-snug line-clamp-2 min-h-[2.25rem] group-hover:text-luxe-gold-dark transition-colors">{product.name}</h3>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            <span className="text-[15px] font-bold text-luxe-black">${product.price.toFixed(2)}</span>
            {d > 0 && <span className="text-[11px] text-luxe-gray line-through">${product.originalPrice.toFixed(2)}</span>}
            <span className="ml-auto flex items-center gap-1 text-[9px] text-luxe-gray">
              <span className="w-1 h-1 rounded-full bg-luxe-gold" />
              {sold > 0 ? `${sold} sold` : 'New'}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Premium alias — one card component across the whole storefront
function PCardPremium({ product }: { product: Product }) {
  return <PCard product={product} />;
}


// Per-route document title for SEO
function RouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const brand = "Luxedge";
    const segs = pathname.split("/").filter(Boolean);
    const set = (t: string) => { document.title = t + " | " + brand; };
    const full = (t: string) => { document.title = t; };
    if (segs.length === 0) full("Luxedge — Premium Pet Essentials | Better Products for Happier Pets");
    else if (segs[0] === "shop") set("Shop All Products");
    else if (segs[0] === "category") set("Shop " + fromSlug(decodeURIComponent(segs[1] || "")));
    else if (segs[0] === "product") {
      const p = ALL_PRODUCTS.find((x) => x.id === decodeURIComponent(segs[1] || ""));
      set(p ? p.name : "Product");
    }
    else if (segs[0] === "cart") set("Shopping Cart");
    else if (segs[0] === "checkout") set("Secure Checkout");
    else if (segs[0] === "orders") set("My Orders");
    else if (segs[0] === "about") set("About Us");
    else if (segs[0] === "contact") set("Contact Us");
    else if (segs[0] === "privacy") set("Privacy Policy");
    else if (segs[0] === "terms") set("Terms of Service");
    else if (segs[0] === "returns") set("Return Policy");
    else if (segs[0] === "shipping-policy") set("Shipping Policy");
    else if (segs[0] === "faq") set("Frequently Asked Questions");
    else if (segs[0] === "careers") set("Careers");
    else if (segs[0] === "blog") set(segs[1] ? (segs[1] === "write" ? "Write a Post" : "Blog") : "Blog & Insights");
    else if (segs[0] === "login") set("Sign In");
    else if (segs[0] === "signup") set("Create Account");
    else if (segs[0] === "admin") set("Admin Dashboard");
    else set("Luxedge");
  }, [pathname]);
  return null;
}

// Scroll to top on every route change
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    // Also try parent frame scroll for iframe embeds
    try { if (window.parent !== window) { window.parent.postMessage({ type: 'scrollTop' }, '*'); } } catch(_) {}
  }, [pathname]);
  return null;
}

function SLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:bg-luxe-black focus:text-white focus:rounded-lg focus:text-sm">Skip to content</a>
      <ScrollToTop />
      <Header />
      <main id="main-content" className="flex-1">{children}</main>
      <Footer />
      <CartDrawer />
      <CookieConsent />
    </div>
  );
}

// ============================================================================
// PRODUCT DETAIL PAGE
// ============================================================================
function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { products, addToCart, user, reviews: allReviews, setReviews, notify } = useApp();
  const nav = useNavigate();
  const product = products.find(p => p.id === id);

  // ALL hooks MUST be before any return
  const [qty, setQty] = useState(1);
  const [selImg, setSelImg] = useState(0);
  const [selVariant, setSelVariant] = useState<ProductVariant | null>(null);
  const [tab, setTab] = useState<'desc' | 'specs' | 'reviews'>('desc');
  const [revForm, setRevForm] = useState({ rating: 5, comment: '' });
  const [showRevForm, setShowRevForm] = useState(false);
  const [selColor, setSelColor] = useState('');
  const [selSize, setSelSize] = useState('');

  // Scroll to top on product change
  useEffect(() => { window.scrollTo(0, 0); setSelImg(0); setSelVariant(null); setQty(1); setTab('desc'); if (product) { trackEvent('view_item', { currency: 'USD', value: product.price, items: [{ item_id: product.id, item_name: product.name, price: product.price }], ...utmParams() }); } }, [id, product?.id]);

  // Set initial color/size when product loads
  useEffect(() => {
    if (product && product.variants.length > 0) {
      const colors = [...new Set(product.variants.map(v => v.color).filter(Boolean))];
      const sizes = [...new Set(product.variants.map(v => v.size).filter(Boolean))];
      setSelColor(colors[0] || '');
      setSelSize(sizes[0] || '');
    }
  }, [product?.id]);

  // Update selected variant when color/size changes
  useEffect(() => {
    if (product && product.variants.length > 0) {
      const match = product.variants.find(v =>
        (!selColor || v.color === selColor) && (!selSize || v.size === selSize)
      );
      setSelVariant(match || null);
      if (match?.image) {
        const imgIdx = product.images.indexOf(match.image);
        if (imgIdx >= 0) setSelImg(imgIdx);
      }
    }
  }, [selColor, selSize, product?.id]);

  // Now safe to do early return AFTER all hooks
  if (!product) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-5xl mb-4">😕</p>
          <h2 className="text-2xl font-bold mb-2">Product Not Found</h2>
          <p className="text-gray-500 mb-6">This product may have been removed.</p>
          <Link to="/shop" className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full transition-colors">Back to Shop</Link>
        </div>
      </div>
    );
  }

  const reviews = allReviews.filter(r => r.productId === product.id && r.status === 'approved');
  const activePrice = selVariant ? selVariant.salePrice : product.price;
  const activeOriginal = selVariant ? selVariant.price : product.originalPrice;
  const activeStock = selVariant ? selVariant.stock : product.stock;
  const discount = activeOriginal > 0 ? Math.round((1 - activePrice / activeOriginal) * 100) : 0;
  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : product.rating;
  const uniqueColors = [...new Set(product.variants.map(v => v.color).filter(Boolean))];
  const uniqueSizes = [...new Set(product.variants.map(v => v.size).filter(Boolean))];

  const handleAddToCart = () => {
    if (!user) { nav('/login'); return; }
    if (activeStock === 0) return;
    for (let i = 0; i < qty; i++) addToCart(product);
    notify(`${qty}× ${product.name} added to cart!`);
  };

  const handleBuyNow = () => {
    if (!user) { nav('/login'); return; }
    if (activeStock === 0) return;
    for (let i = 0; i < qty; i++) addToCart(product);
    nav('/checkout');
  };

  const submitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { nav('/login'); return; }
    setReviews(prev => [{ id: `r${Date.now()}`, productId: product.id, productName: product.name, userName: user.name, rating: revForm.rating, comment: revForm.comment, status: 'pending', date: new Date().toISOString() }, ...prev]);
    notify('Review submitted! It will appear after approval.');
    setRevForm({ rating: 5, comment: '' });
    setShowRevForm(false);
  };

  const related = products.filter(p => p.isActive && p.id !== product.id && p.category === product.category).slice(0, 4);
  const relatedFallback = related.length === 0 ? products.filter(p => p.isActive && p.id !== product.id).slice(0, 4) : [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400 mb-5">
        <Link to="/" className="hover:text-luxe-gold transition-colors">Home</Link>
        <ChevronRight size={11} />
        <Link to="/shop" className="hover:text-luxe-gold transition-colors">Shop</Link>
        <ChevronRight size={11} />
        <Link to={`/category/${toSlug(product.category)}`} className="hover:text-luxe-gold transition-colors">{product.category}</Link>
        <ChevronRight size={11} />
        <span className="text-gray-700 truncate min-w-0 max-w-[220px] font-medium">{product.name}</span>
      </nav>

      <div className="grid lg:grid-cols-2 gap-6 lg:gap-10">
        {/* LEFT: Image Gallery */}
        <div className="lg:sticky lg:top-24 self-start">
          <div className="relative rounded-3xl overflow-hidden border border-luxe-silver/70 bg-luxe-cream shadow-md">
            <div className="aspect-[4/3]">
              <img key={selImg} src={product.images[selImg] || product.images[0]} alt={product.name} fetchPriority="high" decoding="async" className="w-full h-full object-cover" />
            </div>
            {discount > 0 && (
              <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                <span className="px-2 py-1 bg-sale text-white text-[10px] font-bold rounded-full shadow">-{discount}%</span>
              </div>
            )}
            {product.freeShipping && <span className="absolute top-3 right-3 px-2 py-1 bg-luxe-black/90 text-luxe-gold-light text-[9px] font-bold rounded-full">FREE SHIP</span>}
          </div>
          <div className="flex gap-2.5 mt-3 overflow-x-auto pb-1">
            {product.images.map((img, i) => (
              <button key={i} onClick={() => setSelImg(i)} aria-label={`View image ${i + 1}`}
                className={`w-16 h-16 rounded-xl overflow-hidden border-2 shrink-0 transition-all ${selImg === i ? 'border-luxe-gold ring-2 ring-luxe-gold/20 shadow-md' : 'border-luxe-silver hover:border-luxe-gold/50 opacity-80 hover:opacity-100'}`}>
                <img src={img} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT: Product Info — AliExpress-style premium */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {product.brand && <span className="text-[11px] font-bold text-luxe-gold uppercase tracking-wider">{product.brand}</span>}
            {product.condition !== 'New' && <span className="text-[11px] text-gray-400">| {product.condition}</span>}
            <span className="text-[11px] text-gray-500 px-2 py-0.5 bg-gray-100 rounded-full font-medium">{product.category}</span>
          </div>

          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-luxe-black tracking-tight mb-3">{product.name}</h1>

          {/* Rating */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star key={i} size={14} className={i < Math.round(avgRating) ? 'text-star fill-star' : 'text-gray-200'} />)}</div>
            <span className="text-xs font-semibold text-luxe-gold hover:underline cursor-pointer" onClick={() => setTab('reviews')}>{avgRating.toFixed(1)} ({reviews.length})</span>
            <span className="text-gray-300">|</span>
            <span className="text-xs text-gray-500">{Math.floor(product.reviews * 0.87)} sold</span>
          </div>

          {/* Price */}
          <div className="rounded-2xl bg-luxe-gold-soft/70 border border-luxe-gold/25 p-5 mb-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-serif text-3xl font-bold text-luxe-black">${activePrice.toFixed(2)}</span>
              {discount > 0 && <span className="text-sm text-luxe-gray line-through">${activeOriginal.toFixed(2)}</span>}
              {discount > 0 && <span className="px-2 py-0.5 bg-sale text-white text-[11px] font-bold rounded-full">Save ${(activeOriginal - activePrice).toFixed(2)}</span>}
            </div>
            {discount > 0 && <p className="text-[11px] text-luxe-gold-dark mt-2 font-semibold">{discount}% off — limited time deal</p>}
          </div>

          {/* Stock + Shipping */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs">
            {activeStock > 10 && <span className="text-green-600 font-medium"><CheckCircle size={13} className="inline mr-1" />In Stock</span>}
            {activeStock > 0 && activeStock <= 10 && <span className="text-luxe-gold font-medium"><AlertTriangle size={13} className="inline mr-1" />Only {activeStock} left in stock</span>}
            {activeStock === 0 && <span className="text-red-500 font-medium"><X size={13} className="inline mr-1" />Out of Stock</span>}
            {product.freeShipping && <span className="text-gray-500"><Truck size={13} className="inline mr-1" />Free shipping</span>}
            <span className="text-gray-500"><RotateCcw size={13} className="inline mr-1" />30-day easy returns</span>
          </div>

          {/* Short Desc */}
          {product.shortDesc && <p className="text-sm text-gray-600 mb-4 leading-relaxed">{product.shortDesc}</p>}

          {/* Color */}
          {uniqueColors.length > 0 && (
            <div className="mb-4">
              <span className="block text-xs font-semibold text-gray-700 mb-2">Color: <span className="text-gray-400 font-normal">{selColor}</span></span>
              <div className="flex gap-2">
                {uniqueColors.map(c => (
                  <button key={c} onClick={() => setSelColor(c)} title={c}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${selColor === c ? 'border-luxe-gold ring-2 ring-luxe-light' : 'border-gray-200 hover:border-gray-400'}`}
                    style={{ backgroundColor: ({ Black: '#000', White: '#fff', Blue: '#3b82f6', Red: '#ef4444', Silver: '#9ca3af', Brown: '#92400e', Green: '#16a34a', Gold: '#d97706', Pink: '#ec4899' })[c] || '#ccc' }} />
                ))}
              </div>
            </div>
          )}
          {/* Size */}
          {uniqueSizes.length > 0 && uniqueSizes[0] !== 'One Size' && (
            <div className="mb-5">
              <span className="block text-xs font-semibold text-gray-700 mb-2">Size: <span className="text-gray-400 font-normal">{selSize}</span></span>
              <div className="flex gap-2 flex-wrap">
                {uniqueSizes.map(s => (
                  <button key={s} onClick={() => setSelSize(s)}
                    className={`px-4 py-2 text-xs font-semibold border-2 rounded-lg transition-all ${selSize === s ? 'border-luxe-gold bg-luxe-light text-luxe-black' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-stretch gap-3 mb-4">
            <div className="flex items-center border-2 border-gray-200 rounded-xl">
              <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-3 py-2.5 hover:bg-gray-50 text-gray-500"><Minus size={14} /></button>
              <span className="px-3 py-2.5 text-sm font-semibold border-x-2 border-gray-100 min-w-[2.25rem] text-center">{qty}</span>
              <button onClick={() => setQty(Math.min(activeStock || 1, qty + 1))} className="px-3 py-2.5 hover:bg-gray-50 text-gray-500"><Plus size={14} /></button>
            </div>
            <button onClick={handleAddToCart} disabled={activeStock === 0}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:bg-luxe-silver disabled:cursor-not-allowed disabled:text-luxe-gray shadow-gold hover:shadow-luxe-gold/30 hover:scale-[1.02] bg-luxe-gold hover:bg-luxe-gold-dark">
              <ShoppingBag size={15} /> {activeStock === 0 ? 'Out of Stock' : 'Add to Cart'}
            </button>
            <button onClick={handleBuyNow} disabled={activeStock === 0}
              className="flex-1 py-3 bg-luxe-black hover:bg-luxe-charcoal disabled:bg-luxe-silver disabled:cursor-not-allowed disabled:text-luxe-gray text-white text-sm font-bold rounded-xl transition-colors">
              Buy Now
            </button>
          </div>

          {/* Trust */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { icon: Truck, t: 'Free ship $50+' },
              { icon: RotateCcw, t: '30-day returns' },
              { icon: Shield, t: 'Quality guarantee' },
              { icon: Lock, t: 'Secure checkout' },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 bg-luxe-cream rounded-xl border border-luxe-silver/70">
                <b.icon size={14} className="text-luxe-gold shrink-0" />
                <span className="text-[10px] sm:text-[11px] text-luxe-gray font-medium leading-tight">{b.t}</span>
              </div>
            ))}
          </div>

          {/* Ad: Below Product Information */}
          <AdSenseAd placement="product_below_info" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mt-8 mb-5 border-b border-gray-100 overflow-x-auto">
        {([['desc', 'Description'], ['specs', 'Specifications'], ['reviews', `Reviews (${reviews.length})`]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === key ? 'border-luxe-gold text-luxe-black' : 'border-transparent text-luxe-gray hover:text-luxe-black'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Description */}
      {tab === 'desc' && (
        <div className="max-w-3xl">
          <p className="text-[15px] text-luxe-gray leading-relaxed whitespace-pre-line">{product.description}</p>
          {product.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
              {product.tags.map(t => <span key={t} className="text-xs text-luxe-gold hover:underline cursor-pointer">#{t}</span>)}
            </div>
          )}
        </div>
      )}

      {/* Specs */}
      {tab === 'specs' && (
        <table className="w-full text-xs max-w-3xl">
          <tbody>
            {[
              ['Brand', product.brand], ['Category', product.category], ['Condition', product.condition],
              ['Weight', product.weight], ['Dimensions', product.dimensions],
              ['Origin', product.origin], ['Shipping', product.freeShipping ? 'Free' : `$${product.shippingCost}`],
            ].filter(([, v]) => v).map(([k, v], i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                <td className="px-3 py-2.5 font-medium text-gray-600 w-1/3">{k}</td>
                <td className="px-3 py-2.5 text-gray-900">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Reviews */}
      {tab === 'reviews' && (
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl font-bold text-gray-900">{avgRating.toFixed(1)}</span>
            <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star key={i} size={16} className={i < Math.round(avgRating) ? 'text-star fill-star' : 'text-gray-200'} />)}</div>
            <span className="text-xs text-gray-500">{reviews.length} reviews</span>
          </div>

          {user ? (
            <button onClick={() => setShowRevForm(!showRevForm)} className="text-xs font-semibold text-luxe-gold hover:underline mb-4 block">{showRevForm ? 'Cancel' : 'Write a Review'}</button>
          ) : (
            <p className="text-xs text-gray-500 mb-4"><Link to="/login" className="text-luxe-gold font-semibold hover:underline">Sign in</Link> to review</p>
          )}

          {showRevForm && (
            <form onSubmit={submitReview} className="bg-luxe-cream rounded-xl p-4 mb-5 space-y-3 border border-luxe-silver/70">
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map(s => (
                <button key={s} type="button" onClick={() => setRevForm({ ...revForm, rating: s })}>
                  <Star size={18} className={s <= revForm.rating ? 'text-star fill-star' : 'text-gray-300'} />
                </button>
              ))}</div>
              <textarea required rows={3} value={revForm.comment} onChange={e => setRevForm({ ...revForm, comment: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold resize-none" placeholder="Write your review..." />
              <button type="submit" className="px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold rounded-lg transition-colors">Submit Review</button>
            </form>
          )}

          <div className="space-y-4">
            {reviews.length > 0 ? reviews.map(r => (
              <div key={r.id} className="border-b border-gray-100 pb-4 last:border-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-bold text-gray-800">{r.userName}</span>
                  <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star key={i} size={11} className={i < r.rating ? 'text-star fill-star' : 'text-gray-200'} />)}</div>
                  <span className="text-[11px] text-gray-400">- {new Date(r.date).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-gray-600">{r.comment}</p>
              </div>
            )) : <p className="text-sm text-gray-400">No reviews yet.</p>}
          </div>
        </div>
      )}

      {/* Related */}
      <div className="mt-10 pt-6 border-t border-gray-100">
        <h2 className="font-serif text-lg font-bold text-luxe-black mb-4">Related Products</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(related.length > 0 ? related : relatedFallback).map(p => <PCardPremium key={p.id} product={p} />)}
        </div>
      </div>
    </div>
  );

}

// ============================================================================
// STORE PAGES
// ============================================================================
// Scroll-reveal wrapper — fades content in as it enters the viewport
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) { setShown(true); io.disconnect(); }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal-base ${shown ? 'reveal-show' : ''} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

function SectionHeader({ eyebrow, title, to, linkLabel = 'View All' }: { eyebrow: string; title: string; to?: string; linkLabel?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-7">
      <div>
        <p className="eyebrow mb-2">{eyebrow}</p>
        <h2 className="text-2xl sm:text-3xl font-serif font-bold text-luxe-black tracking-tight">{title}</h2>
      </div>
      {to && <Link to={to} className="hidden sm:inline-flex items-center gap-1.5 text-[13px] font-bold text-luxe-gold hover:text-luxe-gold-dark transition-colors group">
        {linkLabel} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
      </Link>}
    </div>
  );
}

function HomePage() {
  const { products, notify } = useApp();
  const featured = products.filter(p => p.isActive);
  const deals = featured.filter(p => p.originalPrice > p.price).sort((a, b) => (1 - b.price / b.originalPrice) - (1 - a.price / a.originalPrice));
  const hero = featured.slice(0, 4);

  return (
    <div className="bg-white">
      {/* ════════ HERO — light, premium blue ════════ */}
      <section className="relative bg-gradient-to-br from-luxe-light via-white to-white text-luxe-black overflow-hidden">
        {/* Ambient glow + texture */}
        <div aria-hidden="true" className="absolute inset-0">
          <div className="absolute -top-40 -right-32 w-[36rem] h-[36rem] rounded-full bg-luxe-gold/12 blur-[130px]" />
          <div className="absolute -bottom-48 -left-32 w-[30rem] h-[30rem] rounded-full bg-luxe-gold/8 blur-[120px]" />
          <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #2563eb 1px, transparent 0)', backgroundSize: '34px 34px' }} />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 pt-14 pb-16 sm:pt-18 sm:pb-20 lg:pt-24 lg:pb-24 grid lg:grid-cols-[1.05fr_0.95fr] items-center gap-10 lg:gap-14">
          {/* Copy */}
          <div className="hero-stagger text-center lg:text-left">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-luxe-gold/10 border border-luxe-gold/25 text-luxe-gold-dark text-[11px] font-bold uppercase tracking-[0.16em]">
              <Sparkles size={12} /> Curated for Quality, Priced for Value
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.4rem] font-bold leading-[1.08] tracking-tight mt-6 mb-5 text-luxe-black">
              Everything Your Pet Loves, <span className="text-gradient-blue">Thoughtfully Curated</span>
            </h1>
            <p className="text-luxe-gray text-sm sm:text-base max-w-lg mx-auto lg:mx-0 mb-8 leading-relaxed">
              Handpicked essentials for feeding, comfort, play, and grooming — tested by our team, loved by pets, delivered to your door.
            </p>
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3">
              <Link to="/shop" className="inline-flex items-center gap-2 px-7 py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm shadow-gold transition-all hover:-translate-y-0.5">
                Shop Pet Essentials <ArrowRight size={16} />
              </Link>
              <Link to="/shop?q=deal" className="inline-flex items-center gap-2 px-7 py-3.5 border border-luxe-silver text-luxe-charcoal font-semibold rounded-full text-sm hover:border-luxe-gold hover:text-luxe-gold transition-all bg-white/70">
                Explore Deals
              </Link>
            </div>
            {/* Social proof */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-3 mt-9 pt-8 border-t border-luxe-silver">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star key={i} size={13} className="text-star fill-star" />)}</div>
                <span className="text-[12px] text-luxe-gray"><strong className="text-luxe-black font-bold">4.9/5</strong> · 2,000+ happy pet parents</span>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-luxe-gray"><Truck size={14} className="text-luxe-gold" /> Free shipping over $50</div>
              <div className="flex items-center gap-2 text-[12px] text-luxe-gray"><RotateCcw size={14} className="text-luxe-gold" /> 30-day easy returns</div>
            </div>
          </div>

          {/* Photo collage */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {hero[0] && (
                <Link to={`/product/${hero[0].id}`} className="relative row-span-2 group rounded-2xl overflow-hidden ring-1 ring-luxe-silver shadow-lg shadow-luxe-gold/10">
                  <img src={hero[0].images[0]} alt={hero[0].name} aria-hidden="true" loading="eager" fetchPriority="high" decoding="async" className="w-full h-full min-h-[22rem] object-cover group-hover:scale-[1.04] transition-transform duration-700" />
                  <span className="absolute bottom-3 left-3 right-3 px-3 py-2 glass rounded-lg text-[11px] font-semibold text-luxe-black">{hero[0].name}</span>
                </Link>
              )}
              {hero.slice(1, 3).map(p => (
                <Link key={p.id} to={`/product/${p.id}`} className="group rounded-2xl overflow-hidden ring-1 ring-luxe-silver shadow-md shadow-luxe-gold/5">
                  <img src={p.images[0]} alt={p.name} loading="lazy" decoding="async" className="w-full aspect-square object-cover group-hover:scale-[1.04] transition-transform duration-700" />
                </Link>
              ))}
            </div>
            {/* Floating trust chips */}
            <div className="absolute -left-3 sm:-left-6 top-6 glass rounded-2xl px-4 py-3 flex items-center gap-3 shadow-xl animate-float">
              <span className="w-9 h-9 rounded-full bg-luxe-gold/12 text-luxe-gold flex items-center justify-center"><Truck size={16} /></span>
              <div>
                <p className="text-[11px] font-bold text-luxe-black">Free Shipping</p>
                <p className="text-[10px] text-luxe-gray">On orders $50+</p>
              </div>
            </div>
            <div className="absolute -right-2 sm:-right-5 bottom-8 glass rounded-2xl px-4 py-3 flex items-center gap-3 shadow-xl">
              <span className="w-9 h-9 rounded-full bg-luxe-gold/12 text-luxe-gold flex items-center justify-center"><Shield size={16} /></span>
              <div>
                <p className="text-[11px] font-bold text-luxe-black">Quality Guarantee</p>
                <p className="text-[10px] text-luxe-gray">Handpicked & tested</p>
              </div>
            </div>
          </div>
        </div>
        {/* Blue baseline */}
        <div aria-hidden="true" className="h-px bg-gradient-to-r from-transparent via-luxe-gold/50 to-transparent" />
      </section>

      {/* ════════ Ad: After Hero ════════ */}
      <div className="max-w-7xl mx-auto px-4"><AdSenseAd placement="home_after_hero" /></div>

      {/* ════════ SHOP BY PET ════════ */}
      <section className="py-14 sm:py-18 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal className="text-center mb-9">
            <p className="eyebrow mb-2">Start Here</p>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-luxe-black tracking-tight">Who are you shopping for?</h2>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
            {[
              { emoji: '🐶', label: 'Dog', to: '/category/dog-supplies', desc: 'Harnesses, toys, beds & more', img: CAT_META['Dog Supplies'].img },
              { emoji: '🐱', label: 'Cat', to: '/category/cat-supplies', desc: 'Toys, towers, beds & more', img: CAT_META['Cat Supplies'].img },
            ].map(p => (
              <Reveal key={p.label} delay={80}>
                <Link to={p.to} className="group relative block rounded-3xl overflow-hidden ring-1 ring-luxe-silver/80 hover:ring-luxe-gold/60 shadow-sm hover:shadow-xl transition-all duration-300">
                  <img src={p.img} alt={p.label} loading="lazy" className="w-full aspect-[4/3] object-cover group-hover:scale-[1.05] transition-transform duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-luxe-black/80 via-luxe-black/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-6 text-center">
                    <span className="text-3xl block mb-1.5">{p.emoji}</span>
                    <span className="font-serif text-2xl font-bold text-luxe-white block">{p.label}</span>
                    <span className="text-xs text-luxe-white/75">{p.desc}</span>
                    <span className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-bold text-luxe-gold-light opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all">Shop now <ArrowRight size={12} /></span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ════════ POPULAR CATEGORIES ════════ */}
      <section className="py-14 sm:py-18 bg-luxe-cream">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal><SectionHeader eyebrow="Browse" title="Shop Popular Categories" to="/shop" /></Reveal>
          <Reveal delay={60}>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:grid sm:grid-cols-4 lg:grid-cols-6 sm:mx-0 sm:px-0 sm:overflow-visible">
              {CAT_LIST.filter(c => c !== 'All').map(c => {
                const meta = CAT_META[c];
                const count = featured.filter(p => p.category === c).length;
                return (
                  <Link key={c} to={`/category/${toSlug(c)}`} className="group shrink-0 w-32 sm:w-auto">
                    <div className="bg-white rounded-2xl border border-luxe-silver/80 hover:border-luxe-gold/60 hover:shadow-lg hover:shadow-luxe-gold/10 hover:-translate-y-1 transition-all duration-300 p-4 text-center">
                      <div className="w-14 h-14 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center text-2xl group-hover:scale-110 group-hover:bg-luxe-gold/15 transition-transform duration-300">{meta?.emoji || '🐾'}</div>
                      <p className="text-center text-[12px] font-semibold text-luxe-black mt-3 leading-tight">{c}</p>
                      <p className="text-center text-[10px] text-luxe-gray mt-0.5">{count} items</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ════════ Ad: After Categories ════════ */}
      <div className="max-w-7xl mx-auto px-4"><AdSenseAd placement="home_after_categories" /></div>

      {/* ════════ PROMO BANNERS ════════ */}
      <section className="py-14 sm:py-18 bg-white">
        <div className="max-w-7xl mx-auto px-4 grid sm:grid-cols-3 gap-4 sm:gap-5">
          <Reveal><Link to="/shop" className="group relative block rounded-3xl overflow-hidden bg-sale-bg border border-luxe-silver/80 p-7 hover:shadow-xl hover:shadow-luxe-silver/50 hover:-translate-y-1 transition-all duration-300">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-sale text-white text-[10px] font-bold rounded-full mb-4"><Zap size={11} /> Deal</span>
            <h3 className="font-serif text-xl font-bold text-luxe-black mb-1.5">Pet Favorites Under $30</h3>
            <p className="text-xs text-luxe-gray mb-4">Everyday essentials your pet will love.</p>
            <span className="inline-flex items-center gap-1 text-[12px] font-bold text-sale group-hover:underline">Shop now <ArrowRight size={12} /></span>
          </Link></Reveal>
          <Reveal delay={70}><Link to="/category/pet-beds" className="group relative block rounded-3xl overflow-hidden bg-luxe-gold-soft border border-luxe-gold/25 p-7 hover:shadow-xl hover:shadow-luxe-gold/15 hover:-translate-y-1 transition-all duration-300">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-luxe-gold text-white text-[10px] font-bold rounded-full mb-4"><Moon size={11} /> Comfort</span>
            <h3 className="font-serif text-xl font-bold text-luxe-black mb-1.5">Better Sleep for Your Pet</h3>
            <p className="text-xs text-luxe-gray mb-4">Orthopedic beds & cozy caves for deep rest.</p>
            <span className="inline-flex items-center gap-1 text-[12px] font-bold text-luxe-gold group-hover:underline">Shop now <ArrowRight size={12} /></span>
          </Link></Reveal>
          <Reveal delay={140}><Link to="/category/pet-toys" className="group relative block rounded-3xl overflow-hidden bg-luxe-cream border border-luxe-silver/80 p-7 hover:shadow-xl hover:shadow-luxe-silver/50 hover:-translate-y-1 transition-all duration-300">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-luxe-black text-luxe-gold-light text-[10px] font-bold rounded-full mb-4"><Sparkles size={11} /> Play</span>
            <h3 className="font-serif text-xl font-bold text-luxe-black mb-1.5">Playtime Essentials</h3>
            <p className="text-xs text-luxe-gray mb-4">Interactive toys & enrichment for happy pets.</p>
            <span className="inline-flex items-center gap-1 text-[12px] font-bold text-luxe-gold group-hover:underline">Shop now <ArrowRight size={12} /></span>
          </Link></Reveal>
        </div>
      </section>

      {/* ════════ PRODUCT SECTIONS (or premium empty-catalog state) ════════ */}
      {/* Production catalog reset: with zero approved products the storefront
          shows ONE premium curation notice instead of empty grids or demo
          cards. No fake counts, launch dates, reviews, or shipping claims. */}
      {featured.length === 0 ? (
        <section className="py-16 sm:py-20 bg-luxe-cream">
          <div className="max-w-2xl mx-auto px-4 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-5"><Sparkles size={22} className="text-luxe-gold" /></div>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-luxe-black mb-3">New premium pet essentials are being curated</h2>
            <p className="text-sm text-luxe-gray leading-relaxed">Thoughtfully selected pet essentials are coming soon. Every product is verified before it reaches your door.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="py-14 sm:py-18 bg-luxe-cream">
            <div className="max-w-7xl mx-auto px-4">
              <Reveal><SectionHeader eyebrow="Best Sellers" title="Popular Right Now" to="/shop" /></Reveal>
              <Reveal delay={60}>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {[...featured].sort((a, b) => b.reviews - a.reviews).slice(0, 8).map(p => <PCard key={p.id} product={p} />)}
                </div>
              </Reveal>
            </div>
          </section>

          {/* ════════ Ad: Between Product Sections ════════ */}
          <div className="max-w-7xl mx-auto px-4"><AdSenseAd placement="home_between_sections" /></div>
        </>
      )}

      {/* ════════ SHOP BY NEED ════════ */}
      <section className="py-14 sm:py-18 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <Reveal className="text-center mb-9">
            <p className="eyebrow mb-2">Solutions</p>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-luxe-black tracking-tight">Shop by Need</h2>
          </Reveal>
          <Reveal delay={60}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { emoji: '🍽️', label: 'Feeding Time', to: '/category/feeding-water' },
                { emoji: '😴', label: 'Better Sleep', to: '/category/pet-beds' },
                { emoji: '🧸', label: 'Play & Enrichment', to: '/category/pet-toys' },
                { emoji: '✂️', label: 'Grooming', to: '/category/grooming' },
                { emoji: '🎒', label: 'Walking & Travel', to: '/category/pet-accessories' },
              ].map(n => (
                <Link key={n.label} to={n.to} className="group rounded-2xl border border-luxe-silver/80 hover:border-luxe-gold/60 hover:shadow-lg hover:shadow-luxe-gold/10 hover:-translate-y-1 transition-all duration-300 p-5 text-center bg-white">
                  <span className="text-3xl block mb-2.5 group-hover:scale-110 transition-transform duration-300">{n.emoji}</span>
                  <span className="text-[13px] font-semibold text-luxe-black">{n.label}</span>
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ════════ PET PARENT FAVORITES (only when the catalog has products) ════════ */}
      {featured.length > 0 && (
        <section className="py-14 sm:py-18 bg-luxe-cream">
          <div className="max-w-7xl mx-auto px-4">
            <Reveal><SectionHeader eyebrow="Recommended For You" title="Pet Parent Favorites" to="/shop" /></Reveal>
            <Reveal delay={60}>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {deals.slice(0, 8).map(p => <PCard key={p.id} product={p} />)}
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ════════ TRUST BAR ════════ */}
      <section className="py-12 sm:py-14 bg-white border-y border-luxe-silver/60">
        <div className="max-w-7xl mx-auto px-4 grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { icon: Truck, title: 'Free Shipping $50+', desc: 'On every order over $50' },
            { icon: RotateCcw, title: 'Easy 30-Day Returns', desc: 'No-hassle replacements' },
            { icon: Shield, title: 'Secure Checkout', desc: '256-bit SSL encryption' },
            { icon: Headphones, title: 'Customer Support', desc: 'Mon–Fri, 9AM–6PM CT' },
          ].map(t => (
            <div key={t.title} className="flex items-center gap-3.5">
              <span className="w-12 h-12 rounded-2xl bg-luxe-gold-soft ring-1 ring-luxe-gold/20 text-luxe-gold flex items-center justify-center shrink-0"><t.icon size={20} /></span>
              <div>
                <p className="text-sm font-bold text-luxe-black">{t.title}</p>
                <p className="text-[11px] text-luxe-gray">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ════════ NEWSLETTER — dark bookend ════════ */}
      <section className="relative bg-luxe-black text-luxe-white overflow-hidden">
        <div aria-hidden="true" className="absolute -top-32 right-0 w-[28rem] h-[28rem] rounded-full bg-luxe-gold/12 blur-[120px]" />
        <div className="relative max-w-3xl mx-auto px-4 py-16 sm:py-20 text-center">
          <p className="eyebrow mb-3 text-luxe-gold-light">Stay in the Loop</p>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-luxe-white tracking-tight mb-3">Join the Luxedge Pet Family</h2>
          <p className="text-luxe-white/65 text-sm mb-8 max-w-md mx-auto">Get new arrivals, pet essentials, and member-only offers delivered to your inbox.</p>
          <form onSubmit={e => { e.preventDefault(); notify('Thanks for subscribing! 🐾'); }} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input type="email" required placeholder="Your email address" aria-label="Email address"
              className="flex-1 px-5 py-3.5 bg-luxe-white/5 border border-luxe-white/20 rounded-full text-sm text-luxe-white placeholder-luxe-white/40 focus:outline-none focus:border-luxe-gold-light focus:ring-4 focus:ring-luxe-gold/15 transition-all" />
            <button type="submit" className="px-8 py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-all hover:-translate-y-0.5 shadow-gold">
              Subscribe
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function ShopPage() {
  const { slug } = useParams<{ slug?: string }>();
  const { products } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const initialCat = slug ? fromSlug(slug) : 'All';
  const [cat, setCat] = useState(initialCat);
  const [q, setQ] = useState(params.get('q') || '');
  const [sort, setSort] = useState('featured');
  const [maxPrice, setMaxPrice] = useState(0); // 0 = no limit
  const [minRating, setMinRating] = useState(0); // 0 = any
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sync when URL slug or query changes
  useEffect(() => { setCat(slug ? fromSlug(slug) : 'All'); }, [slug]);
  useEffect(() => { const qp = params.get('q'); if (qp) trackEvent('search', { search_term: qp, ...utmParams() }); setQ(qp || ''); }, [params]);

  const f = products.filter(p => p.isActive)
    .filter(p => cat === 'All' || p.category === cat)
    .filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
    .filter(p => maxPrice === 0 || p.price <= maxPrice)
    .filter(p => minRating === 0 || p.rating >= minRating)
    .sort((a, b) => {
      if (sort === 'price-low') return a.price - b.price;
      if (sort === 'price-high') return b.price - a.price;
      if (sort === 'rating') return b.rating - a.rating;
      if (sort === 'best-sellers') return (b.reviews || 0) - (a.reviews || 0);
      return 0;
    });

  const handleCatChange = (newCat: string) => {
    if (newCat === 'All') nav('/shop');
    else nav(`/category/${toSlug(newCat)}`);
  };

  const pageTitle = cat === 'All' ? 'Shop All Products' : cat;
  const pageDesc = cat === 'All' ? 'Handpicked for quality, comfort, and value.' : CAT_META[cat]?.desc || `Browse our ${cat} collection`;
  const activeFilters = (cat !== 'All' ? 1 : 0) + (maxPrice > 0 ? 1 : 0) + (minRating > 0 ? 1 : 0);

  const clearAll = () => { setCat('All'); setQ(''); setMaxPrice(0); setMinRating(0); nav('/shop'); };

  // Reusable sidebar filter block (desktop sidebar + mobile drawer)
  const FilterBlock = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-bold text-luxe-black uppercase tracking-wider mb-3">Category</h3>
        <div className="space-y-1">
          {CAT_LIST.map(c => (
            <button key={c} onClick={() => handleCatChange(c)}
              className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors ${
                cat === c ? 'bg-luxe-gold-soft text-luxe-gold-dark font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-xs font-bold text-luxe-black uppercase tracking-wider mb-3">Price</h3>
        <select value={maxPrice} onChange={e => setMaxPrice(+e.target.value)}
          className="w-full text-[13px] px-3 py-2.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20">
          <option value={0}>Any price</option>
          <option value={25}>Under $25</option>
          <option value={50}>Under $50</option>
          <option value={100}>Under $100</option>
          <option value={200}>Under $200</option>
        </select>
      </div>
      <div>
        <h3 className="text-xs font-bold text-luxe-black uppercase tracking-wider mb-3">Rating</h3>
        <div className="space-y-1">
          {[4.5, 4, 0].map(r => (
            <button key={r} onClick={() => setMinRating(r)}
              className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors ${
                minRating === r ? 'bg-luxe-gold-soft text-luxe-gold-dark font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {r === 0 ? 'Any rating' : (
                <span className="flex items-center gap-1"><Star size={12} className="text-amber-400 fill-amber-400" /> {r}+ &amp; up</span>
              )}
            </button>
          ))}
        </div>
      </div>
      {activeFilters > 0 && (
        <button onClick={clearAll} className="w-full text-center text-[12px] font-semibold text-luxe-gold hover:text-luxe-gold-dark hover:underline">Clear all filters ({activeFilters})</button>
      )}
    </div>
  );

  return (
    <div>
      {/* Page Header */}
      <section className="bg-gradient-to-b from-luxe-cream to-white border-b border-luxe-silver/60">
        <div className="max-w-7xl mx-auto px-4 py-10 sm:py-12">
          <p className="eyebrow mb-2">{cat === 'All' ? 'Our Collection' : cat}</p>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black tracking-tight">{pageTitle}</h1>
          <p className="text-luxe-gray text-xs sm:text-sm max-w-xl mt-2">{pageDesc}</p>
        </div>
      </section>

      {/* Toolbar: mobile Filter button + search + sort */}
      <div className="bg-white/90 backdrop-blur-md border-b border-luxe-silver/70 sticky top-0 z-20 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="max-w-7xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <button onClick={() => setDrawerOpen(true)}
            className="lg:hidden shrink-0 flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-2 border border-luxe-silver rounded-lg text-luxe-charcoal hover:border-luxe-gold/60 hover:text-luxe-gold transition-colors">
            <SlidersHorizontal size={14} /> Filter{activeFilters > 0 && <span className="w-4 h-4 rounded-full bg-luxe-gold text-white text-[9px] font-bold flex items-center justify-center">{activeFilters}</span>}
          </button>
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-luxe-gray" />
            <input placeholder="Search products..." value={q} onChange={e => setQ(e.target.value)} aria-label="Search products"
              className="w-full pl-9 pr-3 py-2 border border-luxe-silver rounded-lg text-[13px] focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 bg-luxe-cream/60" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="shrink-0 text-[12px] bg-transparent border-0 focus:outline-none text-luxe-gray font-medium">
            <option value="featured">Featured</option>
            <option value="best-sellers">Best Sellers</option>
            <option value="price-low">Price: Low→High</option>
            <option value="price-high">Price: High→Low</option>
            <option value="rating">Top Rated</option>
          </select>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-luxe-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[290px] max-w-[85vw] bg-white shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-luxe-silver/70">
              <h2 className="font-serif text-base font-bold text-luxe-black">Filters</h2>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close filters"
                className="p-1.5 rounded-lg text-luxe-gray hover:bg-luxe-cream"><X size={16} /></button>
            </div>
            <div className="p-4">
              <FilterBlock />
              <button onClick={() => setDrawerOpen(false)}
                className="mt-6 w-full py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm font-bold rounded-xl transition-colors">
                Show {f.length} products
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content: sidebar + grid */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-56 shrink-0 bg-white border border-luxe-silver/70 rounded-2xl p-5 h-fit sticky top-16 shadow-sm">
            <FilterBlock />
          </aside>

          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-luxe-gray mb-3">{f.length} product{f.length !== 1 ? 's' : ''}{cat !== 'All' ? ` in ${cat}` : ''}</p>

            {f.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                {f.map(p => <PCard key={p.id} product={p} />)}
              </div>
            ) : products.length === 0 ? (
              /* Production catalog reset: genuinely empty catalog — premium
                 curation notice, never demo cards or fake counts. */
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Sparkles size={22} className="text-luxe-gold" /></div>
                <p className="font-serif text-lg font-bold text-luxe-black mb-1">New premium pet essentials are being curated</p>
                <p className="text-sm text-luxe-gray mb-5">Thoughtfully selected pet essentials are coming soon.</p>
                <Link to="/" className="inline-block px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold uppercase tracking-wider rounded-full transition-colors">Back to home</Link>
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Search size={22} className="text-luxe-gold" /></div>
                <p className="font-serif text-lg font-bold text-luxe-black mb-1">No products found</p>
                <p className="text-sm text-luxe-gray mb-5">Try adjusting your search or filters.</p>
                <button onClick={clearAll} className="px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold uppercase tracking-wider rounded-full transition-colors">Clear all filters</button>
              </div>
            )}
            {/* Ad: After Product Row */}
            <AdSenseAd placement="shop_after_row" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CartDrawer() {
  const { cart, cartOpen, closeCart, updateQty, removeFromCart, user } = useApp();
  const nav = useNavigate();
  const loc = useLocation();

  // Close the drawer whenever the route changes (e.g. Proceed to Checkout).
  useEffect(() => { closeCart(); }, [loc.pathname, closeCart]);

  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const sh = sub >= 50 ? 0 : 4.99;
  const tot = sub + sh;
  const remaining = 50 - sub;

  const checkout = () => {
    closeCart();
    nav(user ? '/checkout' : '/login');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={closeCart}
        className={`fixed inset-0 bg-black/40 z-[90] transition-opacity duration-300 ${cartOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Shopping cart"
        aria-hidden={!cartOpen}
        inert={!cartOpen}
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-white z-[95] shadow-2xl transform transition-transform duration-300 ease-out ${cartOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <ShoppingBag size={20} className="text-luxe-gold" />
              <h2 className="text-lg font-semibold text-luxe-black">Your Cart ({cart.length})</h2>
            </div>
            <button onClick={closeCart} aria-label="Close cart" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <X size={18} />
            </button>
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center"><ShoppingBag size={28} className="text-luxe-gold" /></div>
              <p className="text-luxe-black text-sm font-semibold">Your cart is empty</p>
              <p className="text-luxe-gray text-xs">Add some handpicked essentials to get started.</p>
              <button onClick={() => { closeCart(); nav('/shop'); }} className="mt-2 px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold uppercase tracking-wider rounded-full transition-colors">
                Shop Now
              </button>
            </div>
          ) : (
            <>
              {/* Items */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {sub < 50 ? (
                  <div className="rounded-lg bg-luxe-light border border-luxe-silver px-3 py-2.5">
                    <p className="text-[11px] text-gray-600">You're <span className="font-bold text-luxe-gold">${remaining.toFixed(2)}</span> away from free shipping</p>
                    <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-luxe-gold rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (sub / 50) * 100)}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 flex items-center gap-2">
                    <CheckCircle size={14} className="text-green-600 shrink-0" />
                    <p className="text-[11px] font-semibold text-green-700">You've unlocked FREE shipping!</p>
                  </div>
                )}

                {cart.map(item => (
                  <div key={item.product.id} className="flex gap-3 p-3 bg-luxe-cream rounded-xl border border-luxe-silver/50">
                    <img src={item.product.images[0]} alt={item.product.name} className="w-20 h-20 object-cover rounded-lg shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-luxe-black truncate">{item.product.name}</h4>
                      <p className="text-[11px] text-gray-400 truncate">{item.product.category}</p>
                      <p className="text-sm font-bold text-luxe-gold mt-0.5">${item.product.price.toFixed(2)}</p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200">
                          <button onClick={() => updateQty(item.product.id, item.quantity - 1)} aria-label="Decrease quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Minus size={12} /></button>
                          <span className="text-xs font-semibold w-6 text-center">{item.quantity}</span>
                          <button onClick={() => updateQty(item.product.id, item.quantity + 1)} aria-label="Increase quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Plus size={12} /></button>
                        </div>
                        <button onClick={() => removeFromCart(item.product.id)} aria-label="Remove item" className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-luxe-black shrink-0">${(item.product.price * item.quantity).toFixed(2)}</p>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="border-t border-gray-100 px-5 py-4 space-y-3">
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-semibold text-luxe-black">${sub.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className={`font-semibold ${sh === 0 ? 'text-green-600' : 'text-luxe-black'}`}>{sh === 0 ? 'FREE' : `$${sh.toFixed(2)}`}</span></div>
                  <div className="flex justify-between pt-2 border-t border-gray-100 text-base"><span className="font-semibold text-luxe-black">Total</span><span className="font-bold text-luxe-black">${tot.toFixed(2)}</span></div>
                </div>
                <button onClick={checkout} className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl transition-colors uppercase text-xs tracking-wider flex items-center justify-center gap-2 shadow-gold">
                  <Lock size={14} /> {user ? 'Proceed to Checkout' : 'Sign In to Checkout'}
                </button>
                <button onClick={() => { closeCart(); nav('/cart'); }} className="w-full py-2.5 text-xs text-gray-500 hover:text-luxe-black transition-colors">
                  View Full Cart
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function CartPage() {
  const { cart, updateQty, removeFromCart, user } = useApp(); const nav = useNavigate();
  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0); const sh = sub >= 50 ? 0 : 4.99; const tot = sub + sh;
  const remaining = 50 - sub;

  if (cart.length === 0) return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><ShoppingBag size={28} className="text-luxe-gold" /></div>
        <h2 className="font-serif text-2xl font-bold text-luxe-black mb-2">Your cart is empty</h2>
        <p className="text-luxe-gray text-sm mb-6">Discover handpicked essentials your pet will love.</p>
        <Link to="/shop" className="inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Shop Now</Link>
      </div>
    </div>
  );

  return (
    <div className="py-12 bg-luxe-cream min-h-screen">
      <div className="max-w-5xl mx-auto px-4">
        <p className="eyebrow mb-2">Your Selection</p>
        <h1 className="font-serif text-3xl font-bold text-luxe-black mb-8">Shopping Cart</h1>
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Items */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-luxe-silver/70 shadow-sm divide-y divide-luxe-silver/60">
            {cart.map(i => (
              <div key={i.product.id} className="flex gap-4 p-5">
                <img src={i.product.images[0]} alt={i.product.name} className="w-20 h-20 object-cover rounded-xl border border-luxe-silver/60" />
                <div className="flex-1 min-w-0">
                  <Link to={`/product/${i.product.id}`} className="font-semibold text-luxe-black hover:text-luxe-gold-dark transition-colors line-clamp-1">{i.product.name}</Link>
                  <p className="text-luxe-gray text-xs mt-0.5">{i.product.category}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex items-center gap-1 bg-luxe-cream border border-luxe-silver rounded-lg">
                      <button onClick={() => updateQty(i.product.id, i.quantity - 1)} aria-label="Decrease quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Minus size={13} /></button>
                      <span className="text-xs font-semibold w-7 text-center">{i.quantity}</span>
                      <button onClick={() => updateQty(i.product.id, i.quantity + 1)} aria-label="Increase quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Plus size={13} /></button>
                    </div>
                    <button onClick={() => removeFromCart(i.product.id)} aria-label="Remove item" className="p-1.5 text-luxe-gray hover:text-luxe-red transition-colors"><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-luxe-black">${(i.product.price * i.quantity).toFixed(2)}</p>
                  <p className="text-xs text-luxe-gray">${i.product.price.toFixed(2)} each</p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="h-fit lg:sticky lg:top-20 bg-white rounded-2xl border border-luxe-silver/70 shadow-sm p-6">
            <h2 className="font-serif text-lg font-bold text-luxe-black mb-5">Order Summary</h2>
            {sub < 50 && (
              <div className="rounded-xl bg-luxe-gold-soft/70 border border-luxe-gold/20 px-4 py-3 mb-5">
                <p className="text-[11px] text-luxe-gray">Add <span className="font-bold text-luxe-gold-dark">${remaining.toFixed(2)}</span> more for free shipping</p>
                <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden">
                  <div className="h-full bg-luxe-gold rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (sub / 50) * 100)}%` }} />
                </div>
              </div>
            )}
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between"><span className="text-luxe-gray">Subtotal</span><span className="font-medium text-luxe-black">${sub.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-luxe-gray">Shipping</span><span className={`font-medium ${sh === 0 ? 'text-luxe-success' : 'text-luxe-black'}`}>{sh === 0 ? 'FREE' : `$${sh.toFixed(2)}`}</span></div>
              <div className="flex justify-between text-lg font-bold pt-3 border-t border-luxe-silver/70"><span className="text-luxe-black">Total</span><span className="text-luxe-black">${tot.toFixed(2)}</span></div>
            </div>
            <button onClick={() => nav(user ? '/checkout' : '/login')} className="mt-5 w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl text-sm transition-colors shadow-gold flex items-center justify-center gap-2">
              <Lock size={14} /> {user ? 'Proceed to Checkout' : 'Sign In to Checkout'}
            </button>
            <Link to="/shop" className="mt-3 block w-full py-2.5 text-center text-xs text-luxe-gray hover:text-luxe-gold transition-colors">Continue Shopping</Link>
            <div className="mt-5 pt-4 border-t border-luxe-silver/60 flex items-center justify-center gap-2">
              {['VISA', 'MC', 'AMEX', 'PayPal'].map(c => <span key={c} className="px-2 py-1 bg-luxe-cream border border-luxe-silver rounded text-[9px] font-bold text-luxe-gray">{c}</span>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckoutPage() {
  const { cart, placeOrder, user } = useApp();
  const nav = useNavigate();

  const [step, setStep] = useState(1); // 1=info, 2=payment, 3=processing, 4=done
  const [orderId, setOrderId] = useState('');
  const [payMethod, setPayMethod] = useState<'card'|'paypal'>('card');
  const [shipMethod, setShipMethod] = useState<'standard'|'express'>('standard');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [f, setF] = useState({ firstName: user?.name.split(' ')[0] || '', lastName: user?.name.split(' ').slice(1).join(' ') || '', email: user?.email || '', phone: '', address: '', city: '', state: '', zip: '', cardNum: '', cardExp: '', cardCvc: '', cardName: '' });

  useEffect(() => { if (!user) nav('/login'); }, [user, nav]);
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const shipCost = shipMethod === 'express' ? 9.99 : (sub >= 50 ? 0 : 4.99);
  const tax = +(sub * 0.0825).toFixed(2); // TX 8.25%
  const total = +(sub + shipCost + tax).toFixed(2);

  const I = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const ER = (field: string) => errors[field] ? <p className="text-red-500 text-xs mt-1">{errors[field]}</p> : null;

  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!f.firstName.trim()) e.firstName = 'Required';
    if (!f.lastName.trim()) e.lastName = 'Required';
    if (!f.email.trim() || !f.email.includes('@')) e.email = 'Valid email required';
    if (!f.phone.trim()) e.phone = 'Required';
    if (!f.address.trim()) e.address = 'Required';
    if (!f.city.trim()) e.city = 'Required';
    if (!f.state.trim()) e.state = 'Required';
    if (!f.zip.trim() || !/^\d{5}/.test(f.zip)) e.zip = 'Valid ZIP required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    if (payMethod === 'paypal') return true;
    const e: Record<string, string> = {};
    if (f.cardNum.replace(/\s/g, '').length < 16) e.cardNum = 'Valid card number required';
    if (!/^\d{2}\/\d{2}$/.test(f.cardExp)) e.cardExp = 'MM/YY format';
    if (f.cardCvc.length < 3) e.cardCvc = '3-4 digits';
    if (!f.cardName.trim()) e.cardName = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => { if (step === 1 && validateStep1()) { trackEvent('begin_checkout', { currency: 'USD', value: total, items: cart.map(i => ({ item_id: i.product.id, item_name: i.product.name, price: i.product.price, quantity: i.quantity })), ...utmParams() }); setStep(2); } };
  const handlePay = async () => {
    if (step === 2 && validateStep2()) {
      setStep(3);
      await new Promise(r => setTimeout(r, 2500));
      const addr = `${f.address}, ${f.city}, ${f.state} ${f.zip}`;
      const oid = placeOrder(addr);
      setOrderId(oid);
      setStep(4);
    }
  };

  const fmtCard = (v: string) => v.replace(/\s/g, '').replace(/(\d{4})/g, '$1 ').trim().slice(0, 19);
  const fmtExp = (v: string) => { const d = v.replace(/\D/g, ''); return d.length >= 2 ? d.slice(0, 2) + '/' + d.slice(2, 4) : d; };

  const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

  // Redirect to cart (in an effect — never call navigate() during render).
  useEffect(() => { if (cart.length === 0 && step < 4) nav('/cart'); }, [cart.length, step, nav]);
  if (cart.length === 0 && step < 4) return null;

  // ── Success ──
  if (step === 4) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle size={40} className="text-green-500" /></div>
        <h1 className="text-2xl font-bold mb-2">Order Confirmed!</h1>
        <p className="text-gray-500 mb-1">Order <span className="font-mono font-semibold text-gray-700">#{orderId}</span></p>
        <p className="text-sm text-gray-400 mb-6">Confirmation sent to {f.email}</p>
        <div className="bg-white rounded-xl border p-5 text-left mb-6">
          <h3 className="font-semibold text-sm mb-3">Shipping to:</h3>
          <p className="text-sm text-gray-600">{f.firstName} {f.lastName}</p>
          <p className="text-sm text-gray-600">{f.address}</p>
          <p className="text-sm text-gray-600">{f.city}, {f.state} {f.zip}</p>
          <div className="mt-3 pt-3 border-t"><p className="text-sm text-gray-500">Delivery: <span className="font-medium text-gray-700">{shipMethod === 'express' ? '2-4 business days' : '7-12 business days'}</span></p></div>
        </div>
        <div className="flex gap-3">
          <Link to="/orders" className="flex-1 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl text-center text-sm transition-colors">View Orders</Link>
          <Link to="/shop" className="flex-1 py-3 border border-gray-200 hover:bg-gray-50 font-semibold rounded-xl text-center text-sm">Continue Shopping</Link>
        </div>
      </div>
    </div>
  );

  // ── Processing ──
  if (step === 3) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-20 h-20 bg-luxe-gold-soft rounded-full flex items-center justify-center mx-auto mb-6"><Loader2 size={36} className="text-luxe-gold animate-spin" /></div>
        <h2 className="text-xl font-bold mb-2">Processing Payment...</h2>
        <p className="text-sm text-gray-500">Please wait. Do not close this page.</p>
      </div>
    </div>
  );

  // ── Main Checkout ──
  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Progress */}
      <div className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center gap-3">
            {[{ n: 1, l: 'Information' }, { n: 2, l: 'Payment' }, { n: 3, l: 'Confirm' }].map((s, i) => (
              <div key={s.n} className="flex items-center gap-3">
                <div className={`flex items-center gap-2 ${step >= s.n ? 'text-luxe-gold' : 'text-gray-400'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ring-2 ${step > s.n ? 'bg-luxe-success text-white ring-luxe-success/30' : step === s.n ? 'bg-luxe-gold text-white ring-luxe-gold/30' : 'bg-luxe-silver/60 text-luxe-gray ring-transparent'}`}>
                    {step > s.n ? '✓' : s.n}
                  </div>
                  <span className="text-sm font-medium hidden sm:block">{s.l}</span>
                </div>
                {i < 2 && <div className={`w-8 sm:w-16 h-0.5 ${step > s.n ? 'bg-green-400' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-5 gap-8">

          {/* ──── LEFT SIDE: Forms ──── */}
          <div className="lg:col-span-3 space-y-6">
            {/* Step 1: Shipping */}
            {step === 1 && (
              <>
                {/* Contact */}
                <div className="bg-white rounded-2xl border p-6">
                  <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><UserIcon size={18} className="text-luxe-gold" /> Contact Information</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className={L}>First Name *</label><input value={f.firstName} onChange={e => setF({...f, firstName: e.target.value})} className={I} placeholder="John" />{ER('firstName')}</div>
                    <div><label className={L}>Last Name *</label><input value={f.lastName} onChange={e => setF({...f, lastName: e.target.value})} className={I} placeholder="Doe" />{ER('lastName')}</div>
                    <div><label className={L}>Email *</label><input type="email" value={f.email} onChange={e => setF({...f, email: e.target.value})} className={I} placeholder="john@example.com" />{ER('email')}</div>
                    <div><label className={L}>Phone *</label><input type="tel" value={f.phone} onChange={e => setF({...f, phone: e.target.value})} className={I} placeholder="(555) 123-4567" />{ER('phone')}</div>
                  </div>
                </div>

                {/* Shipping Address */}
                <div className="bg-white rounded-2xl border p-6">
                  <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><Truck size={18} className="text-luxe-gold" /> Shipping Address</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2"><label className={L}>Street Address *</label><input value={f.address} onChange={e => setF({...f, address: e.target.value})} className={I} placeholder="123 Main Street, Apt 4B" />{ER('address')}</div>
                    <div><label className={L}>City *</label><input value={f.city} onChange={e => setF({...f, city: e.target.value})} className={I} placeholder="Irving" />{ER('city')}</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={L}>State *</label><select value={f.state} onChange={e => setF({...f, state: e.target.value})} className={I}><option value="">--</option>{US_STATES.map(s => <option key={s}>{s}</option>)}</select>{ER('state')}</div>
                      <div><label className={L}>ZIP *</label><input value={f.zip} onChange={e => setF({...f, zip: e.target.value})} className={I} placeholder="75038" maxLength={10} />{ER('zip')}</div>
                    </div>
                  </div>
                </div>

                {/* Shipping Method */}
                <div className="bg-white rounded-2xl border p-6">
                  <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><Package size={18} className="text-luxe-gold" /> Shipping Method</h2>
                  <div className="space-y-3">
                    {[
                      { id: 'standard' as const, label: 'Standard Shipping', time: '7-12 business days', price: sub >= 50 ? 'FREE' : '$4.99', badge: sub >= 50 ? '🎉 Free!' : '' },
                      { id: 'express' as const, label: 'Express Shipping', time: '2-4 business days', price: '$9.99', badge: '' },
                    ].map(o => (
                      <label key={o.id} className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${shipMethod === o.id ? 'border-luxe-gold bg-luxe-gold-soft' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="radio" name="ship" checked={shipMethod === o.id} onChange={() => setShipMethod(o.id)} className="w-4 h-4 text-luxe-gold border-gray-300" />
                        <div className="flex-1">
                          <p className="font-semibold text-sm">{o.label}</p>
                          <p className="text-xs text-gray-500">{o.time}</p>
                        </div>
                        <div className="text-right">
                          <span className={`font-bold text-sm ${o.price === 'FREE' ? 'text-green-600' : ''}`}>{o.price}</span>
                          {o.badge && <p className="text-[10px] text-green-600 font-medium">{o.badge}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <button onClick={handleNext} className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-gold">
                  Continue to Payment <ArrowRight size={16} />
                </button>
              </>
            )}

            {/* Step 2: Payment */}
            {step === 2 && (
              <>
                <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-luxe-gold flex items-center gap-1 mb-2"><ArrowLeft size={14} /> Back to Information</button>

                <div className="bg-white rounded-2xl border p-6">
                  <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><CreditCard size={18} className="text-luxe-gold" /> Payment Method</h2>

                  {/* Method Toggle */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                    <button onClick={() => setPayMethod('card')} className={`p-4 rounded-xl border-2 text-left transition-all ${payMethod === 'card' ? 'border-luxe-gold bg-luxe-gold-soft' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-7 bg-gradient-to-r from-blue-600 to-blue-400 rounded flex items-center justify-center"><span className="text-white text-[8px] font-bold">STRIPE</span></div>
                        <div><p className="font-semibold text-sm">Credit / Debit</p><p className="text-[10px] text-gray-500">Visa, MC, Amex</p></div>
                      </div>
                    </button>
                    <button onClick={() => setPayMethod('paypal')} className={`p-4 rounded-xl border-2 text-left transition-all ${payMethod === 'paypal' ? 'border-luxe-gold bg-luxe-gold-soft' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-7 bg-[#003087] rounded flex items-center justify-center"><span className="text-white text-[8px] font-bold">PayPal</span></div>
                        <div><p className="font-semibold text-sm">PayPal</p><p className="text-[10px] text-gray-500">Fast & secure</p></div>
                      </div>
                    </button>
                  </div>

                  {payMethod === 'card' ? (
                    <div className="space-y-4">
                      <div><label className={L}>Card Number *</label><input value={f.cardNum} onChange={e => setF({...f, cardNum: fmtCard(e.target.value)})} className={I} placeholder="4242 4242 4242 4242" maxLength={19} />{ER('cardNum')}</div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className={L}>Expiry *</label><input value={f.cardExp} onChange={e => setF({...f, cardExp: fmtExp(e.target.value)})} className={I} placeholder="MM/YY" maxLength={5} />{ER('cardExp')}</div>
                        <div><label className={L}>CVC *</label><input value={f.cardCvc} onChange={e => setF({...f, cardCvc: e.target.value.replace(/\D/g,'').slice(0,4)})} className={I} placeholder="123" maxLength={4} />{ER('cardCvc')}</div>
                      </div>
                      <div><label className={L}>Cardholder Name *</label><input value={f.cardName} onChange={e => setF({...f, cardName: e.target.value})} className={I} placeholder="JOHN DOE" />{ER('cardName')}</div>
                    </div>
                  ) : (
                    <div className="text-center py-8 bg-gray-50 rounded-xl">
                      <p className="text-sm text-gray-600 mb-2">You'll be redirected to PayPal to complete payment.</p>
                      <p className="text-xs text-gray-400">Secure. Fast. Easy.</p>
                    </div>
                  )}
                </div>

                {/* Security Note */}
                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                  <Shield size={18} className="text-green-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-green-800">Your payment is secure</p>
                    <p className="text-xs text-green-600">256-bit SSL encryption. We never store your card details.</p>
                  </div>
                </div>

                <button onClick={handlePay} className="w-full py-4 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-gold">
                  <Lock size={16} />
                  {payMethod === 'paypal' ? `Pay with PayPal · $${total.toFixed(2)}` : `Complete Purchase · $${total.toFixed(2)}`}
                </button>
              </>
            )}
          </div>

          {/* ──── RIGHT SIDE: Order Summary ──── */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border p-6 sticky top-20">
              <h2 className="font-bold text-lg mb-5">Order Summary</h2>

              {/* Items */}
              <div className="space-y-4 mb-6 max-h-64 overflow-y-auto pr-1">
                {cart.map(item => (
                  <div key={item.product.id} className="flex gap-3">
                    <div className="relative shrink-0">
                      <img src={item.product.images[0]} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                      <span className="absolute -top-2 -right-2 w-5 h-5 bg-gray-700 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{item.quantity}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.product.name}</p>
                      <p className="text-xs text-gray-500">{item.product.category}</p>
                    </div>
                    <p className="text-sm font-semibold shrink-0">${(item.product.price * item.quantity).toFixed(2)}</p>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="border-t pt-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-medium">${sub.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className={`font-medium ${shipCost === 0 ? 'text-green-600' : ''}`}>{shipCost === 0 ? 'FREE' : `$${shipCost.toFixed(2)}`}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Tax (TX 8.25%)</span><span className="font-medium">${tax.toFixed(2)}</span></div>
                {shipCost > 0 && sub < 50 && <p className="text-xs text-luxe-gold">💡 Add ${(50 - sub).toFixed(2)} more for free shipping!</p>}
                <div className="flex justify-between pt-3 border-t">
                  <span className="font-bold text-lg">Total</span>
                  <div className="text-right">
                    <span className="font-bold text-xl text-gray-900">${total.toFixed(2)}</span>
                    <p className="text-[10px] text-gray-400">USD</p>
                  </div>
                </div>
              </div>

              {/* Trust Badges */}
              <div className="mt-6 pt-5 border-t space-y-2.5">
                {[
                  { i: Truck, t: `${shipMethod === 'express' ? 'Express 2-4 days' : 'Standard 7-12 days'}` },
                  { i: RotateCcw, t: '30-day hassle-free returns' },
                  { i: Shield, t: 'Secure SSL checkout' },
                ].map((b, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-xs text-gray-500">
                    <b.i size={14} className="text-luxe-gold shrink-0" />{b.t}
                  </div>
                ))}
              </div>

              {/* Payment Icons */}
              <div className="mt-5 pt-4 border-t flex items-center justify-center gap-2">
                {['VISA','MC','AMEX','PayPal'].map(c => (
                  <span key={c} className="px-2 py-1 bg-gray-50 border border-gray-200 rounded text-[9px] font-bold text-gray-500">{c}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrdersPage() { const { orders, user } = useApp(); const nav = useNavigate(); useEffect(() => { if (!user) nav('/login'); }, [user, nav]);
  if (orders.filter(o => o.userId === user?.id).length === 0 && user?.role !== 'admin') return <div className="min-h-[60vh] flex items-center justify-center px-4"><div className="text-center"><div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Package size={28} className="text-luxe-gold" /></div><h2 className="font-serif text-2xl font-bold text-luxe-black mb-2">No Orders Yet</h2><p className="text-sm text-luxe-gray mb-6">When you place an order, it will appear here.</p><Link to="/shop" className="inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Shop Now</Link></div></div>;
  return <div className="py-12 bg-gray-50 min-h-screen"><div className="max-w-4xl mx-auto px-4"><h1 className="text-3xl font-serif font-bold mb-8">My Orders</h1>{orders.filter(o => user?.role === 'admin' || o.userId === user?.id).map(o => <div key={o.id} className="bg-white rounded-xl border p-6 mb-4"><div className="flex justify-between mb-4"><div><p className="font-semibold">{o.id}</p><p className="text-sm text-gray-500">{new Date(o.date).toLocaleDateString()}</p></div><span className="px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-sm">{o.status}</span></div>{o.items.map(i => <div key={i.product.id} className="flex items-center gap-4 py-2 border-t"><img src={i.product.images[0]} alt="" className="w-12 h-12 rounded object-cover" /><div className="flex-1"><p className="font-medium">{i.product.name}</p><p className="text-sm text-gray-500">Qty: {i.quantity}</p></div><p className="font-semibold">${(i.product.price * i.quantity).toFixed(2)}</p></div>)}<div className="pt-4 mt-4 border-t flex justify-between"><span className="font-semibold">Total</span><span className="text-lg font-bold text-luxe-gold">${o.total.toFixed(2)}</span></div></div>)}</div></div>;
}

function LoginPage() {
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, adminCreds, guestLogin, cart } = useApp();
  const nav = useNavigate();

  const sub = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 700));
    if (login(e, p)) nav(e.toLowerCase() === adminCreds.email.toLowerCase() ? '/admin' : '/');
    else { setErr('Invalid email or password'); setLoading(false); }
  };

  const asGuest = () => { guestLogin(); nav(cart.length ? '/checkout' : '/'); };

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-12 overflow-hidden bg-gradient-to-br from-luxe-light via-white to-white">
      {/* Ambient glows — soft blue, light theme */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-luxe-gold/10 blur-[120px]" />
      <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-luxe-gold/10 blur-[140px]" />
      <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #2563eb 1px, transparent 0)', backgroundSize: '30px 30px' }} />

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Logo — perfectly centered above card */}
        <div className="flex justify-center mb-7">
          <Link to="/" className="inline-flex items-center justify-center group" aria-label="Luxedge home">
            <img src="/luxedge-lockup.svg" alt="Luxedge" className="h-14 sm:h-16 w-auto drop-shadow-[0_6px_24px_rgba(37,99,235,0.18)] transition-transform group-hover:scale-105" />
          </Link>
        </div>

        {/* Card — light glass */}
        <div className="bg-white rounded-3xl border border-luxe-silver p-8 shadow-[0_20px_60px_-20px_rgba(23,32,51,0.15)]">
          <h1 className="text-2xl font-bold text-luxe-black mb-1.5">Welcome Back</h1>
          <p className="text-sm text-gray-500 mb-8">Sign in to your account to continue</p>

          {err && <div className="mb-5 p-3 bg-sale-bg border border-sale/30 rounded-xl text-sale text-sm text-center animate-scale-in">{err}</div>}

          <form onSubmit={sub} className="space-y-5">
            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={e} onChange={ev => setE(ev.target.value)} placeholder="Email address"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPw ? 'text' : 'password'} required value={p} onChange={ev => setP(ev.target.value)} placeholder="Password"
                className="w-full pl-12 pr-12 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-luxe-gold transition-colors">
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer text-gray-600">
                <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-luxe-gold" defaultChecked />
                Remember me
              </label>
              <a href="#" className="text-luxe-gold hover:text-luxe-gold-dark transition-colors">Forgot password?</a>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-gold">
              {loading ? <Loader2 size={18} className="animate-spin" /> : <>{'Sign In'}<ArrowRight size={16} /></>}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-luxe-silver" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">or continue as</span>
            <div className="flex-1 h-px bg-luxe-silver" />
          </div>

          {/* Guest Login */}
          <button onClick={asGuest}
            className="w-full py-3.5 border border-luxe-silver hover:border-luxe-gold/60 bg-luxe-cream hover:bg-luxe-light text-luxe-black font-semibold rounded-xl transition-all flex flex-wrap items-center justify-center gap-2 group">
            <UserIcon size={16} className="text-luxe-gold" />
            Continue as Guest
            <span className="text-[10px] uppercase tracking-wider text-gray-400 group-hover:text-luxe-gold transition-colors">No account needed</span>
          </button>

          <p className="mt-5 text-center text-sm text-gray-500">
            No account?{' '}
            <Link to="/signup" className="text-luxe-gold font-semibold hover:text-luxe-gold-dark transition-colors">Create one</Link>
          </p>

          {/* Go to store — browse without an account */}
          <Link to="/shop"
            className="mt-4 w-full py-2.5 rounded-xl border border-luxe-silver bg-white hover:bg-luxe-cream hover:border-luxe-gold/50 text-gray-600 hover:text-luxe-gold text-sm font-medium transition-all flex items-center justify-center gap-2">
            <ShoppingBag size={15} className="text-luxe-gold" />
            Go to store
          </Link>
        </div>

        {/* Trust line */}
        <div className="mt-8 flex items-center justify-center gap-6 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><Shield size={13} className="text-luxe-gold" /> Secure checkout</span>
          <span className="flex items-center gap-1.5"><Truck size={13} className="text-luxe-gold" /> Free shipping $50+</span>
          <span className="flex items-center gap-1.5"><RotateCcw size={13} className="text-luxe-gold" /> 30-day returns</span>
        </div>

        {/* Admin link */}
        <p className="mt-6 text-center text-xs text-gray-500">
          Admin? <Link to="/admin/login" className="text-luxe-gold/80 hover:text-luxe-gold transition-colors">Go to Admin Login</Link>
        </p>
      </div>
    </div>
  );
}

function SignupPage() {
  const [n, setN] = useState('');
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useApp();
  const nav = useNavigate();

  const sub = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr('');
    if (!signup(n, e, p)) { setErr('An account with this email already exists'); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 700));
    nav('/');
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-12 overflow-hidden bg-gradient-to-br from-luxe-light via-white to-white">
      {/* Ambient glows — soft blue, light theme */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-luxe-gold/10 blur-[120px]" />
      <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-luxe-gold/10 blur-[140px]" />
      <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #2563eb 1px, transparent 0)', backgroundSize: '30px 30px' }} />

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Logo — perfectly centered above card */}
        <div className="flex justify-center mb-7">
          <Link to="/" className="inline-flex items-center justify-center group" aria-label="Luxedge home">
            <img src="/luxedge-lockup.svg" alt="Luxedge" className="h-14 sm:h-16 w-auto drop-shadow-[0_6px_24px_rgba(37,99,235,0.18)] transition-transform group-hover:scale-105" />
          </Link>
        </div>

        {/* Card — light glass */}
        <div className="bg-white rounded-3xl border border-luxe-silver p-8 shadow-[0_20px_60px_-20px_rgba(23,32,51,0.15)]">
          <h1 className="text-2xl font-bold text-luxe-black mb-1.5">Join Luxedge</h1>
          <p className="text-sm text-gray-500 mb-8">Create your account to start shopping</p>

          {err && <div className="mb-5 p-3 bg-sale-bg border border-sale/30 rounded-xl text-sale text-sm text-center animate-scale-in">{err}</div>}

          <form onSubmit={sub} className="space-y-5">
            <div className="relative">
              <UserIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" required value={n} onChange={ev => setN(ev.target.value)} placeholder="Full Name"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={e} onChange={ev => setE(ev.target.value)} placeholder="Email address"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPw ? 'text' : 'password'} required value={p} onChange={ev => setP(ev.target.value)} placeholder="Password (6+ characters)" minLength={6}
                className="w-full pl-12 pr-12 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-luxe-gold transition-colors">
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-gold">
              {loading ? <Loader2 size={18} className="animate-spin" /> : <>{'Create Account'}<ArrowRight size={16} /></>}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            Have an account?{' '}
            <Link to="/login" className="text-luxe-gold font-semibold hover:text-luxe-gold-dark transition-colors">Sign In</Link>
          </p>

          {/* Go to store — browse without an account */}
          <Link to="/shop"
            className="mt-4 w-full py-2.5 rounded-xl border border-luxe-silver bg-white hover:bg-luxe-cream hover:border-luxe-gold/50 text-gray-600 hover:text-luxe-gold text-sm font-medium transition-all flex items-center justify-center gap-2">
            <ShoppingBag size={15} className="text-luxe-gold" />
            Go to store
          </Link>
        </div>

        {/* Trust line */}
        <div className="mt-8 flex items-center justify-center gap-6 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><Shield size={13} className="text-luxe-gold" /> Secure checkout</span>
          <span className="flex items-center gap-1.5"><Truck size={13} className="text-luxe-gold" /> Free shipping $50+</span>
          <span className="flex items-center gap-1.5"><RotateCcw size={13} className="text-luxe-gold" /> 30-day returns</span>
        </div>
      </div>
    </div>
  );
}

function AdminLoginPage() {
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const { login } = useApp();
  const nav = useNavigate();

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr('');
    if (login(e, p, true)) {
      nav('/admin');
    } else {
      setErr('Invalid email or password');
    }
  };

  return (
    <div className="min-h-screen bg-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Shield className="text-luxe-gold" size={28} />
          <span className="text-xl font-bold">Admin Login</span>
        </div>
        <p className="text-center text-sm text-gray-500 mb-6">Secure access to admin dashboard</p>

        {err && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            <AlertTriangle size={16} />{err}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email</label>
            <input type="email" placeholder="Enter admin email" value={e} onChange={ev => setE(ev.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20" required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Password</label>
            <input type="password" placeholder="Enter password" value={p} onChange={ev => setP(ev.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20" required />
          </div>
          <button type="submit" className="w-full py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-gold">
            <Lock size={16} /> Access Dashboard
          </button>
        </form>

        <div className="mt-6 flex items-center gap-2 text-xs text-gray-400 justify-center">
          <Shield size={12} /> Protected admin area
        </div>

        <Link to="/" className="block text-center text-sm text-gray-500 mt-4 hover:text-gray-700">← Back to Store</Link>
      </div>
    </div>
  );
}

// ============================================================================
// LEGAL + SUPPORT + BRAND PAGES
// ============================================================================
function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-luxe-silver/60 py-12"><div className="max-w-4xl mx-auto px-4 text-center"><h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black">{title}</h1></div></section>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl border p-6 sm:p-10">
          <p className="text-xs text-gray-400 mb-8">Last updated: {updated}</p>
          <div className="space-y-8 text-sm text-gray-600 leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
function LS({ t, children }: { t: string; children: ReactNode }) { return <div><h2 className="text-base font-bold text-gray-900 mb-2">{t}</h2>{children}</div>; }

function AboutPage() {
  return (<div>
    <section className="bg-gradient-to-b from-luxe-light to-white border-b border-gray-100 py-16"><div className="max-w-4xl mx-auto px-4 text-center">
      <p className="text-luxe-gold text-xs font-semibold uppercase tracking-wider mb-3">Our Story</p>
      <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-3">About Luxedge</h1>
      <p className="text-gray-500 max-w-xl mx-auto">More than a store — a commitment to quality you can feel.</p>
    </div></section>
    <section className="py-14"><div className="max-w-3xl mx-auto px-4 space-y-6">
      <p className="text-lg text-gray-700 leading-relaxed">Luxedge was born from a simple frustration: finding quality products online shouldn't feel like a gamble. Too many marketplaces are flooded with low-quality items, misleading photos, and unreliable sellers.</p>
      <p className="text-gray-600 leading-relaxed">We decided to build something different. Based in Irving, Texas, Luxedge is a curated ecommerce destination where every product is handpicked by our team before it ever reaches our shelves. We test, compare, and reject hundreds of items to list only the ones we'd genuinely recommend to friends and family.</p>
      <h2 className="text-xl font-bold text-gray-900 pt-4">Our Mission</h2>
      <p className="text-gray-600 leading-relaxed">To make premium-quality products accessible to everyone — without the premium markup. We believe great design and solid craftsmanship shouldn't cost a fortune. Every item on Luxedge represents the best value we could find at its price point.</p>
      <h2 className="text-xl font-bold text-gray-900 pt-4">Customer-First, Always</h2>
      <p className="text-gray-600 leading-relaxed">We stand behind everything we sell. That means free shipping on orders over $50, a 30-day hassle-free return policy, and a support team that actually responds. If something isn't right with your order, we make it right — no runaround, no fine print.</p>
      <p className="text-gray-600 leading-relaxed">Whether you're setting up a cozy corner for your cat, outfitting your dog for adventure, or simply spoiling your furry friend with something well-made, Luxedge is here to help you shop smarter and keep your pet happier.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-10 pt-8 border-t">
        {[{v:'2,000+',l:'Happy Customers'},{v:'500+',l:'Products Curated'},{v:'99%',l:'Satisfaction Rate'},{v:'24/7',l:'Customer Support'}].map((s,i)=>
          <div key={i} className="text-center"><p className="text-2xl font-bold text-luxe-gold">{s.v}</p><p className="text-xs text-gray-500 mt-1">{s.l}</p></div>
        )}
      </div>
    </div></section>
  </div>);
}

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="August 14, 2026">
      <LS t="Introduction"><p>At Luxedge, we value your privacy and are committed to protecting your personal information. This Privacy Policy explains what information we collect, how we use it, and the choices you have when using our website.</p></LS>
      <LS t="Information We Collect"><ul className="list-disc pl-5 mt-2 space-y-1"><li>Name</li><li>Billing and shipping address</li><li>Email address</li><li>Phone number</li><li>Payment information (processed securely through our payment providers)</li><li>Order history</li><li>IP address, browser type, and device information</li><li>Website usage information through cookies and analytics</li></ul></LS>
      <LS t="Checkout Options"><p><strong>Guest Checkout:</strong> You do not need to create an account to make a purchase. Customers may complete their orders using Guest Checkout. We collect only the information necessary to process, ship, and support the order.</p><p className="mt-2"><strong>Create an Account:</strong></p><ul className="list-disc pl-5 mt-2 space-y-1"><li>Customers who prefer to create an account may register during checkout.</li><li>View order history.</li><li>Save billing and shipping information for faster future purchases.</li><li>Track current and past orders.</li><li>Manage account information.</li></ul><p className="mt-2">Whether you choose Guest Checkout or create an account, your personal information is collected, stored, and protected in accordance with this Privacy Policy.</p></LS>
      <LS t="How We Use Your Information"><ul className="list-disc pl-5 mt-2 space-y-1"><li>Process and fulfill your orders.</li><li>Communicate regarding your order or customer service requests.</li><li>Improve our website and customer experience.</li><li>Prevent fraud and unauthorized transactions.</li><li>Comply with legal obligations.</li><li>Send promotional emails if you have opted in (you may unsubscribe at any time).</li></ul></LS>
      <LS t="Payment Security"><p>Payments are processed securely through trusted third-party payment processors. Luxedge does not store your complete credit or debit card information on our servers.</p></LS>
      <LS t="Cookies"><p>Our website uses cookies to remember your preferences, improve website performance, analyze website traffic, and enhance your shopping experience. When you first visit our site, we ask for your consent to use advertising and analytics cookies. You may change your choice or disable cookies through your browser settings at any time, although some website features may not function properly.</p></LS>
      <LS t="Advertising & Google AdSense"><p>We display advertising on our website through <strong>Google AdSense</strong>, a service provided by Google LLC ("Google"). Google and its advertising partners may use cookies — such as the DoubleClick cookie — to serve and personalize ads based on your visits to this site and other websites across the Internet.</p><p className="mt-2">You can learn more about how Google uses data when you visit sites that partner with it by reading Google's page on <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-700">how Google uses data when you use our partners' sites or apps</a>.</p><p className="mt-2">You can opt out of personalized advertising by visiting <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-700">Google Ads Settings</a>. Third-party vendors, including Google, use cookies to serve ads based on a user's prior visits to this website.</p></LS>
      <LS t="Sharing Your Information"><ul className="list-disc pl-5 mt-2 space-y-1"><li>We do not sell or rent your personal information.</li><li>We may share your information only with trusted service providers, including payment processors, shipping carriers, website hosting providers, and analytics services. These providers receive only the information necessary to perform their services.</li></ul></LS>
      <LS t="Data Security"><p>We use reasonable administrative, technical, and physical safeguards to protect your personal information. While no method of transmission over the Internet is completely secure, we strive to protect your information using industry-standard security practices.</p></LS>
      <LS t="Your Rights"><p>Depending on your location, you may request access to, correction of, or deletion of your personal information where permitted by law, and you may opt out of marketing communications.</p></LS>
      <LS t="Third-Party Links"><p>Our website may contain links to third-party websites. We are not responsible for the privacy practices or content of those websites.</p></LS>
      <LS t="Changes to This Privacy Policy"><p>We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated effective date.</p></LS>
      <LS t="Contact Us"><p>If you have any questions about this Privacy Policy or how we handle your information, please contact us:<br />Email: hello@luxedge.us<br />Phone: (440) 941-8002</p></LS>
    </LegalPage>
  );
}

function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="August 14, 2026">
      <LS t="Orders and Product Information"><p>Product availability, pricing, and descriptions may change as inventory and supplier information are updated. We work to keep product details accurate and current.</p></LS>
      <LS t="Customer Responsibilities"><p>Customers are responsible for providing accurate account, shipping, and payment details when placing orders or contacting support.</p></LS>
      <LS t="Returns & Replacements"><p>Returns and replacements are governed by our Return &amp; Replacement Policy. Contact us within 30 days of your order date to request a return authorization. We do not offer refunds.</p></LS>
      <LS t="Support"><p>For questions about an order, product, or account, contact Luxedge support using the contact details provided on the site.</p></LS>
    </LegalPage>
  );
}

function ReturnsPage() {
  return (
    <LegalPage title="Returns & Replacement Policy" updated="August 14, 2026">
      <LS t="Our Promise"><p>At Luxedge, we take pride in the quality of our pet essentials. If you receive a product that is damaged, defective, or incorrect, please contact us within 30 days of your order date. We will work with you to resolve the issue as quickly as possible.</p></LS>
      <LS t="Return Eligibility"><ul className="list-disc pl-5 mt-2 space-y-1"><li>Return requests must be made within 30 days of the original order date.</li><li>Products must be unused, unopened, and returned in their original packaging.</li><li>Returns require prior approval from Luxedge before being shipped.</li></ul></LS>
      <LS t="Replacement Policy"><p>Once we receive and inspect your returned product, we will process a replacement if the return meets our policy requirements.</p><p className="mt-2">Replacement items will be shipped after the returned product has been received and approved.</p></LS>
      <LS t="No Refund Policy"><p>We do not offer refunds.</p><p className="mt-2">Eligible returned products will be replaced with the same product. Refunds, exchanges for different products, or store credits are not available.</p></LS>
      <LS t="Return Shipping"><ul className="list-disc pl-5 mt-2 space-y-1"><li>Customers are responsible for purchasing their own return shipping label.</li><li>Customers are responsible for properly packaging the product to prevent damage during transit.</li><li>Customers are responsible for all return shipping costs.</li><li>We recommend using a trackable shipping service, as Luxedge is not responsible for returns that are lost or damaged during shipping.</li></ul></LS>
      <LS t="Damaged or Incorrect Orders"><p>If your order arrives damaged or you received the wrong product, please contact us within 30 days of delivery. Include your order number and photos of the product and packaging so we can review your request promptly.</p></LS>
      <LS t="Contact Us"><p>If you have any questions regarding returns or replacements, please contact us:<br />Email: hello@luxedge.us<br />Phone: (440) 941-8002</p></LS>
    </LegalPage>
  );
}

function ShippingPolicyPage() {
  return (
    <LegalPage title="Shipping Policy" updated="March 15, 2025">
      <LS t="Where We Ship"><p>Luxedge currently ships to all 50 US states and territories. We are working on expanding to international destinations soon.</p></LS>
      <LS t="Processing Time"><p>Orders are typically processed within <strong>1-3 business days</strong> after payment confirmation. You'll receive an email confirmation when your order has been shipped with tracking information.</p></LS>
      <LS t="Shipping Methods & Times"><div className="mt-3 overflow-x-auto"><table className="w-full text-sm border-collapse"><thead><tr className="bg-gray-50"><th className="text-left px-4 py-2 border">Method</th><th className="text-left px-4 py-2 border">Estimated Delivery</th><th className="text-left px-4 py-2 border">Cost</th></tr></thead><tbody><tr><td className="px-4 py-2 border">Standard Shipping</td><td className="px-4 py-2 border">7-12 business days</td><td className="px-4 py-2 border">$4.99 (FREE on orders $50+)</td></tr><tr><td className="px-4 py-2 border">Express Shipping</td><td className="px-4 py-2 border">2-4 business days</td><td className="px-4 py-2 border">$9.99</td></tr></tbody></table></div></LS>
      <LS t="Free Shipping"><p>Enjoy <strong>free standard shipping</strong> on all orders of $50 or more. This offer applies automatically at checkout — no coupon code needed.</p></LS>
      <LS t="Order Tracking"><p>Once your order ships, you'll receive a confirmation email with a tracking number. You can use this number to track your package through the carrier's website. You can also check your order status by logging into your Luxedge account and visiting the "My Orders" section.</p></LS>
      <LS t="Delivery Delays"><p>While we strive to meet all estimated delivery windows, delays may occasionally occur due to high order volume, carrier issues, weather events, or other circumstances beyond our control. If your order is significantly delayed, please contact us and we'll investigate immediately.</p></LS>
      <LS t="Missing or Lost Packages"><p>If your tracking shows "delivered" but you haven't received your package, please check with neighbors, building management, or your local post office. If you still can't locate your package after 48 hours, contact us at hello@luxedge.us and we'll work with the carrier to resolve the issue.</p></LS>
      <LS t="Address Accuracy"><p>Please double-check your shipping address before completing checkout. Luxedge is not responsible for orders shipped to incorrect addresses provided by the customer. Address correction fees charged by carriers will be the customer's responsibility.</p></LS>
      <LS t="P.O. Boxes & Military Addresses"><p>We ship to P.O. Boxes and APO/FPO/DPO addresses via USPS. Delivery times to military addresses may vary. Express shipping is not available for P.O. Box or military addresses.</p></LS>
    </LegalPage>
  );
}

function FAQPage() {
  const [open, setOpen] = useState<string | null>(null);
  const faqs = [
    { c: 'Orders & Shipping', qs: [
      { q: 'How long does shipping take?', a: 'Standard shipping takes 7-12 business days. Express shipping delivers in 2-4 business days. Processing takes an additional 1-3 business days before shipment.' },
      { q: 'Do you offer free shipping?', a: 'Yes! We offer free standard shipping on all orders of $50 or more. The discount is applied automatically at checkout.' },
      { q: 'How can I track my order?', a: 'Once your order ships, you\'ll receive an email with a tracking number. You can also log into your Luxedge account and check "My Orders" for real-time tracking updates.' },
      { q: 'Do you ship internationally?', a: 'Currently, we ship only within the United States (all 50 states and territories). International shipping is coming soon.' },
      { q: 'Can I change my shipping address after ordering?', a: 'If your order hasn\'t shipped yet, contact us immediately at hello@luxedge.us and we\'ll do our best to update the address. Once shipped, address changes are not possible.' },
    ]},
    { c: 'Returns & Refunds', qs: [
      { q: 'What is your return policy?', a: 'We offer a 30-day return & replacement policy. Products must be unused, unopened, and in their original packaging. Email hello@luxedge.us within 30 days for a return authorization.' },
      { q: 'How does the replacement process work?', a: 'Once we receive and inspect your approved return, we ship a replacement of the same product. We do not offer refunds or exchanges for different products.' },
      { q: 'Who pays for return shipping?', a: 'Customers are responsible for return shipping costs and for packaging the product safely. We recommend using a trackable shipping service.' },
      { q: 'What if I receive a damaged or incorrect item?', a: 'Contact us within 30 days of delivery with your order number and photos of the product and packaging. We\'ll review your request and arrange a replacement.' },
    ]},
    { c: 'Payment & Security', qs: [
      { q: 'What payment methods do you accept?', a: 'We accept Visa, MasterCard, American Express, Discover, and PayPal. All transactions are processed securely through Stripe or PayPal.' },
      { q: 'Is my payment information secure?', a: 'Absolutely. We use 256-bit SSL encryption for all transactions. Your payment data is processed through PCI-DSS compliant processors. We never store your full card details on our servers.' },
      { q: 'Can I cancel an order?', a: 'Orders can be canceled within 2 hours of placement. After that, the order enters processing and cannot be canceled. Contact us at hello@luxedge.us as soon as possible if you need to cancel.' },
    ]},
    { c: 'Products & Quality', qs: [
      { q: 'How do you select your products?', a: 'Every product on Luxedge goes through a rigorous curation process. We evaluate quality, design, value, and customer reviews before listing any item. Only products that meet our standards make it to our store.' },
      { q: 'Are your products authentic?', a: 'Yes. We source all products from verified manufacturers and authorized distributors. Every item is quality-checked before it\'s listed on our store.' },
      { q: 'Do you offer warranties?', a: 'Individual warranty coverage varies by product and manufacturer. Check the product description for specific warranty details. For general quality issues, our 30-day return policy has you covered.' },
    ]},
    { c: 'Account & Support', qs: [
      { q: 'Do I need an account to shop?', a: 'You need an account to place orders, track shipments, and submit reviews. Creating an account is free and takes less than a minute.' },
      { q: 'How do I contact customer support?', a: 'Email us at hello@luxedge.us or call (440) 941-8002. Our support team is available Monday-Friday, 9 AM - 6 PM CT. We typically respond to emails within 24 hours.' },
      { q: 'I forgot my password. What do I do?', a: 'Use the password reset option on the login page. If you continue to have trouble, contact our support team and we\'ll help you regain access to your account.' },
    ]},
  ];

  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-luxe-silver/60 py-12"><div className="max-w-4xl mx-auto px-4 text-center"><h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-2">Frequently Asked Questions</h1><p className="text-luxe-gray text-sm">Quick answers to common questions about shopping at Luxedge.</p></div></section>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {faqs.map(section => (
          <div key={section.c}>
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><ChevronRight size={16} className="text-luxe-gold" />{section.c}</h2>
            <div className="space-y-2">
              {section.qs.map(faq => {
                const key = faq.q;
                const isOpen = open === key;
                return (
                  <div key={key} className="bg-white rounded-xl border overflow-hidden">
                    <button onClick={() => setOpen(isOpen ? null : key)} className="w-full flex items-center justify-between px-5 py-4 text-left">
                      <span className="text-sm font-medium text-gray-900 pr-4">{faq.q}</span>
                      <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed border-t pt-3">{faq.a}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="text-center pt-6">
          <p className="text-gray-500 text-sm mb-3">Still have questions?</p>
          <Link to="/contact" className="px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg text-sm inline-flex items-center gap-2 transition-colors"><Mail size={16} />Contact Support</Link>
        </div>
      </div>
    </div>
  );
}

function ContactPage() {
  const [ok, setOk] = useState(false);
  const { notify } = useApp();
  return (
    <div>
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-gray-100 py-10"><div className="max-w-4xl mx-auto px-4 text-center">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-2">Contact Us</h1>
        <p className="text-gray-500 text-sm max-w-lg mx-auto">Have a question, concern, or just want to say hello? We'd love to hear from you. Our team typically responds within 24 hours.</p>
      </div></section>
      <section className="py-10"><div className="max-w-4xl mx-auto px-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {[
            { i: Mail, l: 'Email', v: 'hello@luxedge.us', s: 'We reply within 24hrs' },
            { i: Phone, l: 'Phone', v: '(440) 941-8002', s: 'Mon-Fri, 9AM-6PM CT' },
            { i: MapPin, l: 'Address', v: 'Irving, TX 75038', s: 'United States' },
            { i: Clock, l: 'Hours', v: 'Mon - Fri', s: '9:00 AM - 6:00 PM CT' },
          ].map((x, i) => (
            <div key={i} className="text-center p-5 bg-gray-50 rounded-xl border border-gray-100">
              <x.i className="mx-auto mb-2 text-luxe-gold" size={22} />
              <p className="text-[10px] text-luxe-gold font-semibold uppercase tracking-wider">{x.l}</p>
              <p className="font-semibold text-sm mt-1">{x.v}</p>
              <p className="text-xs text-gray-500">{x.s}</p>
            </div>
          ))}
        </div>

        <div className="max-w-2xl mx-auto">
          {ok ? (
            <div className="text-center py-16 bg-green-50 rounded-2xl border border-green-200">
              <CheckCircle className="mx-auto text-green-500 mb-4" size={48} />
              <h2 className="text-xl font-bold mb-2">Message Received!</h2>
              <p className="text-sm text-gray-500">Thank you for reaching out. We'll get back to you within 24 hours.</p>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); setOk(true); notify('Message sent!'); }} className="bg-white rounded-2xl border p-6 sm:p-8 space-y-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Send size={18} className="text-luxe-gold" /> Send Us a Message</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Name *</label><input required placeholder="Your full name" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email *</label><input required type="email" placeholder="you@example.com" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold" /></div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Subject *</label>
                <select required className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold"><option value="">Select a topic</option><option>Order Question</option><option>Shipping & Tracking</option><option>Returns & Refunds</option><option>Product Inquiry</option><option>Technical Support</option><option>Other</option></select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Message *</label><textarea required placeholder="Tell us how we can help..." rows={5} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold resize-none" /></div>
              <button type="submit" className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm transition-colors shadow-gold"><Send size={16} />Send Message</button>
            </form>
          )}
        </div>
      </div></section>
    </div>
  );
}

// ============================================================================
// ============================================================================
function CareersPage() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-gray-100 py-10"><div className="max-w-4xl mx-auto px-4 text-center">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-2">Careers at Luxedge</h1>
        <p className="text-gray-500 text-sm max-w-lg mx-auto">Join our growing team and help shape the future of curated ecommerce.</p>
      </div></section>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <div className="bg-white rounded-2xl border p-6 sm:p-10">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Why Work at Luxedge?</h2>
          <p className="text-gray-600 leading-relaxed mb-4">At Luxedge, we're building more than an online store — we're creating a trusted destination for people who value quality. Based in Irving, Texas, our small but passionate team is obsessed with finding the best products in the world and delivering an exceptional shopping experience.</p>
          <p className="text-gray-600 leading-relaxed mb-6">We value curiosity, ownership, and a genuine desire to make customers happy. If you thrive in a fast-paced environment and want to grow alongside a brand that's just getting started, we'd love to hear from you.</p>

          <h2 className="text-xl font-bold text-gray-900 mb-4">Our Culture</h2>
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            {[
              { emoji: '🚀', title: 'Growth-Focused', desc: 'We invest in our people. Learn, grow, and level up with us.' },
              { emoji: '🤝', title: 'Collaborative', desc: 'Small team, big impact. Every voice matters here.' },
              { emoji: '🌍', title: 'Remote-Friendly', desc: 'Work from anywhere. We care about results, not locations.' },
              { emoji: '💡', title: 'Innovation-Driven', desc: 'We encourage new ideas and creative problem-solving.' },
            ].map((v, i) => (
              <div key={i} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-2xl">{v.emoji}</span>
                <h3 className="font-bold text-gray-900 mt-2">{v.title}</h3>
                <p className="text-sm text-gray-600 mt-1">{v.desc}</p>
              </div>
            ))}
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-4">Open Positions</h2>
          <p className="text-gray-600 leading-relaxed mb-4">We're always looking for talented individuals to join us. Even if you don't see a specific role listed, we encourage you to reach out — great people always have a place at Luxedge.</p>

          <div className="space-y-3 mb-8">
            {[
              { title: 'Product Curator', type: 'Remote · Full-Time', desc: 'Research, test, and select products that meet our quality standards.' },
              { title: 'Content Writer', type: 'Remote · Part-Time', desc: 'Create engaging blog posts, product descriptions, and marketing copy.' },
              { title: 'Customer Support Specialist', type: 'Remote · Full-Time', desc: 'Help customers via email and chat with a focus on resolution and delight.' },
            ].map((job, i) => (
              <div key={i} className="p-5 border border-gray-200 rounded-xl hover:border-luxe-gold/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-gray-900">{job.title}</h3>
                    <p className="text-xs text-luxe-gold font-medium mt-0.5">{job.type}</p>
                    <p className="text-sm text-gray-600 mt-2">{job.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-3">How to Apply</h2>
          <p className="text-gray-600 leading-relaxed mb-4">Send your resume and a brief note about why you'd be a great fit to <strong>careers@luxedge.us</strong>. Include the role you're interested in as the subject line. We review all applications and aim to respond within one week.</p>
          <Link to="/contact" className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg text-sm inline-flex items-center gap-2 transition-colors">
            <Mail size={16} /> Get in Touch
          </Link>
        </div>
      </div>
    </div>
  );
}

// BLOG SYSTEM
// ============================================================================
const blogSlug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function BlogListPage() {
  const { blogs, user } = useApp();
  const published = blogs.filter(b => b.status === 'published');

  return (
    <div>
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-gray-100 py-10">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-luxe-gold text-xs font-semibold uppercase tracking-wider mb-2">Luxedge Blog</p>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-2">Insights & Inspiration</h1>
          <p className="text-gray-500 text-sm max-w-lg mx-auto">Tips, guides, and stories from the world of pet care.</p>
        </div>
      </section>

      <section className="py-10 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4">
          {user && (
            <div className="flex justify-end mb-6">
              <Link to="/blog/write" className="px-5 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg flex items-center gap-2 text-sm">
                <PenLine size={16} /> Write a Post
              </Link>
            </div>
          )}

          {published.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {published.map(post => (
                <Link key={post.id} to={`/blog/${post.slug}`} className="group bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300">
                  <div className="aspect-[16/10] overflow-hidden">
                    <img src={post.image} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400"><Calendar size={12} />{new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <span className="text-gray-200">·</span>
                      <span className="text-xs text-gray-400">{post.authorName}</span>
                    </div>
                    <h2 className="font-bold text-gray-900 mb-2 group-hover:text-luxe-gold transition-colors leading-tight">{post.title}</h2>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-4">{post.excerpt}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1.5">{post.tags.slice(0, 3).map(t => <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-medium">#{t}</span>)}</div>
                      <span className="text-luxe-gold text-sm font-semibold group-hover:underline flex items-center gap-1">Read More <ArrowRight size={14} /></span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-xl border">
              <BookOpen size={48} className="mx-auto text-gray-200 mb-4" />
              <p className="text-lg font-semibold text-gray-700 mb-2">No posts yet</p>
              <p className="text-sm text-gray-500">Check back soon for new content!</p>
            </div>
          )}

          {/* Ad below blog listing */}
          {published.length > 0 && <AdSenseAd placement="blog_after_article" />}
        </div>
      </section>
    </div>
  );
}

function BlogDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { blogs: allBlogs } = useApp();
  const post = allBlogs.find(b => b.slug === slug && b.status === 'published');
  const relatedPosts = allBlogs.filter(b => b.slug !== slug && b.status === 'published').slice(0, 3);

  useEffect(() => { window.scrollTo(0, 0); }, [slug]);

  if (!post) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center"><p className="text-5xl mb-4">📝</p><h2 className="text-2xl font-bold mb-2">Post Not Found</h2><Link to="/blog" className="px-6 py-3 bg-luxe-gold text-white font-semibold rounded-lg">Back to Blog</Link></div>
    </div>
  );

  // Simple markdown-ish rendering for ## headings and paragraphs
  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return <br key={i} />;
      if (trimmed.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-gray-900 mt-8 mb-3">{trimmed.slice(3)}</h2>;
      if (trimmed.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold text-gray-900 mt-8 mb-4">{trimmed.slice(2)}</h1>;
      return <p key={i} className="text-gray-600 leading-relaxed mb-3">{trimmed}</p>;
    });
  };

  return (
    <div>
      {/* Hero Image */}
      <div className="relative h-64 sm:h-80 lg:h-96 bg-luxe-light">
        <img src={post.image} alt={post.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-luxe-black/70 via-transparent to-transparent" />
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-20 relative z-10">
        {/* Post Header */}
        <div className="bg-white rounded-2xl shadow-xl border p-6 sm:p-10 mb-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-gray-400 mb-4">
            <Link to="/" className="hover:text-luxe-gold">Home</Link><ChevronRight size={12} />
            <Link to="/blog" className="hover:text-luxe-gold">Blog</Link><ChevronRight size={12} />
            <span className="text-gray-600 truncate max-w-[200px]">{post.title}</span>
          </nav>

          {/* Tags */}
          <div className="flex gap-2 mb-4">{post.tags.map(t => <span key={t} className="px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-xs font-medium">#{t}</span>)}</div>

          {/* Title */}
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-luxe-black leading-tight mb-4">{post.title}</h1>

          {/* Meta */}
          <div className="flex items-center gap-4 pb-6 border-b mb-8">
            <div className="w-10 h-10 bg-luxe-gold-soft rounded-full flex items-center justify-center"><span className="font-bold text-luxe-gold-dark text-sm">{post.authorName.charAt(0)}</span></div>
            <div>
              <p className="font-semibold text-sm text-gray-900">{post.authorName}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar size={11} />{new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
          </div>

          {/* Ad: Top of Article */}
          <AdSenseAd placement="blog_in_article" />

          {/* Content with mid-article ad */}
          <article className="prose-custom">
            {renderContent(post.content)}
          </article>

          {/* Inline images */}
          {post.images.length > 0 && (
            <div className="grid grid-cols-2 gap-4 mt-8">
              {post.images.map((img, i) => <img key={i} src={img} alt="" className="rounded-xl w-full object-cover" />)}
            </div>
          )}

          {/* Ad: End of Article */}
          <AdSenseAd placement="blog_after_article" />

          {/* Related Posts */}
          {relatedPosts.length > 0 && (
            <div className="mt-10 pt-8 border-t">
              <h3 className="font-bold text-lg text-gray-900 mb-4">You May Also Like</h3>
              <div className="grid sm:grid-cols-3 gap-4">
                {relatedPosts.map(r => (
                  <Link key={r.id} to={`/blog/${r.slug}`} className="group flex gap-3 p-3 bg-gray-50 rounded-xl hover:bg-luxe-gold-soft transition-colors">
                    <img src={r.image} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900 group-hover:text-luxe-gold line-clamp-2 leading-tight">{r.title}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Back link */}
        <div className="text-center mb-12">
          <Link to="/blog" className="text-luxe-gold font-semibold text-sm hover:underline flex items-center justify-center gap-2"><ArrowLeft size={16} /> Back to All Posts</Link>
        </div>
      </div>
    </div>
  );
}

function BlogWritePage() {
  const { user, setBlogs, notify } = useApp();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [cover, setCover] = useState('');

  useEffect(() => { if (!user) nav('/login'); }, [user, nav]);

  const handleCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = ev => { if (ev.target?.result) setCover(ev.target.result as string); }; r.readAsDataURL(file);
    e.target.value = '';
  };

  const handleImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    Array.from(files).slice(0, 5 - images.length).forEach(file => {
      const r = new FileReader(); r.onload = ev => { if (ev.target?.result) setImages(prev => [...prev, ev.target!.result as string]); }; r.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const addTag = () => { if (tagInput.trim() && !tags.includes(tagInput.trim())) { setTags([...tags, tagInput.trim()]); setTagInput(''); } };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) { notify('Title and content required'); return; }
    if (!cover) { notify('Please add a cover image'); return; }

    const newPost: BlogPost = {
      id: `b${Date.now()}`, slug: blogSlug(title), title, excerpt: excerpt || content.slice(0, 150) + '...',
      content, image: cover, images, tags,
      authorId: user!.id, authorName: user!.name,
      status: user!.role === 'admin' ? 'published' : 'pending',
      date: new Date().toISOString(),
    };
    setBlogs(prev => [newPost, ...prev]);
    notify(user!.role === 'admin' ? 'Blog published!' : 'Blog submitted for review!');
    nav('/blog');
  };

  const I = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20';

  return (
    <div className="py-10 bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4">
        <Link to="/blog" className="text-sm text-gray-500 hover:text-luxe-gold flex items-center gap-1 mb-6"><ArrowLeft size={14} />Back to Blog</Link>
        <h1 className="text-2xl font-bold mb-8 flex items-center gap-2"><PenLine size={22} className="text-luxe-gold" />Write a Blog Post</h1>

        <form onSubmit={submit} className="space-y-6">
          {/* Cover Image */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Cover Image *</label>
            {cover ? (
              <div className="relative rounded-xl overflow-hidden mb-3 aspect-[16/9]">
                <img src={cover} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setCover('')} className="absolute top-3 right-3 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center text-sm hover:bg-red-600">✕</button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-luxe-gold hover:bg-luxe-gold-soft/30 transition-all">
                <Upload size={28} className="text-gray-400 mb-2" />
                <span className="text-sm font-medium text-gray-600">Upload cover image</span>
                <span className="text-xs text-gray-400">JPG, PNG · Max 5MB</span>
                <input type="file" accept="image/*" onChange={handleCover} className="hidden" />
              </label>
            )}
          </div>

          {/* Title & Excerpt */}
          <div className="bg-white rounded-2xl border p-6 space-y-4">
            <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Title *</label><input value={title} onChange={e => setTitle(e.target.value)} className={I} placeholder="Your blog post title" required /></div>
            <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Excerpt</label><input value={excerpt} onChange={e => setExcerpt(e.target.value)} className={I} placeholder="Short preview text (optional)" maxLength={200} /></div>
          </div>

          {/* Content */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Content * <span className="normal-case text-gray-400 font-normal">Use ## for headings</span></label>
            <textarea value={content} onChange={e => setContent(e.target.value)} className={I + ' resize-none'} rows={12} placeholder="Write your article here...&#10;&#10;## Section Heading&#10;Your paragraph text..." required />
          </div>

          {/* Inline Images */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Article Images ({images.length}/5)</label>
            {images.length > 0 && <div className="flex gap-3 mb-3 overflow-x-auto">{images.map((img, i) => <div key={i} className="relative shrink-0"><img src={img} alt="" className="w-20 h-20 rounded-lg object-cover" /><button type="button" onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center">✕</button></div>)}</div>}
            {images.length < 5 && <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-luxe-gold text-sm text-gray-500 hover:text-luxe-gold w-fit"><Upload size={16} />Add images<input type="file" accept="image/*" multiple onChange={handleImages} className="hidden" /></label>}
          </div>

          {/* Tags */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Tags</label>
            <div className="flex flex-wrap gap-2 mb-3">{tags.map(t => <span key={t} className="flex items-center gap-1 px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-sm"><Tag size={12} />{t}<button type="button" onClick={() => setTags(prev => prev.filter(x => x !== t))} className="text-luxe-gold hover:text-red-500 ml-1">×</button></span>)}</div>
            <div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className={I} placeholder="Add tag & press Enter" /><button type="button" onClick={addTag} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium shrink-0">Add</button></div>
          </div>

          {user?.role !== 'admin' && <div className="p-4 bg-luxe-gold-soft border border-luxe-gold/30 rounded-xl text-sm text-luxe-gold-dark flex items-center gap-2"><Eye size={16} />Your post will be reviewed by admin before publishing.</div>}

          <div className="flex gap-3">
            <button type="submit" className="flex-1 py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2"><Send size={16} />{user?.role === 'admin' ? 'Publish Now' : 'Submit for Review'}</button>
            <button type="button" onClick={() => nav('/blog')} className="px-6 py-3.5 border rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Admin section lives in its own file so it can be code-split into a lazy
// chunk — it is only downloaded when an /admin/* route is actually visited.
const AdminSection = lazy(() => import('./admin/AdminSection'));

function AdminFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-luxe-cream">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <Loader2 size={28} className="animate-spin text-luxe-gold" />
        <span className="text-sm font-medium">Loading admin…</span>
      </div>
    </div>
  );
}

// APP WITH ROUTES
// ============================================================================
export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <MarketingManager />
        <RouteTitle />
        <Routes>
          {/* Store */}
          <Route path="/" element={<SLayout><HomePage /></SLayout>} />
          <Route path="/shop" element={<SLayout><ShopPage /></SLayout>} />
          <Route path="/category/:slug" element={<SLayout><ShopPage /></SLayout>} />
          <Route path="/product/:id" element={<SLayout><ProductDetailPage /></SLayout>} />
          <Route path="/cart" element={<SLayout><CartPage /></SLayout>} />
          <Route path="/checkout" element={<SLayout><CheckoutPage /></SLayout>} />
          <Route path="/orders" element={<SLayout><OrdersPage /></SLayout>} />
          <Route path="/about" element={<SLayout><AboutPage /></SLayout>} />
          <Route path="/contact" element={<SLayout><ContactPage /></SLayout>} />
          <Route path="/privacy" element={<SLayout><PrivacyPage /></SLayout>} />
          <Route path="/terms" element={<SLayout><TermsPage /></SLayout>} />
          <Route path="/returns" element={<SLayout><ReturnsPage /></SLayout>} />
          <Route path="/shipping-policy" element={<SLayout><ShippingPolicyPage /></SLayout>} />
          <Route path="/faq" element={<SLayout><FAQPage /></SLayout>} />
          <Route path="/careers" element={<SLayout><CareersPage /></SLayout>} />
          {/* Blog */}
          <Route path="/blog" element={<SLayout><BlogListPage /></SLayout>} />
          <Route path="/blog/write" element={<SLayout><BlogWritePage /></SLayout>} />
          <Route path="/blog/:slug" element={<SLayout><BlogDetailPage /></SLayout>} />
          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          {/* Admin — lazy-loaded chunk (only fetched when an /admin/* route is visited) */}
          <Route path="/admin/*" element={<ProtectedRoute requireAdmin={true}><Suspense fallback={<AdminFallback />}><AdminSection /></Suspense></ProtectedRoute>} />
          {/* Fallback */}
          <Route path="*" element={<SLayout><HomePage /></SLayout>} />
        </Routes>
        <Toast />
      </HashRouter>
    </AppProvider>
  );
}
