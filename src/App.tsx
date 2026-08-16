import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import MarketingManager from './components/MarketingManager';
import AdSenseAd from './components/AdSenseAd';
import {
  activeModeLabel, AD_SLOT_RE, clearPreviewConfig, CLIENT_ID_RE, fetchGlobalConfig,
  getCachedPreview, hasPreviewConfig, PLACEMENT_KEYS, PLACEMENT_LABELS,
  savePreviewConfig, trackEvent, utmParams, validateConfig, MarketingConfig,
  PlacementKey, DEFAULT_CONFIG,
} from './lib/marketing';
import { useAuthStore } from './store/authStore';
import {
  ShoppingBag, Menu, X, Search, User as UserIcon, LogOut, Package,
  Shield, Star, Truck, RotateCcw, Zap, ArrowRight, Mail, Phone,
  MapPin, Plus, Minus, Trash2, Lock, Loader2, CheckCircle, CreditCard,
  FolderTree, Edit2, Users as UsersIcon, Settings, LayoutDashboard,
  ShoppingCart, AlertTriangle, ToggleLeft, ToggleRight, Eye,
  ChevronDown, ChevronRight, Save, ArrowLeft, DollarSign, Upload, ImageIcon,
  Globe, Clock, Send, Headphones, Sparkles, TrendingUp,
  FileText, PenLine, Calendar, Tag, BookOpen, EyeOff, ChevronUp,
  Bot, Clipboard, Link2, RefreshCw, Wand2, History, Layers, Shuffle, Table2, Sliders,
  Monitor, Smartphone, Share2, Code, Download,
  Megaphone, Target, Moon, Heart, SlidersHorizontal,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================
interface ProductVariant {
  id: string; color: string; size: string; price: number; salePrice: number;
  stock: number; sku: string; image?: string;
}
interface Product {
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
interface Order {
  id: string; userId: string; userName: string; items: CartItem[];
  total: number; status: string; date: string; address?: string;
}
interface Review {
  id: string; productId: string; productName: string; userName: string;
  rating: number; comment: string; status: 'pending' | 'approved' | 'rejected';
  date: string;
}
interface AdminCategory { id: string; name: string; isActive: boolean; subs: { id: string; name: string; isActive: boolean; }[]; }
interface BlogPost {
  id: string; slug: string; title: string; excerpt: string; content: string;
  image: string; images: string[]; tags: string[];
  authorId: string; authorName: string;
  status: 'published' | 'draft' | 'pending';
  date: string;
}


// ============================================================================
// AI IMPORT ENGINE — TYPES & CONSTANTS
// ============================================================================
interface AIProvider {
  id: string; name: string; models: string[]; defaultModel: string;
  apiKey: string; enabled: boolean; isDefault: boolean;
}
interface ImportHistoryEntry {
  id: string; source: string; sourceType: 'url'|'html'|'text'|'clipboard'|'image';
  date: string; provider: string; model: string; productTitle: string;
  status: 'success'|'failed'|'partial'; importTime: number;
}
interface AIExtractedProduct {
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
interface EnterpriseVariant {
  id: string; combo: Record<string,string>;
  sku: string; barcode: string; costPrice: number; sellingPrice: number;
  comparePrice: number; inventory: number; weight: string; dimensions: string;
  image: string; status: 'active'|'inactive'|'draft'; lowStockThreshold: number;
}
interface VariantAttribute {
  id: string; name: string; values: string[]; autoDetected: boolean;
}
interface SEOData {
  title: string; metaDescription: string; keywords: string[];
  slug: string; canonicalUrl: string; focusKeyword: string;
  secondaryKeywords: string[]; imageAlt: string; imageTitle: string; imageCaption: string;
}
interface SocialSEO {
  ogTitle: string; ogDescription: string; ogImage: string;
  twitterCard: string; twitterTitle: string; twitterDescription: string;
  pinterestDescription: string; pinterestImage: string;
}
interface ContentData {
  premiumTitle: string; luxuryDescription: string; shortDescription: string;
  bulletFeatures: string[]; specifications: Record<string,string>;
  benefits: string[]; useCases: string[]; careInstructions: string;
  packageContents: string[]; warrantyText: string; shippingInfo: string;
  focusKeyword: string;
  faqs: { q: string; a: string }[];
}
interface SEOScore {
  overall: number; readability: number; keywordDensity: number;
  metaLength: number; titleLength: number; missingAlt: number;
  issues: { type: 'error'|'warning'|'good'; msg: string }[];
}
interface StructuredSchemas {
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

async function callAIProvider(prompt: string, providers: AIProvider[], onProgress?: (m:string)=>void): Promise<string> {
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

function loadAIProviders(): AIProvider[] {
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

async function fetchPageContent(url: string, scrapedoKey?: string): Promise<string> {
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

function buildExtractionPrompt(rawContent: string, sourceType: string): string {
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

const CAT_LIST = ['All', 'Dog Supplies', 'Cat Supplies', 'Pet Beds', 'Pet Toys', 'Feeding & Water', 'Grooming', 'Pet Accessories'];
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
function useApp() { const c = useContext(AC); if (!c) throw new Error('no ctx'); return c; }

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
  const [products, setProducts] = useState<Product[]>(ALL_PRODUCTS);
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

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
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
          <img src={product.images[0]} alt={product.name} aria-hidden="true" className="w-full aspect-square object-cover group-hover:scale-[1.05] transition-transform duration-500" loading="lazy" />
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
              <img key={selImg} src={product.images[selImg] || product.images[0]} alt={product.name} className="w-full h-full object-cover" />
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
                  <img src={hero[0].images[0]} alt={hero[0].name} aria-hidden="true" loading="eager" className="w-full h-full min-h-[22rem] object-cover group-hover:scale-[1.04] transition-transform duration-700" />
                  <span className="absolute bottom-3 left-3 right-3 px-3 py-2 glass rounded-lg text-[11px] font-semibold text-luxe-black">{hero[0].name}</span>
                </Link>
              )}
              {hero.slice(1, 3).map(p => (
                <Link key={p.id} to={`/product/${p.id}`} className="group rounded-2xl overflow-hidden ring-1 ring-luxe-silver shadow-md shadow-luxe-gold/5">
                  <img src={p.images[0]} alt={p.name} loading="lazy" className="w-full aspect-square object-cover group-hover:scale-[1.04] transition-transform duration-700" />
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

      {/* ════════ BEST SELLERS ════════ */}
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

      {/* ════════ PET PARENT FAVORITES ════════ */}
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

  if (cart.length === 0 && step < 4) { nav('/cart'); return null; }

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
      <LS t="Cookies"><p>Our website uses cookies to remember your preferences, improve website performance, analyze website traffic, and enhance your shopping experience. You may disable cookies through your browser settings, although some website features may not function properly.</p></LS>
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

// Admin Blog Management
function ABlogs() {
  const { blogs, setBlogs, notify } = useApp();
  const [delId, setDelId] = useState<string | null>(null);
  const statusColor: Record<string, string> = { published: 'bg-green-100 text-green-700', pending: 'bg-yellow-100 text-yellow-700', draft: 'bg-gray-100 text-gray-600' };

  const updateStatus = (id: string, status: BlogPost['status']) => { setBlogs(prev => prev.map(b => b.id === id ? { ...b, status } : b)); notify(`Post ${status}!`); };
  const del = () => { if (delId) { setBlogs(prev => prev.filter(b => b.id !== delId)); notify('Post deleted!'); setDelId(null); } };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Blog Posts</h1>
        <Link to="/blog/write" className="px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />New Post</Link>
      </div>

      {blogs.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr><th className="px-6 py-4">Post</th><th className="px-6 py-4">Author</th><th className="px-6 py-4">Date</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Actions</th></tr></thead>
            <tbody>{blogs.map(b => (
              <tr key={b.id} className="border-t hover:bg-gray-50">
                <td className="px-6 py-4"><div className="flex items-center gap-3"><img src={b.image} alt="" className="w-12 h-8 rounded object-cover" /><div><p className="font-medium text-sm">{b.title}</p><p className="text-xs text-gray-400 truncate max-w-[200px]">{b.excerpt}</p></div></div></td>
                <td className="px-6 py-4 text-sm text-gray-600">{b.authorName}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{new Date(b.date).toLocaleDateString()}</td>
                <td className="px-6 py-4"><select value={b.status} onChange={e => updateStatus(b.id, e.target.value as BlogPost['status'])} className={`text-xs font-semibold px-3 py-1.5 rounded-full border-0 cursor-pointer ${statusColor[b.status]}`}><option value="published">Published</option><option value="pending">Pending</option><option value="draft">Draft</option></select></td>
                <td className="px-6 py-4 flex gap-1">
                  <Link to={`/blog/${b.slug}`} className="p-2 hover:bg-luxe-gold-soft rounded text-luxe-gold"><Eye size={16} /></Link>
                  <button onClick={() => setDelId(b.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-500"><FileText size={48} className="mx-auto text-gray-200 mb-4" />No blog posts yet</div>
      )}

      <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete Post">
        <p className="text-gray-600 mb-6">Delete this blog post permanently?</p>
        <div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div>
      </Modal>
    </div>
  );
}

// ADMIN PANEL - FULL WORKING SYSTEM
// ============================================================================
function AdminLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobSide, setMobSide] = useState(false);

  useEffect(() => { if (!user || user.role !== 'admin') nav('/admin/login'); }, [user, nav]);
  useEffect(() => { setMobSide(false); }, [loc.pathname]);
  if (!user || user.role !== 'admin') return null;

  const links = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/admin/products', icon: Package, label: 'Products' },
    { to: '/admin/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/admin/users', icon: UsersIcon, label: 'Users' },
    { to: '/admin/categories', icon: FolderTree, label: 'Categories' },
    { to: '/admin/reviews', icon: Star, label: 'Reviews' },
    { to: '/admin/blogs', icon: FileText, label: 'Blog Posts' },
    { to: '/admin/seo-engine', icon: Search, label: 'SEO Engine ⭐' },
    { to: '/admin/marketing', icon: Megaphone, label: 'Marketing Gen ⭐' },
    { to: '/admin/marketing-traffic', icon: TrendingUp, label: 'Marketing & Traffic' },
    { to: '/admin/variant-gen', icon: Layers, label: 'Variant Gen ⭐' },
    { to: '/admin/ai', icon: Bot, label: 'AI Hub ⭐' },
    { to: '/admin/ai-import', icon: Bot, label: 'AI Import ⭐' },
  { to: '/admin/settings', icon: Settings, label: 'Settings' },
  ];

  const Sidebar = ({ mobile }: { mobile?: boolean }) => (
    <aside className={`flex flex-col ${mobile ? 'w-full h-full' : 'w-52 min-h-screen hidden lg:flex'}`}
      style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
      <div className="p-3 border-b border-white/5 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-[10px]"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>
          <Shield size={14} className="text-white" />
        </div>
        <span className="font-bold text-sm text-white tracking-tight">Luxedge</span>
        {mobile && <button onClick={() => setMobSide(false)} className="ml-auto p-1 hover:bg-white/10 rounded-md"><X size={14} className="text-slate-400" /></button>}
      </div>
      <nav className="flex-1 p-1.5 space-y-0.5 overflow-y-auto">
        {links.map(l => {
          const isActive = loc.pathname === l.to;
          return (
            <Link key={l.to} to={l.to}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 group relative ${
                isActive ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}>
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full" style={{ background: 'linear-gradient(180deg, #3b82f6, #8b5cf6)' }} />}
              <l.icon size={14} className={isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-1.5 border-t border-white/5 space-y-0.5">
        <Link to="/" className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/5 transition-colors">
          <ArrowLeft size={10} />Store
        </Link>
        <button onClick={() => { logout(); nav('/admin/login'); }}
          className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 px-2.5 py-1 rounded-md hover:bg-red-500/10 w-full transition-colors">
          <LogOut size={10} />Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex">
      <Sidebar />
      {mobSide && <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-black/50" onClick={() => setMobSide(false)} /><div className="absolute left-0 top-0 h-full w-64"><Sidebar mobile /></div></div>}
      <div className="flex-1 flex flex-col">
        <header className="h-14 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-40">
          <button onClick={() => setMobSide(true)} className="lg:hidden p-1.5 hover:bg-gray-100 rounded-lg"><Menu size={18} /></button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 hidden sm:block">{user?.name || 'Admin'}</span>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>A</div>
          </div>
        </header>
        <main className="flex-1 p-3 lg:p-5" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>{children}</main>
      </div>
    </div>
  );
}

function ADashboard() {
  const { products, orders, users, reviews } = useApp();
  const rev = orders.reduce((s, o) => s + o.total, 0);
  const pending = orders.filter(o => o.status === 'Pending').length;
  const pendingR = reviews.filter(r => r.status === 'pending').length;
  const lowStock = products.filter(p => p.stock <= 10).length;

  const stats = [
    { l: 'Revenue', v: `$${rev.toLocaleString(undefined, {minimumFractionDigits:2})}`, i: DollarSign, c1: '#10b981', c2: '#059669', bg: 'from-emerald-500 to-teal-600' },
    { l: 'Orders', v: orders.length, i: ShoppingCart, c1: '#3b82f6', c2: '#2563eb', bg: 'from-blue-500 to-indigo-600' },
    { l: 'Customers', v: users.length, i: UsersIcon, c1: '#8b5cf6', c2: '#7c3aed', bg: 'from-violet-500 to-purple-600' },
    { l: 'Products', v: products.length, i: Package, c1: '#0088ff', c2: '#00d2ff', bg: 'from-blue-500 to-cyan-400' },
  ];

  return <div className="space-y-3.5">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-gray-900 tracking-tight">Dashboard</h1>
        <p className="text-[11px] text-gray-500">Welcome back! Here's what's happening.</p>
      </div>
      <Link to="/admin/ai-import" className="px-3 py-2 rounded-lg text-[11px] font-semibold text-white flex items-center gap-1.5 shadow-lg shadow-purple-200 transition-all hover:scale-[1.03]"
        style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}>
        <Wand2 size={12} /> AI Import
      </Link>
    </div>

    {/* Stats Grid */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {stats.map((s, i) => (
        <div key={i} className="card-lift bg-white rounded-xl p-3.5 border border-gray-100 overflow-hidden relative">
          <div className="absolute top-0 right-0 w-16 h-16 -translate-y-1/2 translate-x-1/2 rounded-full opacity-10" style={{ background: `linear-gradient(135deg, ${s.c1}, ${s.c2})` }} />
          <div className="flex items-center justify-between mb-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br ${s.bg} shadow-md`}>
              <s.i size={14} className="text-white" />
            </div>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5" style={{ color: s.c1, backgroundColor: `${s.c1}15` }}>
              <TrendingUp size={9} /> +12%
            </span>
          </div>
          <p className="text-lg font-bold text-gray-900 leading-none">{s.v}</p>
          <p className="text-[10px] text-gray-500 font-medium mt-1">{s.l}</p>
          <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${s.c1}55, ${s.c2}55)` }} />
        </div>
      ))}
    </div>

    {/* Alerts + Quick Tools Row */}
    <div className="grid lg:grid-cols-3 gap-2.5">
      <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {[
          { on: lowStock > 0, grad: 'from-sky-50 to-orange-50', b: 'border-sky-100', i: AlertTriangle, ic: 'bg-sky-100', tc: 'text-blue-600', n: lowStock, l: 'Low stock items', t: 'text-blue-800', s: 'text-blue-700', to: '/admin/products' },
          { on: pending > 0, grad: 'from-blue-50 to-indigo-50', b: 'border-blue-100', i: ShoppingCart, ic: 'bg-blue-100', tc: 'text-blue-600', n: pending, l: 'Pending orders', t: 'text-blue-800', s: 'text-blue-700', to: '/admin/orders' },
          { on: pendingR > 0, grad: 'from-purple-50 to-pink-50', b: 'border-purple-100', i: Star, ic: 'bg-purple-100', tc: 'text-purple-600', n: pendingR, l: 'Reviews pending', t: 'text-purple-800', s: 'text-purple-700', to: '/admin/reviews' },
        ].map((a, idx) => a.on ? (
          <Link key={idx} to={a.to} className={`bg-gradient-to-br ${a.grad} border ${a.b} rounded-xl p-3 card-lift group`}>
            <div className="flex items-center gap-2 mb-1.5"><div className={`w-7 h-7 ${a.ic} rounded-lg flex items-center justify-center`}><a.i size={13} className={a.tc} /></div><span className={`font-bold ${a.t}`}>{a.n}</span></div>
            <p className={`text-[11px] ${a.s} font-medium leading-tight`}>{a.l}</p>
            <p className={`text-[9px] font-semibold ${a.s} opacity-70 group-hover:opacity-100 flex items-center gap-0.5 mt-1 transition-opacity`}>View <ArrowRight size={9} /></p>
          </Link>
        ) : <div key={idx} className="hidden" />)}
      </div>

      {/* Quick AI Tools */}
      <div className="bg-white rounded-xl border border-gray-100 p-3 card-lift">
        <h3 className="font-bold text-[11px] text-gray-800 mb-2 flex items-center gap-1.5"><Zap size={11} className="text-blue-500" />Quick AI Tools</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { to: '/admin/ai-import', icon: Wand2, label: 'Import Product', color: '#8b5cf6' },
            { to: '/admin/marketing', icon: Megaphone, label: 'Generate Content', color: '#3b82f6' },
            { to: '/admin/variant-gen', icon: Layers, label: 'Create Variants', color: '#0088ff' },
            { to: '/admin/seo-engine', icon: Search, label: 'SEO Optimize', color: '#10b981' },
          ].map(t => (
            <Link key={t.to} to={t.to}
              className="flex flex-col items-start gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-medium hover:bg-gray-50 transition-all group">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: `${t.color}15` }}>
                <t.icon size={11} style={{ color: t.color }} />
              </div>
              <span className="text-gray-700 group-hover:text-gray-900 leading-tight">{t.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>

    {/* Recent Orders */}
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden card-lift">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
        <h2 className="font-bold text-xs text-gray-800">Recent Orders</h2>
        <Link to="/admin/orders" className="text-[10px] font-semibold text-blue-600 hover:text-blue-800">View All →</Link>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-gray-400 border-b border-gray-50">
            <th className="px-4 py-2 font-semibold">Order</th>
            <th className="px-2 py-2 font-semibold hidden sm:table-cell">Customer</th>
            <th className="px-2 py-2 font-semibold hidden md:table-cell">Date</th>
            <th className="px-2 py-2 font-semibold text-right">Total</th>
            <th className="px-4 py-2 font-semibold text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.slice(0,5).map(o => (
            <tr key={o.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition-colors">
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold ${
                    o.status === 'Delivered' ? 'bg-green-100 text-green-700' :
                    o.status === 'Shipped' ? 'bg-blue-100 text-blue-700' :
                    o.status === 'Processing' ? 'bg-sky-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>#{String(orders.indexOf(o)+1).padStart(2,'0')}</div>
                  <span className="font-semibold text-[11px] text-gray-900">{o.id}</span>
                </div>
              </td>
              <td className="px-2 py-2 text-[11px] text-gray-600 hidden sm:table-cell">{o.userName}</td>
              <td className="px-2 py-2 text-[11px] text-gray-500 hidden md:table-cell">{o.date.slice(0,10)}</td>
              <td className="px-2 py-2 text-[11px] font-bold text-gray-900 text-right">${o.total.toFixed(2)}</td>
              <td className="px-4 py-2 text-right">
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${
                  o.status === 'Delivered' ? 'bg-green-100 text-green-700' :
                  o.status === 'Shipped' ? 'bg-blue-100 text-blue-700' :
                  o.status === 'Processing' ? 'bg-sky-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{o.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>;
}

function AProducts() {
  const { products, setProducts, notify } = useApp();
  const nav = useNavigate();
  const [delId, setDelId] = useState<string | null>(null);
  const toggle = (id: string) => { setProducts(p => p.map(x => x.id === id ? { ...x, isActive: !x.isActive } : x)); notify('Status updated!'); };
  const del = () => { if (delId) { setProducts(p => p.filter(x => x.id !== delId)); notify('Deleted!'); setDelId(null); } };

  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Products</h1><button onClick={() => nav('/admin/products/new')} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />Add Product</button></div>
    <div className="bg-white rounded-xl shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full">
      <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr><th className="px-6 py-4">Product</th><th className="px-6 py-4">Brand</th><th className="px-6 py-4">Category</th><th className="px-6 py-4">Price</th><th className="px-6 py-4">Stock</th><th className="px-6 py-4">Variants</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Actions</th></tr></thead>
      <tbody>{products.map(p => <tr key={p.id} className="border-t hover:bg-gray-50">
        <td className="px-6 py-4"><div className="flex items-center gap-3"><img src={p.images[0]} alt="" className="w-10 h-10 rounded object-cover" /><div><span className="font-medium text-sm block">{p.name}</span>{p.shortDesc && <span className="text-xs text-gray-400">{p.shortDesc}</span>}</div></div></td>
        <td className="px-6 py-4 text-xs text-gray-500">{p.brand}</td>
        <td className="px-6 py-4 text-sm">{p.category}</td>
        <td className="px-6 py-4"><span className="font-semibold">${p.price}</span>{p.originalPrice > p.price && <span className="text-xs text-gray-400 line-through ml-1">${p.originalPrice}</span>}</td>
        <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${p.stock <= 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{p.stock}</span></td>
        <td className="px-6 py-4 text-sm">{p.variants.length > 0 ? <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">{p.variants.length}</span> : <span className="text-gray-400 text-xs">—</span>}</td>
        <td className="px-6 py-4"><button onClick={() => toggle(p.id)}>{p.isActive ? <ToggleRight size={22} className="text-green-500" /> : <ToggleLeft size={22} className="text-gray-400" />}</button></td>
        <td className="px-6 py-4 flex gap-1"><button onClick={() => nav(`/admin/products/edit/${p.id}`)} className="p-2 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={16} /></button><button onClick={() => setDelId(p.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash2 size={16} /></button></td>
      </tr>)}</tbody>
    </table></div></div>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete Product"><p className="text-gray-600 mb-6">Delete this product permanently?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

// ============================================================================
// ADVANCED PRODUCT EDITOR (eBay-style)
// ============================================================================
const EMPTY_PRODUCT: Product = { id:'',name:'',shortDesc:'',description:'',price:0,originalPrice:0,category:'Dog Supplies',stock:0,images:[],rating:0,reviews:0,isActive:true,brand:'',condition:'New',tags:[],weight:'',dimensions:'',origin:'China',freeShipping:true,shippingCost:'0',variants:[] };

function AProductEdit() {
  const { id: paramId } = useParams<{ id: string }>();
  const isNew = !paramId;
  const { products, setProducts, notify } = useApp();
  const nav = useNavigate();

  const existing = paramId ? products.find(p => p.id === paramId) : null;
  const [p, setP] = useState<Product>(existing ? { ...existing } : { ...EMPTY_PRODUCT, id: `p${Date.now()}` });
  const [tab, setTab] = useState('basic');
  const [tagInput, setTagInput] = useState('');

  // Image upload
  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    Array.from(files).slice(0, 5 - p.images.length).forEach(f => {
      if (!f.type.startsWith('image/') || f.size > 5*1024*1024) return;
      const r = new FileReader();
      r.onload = ev => { const res = ev.target?.result as string; if (res) setP(prev => ({ ...prev, images: prev.images.length < 5 ? [...prev.images, res] : prev.images })); };
      r.readAsDataURL(f);
    });
    e.target.value = '';
  };
  const removeImg = (i: number) => setP(prev => ({ ...prev, images: prev.images.filter((_, idx) => idx !== i) }));
  const setMainImg = (i: number) => setP(prev => { const imgs = [...prev.images]; const [m] = imgs.splice(i, 1); return { ...prev, images: [m, ...imgs] }; });

  // Tags
  const addTag = () => { if (tagInput.trim() && !p.tags.includes(tagInput.trim())) { setP(prev => ({ ...prev, tags: [...prev.tags, tagInput.trim()] })); setTagInput(''); } };
  const removeTag = (t: string) => setP(prev => ({ ...prev, tags: prev.tags.filter(x => x !== t) }));

  // Variants
  const [vColor, setVColor] = useState(''); const [vSize, setVSize] = useState('');
  const addVariant = () => {
    if (!vColor && !vSize) { notify('Enter color or size'); return; }
    setP(prev => ({ ...prev, variants: [...prev.variants, { id: `v${Date.now()}`, color: vColor, size: vSize, price: prev.price, salePrice: prev.price, stock: 0, sku: '' }] }));
    setVColor(''); setVSize('');
  };
  const updateVariant = (vid: string, updates: Partial<ProductVariant>) => { setP(prev => ({ ...prev, variants: prev.variants.map(v => v.id === vid ? { ...v, ...updates } : v) })); };
  const removeVariant = (vid: string) => setP(prev => ({ ...prev, variants: prev.variants.filter(v => v.id !== vid) }));

  // Auto-generate variants
  const [genColors, setGenColors] = useState('');
  const [genSizes, setGenSizes] = useState('');
  const autoGenerate = () => {
    const colors = genColors.split(',').map(s => s.trim()).filter(Boolean);
    const sizes = genSizes.split(',').map(s => s.trim()).filter(Boolean);
    if (colors.length === 0 && sizes.length === 0) { notify('Enter colors or sizes'); return; }
    const newVars: ProductVariant[] = [];
    if (colors.length > 0 && sizes.length > 0) {
      colors.forEach(c => sizes.forEach(s => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: c, size: s, price: p.price, salePrice: p.price, stock: 0, sku: '' })));
    } else if (colors.length > 0) {
      colors.forEach(c => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: c, size: 'One Size', price: p.price, salePrice: p.price, stock: 0, sku: '' }));
    } else {
      sizes.forEach(s => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: 'Default', size: s, price: p.price, salePrice: p.price, stock: 0, sku: '' }));
    }
    setP(prev => ({ ...prev, variants: [...prev.variants, ...newVars] }));
    setGenColors(''); setGenSizes('');
    notify(`${newVars.length} variants created!`);
  };

  // Save
  const handleSave = () => {
    if (!p.name) { notify('Product name required'); return; }
    if (p.images.length === 0) { notify('At least 1 image required'); return; }
    if (p.price <= 0) { notify('Price must be greater than 0'); return; }
    const totalVarStock = p.variants.reduce((s, v) => s + v.stock, 0);
    const finalProduct = { ...p, stock: p.variants.length > 0 ? totalVarStock : p.stock };
    if (isNew) {
      setProducts(prev => [...prev, finalProduct]);
      notify('Product created!');
    } else {
      setProducts(prev => prev.map(x => x.id === p.id ? finalProduct : x));
      notify('Product saved!');
    }
    nav('/admin/products');
  };

  const discount = p.originalPrice > 0 && p.price > 0 ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
  const I = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const tabs = ['basic','pricing','images','variants','details','shipping'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/admin/products')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div><h1 className="text-2xl font-bold">{isNew ? 'Add New Product' : 'Edit Product'}</h1><p className="text-sm text-gray-500">{isNew ? 'Create a new product listing' : p.name}</p></div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => nav('/admin/products')} className="px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} />{isNew ? 'Create Product' : 'Save Changes'}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="flex border-b overflow-x-auto">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-5 py-3 text-sm font-medium capitalize whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
              {t === 'basic' ? '📋 Basic Info' : t === 'pricing' ? '💰 Pricing' : t === 'images' ? '🖼️ Images' : t === 'variants' ? '🎨 Variants' : t === 'details' ? '📦 Details' : '🚚 Shipping'}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* BASIC INFO TAB */}
          {tab === 'basic' && (
            <div className="space-y-5 max-w-3xl">
              <div><label className={L}>Product Name *</label><input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} className={I} placeholder="e.g. Orthopedic Memory Foam Dog Bed" /></div>
              <div><label className={L}>Short Description</label><input value={p.shortDesc} onChange={e => setP({ ...p, shortDesc: e.target.value })} className={I} placeholder="Brief tagline for product cards" maxLength={100} /><p className="text-xs text-gray-400 mt-1">{p.shortDesc.length}/100</p></div>
              <div><label className={L}>Full Description *</label><textarea value={p.description} onChange={e => setP({ ...p, description: e.target.value })} className={I + ' resize-none'} rows={6} placeholder="Detailed product description. Use line breaks for formatting." /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Category *</label><select value={p.category} onChange={e => setP({ ...p, category: e.target.value })} className={I}>{CAT_LIST.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label className={L}>Brand</label><input value={p.brand} onChange={e => setP({ ...p, brand: e.target.value })} className={I} placeholder="Brand name" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Condition</label><select value={p.condition} onChange={e => setP({ ...p, condition: e.target.value })} className={I}><option>New</option><option>Used</option><option>Refurbished</option><option>Open Box</option></select></div>
                <div className="flex items-end gap-3 pb-1"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={p.isActive} onChange={e => setP({ ...p, isActive: e.target.checked })} className="w-4 h-4 text-blue-500 rounded" /><span className="text-sm text-gray-700">Active (visible in store)</span></label></div>
              </div>
              <div>
                <label className={L}>Tags / Keywords</label>
                <div className="flex flex-wrap gap-2 mb-2">{p.tags.map(t => <span key={t} className="flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"><span>{t}</span><button type="button" onClick={() => removeTag(t)} className="text-gray-400 hover:text-red-500">×</button></span>)}</div>
                <div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className={I} placeholder="Type tag & press Enter" /><button type="button" onClick={addTag} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium">Add</button></div>
              </div>
            </div>
          )}

          {/* PRICING TAB */}
          {tab === 'pricing' && (
            <div className="space-y-5 max-w-3xl">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Sale Price (USD) *</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.price || ''} onChange={e => setP({ ...p, price: +e.target.value })} className={I + ' pl-7'} placeholder="0.00" /></div></div>
                <div><label className={L}>Compare / Original Price</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.originalPrice || ''} onChange={e => setP({ ...p, originalPrice: +e.target.value })} className={I + ' pl-7'} placeholder="0.00" /></div></div>
              </div>
              {discount > 0 && <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl"><DollarSign size={20} className="text-green-600" /><div><p className="font-semibold text-green-700">Discount: {discount}% OFF</p><p className="text-sm text-green-600">Customer saves ${(p.originalPrice - p.price).toFixed(2)}</p></div></div>}
              <div><label className={L}>Global Stock (if no variants) *</label><input type="number" value={p.stock || ''} onChange={e => setP({ ...p, stock: +e.target.value })} className={I} placeholder="0" />{p.stock > 0 && p.stock <= 10 && <p className="text-xs text-blue-600 mt-1 flex items-center gap-1"><AlertTriangle size={12} />Low stock warning will appear</p>}</div>
            </div>
          )}

          {/* IMAGES TAB */}
          {tab === 'images' && (
            <div className="space-y-5 max-w-3xl">
              <p className="text-sm text-gray-500">Upload up to 5 images. First image is the main product image. Click to set as main.</p>
              {p.images.length > 0 && <div className="grid grid-cols-5 gap-4">{p.images.map((img, i) => (
                <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border-2 border-gray-200 hover:border-blue-400 transition-all cursor-pointer" onClick={() => setMainImg(i)}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  {i === 0 && <div className="absolute top-2 left-2 px-2 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full">MAIN</div>}
                  <button type="button" onClick={e => { e.stopPropagation(); removeImg(i); }} className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600">✕</button>
                  {i !== 0 && <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-end justify-center pb-2"><span className="text-[10px] text-white bg-black/50 px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">Click = Main</span></div>}
                </div>
              ))}</div>}
              {p.images.length < 5 && (
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all">
                  <Upload size={28} className="text-gray-400 mb-2" />
                  <span className="text-sm font-medium text-gray-600">Click to upload from PC</span>
                  <span className="text-xs text-gray-400 mt-1">PNG, JPG, WebP · Max 5MB each · {5 - p.images.length} slot{5 - p.images.length !== 1 ? 's' : ''} remaining</span>
                  <input type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" />
                </label>
              )}
              {p.images.length === 0 && <p className="text-xs text-red-500 flex items-center gap-1"><ImageIcon size={12} />At least 1 image is required</p>}
            </div>
          )}

          {/* VARIANTS TAB */}
          {tab === 'variants' && (
            <div className="space-y-6">
              {/* Auto-generate */}
              <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl">
                <h3 className="font-semibold text-blue-800 mb-3 flex items-center gap-2"><Zap size={16} />Auto-Generate Combinations</h3>
                <p className="text-xs text-blue-600 mb-3">Enter comma-separated values. All combinations will be created automatically.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div><label className="text-xs font-medium text-blue-700 mb-1 block">Colors</label><input value={genColors} onChange={e => setGenColors(e.target.value)} className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white" placeholder="Black, White, Blue" /></div>
                  <div><label className="text-xs font-medium text-blue-700 mb-1 block">Sizes</label><input value={genSizes} onChange={e => setGenSizes(e.target.value)} className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white" placeholder="S, M, L, XL" /></div>
                </div>
                <button type="button" onClick={autoGenerate} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg font-medium flex items-center gap-2"><Zap size={14} />Generate Variants</button>
              </div>

              {/* Manual add */}
              <div className="p-5 bg-gray-50 border border-gray-200 rounded-xl">
                <h3 className="font-semibold text-gray-700 mb-3">Or Add Manually</h3>
                <div className="flex gap-3 items-end">
                  <div className="flex-1"><label className="text-xs font-medium text-gray-600 mb-1 block">Color</label><input value={vColor} onChange={e => setVColor(e.target.value)} className={I} placeholder="e.g. Black" /></div>
                  <div className="flex-1"><label className="text-xs font-medium text-gray-600 mb-1 block">Size</label><input value={vSize} onChange={e => setVSize(e.target.value)} className={I} placeholder="e.g. Large" /></div>
                  <button type="button" onClick={addVariant} className="px-4 py-2.5 bg-gray-800 hover:bg-gray-900 text-white text-sm rounded-lg font-medium flex items-center gap-2"><Plus size={14} />Add</button>
                </div>
              </div>

              {/* Variants table */}
              {p.variants.length > 0 && (
                <div className="border rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between"><span className="font-semibold text-sm">{p.variants.length} Variant{p.variants.length !== 1 ? 's' : ''}</span><span className="text-xs text-gray-500">Total stock: {p.variants.reduce((s, v) => s + v.stock, 0)}</span></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="px-4 py-3 text-left">Color</th><th className="px-4 py-3 text-left">Size</th><th className="px-4 py-3 text-left">Price</th><th className="px-4 py-3 text-left">Sale</th><th className="px-4 py-3 text-left">Stock</th><th className="px-4 py-3 text-left">SKU</th><th className="px-4 py-3"></th></tr></thead>
                      <tbody>{p.variants.map(v => (
                        <tr key={v.id} className="border-t">
                          <td className="px-4 py-2"><input value={v.color} onChange={e => updateVariant(v.id, { color: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input value={v.size} onChange={e => updateVariant(v.id, { size: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" step="0.01" value={v.price||''} onChange={e => updateVariant(v.id, { price: +e.target.value })} className="w-20 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" step="0.01" value={v.salePrice||''} onChange={e => updateVariant(v.id, { salePrice: +e.target.value })} className="w-20 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" value={v.stock||''} onChange={e => updateVariant(v.id, { stock: +e.target.value })} className="w-16 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input value={v.sku} onChange={e => updateVariant(v.id, { sku: e.target.value })} className="w-24 px-2 py-1.5 border rounded text-sm" placeholder="SKU" /></td>
                          <td className="px-4 py-2"><button type="button" onClick={() => removeVariant(v.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {p.variants.length === 0 && <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed"><p className="text-gray-400 text-sm">No variants yet. Use auto-generate or add manually above.</p></div>}
            </div>
          )}

          {/* DETAILS TAB */}
          {tab === 'details' && (
            <div className="space-y-5 max-w-3xl">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Weight</label><input value={p.weight} onChange={e => setP({ ...p, weight: e.target.value })} className={I} placeholder="e.g. 0.5 lbs" /></div>
                <div><label className={L}>Dimensions</label><input value={p.dimensions} onChange={e => setP({ ...p, dimensions: e.target.value })} className={I} placeholder="e.g. 6 × 4 × 2 in" /></div>
              </div>
              <div><label className={L}>Country of Origin</label><select value={p.origin} onChange={e => setP({ ...p, origin: e.target.value })} className={I}>{['China','USA','India','Japan','South Korea','Germany','Vietnam','Taiwan','UK','Italy','Other'].map(c => <option key={c}>{c}</option>)}</select></div>
            </div>
          )}

          {/* SHIPPING TAB */}
          {tab === 'shipping' && (
            <div className="space-y-5 max-w-3xl">
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border">
                <input type="checkbox" checked={p.freeShipping} onChange={e => setP({ ...p, freeShipping: e.target.checked, shippingCost: e.target.checked ? '0' : p.shippingCost })} className="w-5 h-5 text-blue-500 rounded" id="fship" />
                <label htmlFor="fship" className="cursor-pointer"><p className="font-semibold text-sm">Free Shipping</p><p className="text-xs text-gray-500">Offer free shipping on this product</p></label>
              </div>
              {!p.freeShipping && <div><label className={L}>Shipping Cost (USD)</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.shippingCost} onChange={e => setP({ ...p, shippingCost: e.target.value })} className={I + ' pl-7'} placeholder="4.99" /></div></div>}
              <div><label className={L}>Weight (for shipping calc)</label><input value={p.weight} onChange={e => setP({ ...p, weight: e.target.value })} className={I} placeholder="e.g. 0.5 lbs" /></div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Save Bar */}
      <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between sticky bottom-0">
        <p className="text-sm text-gray-500">
          {p.images.length} image{p.images.length !== 1 ? 's' : ''} · {p.variants.length} variant{p.variants.length !== 1 ? 's' : ''} · {p.tags.length} tag{p.tags.length !== 1 ? 's' : ''}
        </p>
        <div className="flex gap-3">
          <button onClick={() => nav('/admin/products')} className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50">Discard</button>
          <button onClick={handleSave} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><Save size={16} />{isNew ? 'Create Product' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

function AOrders() {
  const { orders, setOrders, notify } = useApp();
  const [view, setView] = useState<Order | null>(null);
  const statuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
  const statusColor: Record<string, string> = { Pending: 'bg-yellow-100 text-yellow-700', Processing: 'bg-blue-100 text-blue-700', Shipped: 'bg-purple-100 text-purple-700', Delivered: 'bg-green-100 text-green-700', Cancelled: 'bg-red-100 text-red-700' };
  const updateStatus = (id: string, status: string) => { setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o)); notify(`Order ${status}`); };

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Orders</h1>
    <div className="bg-white rounded-xl shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full">
      <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr><th className="px-6 py-4">Order</th><th className="px-6 py-4">Customer</th><th className="px-6 py-4">Total</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Actions</th></tr></thead>
      <tbody>{orders.map(o => <tr key={o.id} className="border-t hover:bg-gray-50">
        <td className="px-6 py-4"><p className="font-medium text-sm">{o.id}</p><p className="text-xs text-gray-500">{new Date(o.date).toLocaleDateString()}</p></td>
        <td className="px-6 py-4 text-sm">{o.userName}</td>
        <td className="px-6 py-4 font-semibold">${o.total.toFixed(2)}</td>
        <td className="px-6 py-4"><select value={o.status} onChange={e => updateStatus(o.id, e.target.value)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border-0 cursor-pointer ${statusColor[o.status] || 'bg-gray-100'}`}>{statuses.map(s => <option key={s}>{s}</option>)}</select></td>
        <td className="px-6 py-4"><button onClick={() => setView(o)} className="p-2 hover:bg-blue-50 rounded text-blue-600"><Eye size={16} /></button></td>
      </tr>)}</tbody>
    </table></div></div>

    <Modal open={!!view} onClose={() => setView(null)} title={`Order ${view?.id}`}>
      {view && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm"><div><p className="text-gray-500">Customer</p><p className="font-medium">{view.userName}</p></div><div><p className="text-gray-500">Status</p><p className="font-medium">{view.status}</p></div></div>
        {view.address && <div className="bg-gray-50 p-3 rounded-lg text-sm"><p className="text-gray-500 text-xs mb-1">Shipping Address</p><p>{view.address}</p></div>}
        <div className="space-y-2">{view.items.map(i => <div key={i.product.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg"><img src={i.product.images[0]} alt="" className="w-12 h-12 rounded object-cover" /><div className="flex-1"><p className="font-medium text-sm">{i.product.name}</p><p className="text-xs text-gray-500">Qty: {i.quantity}</p></div><p className="font-semibold">${(i.product.price * i.quantity).toFixed(2)}</p></div>)}</div>
        <div className="pt-3 border-t flex justify-between font-bold"><span>Total</span><span>${view.total.toFixed(2)}</span></div>
      </div>}
    </Modal>
  </div>;
}

function AUsers() {
  const { users, setUsers, notify } = useApp();
  const [delId, setDelId] = useState<string | null>(null);
  const toggleBlock = (id: string) => { setUsers(prev => prev.map(u => u.id === id ? { ...u, isBlocked: !u.isBlocked } : u)); notify('User updated!'); };
  const del = () => { if (delId) { setUsers(prev => prev.filter(u => u.id !== delId)); notify('User deleted!'); setDelId(null); } };

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Users</h1>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{users.map(u => <div key={u.id} className={`bg-white rounded-xl border p-5 ${u.isBlocked ? 'border-red-200 bg-red-50/30' : ''}`}>
      <div className="flex items-center gap-3 mb-4"><div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${u.isBlocked ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{u.name[0]}</div><div><p className="font-semibold">{u.name}</p><p className="text-xs text-gray-500">{u.email}</p></div>{u.isBlocked && <span className="ml-auto text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">Blocked</span>}</div>
      {u.joined && <p className="text-xs text-gray-400 mb-4">Joined: {u.joined}</p>}
      <div className="flex gap-2"><button onClick={() => toggleBlock(u.id)} className={`flex-1 py-2 rounded-lg text-xs font-medium ${u.isBlocked ? 'bg-green-50 text-green-600' : 'bg-sky-50 text-blue-600'}`}>{u.isBlocked ? 'Unblock' : 'Block'}</button><button onClick={() => setDelId(u.id)} className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium">Delete</button></div>
    </div>)}</div>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete User"><p className="text-gray-600 mb-6">Delete this user?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

function ACategories() {
  const { categories, setCategories, notify } = useApp();
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState<AdminCategory | null>(null);
  const [form, setForm] = useState({ name: '', isActive: true, parentId: '' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [delId, setDelId] = useState<string | null>(null);
  const [subModal, setSubModal] = useState<string | null>(null);
  const [subName, setSubName] = useState('');

  const toggle = (id: string) => { const n = new Set(expanded); n.has(id) ? n.delete(id) : n.add(id); setExpanded(n); };
  const openAdd = () => { setEdit(null); setForm({ name: '', isActive: true, parentId: '' }); setModal(true); };
  const openEdit = (c: AdminCategory) => { setEdit(c); setForm({ name: c.name, isActive: c.isActive, parentId: '' }); setModal(true); };
  const save = (e: React.FormEvent) => { e.preventDefault(); if (edit) { setCategories(prev => prev.map(c => c.id === edit.id ? { ...c, name: form.name, isActive: form.isActive } : c)); notify('Category updated!'); } else { setCategories(prev => [...prev, { id: `c${Date.now()}`, name: form.name, isActive: form.isActive, subs: [] }]); notify('Category added!'); } setModal(false); };
  const del = () => { if (delId) { setCategories(prev => prev.filter(c => c.id !== delId)); notify('Category deleted!'); setDelId(null); } };
  const toggleStatus = (id: string) => { setCategories(prev => prev.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c)); notify('Status updated!'); };
  const addSub = (e: React.FormEvent) => { e.preventDefault(); if (subModal && subName) { setCategories(prev => prev.map(c => c.id === subModal ? { ...c, subs: [...c.subs, { id: `s${Date.now()}`, name: subName, isActive: true }] } : c)); setSubName(''); setSubModal(null); notify('Subcategory added!'); } };
  const delSub = (catId: string, subId: string) => { setCategories(prev => prev.map(c => c.id === catId ? { ...c, subs: c.subs.filter(s => s.id !== subId) } : c)); notify('Subcategory deleted!'); };
  const toggleSub = (catId: string, subId: string) => { setCategories(prev => prev.map(c => c.id === catId ? { ...c, subs: c.subs.map(s => s.id === subId ? { ...s, isActive: !s.isActive } : s) } : c)); notify('Updated!'); };

  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Categories</h1><button onClick={openAdd} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />Add Category</button></div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold">{categories.length}</p><p className="text-sm text-gray-500">Main Categories</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold">{categories.reduce((s, c) => s + c.subs.length, 0)}</p><p className="text-sm text-gray-500">Subcategories</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold text-green-600">{categories.filter(c => c.isActive).length}</p><p className="text-sm text-gray-500">Active</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold text-gray-400">{categories.filter(c => !c.isActive).length}</p><p className="text-sm text-gray-500">Inactive</p></div>
    </div>
    <div className="bg-white rounded-xl shadow-sm">
      {categories.map(c => <div key={c.id}>
        <div className="flex items-center gap-3 p-4 border-b hover:bg-gray-50">
          <button onClick={() => toggle(c.id)} className="p-1">{c.subs.length > 0 ? (expanded.has(c.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} className="text-gray-400" />) : <span className="w-4" />}</button>
          <FolderTree size={18} className={c.isActive ? 'text-blue-500' : 'text-gray-400'} />
          <div className="flex-1"><p className={`font-medium ${c.isActive ? '' : 'text-gray-400'}`}>{c.name}</p>{c.subs.length > 0 && <p className="text-xs text-gray-500">{c.subs.length} sub</p>}</div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.isActive ? 'Active' : 'Inactive'}</span>
          <button onClick={() => setSubModal(c.id)} className="p-2 hover:bg-blue-50 rounded text-blue-600" title="Add Sub"><Plus size={16} /></button>
          <button onClick={() => toggleStatus(c.id)} className="p-2 hover:bg-gray-100 rounded">{c.isActive ? <ToggleRight size={20} className="text-green-500" /> : <ToggleLeft size={20} className="text-gray-400" />}</button>
          <button onClick={() => openEdit(c)} className="p-2 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={16} /></button>
          <button onClick={() => setDelId(c.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash2 size={16} /></button>
        </div>
        {expanded.has(c.id) && c.subs.map(s => <div key={s.id} className="flex items-center gap-3 p-3 pl-14 border-b bg-gray-50/50">
          <span className="text-gray-400">└</span><p className={`flex-1 text-sm ${s.isActive ? '' : 'text-gray-400'}`}>{s.name}</p>
          <button onClick={() => toggleSub(c.id, s.id)} className="p-1">{s.isActive ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} className="text-gray-400" />}</button>
          <button onClick={() => delSub(c.id, s.id)} className="p-1 text-red-500"><Trash2 size={14} /></button>
        </div>)}
      </div>)}
    </div>
    <Modal open={modal} onClose={() => setModal(false)} title={edit ? 'Edit Category' : 'Add Category'}>
      <form onSubmit={save} className="space-y-4"><input required placeholder="Category Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 border rounded-lg" /><label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />Active</label><div className="flex gap-3"><button type="submit" className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium">{edit ? 'Save' : 'Add'}</button><button type="button" onClick={() => setModal(false)} className="px-6 py-2.5 border rounded-lg">Cancel</button></div></form>
    </Modal>
    <Modal open={!!subModal} onClose={() => setSubModal(null)} title="Add Subcategory">
      <form onSubmit={addSub} className="space-y-4"><input required placeholder="Subcategory Name" value={subName} onChange={e => setSubName(e.target.value)} className="w-full px-4 py-2.5 border rounded-lg" /><div className="flex gap-3"><button type="submit" className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium">Add</button><button type="button" onClick={() => setSubModal(null)} className="px-6 py-2.5 border rounded-lg">Cancel</button></div></form>
    </Modal>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete Category"><p className="text-gray-600 mb-6">Delete this category and all subcategories?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

function AReviews() {
  const { reviews, setReviews, notify } = useApp();
  const approve = (id: string) => { setReviews(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r)); notify('Review approved!'); };
  const reject = (id: string) => { setReviews(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r)); notify('Review rejected!'); };
  const del = (id: string) => { setReviews(prev => prev.filter(r => r.id !== id)); notify('Review deleted!'); };
  const sColor: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Reviews</h1>
    {reviews.length === 0 ? <div className="bg-white rounded-xl border p-12 text-center text-gray-500">No reviews yet</div> :
    <div className="space-y-4">{reviews.map(r => <div key={r.id} className={`bg-white rounded-xl border p-5 ${r.status === 'pending' ? 'border-yellow-200' : ''}`}>
      <div className="flex items-start justify-between mb-3"><div><p className="font-semibold">{r.userName}</p><p className="text-xs text-gray-500">on <span className="text-blue-600">{r.productName}</span></p></div><span className={`text-xs px-3 py-1 rounded-full font-medium capitalize ${sColor[r.status]}`}>{r.status}</span></div>
      <div className="flex gap-0.5 mb-2">{[...Array(5)].map((_, i) => <Star key={i} size={14} className={i < r.rating ? 'text-sky-400 fill-sky-400' : 'text-gray-200'} />)}</div>
      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg mb-4">{r.comment}</p>
      <div className="flex gap-2">{r.status === 'pending' && <><button onClick={() => approve(r.id)} className="px-4 py-2 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100">✓ Approve</button><button onClick={() => reject(r.id)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100">✕ Reject</button></>}<button onClick={() => del(r.id)} className="px-4 py-2 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 ml-auto">Delete</button></div>
    </div>)}</div>}
  </div>;
}

// Defined at MODULE scope (not inside ASettings). Previously these lived inside
// the component, so every keystroke recreated them as brand-new component types —
// React then unmounted/remounted each input and stole focus after every character,
// which made it feel like the API keys "wouldn't save".
const SETTINGS_INPUT = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const SETTINGS_LABEL = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

function SecField({ label, k, placeholder, hint, isUrl, apiKeys, setApiKeys, showKeys, toggleShow }: {
  label: string; k: string; placeholder: string; hint?: string; isUrl?: boolean;
  apiKeys: Record<string, string>; setApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  showKeys: Record<string, boolean>; toggleShow: (k: string) => void;
}) {
  return (
    <div>
      <label className={SETTINGS_LABEL}>{label}</label>
      <div className="relative">
        <input
          type={isUrl ? 'url' : (showKeys[k] ? 'text' : 'password')}
          value={apiKeys[k] || ''}
          onChange={e => setApiKeys(s => ({ ...s, [k]: e.target.value }))}
          className={SETTINGS_INPUT + (isUrl ? '' : ' pr-10')}
          placeholder={placeholder}
        />
        {!isUrl && (
          <button type="button" onClick={() => toggleShow(k)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showKeys[k] ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Accordion({ id, title, icon, borderClass, children, open, toggle }: {
  id: string; title: string; icon: React.ReactNode; borderClass?: string; children: React.ReactNode;
  open: Record<string, boolean>; toggle: (k: string) => void;
}) {
  return (
    <div className={`bg-white rounded-xl border ${borderClass || ''}`}>
      <button type="button" onClick={() => toggle(id)} className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 rounded-xl transition-colors">
        <span className="font-semibold flex items-center gap-2">{icon}{title}</span>
        {open[id] ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>
      {open[id] && <div className="px-5 pb-6 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function ASettings() {
  const { user, changePassword, updateAdminProfile, notify } = useApp();
  const navigate = useNavigate();
  const L = SETTINGS_LABEL;
  const I = SETTINGS_INPUT;

  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('luxedge_api_keys') || '{}'); } catch { return {}; }
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [apiSaved, setApiSaved] = useState(false);
  const toggleShow = (k: string) => setShowKeys(s => ({ ...s, [k]: !s[k] }));

  const [open, setOpen] = useState<Record<string, boolean>>({ api: true, store: false, profile: false, password: false });
  const toggle = (k: string) => setOpen(s => ({ ...s, [k]: !s[k] }));

  const [profName, setProfName] = useState(user?.name || '');
  const [profEmail, setProfEmail] = useState(user?.email || '');

  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confPass, setConfPass] = useState('');
  const [passError, setPassError] = useState('');
  const [passOk, setPassOk] = useState(false);

  const handleSaveApiKeys = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('luxedge_api_keys', JSON.stringify(apiKeys));
    setApiSaved(true);
    notify('API Keys saved!');
    setTimeout(() => setApiSaved(false), 3000);
  };

  const handleProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profName.trim() || !profEmail.trim()) { notify('Name and email required'); return; }
    updateAdminProfile(profName.trim(), profEmail.trim());
  };

  const handlePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(''); setPassOk(false);
    if (newPass !== confPass) { setPassError('New passwords do not match'); return; }
    if (newPass.length < 6) { setPassError('Password must be at least 6 characters'); return; }
    if (curPass === newPass) { setPassError('New password must differ from current'); return; }
    const result = changePassword(curPass, newPass);
    if (result.ok) {
      setPassOk(true);
      setCurPass(''); setNewPass(''); setConfPass('');
      notify(result.msg);
      setTimeout(() => setPassOk(false), 5000);
    } else { setPassError(result.msg); }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* ── AI Providers ── */}
      <Accordion id="ai" title="AI Providers" icon={<Bot size={18} className="text-purple-600" />} borderClass="border-purple-300" open={open} toggle={toggle}>
        <div className="pt-5 space-y-4">
          <p className="text-sm text-gray-500">For full AI provider management including API keys, model selection, credit tracking, and connection testing, visit the dedicated AI Hub.</p>
          <button type="button" onClick={() => navigate('/admin/ai')}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Bot size={16} /> Open AI Hub →
          </button>
        </div>
      </Accordion>

      {/* ── API Keys ── */}
      <Accordion id="api" title="API Keys" icon={<Globe size={18} className="text-green-600" />} borderClass="border-green-300" open={open} toggle={toggle}>
        <div className="pt-5 space-y-5">
          <p className="text-sm text-gray-500">Keys are saved locally in your browser. Add them to enable AliExpress import, AI features, payments, and more.</p>

          {/* scrape.do */}
          <div className="rounded-xl border border-dashed border-green-300 bg-green-50 p-4 space-y-3">
            <div>
              <p className="text-sm font-bold text-green-700">scrape.do — Free AliExpress Importer</p>
              <p className="text-xs text-green-600 mt-0.5">1,000 free requests/month · No credit card · Permanent free tier</p>
            </div>
            <ol className="text-xs text-green-700 space-y-1 list-decimal list-inside">
              <li>Go to <span className="font-mono bg-white px-1 rounded">scrape.do</span> and create a free account</li>
              <li>Copy your token from the dashboard</li>
              <li>Paste it below and save</li>
            </ol>
            <SecField label="scrape.do Token" k="scrapedoKey" placeholder="paste your scrape.do token here" hint="Required for AliExpress product import" apiKeys={apiKeys} setApiKeys={setApiKeys} showKeys={showKeys} toggleShow={toggleShow} />
          </div>

          <SecField label="OpenAI API Key" k="openAiKey" placeholder="sk-proj-..." hint="For AI product descriptions · platform.openai.com" apiKeys={apiKeys} setApiKeys={setApiKeys} showKeys={showKeys} toggleShow={toggleShow} />

          <div className="grid sm:grid-cols-2 gap-4">
            <SecField label="Supabase Project URL" k="supabaseUrl" placeholder="https://xxx.supabase.co" hint="From supabase.com dashboard" isUrl apiKeys={apiKeys} setApiKeys={setApiKeys} showKeys={showKeys} toggleShow={toggleShow} />
            <SecField label="Supabase Anon Key" k="supabaseAnonKey" placeholder="eyJhbGci..." hint="anon/public key from API settings" apiKeys={apiKeys} setApiKeys={setApiKeys} showKeys={showKeys} toggleShow={toggleShow} />
          </div>

          <SecField label="Stripe Publishable Key" k="stripePublishableKey" placeholder="pk_live_..." hint="stripe.com → Developers → API Keys" apiKeys={apiKeys} setApiKeys={setApiKeys} showKeys={showKeys} toggleShow={toggleShow} />
          <SecField label="Google OAuth Client ID" k="googleClientId" placeholder="123456789.apps.googleusercontent.com" hint="console.cloud.google.com → Credentials" apiKeys={apiKeys} setApiKeys={setApiKeys} showKeys={showKeys} toggleShow={toggleShow} />

          {apiSaved && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
              <CheckCircle size={16} /> API Keys saved successfully!
            </div>
          )}
          <form onSubmit={handleSaveApiKeys}>
            <button type="submit" className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Save size={16} /> Save API Keys
            </button>
          </form>
        </div>
      </Accordion>

      {/* ── Store Information ── */}
      <Accordion id="store" title="Store Information" icon={<Settings size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          <form onSubmit={e => { e.preventDefault(); notify('Store settings saved!'); }} className="grid sm:grid-cols-2 gap-4">
            <div><label className={L}>Store Name</label><input defaultValue="Luxedge" className={I} /></div>
            <div><label className={L}>Contact Email</label><input defaultValue="hello@luxedge.us" className={I} /></div>
            <div><label className={L}>Phone</label><input defaultValue="(440) 941-8002" className={I} /></div>
            <div><label className={L}>Address</label><input defaultValue="Irving, TX" className={I} /></div>
            <div className="sm:col-span-2">
              <button type="submit" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
                <Save size={16} />Save Store Settings
              </button>
            </div>
          </form>
        </div>
      </Accordion>

      {/* ── Admin Profile ── */}
      <Accordion id="profile" title="Admin Profile" icon={<UserIcon size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          <form onSubmit={handleProfile} className="space-y-4">
            <div><label className={L}>Name</label><input value={profName} onChange={e => setProfName(e.target.value)} className={I} placeholder="Admin name" /></div>
            <div><label className={L}>Email</label><input type="email" value={profEmail} onChange={e => setProfEmail(e.target.value)} className={I} placeholder="admin email" /></div>
            <button type="submit" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"><Save size={16} />Save Profile</button>
          </form>
        </div>
      </Accordion>

      {/* ── Change Password ── */}
      <Accordion id="password" title="Change Password" icon={<Lock size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          {passOk && <div className="flex items-center gap-2 p-3 mb-4 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm"><CheckCircle size={16} /> Password updated! Use your new password next login.</div>}
          {passError && <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertTriangle size={16} /> {passError}</div>}
          <form onSubmit={handlePassword} className="space-y-4">
            <div><label className={L}>Current Password *</label><input type="password" value={curPass} onChange={e => setCurPass(e.target.value)} className={I} placeholder="Enter current password" required /></div>
            <div><label className={L}>New Password *</label><input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className={I} placeholder="Minimum 6 characters" required minLength={6} /></div>
            <div><label className={L}>Confirm New Password *</label><input type="password" value={confPass} onChange={e => setConfPass(e.target.value)} className={I} placeholder="Re-enter new password" required minLength={6} /></div>
            <button type="submit" className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"><Lock size={16} />Update Password</button>
          </form>
        </div>
      </Accordion>
    </div>
  );
}

// ============================================================================
// ENTERPRISE MARKETING GENERATOR
// ============================================================================
type MktTab = 'google'|'meta'|'social'|'email'|'video'|'vault';
type MktTone = 'luxury'|'urgent'|'friendly'|'professional';
const MKT_TONES: MktTone[] = ['luxury','urgent','friendly','professional'];

interface GoogleAd {
  headlines: string[];
  descriptions: string[];
  displayUrl: string;
  finalUrl: string;
  callouts: string[];
  sitelinks: { title: string; desc: string; url: string }[];
}
interface MetaAd {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  audience: string;
  interests: string[];
}
interface SocialPosts {
  instagram: string;
  hashtags: string[];
  facebook: string;
  twitter: string[];
  linkedin: string;
  pinterest: string;
  tiktokScript: string;
}
interface EmailDraft {
  subjectA: string;
  subjectB: string;
  preheader: string;
  heroHeadline: string;
  body: string;
  ctaText: string;
  urgency: string;
}
interface VideoScript {
  youtubeTitle: string;
  youtubeDesc: string;
  youtubeTags: string[];
  tiktokScript: string;
  reelHook: string;
}
interface MktVaultItem {
  id: string;
  type: string;
  productName: string;
  content: string;
  createdAt: string;
}

const EMPTY_GOOGLE: GoogleAd = { headlines: ['','','','','',''], descriptions: ['',''], displayUrl: '', finalUrl: '', callouts: [], sitelinks: [] };
const EMPTY_META: MetaAd = { primaryText: '', headline: '', description: '', cta: 'Shop Now', audience: '', interests: [] };
const EMPTY_SOCIAL: SocialPosts = { instagram: '', hashtags: [], facebook: '', twitter: [], linkedin: '', pinterest: '', tiktokScript: '' };
const EMPTY_EMAIL: EmailDraft = { subjectA: '', subjectB: '', preheader: '', heroHeadline: '', body: '', ctaText: '', urgency: '' };
const EMPTY_VIDEO: VideoScript = { youtubeTitle: '', youtubeDesc: '', youtubeTags: [], tiktokScript: '', reelHook: '' };

const META_CTA_OPTIONS = ['Shop Now','Learn More','Get Offer','Order Now','Sign Up','Book Now','Contact Us','Download'];

function AMarketingGen() {
  const { products } = useApp();
  const [tab, setTab] = useState<MktTab>('google');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [aiProvider, setAiProvider] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [tone, setTone] = useState<MktTone>('luxury');
  const [generating, setGenerating] = useState(false);
  const [genSection, setGenSection] = useState('');
  const [googleAd, setGoogleAd] = useState<GoogleAd>(EMPTY_GOOGLE);
  const [metaAd, setMetaAd] = useState<MetaAd>(EMPTY_META);
  const [social, setSocial] = useState<SocialPosts>(EMPTY_SOCIAL);
  const [email, setEmail] = useState<EmailDraft>(EMPTY_EMAIL);
  const [video, setVideo] = useState<VideoScript>(EMPTY_VIDEO);
  const [vault, setVault] = useState<MktVaultItem[]>([]);
  const [copied, setCopied] = useState('');
  const [newInterest, setNewInterest] = useState('');
  const [newCallout, setNewCallout] = useState('');

  const allProviders: AIProvider[] = loadAIProviders();
  const activeProviders = allProviders.filter(p => p.enabled && p.apiKey);
  const selectedProduct = products.find(p => p.id === selectedProductId);

  useEffect(() => {
    try { setVault(JSON.parse(localStorage.getItem('luxedge_mkt_vault') || '[]')); } catch { setVault([]); }
  }, []);

  useEffect(() => {
    if (activeProviders.length && !aiProvider) {
      const def = activeProviders.find(p => p.isDefault) || activeProviders[0];
      setAiProvider(def.id);
      setAiModel(def.defaultModel);
    }
  }, [activeProviders.length, aiProvider]);

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  function saveVault(type: MktTab, content: string) {
    const item: MktVaultItem = { id: Date.now().toString(), type, productName: selectedProduct?.name || '', content, createdAt: new Date().toISOString() };
    const updated = [item, ...vault].slice(0, 100);
    setVault(updated);
    localStorage.setItem('luxedge_mkt_vault', JSON.stringify(updated));
  }

  async function callAI(prompt: string): Promise<string> {
    const prov = activeProviders.find(p => p.id === aiProvider) || activeProviders[0];
    if (!prov) throw new Error('No AI provider with API key. Go to Settings → AI Providers.');
    const model = aiModel || prov.defaultModel;
    if (prov.id === 'openai') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${prov.apiKey}`}, body: JSON.stringify({ model, messages:[{role:'system',content:'You are an expert luxury e-commerce marketing copywriter. Return only valid JSON.'},{role:'user',content:prompt}], temperature:0.85 }) });
      const d = await r.json(); if (d.error) throw new Error(d.error.message); return d.choices[0].message.content;
    } else if (prov.id === 'gemini') {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${prov.apiKey}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.85} }) });
      const d = await r.json(); if (d.error) throw new Error(d.error.message); return d.candidates[0].content.parts[0].text;
    } else {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${prov.apiKey}`,'HTTP-Referer':'https://luxedge.com'}, body: JSON.stringify({ model, messages:[{role:'user',content:prompt}] }) });
      const d = await r.json(); if (d.error) throw new Error(d.error.message || JSON.stringify(d.error)); return d.choices[0].message.content;
    }
  }

  function parseJ<T>(raw: string, fb: T): T {
    try { const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\{[\s\S]*\})/); return JSON.parse(m ? m[1] : raw); }
    catch { return fb; }
  }

  function buildPrompt(section: string): string {
    const p = selectedProduct;
    if (!p) return '';
    const base = `Product: "${p.name}" | Price: $${p.price} | Category: ${p.category||'Luxury'} | Tone: ${tone.toUpperCase()}\nDescription: ${p.description?.slice(0,300)||'Premium luxury product'}`;
    if (section === 'all') return `${base}\n\nGenerate comprehensive marketing copy. Return ONLY valid JSON:\n{\n  "google": {\n    "headlines": ["h1 ≤30ch","h2","h3","h4","h5","h6"],\n    "descriptions": ["desc1 ≤90ch","desc2"],\n    "displayUrl": "luxedge.com/shop",\n    "finalUrl": "https://luxedge.com/products/${p.name.toLowerCase().replace(/\s+/g,'-')}",\n    "callouts": ["Free US Shipping","Luxury Quality","Easy Returns","Secure Checkout"],\n    "sitelinks": [{"title":"Shop Now","desc":"View all luxury items","url":"/products"},{"title":"About Us","desc":"Our story","url":"/about"}]\n  },\n  "meta": {\n    "primaryText": "compelling 125-char primary ad text with emoji",\n    "headline": "40-char headline",\n    "description": "30-char description",\n    "cta": "Shop Now",\n    "audience": "US adults 25-55 interested in luxury goods, high income",\n    "interests": ["Luxury Brands","Premium Shopping","Interior Design","High-End Fashion"]\n  },\n  "social": {\n    "instagram": "engaging Instagram caption with emojis 2200 chars max",\n    "hashtags": ["luxuryliving","premiumquality","luxedge","shopnow","luxury"],\n    "facebook": "Facebook post 400-500 chars",\n    "twitter": ["tweet1 ≤280ch","tweet2 continuation","tweet3 CTA"],\n    "linkedin": "professional LinkedIn post 500-700 chars",\n    "pinterest": "Pinterest pin description 500 chars",\n    "tiktokScript": "30-second TikTok script with hook/body/CTA"\n  },\n  "email": {\n    "subjectA": "email subject A ≤50ch",\n    "subjectB": "A/B variant subject ≤50ch",\n    "preheader": "preheader text ≤90ch",\n    "heroHeadline": "bold hero headline",\n    "body": "email body with benefit paragraphs",\n    "ctaText": "Shop Now →",\n    "urgency": "limited time urgency line"\n  },\n  "video": {\n    "youtubeTitle": "YouTube title ≤60ch",\n    "youtubeDesc": "YouTube description with timestamps",\n    "youtubeTags": ["luxury","premium","review","unboxing"],\n    "tiktokScript": "60-sec TikTok script with hook/demo/CTA",\n    "reelHook": "First 3-second Reels hook line"\n  }\n}`;
    if (section === 'google') return `${base}\n\nGenerate Google RSA ad copy. Return ONLY valid JSON:\n{"headlines":["h1 ≤30ch","h2","h3","h4","h5","h6"],"descriptions":["desc1 ≤90ch","desc2"],"displayUrl":"luxedge.com/shop","finalUrl":"https://luxedge.com/products/slug","callouts":["Free Shipping","Easy Returns"],"sitelinks":[{"title":"Shop Now","desc":"All products","url":"/products"}]}`;
    if (section === 'meta') return `${base}\n\nGenerate Meta/Facebook ad copy. Return ONLY valid JSON:\n{"primaryText":"125ch primary text","headline":"40ch headline","description":"30ch description","cta":"Shop Now","audience":"target audience description","interests":["interest1","interest2"]}`;
    if (section === 'social') return `${base}\n\nGenerate social media posts. Return ONLY valid JSON:\n{"instagram":"caption","hashtags":["tag1","tag2"],"facebook":"fb post","twitter":["tweet1","tweet2"],"linkedin":"linkedin post","pinterest":"pin desc","tiktokScript":"script"}`;
    if (section === 'email') return `${base}\n\nGenerate email marketing copy. Return ONLY valid JSON:\n{"subjectA":"subject A","subjectB":"subject B","preheader":"preheader","heroHeadline":"hero","body":"body text","ctaText":"Shop Now →","urgency":"urgency line"}`;
    if (section === 'video') return `${base}\n\nGenerate video marketing scripts. Return ONLY valid JSON:\n{"youtubeTitle":"title","youtubeDesc":"description","youtubeTags":["tag1"],"tiktokScript":"script","reelHook":"hook"}`;
    return base;
  }

  async function generateAll() {
    if (!selectedProduct) { alert('Please select a product first.'); return; }
    if (!activeProviders.length) { alert('Add an AI provider API key in Settings first.'); return; }
    setGenerating(true); setGenSection('all');
    try {
      const raw = await callAI(buildPrompt('all'));
      const d = parseJ<Record<string,unknown>>(raw, {});
      if (d.google) setGoogleAd(d.google as GoogleAd);
      if (d.meta) setMetaAd(d.meta as MetaAd);
      if (d.social) setSocial(d.social as SocialPosts);
      if (d.email) setEmail(d.email as EmailDraft);
      if (d.video) setVideo(d.video as VideoScript);
    } catch(e) { alert(`AI Error: ${e instanceof Error ? e.message : String(e)}`); }
    setGenerating(false); setGenSection('');
  }

  async function regenSection(section: MktTab) {
    if (!selectedProduct) return;
    setGenerating(true); setGenSection(section);
    try {
      const raw = await callAI(buildPrompt(section));
      if (section === 'google') setGoogleAd(parseJ(raw, googleAd));
      else if (section === 'meta') setMetaAd(parseJ(raw, metaAd));
      else if (section === 'social') setSocial(parseJ(raw, social));
      else if (section === 'email') setEmail(parseJ(raw, email));
      else if (section === 'video') setVideo(parseJ(raw, video));
    } catch(e) { alert(`AI Error: ${e instanceof Error ? e.message : String(e)}`); }
    setGenerating(false); setGenSection('');
  }

  const MKT_TABS: { key: MktTab; label: string }[] = [
    { key: 'google', label: '🔍 Google Ads' },
    { key: 'meta', label: '📘 Meta Ads' },
    { key: 'social', label: '📱 Social Posts' },
    { key: 'email', label: '📧 Email' },
    { key: 'video', label: '🎬 Video' },
    { key: 'vault', label: '🗄️ Vault' },
  ];

  const CopyBtn = ({ text, k }: { text: string; k: string }) => (
    <button onClick={() => copyText(text, k)} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title="Copy">
      {copied === k ? <CheckCircle size={14} className="text-green-500" /> : <Clipboard size={14} className="text-gray-400" />}
    </button>
  );

  const RegenBtn = ({ section, loading }: { section: MktTab; loading: boolean }) => (
    <button onClick={() => regenSection(section)} disabled={generating || !selectedProduct} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg font-medium disabled:opacity-50 transition-colors">
      {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      {loading ? 'Generating…' : 'Regenerate'}
    </button>
  );

  const CharBadge = ({ text, max, warn }: { text: string; max: number; warn?: number }) => {
    const n = text.length; const w = warn ?? Math.floor(max * 0.85);
    return <span className={`text-xs font-mono ${n > max ? 'text-red-500 font-bold' : n > w ? 'text-blue-500' : 'text-gray-400'}`}>{n}/{max}</span>;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone size={24} className="text-purple-600" /> Marketing Generator
          </h1>
          <p className="text-gray-500 text-sm mt-1">AI-powered ads, social posts, email &amp; video scripts</p>
        </div>
        <button onClick={generateAll} disabled={generating || !selectedProductId} className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 hover:shadow-lg transition-all">
          {generating && genSection === 'all' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {generating && genSection === 'all' ? 'Generating All…' : '✨ Generate All'}
        </button>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Product</label>
          <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            <option value="">— Select product —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">AI Provider</label>
          <select value={aiProvider} onChange={e => { setAiProvider(e.target.value); setAiModel(''); }} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {activeProviders.length === 0 && <option value="">No providers configured</option>}
            {activeProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Model</label>
          <select value={aiModel} onChange={e => setAiModel(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {(activeProviders.find(p => p.id === aiProvider)?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Tone</label>
          <select value={tone} onChange={e => setTone(e.target.value as MktTone)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {MKT_TONES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {MKT_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── GOOGLE ADS TAB ── */}
      {tab === 'google' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Search size={18} className="text-blue-600" /> Google Search Ads (RSA)</h2>
            <div className="flex gap-2">
              <button onClick={() => { saveVault('google', JSON.stringify(googleAd, null, 2)); }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="google" loading={generating && genSection === 'google'} />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Headlines <span className="text-gray-400 font-normal">(max 30 chars each, use at least 5)</span></h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {googleAd.headlines.map((h, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400 w-4">{i+1}</span>
                  <input value={h} onChange={e => { const hs = [...googleAd.headlines]; hs[i] = e.target.value.slice(0,30); setGoogleAd({...googleAd, headlines: hs}); }} placeholder={`Headline ${i+1}`} className="flex-1 text-sm bg-transparent focus:outline-none" />
                  <CharBadge text={h} max={30} />
                  <CopyBtn text={h} k={`gh${i}`} />
                </div>
              ))}
            </div>
            <button onClick={() => setGoogleAd({...googleAd, headlines: [...googleAd.headlines, '']})} className="mt-2 text-xs text-purple-600 hover:underline">+ Add headline</button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Descriptions <span className="text-gray-400 font-normal">(max 90 chars each)</span></h3>
            <div className="space-y-2">
              {googleAd.descriptions.map((d, i) => (
                <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400 w-4 mt-1">{i+1}</span>
                  <textarea value={d} onChange={e => { const ds = [...googleAd.descriptions]; ds[i] = e.target.value.slice(0,90); setGoogleAd({...googleAd, descriptions: ds}); }} placeholder={`Description ${i+1}`} rows={2} className="flex-1 text-sm bg-transparent focus:outline-none resize-none" />
                  <div className="flex flex-col items-end gap-1">
                    <CharBadge text={d} max={90} />
                    <CopyBtn text={d} k={`gd${i}`} />
                  </div>
                </div>
              ))}
              {googleAd.descriptions.length < 4 && <button onClick={() => setGoogleAd({...googleAd, descriptions: [...googleAd.descriptions, '']})} className="text-xs text-purple-600 hover:underline">+ Add description</button>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Display URL</h3>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <Globe size={14} className="text-gray-400 flex-shrink-0" />
                <input value={googleAd.displayUrl} onChange={e => setGoogleAd({...googleAd, displayUrl: e.target.value})} placeholder="luxedge.com/shop/product-name" className="flex-1 text-sm bg-transparent focus:outline-none" />
                <CopyBtn text={googleAd.displayUrl} k="gdurl" />
              </div>
              <p className="text-xs text-gray-400 mt-1">Shown in ad — must match final URL domain</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Final URL</h3>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <Link2 size={14} className="text-gray-400 flex-shrink-0" />
                <input value={googleAd.finalUrl} onChange={e => setGoogleAd({...googleAd, finalUrl: e.target.value})} placeholder="https://luxedge.com/products/..." className="flex-1 text-sm bg-transparent focus:outline-none" />
                <CopyBtn text={googleAd.finalUrl} k="gfurl" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Callout Extensions</h3>
              <div className="flex flex-wrap gap-2 mb-2">
                {googleAd.callouts.map((c, i) => (
                  <span key={i} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                    {c}
                    <button onClick={() => setGoogleAd({...googleAd, callouts: googleAd.callouts.filter((_,j) => j !== i)})} className="hover:text-red-500">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newCallout} onChange={e => setNewCallout(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newCallout.trim()) { setGoogleAd({...googleAd, callouts: [...googleAd.callouts, newCallout.trim()]}); setNewCallout(''); } }} placeholder="Add callout…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <button onClick={() => { if (newCallout.trim()) { setGoogleAd({...googleAd, callouts: [...googleAd.callouts, newCallout.trim()]}); setNewCallout(''); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium">+</button>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Sitelink Extensions</h3>
              <div className="space-y-2">
                {googleAd.sitelinks.map((sl, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg p-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{sl.title}</p>
                      <p className="text-gray-500 truncate">{sl.desc}</p>
                    </div>
                    <button onClick={() => setGoogleAd({...googleAd, sitelinks: googleAd.sitelinks.filter((_,j) => j !== i)})} className="text-gray-400 hover:text-red-500">×</button>
                  </div>
                ))}
                <button onClick={() => setGoogleAd({...googleAd, sitelinks: [...googleAd.sitelinks, {title:'',desc:'',url:''}]})} className="text-xs text-blue-600 hover:underline">+ Add sitelink</button>
              </div>
            </div>
          </div>

          {/* Google Ad Preview */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Monitor size={14} /> Ad Preview</h3>
            <div className="border border-gray-100 rounded-lg p-4 bg-gray-50 max-w-lg">
              <div className="flex items-center gap-1 mb-1"><span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">Ad</span><span className="text-xs text-gray-500 truncate">{googleAd.displayUrl || 'luxedge.com'}</span></div>
              <p className="text-blue-600 text-base font-medium leading-tight mb-0.5">{[googleAd.headlines[0], googleAd.headlines[1], googleAd.headlines[2]].filter(Boolean).join(' | ') || 'Your Ad Headlines Here'}</p>
              <p className="text-sm text-gray-700 leading-snug">{googleAd.descriptions[0] || 'Your compelling description that drives clicks and conversions.'}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── META ADS TAB ── */}
      {tab === 'meta' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Target size={18} className="text-blue-700" /> Meta Ads (Facebook &amp; Instagram)</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('meta', JSON.stringify(metaAd, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="meta" loading={generating && genSection === 'meta'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Primary Text <span className="text-gray-400 font-normal">(≤125 chars recommended)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={metaAd.primaryText} max={500} warn={125} /><CopyBtn text={metaAd.primaryText} k="mpt" /></div>
                </div>
                <textarea value={metaAd.primaryText} onChange={e => setMetaAd({...metaAd, primaryText: e.target.value})} placeholder="Engaging primary text that appears above your image…" rows={4} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Headline <span className="text-gray-400 text-xs">(≤40)</span></label>
                    <div className="flex items-center gap-1"><CharBadge text={metaAd.headline} max={40} /><CopyBtn text={metaAd.headline} k="mh" /></div>
                  </div>
                  <input value={metaAd.headline} onChange={e => setMetaAd({...metaAd, headline: e.target.value.slice(0,40)})} placeholder="Bold headline" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Description <span className="text-gray-400 text-xs">(≤30)</span></label>
                    <div className="flex items-center gap-1"><CharBadge text={metaAd.description} max={30} /><CopyBtn text={metaAd.description} k="md" /></div>
                  </div>
                  <input value={metaAd.description} onChange={e => setMetaAd({...metaAd, description: e.target.value.slice(0,30)})} placeholder="Short description" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Call to Action</label>
                <select value={metaAd.cta} onChange={e => setMetaAd({...metaAd, cta: e.target.value})} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300">
                  {META_CTA_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Target Audience</label>
                <textarea value={metaAd.audience} onChange={e => setMetaAd({...metaAd, audience: e.target.value})} placeholder="e.g. US adults 25-55, high income, interested in luxury goods…" rows={2} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Interests to Target</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {metaAd.interests.map((interest, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                      {interest}
                      <button onClick={() => setMetaAd({...metaAd, interests: metaAd.interests.filter((_,j) => j !== i)})} className="hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newInterest} onChange={e => setNewInterest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newInterest.trim()) { setMetaAd({...metaAd, interests: [...metaAd.interests, newInterest.trim()]}); setNewInterest(''); } }} placeholder="Add interest…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <button onClick={() => { if (newInterest.trim()) { setMetaAd({...metaAd, interests: [...metaAd.interests, newInterest.trim()]}); setNewInterest(''); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium">+</button>
                </div>
              </div>
            </div>

            {/* Meta Ad Preview */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm h-fit">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Share2 size={14} /> Facebook Ad Preview</h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden max-w-sm">
                <div className="p-3 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">L</div>
                  <div><p className="text-xs font-semibold text-gray-900">Luxedge</p><p className="text-xs text-gray-400">Sponsored · <Globe size={10} className="inline" /></p></div>
                </div>
                <p className="px-3 pb-3 text-xs text-gray-800 leading-relaxed">{metaAd.primaryText || 'Your primary ad text will appear here.'}</p>
                <div className="bg-gray-100 h-32 flex items-center justify-center text-gray-400 text-xs">
                  <ImageIcon size={24} className="text-gray-300" />
                </div>
                <div className="p-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                  <div><p className="text-xs font-semibold text-gray-900">{metaAd.headline || 'Your Headline'}</p><p className="text-xs text-gray-500">{metaAd.description || 'Your description'}</p></div>
                  <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold flex-shrink-0">{metaAd.cta}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SOCIAL POSTS TAB ── */}
      {tab === 'social' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Share2 size={18} className="text-pink-600" /> Social Media Posts</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('social', JSON.stringify(social, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="social" loading={generating && genSection === 'social'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Instagram */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📸 Instagram Caption</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.instagram} max={2200} warn={1000} /><CopyBtn text={social.instagram + '\n\n' + social.hashtags.map(h => '#'+h).join(' ')} k="ig" /></div>
              </div>
              <textarea value={social.instagram} onChange={e => setSocial({...social, instagram: e.target.value})} placeholder="Write an engaging Instagram caption with emojis…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none" />
              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-600 mb-1"># Hashtags</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {social.hashtags.map((h, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-pink-50 text-pink-700 text-xs rounded-full">
                      #{h}
                      <button onClick={() => setSocial({...social, hashtags: social.hashtags.filter((_,j) => j !== i)})} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input placeholder="hashtag (no #)" onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim().replace(/^#/,''); if (v) { setSocial({...social, hashtags: [...social.hashtags, v]}); (e.target as HTMLInputElement).value = ''; } } }} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-pink-300" />
                </div>
              </div>
            </div>

            {/* Facebook */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📘 Facebook Post</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.facebook} max={5000} warn={400} /><CopyBtn text={social.facebook} k="fb" /></div>
              </div>
              <textarea value={social.facebook} onChange={e => setSocial({...social, facebook: e.target.value})} placeholder="Write an engaging Facebook post…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              <p className="text-xs text-gray-400 mt-1">Optimal length: 40–80 words</p>
            </div>

            {/* Twitter/X Thread */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">𝕏 Twitter/X Thread</h3>
                <div className="flex gap-2">
                  <CopyBtn text={social.twitter.join('\n\n')} k="tw" />
                  <button onClick={() => setSocial({...social, twitter: [...social.twitter, '']})} className="text-xs text-blue-500 hover:underline">+ Add tweet</button>
                </div>
              </div>
              <div className="space-y-2">
                {social.twitter.map((tw, i) => (
                  <div key={i} className="relative">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 mt-2 w-4 flex-shrink-0">{i+1}/</span>
                      <textarea value={tw} onChange={e => { const t = [...social.twitter]; t[i] = e.target.value.slice(0,280); setSocial({...social, twitter: t}); }} placeholder={`Tweet ${i+1}`} rows={2} className="flex-1 text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none" />
                      <div className="flex flex-col items-end gap-1">
                        <CharBadge text={tw} max={280} warn={240} />
                        <button onClick={() => setSocial({...social, twitter: social.twitter.filter((_,j) => j !== i)})} className="text-gray-300 hover:text-red-400 text-xs">×</button>
                      </div>
                    </div>
                  </div>
                ))}
                {social.twitter.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No tweets yet. Click "Generate All" or add manually.</p>}
              </div>
            </div>

            {/* LinkedIn */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">💼 LinkedIn Post</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.linkedin} max={3000} warn={700} /><CopyBtn text={social.linkedin} k="li" /></div>
              </div>
              <textarea value={social.linkedin} onChange={e => setSocial({...social, linkedin: e.target.value})} placeholder="Professional LinkedIn post…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
            </div>

            {/* Pinterest */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📌 Pinterest Pin</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.pinterest} max={500} /><CopyBtn text={social.pinterest} k="pin" /></div>
              </div>
              <textarea value={social.pinterest} onChange={e => setSocial({...social, pinterest: e.target.value.slice(0,500)})} placeholder="Pinterest pin description optimized for discovery…" rows={3} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
            </div>

            {/* TikTok Script */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">🎵 TikTok Script</h3>
                <CopyBtn text={social.tiktokScript} k="tt" />
              </div>
              <textarea value={social.tiktokScript} onChange={e => setSocial({...social, tiktokScript: e.target.value})} placeholder="Write a 30-60 second TikTok script with hook/demo/CTA…" rows={6} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
            </div>
          </div>
        </div>
      )}

      {/* ── EMAIL TAB ── */}
      {tab === 'email' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Send size={18} className="text-green-600" /> Email Marketing</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('email', JSON.stringify(email, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="email" loading={generating && genSection === 'email'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">A/B Subject Lines</h3>
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-600 font-medium">Version A</label>
                      <div className="flex items-center gap-1"><CharBadge text={email.subjectA} max={50} /><CopyBtn text={email.subjectA} k="esa" /></div>
                    </div>
                    <input value={email.subjectA} onChange={e => setEmail({...email, subjectA: e.target.value})} placeholder="Subject line A — curiosity/benefit driven" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-600 font-medium">Version B</label>
                      <div className="flex items-center gap-1"><CharBadge text={email.subjectB} max={50} /><CopyBtn text={email.subjectB} k="esb" /></div>
                    </div>
                    <input value={email.subjectB} onChange={e => setEmail({...email, subjectB: e.target.value})} placeholder="Subject line B — urgency/FOMO driven" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Preheader <span className="text-gray-400 text-xs">(≤90 chars)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={email.preheader} max={90} /><CopyBtn text={email.preheader} k="epre" /></div>
                </div>
                <input value={email.preheader} onChange={e => setEmail({...email, preheader: e.target.value.slice(0,90)})} placeholder="Preview text shown after subject line…" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Hero Headline</label>
                  <CopyBtn text={email.heroHeadline} k="ehero" />
                </div>
                <input value={email.heroHeadline} onChange={e => setEmail({...email, heroHeadline: e.target.value})} placeholder="Bold, attention-grabbing hero headline" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Email Body</label>
                  <CopyBtn text={email.body} k="ebody" />
                </div>
                <textarea value={email.body} onChange={e => setEmail({...email, body: e.target.value})} placeholder="Email body with paragraphs covering benefits, features, social proof…" rows={6} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-green-300 resize-none" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">CTA Button Text</label>
                    <CopyBtn text={email.ctaText} k="ecta" />
                  </div>
                  <input value={email.ctaText} onChange={e => setEmail({...email, ctaText: e.target.value})} placeholder="Shop Now →" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Urgency Line</label>
                    <CopyBtn text={email.urgency} k="eur" />
                  </div>
                  <input value={email.urgency} onChange={e => setEmail({...email, urgency: e.target.value})} placeholder="⏰ Offer ends midnight Friday!" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
              </div>
            </div>

            {/* Email Preview */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Monitor size={14} /> Email Preview</h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
                <div className="bg-gray-50 p-3 border-b border-gray-200">
                  <p className="text-gray-600"><span className="font-semibold text-gray-800">From:</span> Luxedge &lt;hello@luxedge.com&gt;</p>
                  <p className="text-gray-600"><span className="font-semibold text-gray-800">Subject:</span> {email.subjectA || '(no subject yet)'}</p>
                  <p className="text-gray-400 text-xs italic">{email.preheader || '(preheader)'}</p>
                </div>
                <div className="bg-white p-4 space-y-3 max-h-80 overflow-y-auto">
                  <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg p-4 text-center">
                    <p className="font-bold text-base">{email.heroHeadline || 'Your Hero Headline'}</p>
                  </div>
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{email.body || 'Your email body will appear here.'}</p>
                  {email.urgency && <p className="text-blue-600 font-semibold">{email.urgency}</p>}
                  <div className="text-center">
                    <button className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold text-sm">{email.ctaText || 'Shop Now →'}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VIDEO TAB ── */}
      {tab === 'video' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Zap size={18} className="text-red-600" /> Video Scripts &amp; YouTube</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('video', JSON.stringify(video, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Save size={12} /> Save</button>
              <RegenBtn section="video" loading={generating && genSection === 'video'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">▶️ YouTube Title <span className="text-gray-400 text-xs">(≤60 chars)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={video.youtubeTitle} max={60} /><CopyBtn text={video.youtubeTitle} k="yt" /></div>
                </div>
                <input value={video.youtubeTitle} onChange={e => setVideo({...video, youtubeTitle: e.target.value.slice(0,60)})} placeholder="Engaging YouTube video title" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">YouTube Description</label>
                  <CopyBtn text={video.youtubeDesc} k="ydesc" />
                </div>
                <textarea value={video.youtubeDesc} onChange={e => setVideo({...video, youtubeDesc: e.target.value})} placeholder="YouTube description with timestamps, links, keywords…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">YouTube Tags</label>
                  <CopyBtn text={video.youtubeTags.join(', ')} k="ytags" />
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {video.youtubeTags.map((t, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-full">
                      {t}
                      <button onClick={() => setVideo({...video, youtubeTags: video.youtubeTags.filter((_,j) => j !== i)})} className="hover:text-red-600">×</button>
                    </span>
                  ))}
                </div>
                <input onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) { setVideo({...video, youtubeTags: [...video.youtubeTags, v]}); (e.target as HTMLInputElement).value = ''; } } }} placeholder="Add tag, press Enter" className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">⚡ Reels / TikTok Hook</label>
                  <CopyBtn text={video.reelHook} k="rhook" />
                </div>
                <textarea value={video.reelHook} onChange={e => setVideo({...video, reelHook: e.target.value})} placeholder="First 3-second hook line — must stop the scroll…" rows={3} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none" />
                <p className="text-xs text-gray-400 mt-1">This is the most critical line — it determines if viewers keep watching</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">🎵 TikTok / Reels Full Script</label>
                  <CopyBtn text={video.tiktokScript} k="tts" />
                </div>
                <textarea value={video.tiktokScript} onChange={e => setVideo({...video, tiktokScript: e.target.value})} placeholder="60-second script:\n[0:00] Hook\n[0:05] Problem\n[0:15] Solution demo\n[0:45] CTA" rows={10} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none font-mono" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VAULT TAB ── */}
      {tab === 'vault' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Wand2 size={18} className="text-gray-600" /> Copy Vault ({vault.length})</h2>
            <div className="flex gap-2">
              <button onClick={() => { const blob = new Blob([JSON.stringify(vault, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'luxedge-marketing-vault.json'; a.click(); }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><Upload size={12} /> Export JSON</button>
              {vault.length > 0 && <button onClick={() => { if (confirm('Clear all saved copies?')) { setVault([]); localStorage.removeItem('luxedge_mkt_vault'); } }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium"><Trash2 size={12} /> Clear All</button>}
            </div>
          </div>

          {vault.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-gray-200 rounded-xl">
              <Megaphone size={40} className="text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No saved copies yet</p>
              <p className="text-gray-400 text-sm">Click "Save" on any tab to archive marketing copy here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {vault.map(item => (
                <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">{item.type}</span>
                      <span className="text-sm font-medium text-gray-800">{item.productName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</span>
                      <CopyBtn text={item.content} k={`v${item.id}`} />
                      <button onClick={() => { const updated = vault.filter(v => v.id !== item.id); setVault(updated); localStorage.setItem('luxedge_mkt_vault', JSON.stringify(updated)); }} className="p-1 text-gray-300 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 overflow-auto max-h-32 whitespace-pre-wrap">{item.content.slice(0, 300)}{item.content.length > 300 ? '…' : ''}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ENTERPRISE SEO & CONTENT ENGINE
// ============================================================================
type SEOTab = 'seo'|'schema'|'social'|'content'|'analysis'|'preview';
type ToneOption = 'Luxury'|'Premium'|'Friendly'|'Professional'|'Technical'|'Luxury Brand'|'Minimalist';
const SEO_TONES: ToneOption[] = ['Luxury','Premium','Friendly','Professional','Technical','Luxury Brand','Minimalist'];
const SEO_SCHEMA_KEYS = ['product','breadcrumb','organization','website','faq'] as const;
type SchemaKey = typeof SEO_SCHEMA_KEYS[number];

function _scoreColor(n: number): string {
  return n >= 70 ? 'text-green-600' : n >= 45 ? 'text-blue-500' : 'text-red-500';
}
function _scoreBg(n: number): string {
  return n >= 70 ? 'bg-green-50 border-green-200' : n >= 45 ? 'bg-sky-50 border-sky-200' : 'bg-red-50 border-red-200';
}
function _issueIcon(t: 'good'|'warning'|'error'): string {
  return t === 'good' ? '✅' : t === 'warning' ? '⚠️' : '❌';
}

function _computeSEO(seo: SEOData, content: ContentData): SEOScore {
  const issues: SEOScore['issues'] = [];
  let score = 100;

  const tl = seo.title.length;
  if (tl >= 50 && tl <= 60) issues.push({ type: 'good', msg: `Title: ${tl} chars (ideal 50–60)` });
  else if (tl >= 30 && tl <= 70) { score -= 7; issues.push({ type: 'warning', msg: `Title: ${tl} chars (ideal: 50–60)` }); }
  else if (tl > 0) { score -= 18; issues.push({ type: 'error', msg: `Title: ${tl} chars (${tl < 30 ? 'too short' : 'too long — truncated in SERPs'})` }); }
  else { score -= 25; issues.push({ type: 'error', msg: 'SEO title is empty' }); }

  const ml = seo.metaDescription.length;
  if (ml >= 120 && ml <= 160) issues.push({ type: 'good', msg: `Meta: ${ml} chars (ideal 120–160)` });
  else if (ml >= 80 && ml <= 200) { score -= 8; issues.push({ type: 'warning', msg: `Meta: ${ml} chars (ideal: 120–160)` }); }
  else if (ml > 0) { score -= 18; issues.push({ type: 'error', msg: `Meta: ${ml} chars (${ml < 80 ? 'too short' : 'too long'})` }); }
  else { score -= 25; issues.push({ type: 'error', msg: 'Meta description is empty' }); }

  const fk = seo.focusKeyword.toLowerCase().trim();
  if (fk) {
    if (seo.title.toLowerCase().includes(fk)) issues.push({ type: 'good', msg: 'Focus keyword in title ✓' });
    else { score -= 12; issues.push({ type: 'error', msg: 'Focus keyword missing from title' }); }
    if (seo.metaDescription.toLowerCase().includes(fk)) issues.push({ type: 'good', msg: 'Focus keyword in meta ✓' });
    else { score -= 6; issues.push({ type: 'warning', msg: 'Focus keyword missing from meta description' }); }
    if (seo.slug.toLowerCase().includes(fk.replace(/\s+/g, '-'))) issues.push({ type: 'good', msg: 'Focus keyword in URL slug ✓' });
    else { score -= 4; issues.push({ type: 'warning', msg: 'Focus keyword not in URL slug' }); }
  } else {
    score -= 15; issues.push({ type: 'error', msg: 'Focus keyword not set' });
  }

  if (seo.imageAlt.trim()) issues.push({ type: 'good', msg: 'Image ALT text set ✓' });
  else { score -= 8; issues.push({ type: 'error', msg: 'Image ALT text is missing' }); }

  if (seo.slug.trim()) issues.push({ type: 'good', msg: 'URL slug defined ✓' });
  else { score -= 8; issues.push({ type: 'error', msg: 'URL slug not set' }); }

  if (seo.keywords.length >= 5) issues.push({ type: 'good', msg: `${seo.keywords.length} SEO keywords defined ✓` });
  else if (seo.keywords.length >= 3) { score -= 4; issues.push({ type: 'warning', msg: `${seo.keywords.length} keywords — aim for 5+` }); }
  else { score -= 10; issues.push({ type: 'error', msg: 'Too few keywords (add at least 5)' }); }

  const desc = content.luxuryDescription || '';
  const words = desc.split(/\s+/).filter(Boolean);
  const wc = words.length;
  if (wc >= 200) issues.push({ type: 'good', msg: `Description: ${wc} words ✓` });
  else if (wc >= 100) { score -= 6; issues.push({ type: 'warning', msg: `Description: ${wc} words (aim for 200+)` }); }
  else if (wc > 0) { score -= 14; issues.push({ type: 'error', msg: `Description: ${wc} words (thin content)` }); }
  else { score -= 20; issues.push({ type: 'error', msg: 'Luxury description is empty' }); }

  const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const avgWPS = sentences.length > 0 ? wc / sentences.length : 0;
  let readability = 100;
  if (avgWPS > 30) { readability = 35; issues.push({ type: 'error', msg: `Sentences too long (avg ${avgWPS.toFixed(0)} words)` }); }
  else if (avgWPS > 20) { readability = 65; issues.push({ type: 'warning', msg: `Sentences a bit long (avg ${avgWPS.toFixed(0)} words)` }); }
  else if (avgWPS > 5) { issues.push({ type: 'good', msg: `Readability good (avg ${avgWPS.toFixed(0)} words/sentence)` }); }

  const kwCount = fk ? words.filter(w => w.toLowerCase().includes(fk)).length : 0;
  const density = wc > 0 ? (kwCount / wc) * 100 : 0;
  if (fk) {
    if (density >= 1 && density <= 3) issues.push({ type: 'good', msg: `Keyword density: ${density.toFixed(1)}% (ideal 1–3%)` });
    else if (density > 0) { score -= 4; issues.push({ type: 'warning', msg: `Keyword density: ${density.toFixed(1)}% (ideal: 1–3%)` }); }
    else { score -= 8; issues.push({ type: 'warning', msg: 'Keyword not found in description' }); }
  }

  if (content.bulletFeatures.length >= 4) issues.push({ type: 'good', msg: `${content.bulletFeatures.length} bullet features ✓` });
  else if (content.bulletFeatures.length > 0) { score -= 3; issues.push({ type: 'warning', msg: `Only ${content.bulletFeatures.length} features listed (aim for 6+)` }); }

  return {
    overall: Math.max(0, Math.min(100, score)),
    readability: Math.max(0, Math.min(100, readability)),
    keywordDensity: density,
    metaLength: ml,
    titleLength: tl,
    missingAlt: seo.imageAlt ? 0 : 1,
    issues,
  };
}

function _genProductSchema(p: Product, seo: SEOData, c: ContentData): string {
  return JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": seo.title || p.name,
    "description": c.shortDescription || p.shortDesc,
    "image": p.images?.length ? [p.images[0]] : [],
    "sku": p.id,
    "brand": { "@type": "Brand", "name": p.brand || "Luxedge" },
    "offers": {
      "@type": "Offer",
      "url": `https://luxedge.us/#/products/${p.id}`,
      "priceCurrency": "USD",
      "price": p.price.toFixed(2),
      "priceValidUntil": new Date(Date.now() + 86400000 * 90).toISOString().split('T')[0],
      "availability": p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "seller": { "@type": "Organization", "name": "Luxedge" }
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": p.rating.toString(),
      "reviewCount": p.reviews.toString(),
      "bestRating": "5",
      "worstRating": "1"
    }
  }, null, 2);
}

function _genBreadcrumbSchema(p: Product, seo: SEOData): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://luxedge.us" },
      { "@type": "ListItem", "position": 2, "name": p.category, "item": `https://luxedge.us/#/category/${p.category.toLowerCase().replace(/\s+/g,'-')}` },
      { "@type": "ListItem", "position": 3, "name": seo.title || p.name, "item": `https://luxedge.us/#/products/${seo.slug || p.id}` }
    ]
  }, null, 2);
}

function _genOrgSchema(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Luxedge",
    "url": "https://luxedge.us",
    "logo": { "@type": "ImageObject", "url": "https://luxedge.us/logo.png" },
    "contactPoint": { "@type": "ContactPoint", "contactType": "customer service", "email": "support@luxedge.us", "availableLanguage": "English" },
    "address": { "@type": "PostalAddress", "addressCountry": "US" },
    "sameAs": ["https://twitter.com/luxedge", "https://facebook.com/luxedge", "https://instagram.com/luxedge"]
  }, null, 2);
}

function _genWebsiteSchema(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Luxedge",
    "url": "https://luxedge.us",
    "description": "Premium pet essentials for dogs and cats",
    "potentialAction": {
      "@type": "SearchAction",
      "target": { "@type": "EntryPoint", "urlTemplate": "https://luxedge.us/#/search?q={search_term_string}" },
      "query-input": "required name=search_term_string"
    }
  }, null, 2);
}

function _genFAQSchema(faqs: { q: string; a: string }[]): string {
  if (!faqs.length) return '';
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(f => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a }
    }))
  }, null, 2);
}

function _tryValidate(json: string): boolean {
  if (!json.trim()) return false;
  try { JSON.parse(json); return true; } catch { return false; }
}

function ASEOEngine() {
  const { products, setProducts, notify } = useApp();
  const navigate = useNavigate();

  const [selId, setSelId] = useState('');
  const [tab, setTab] = useState<SEOTab>('seo');
  const [tone, setTone] = useState<ToneOption>('Luxury');
  const [previewMode, setPreviewMode] = useState<'desktop'|'mobile'|'facebook'|'twitter'>('desktop');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSection, setAiSection] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [newKw, setNewKw] = useState('');
  const [newSecKw, setNewSecKw] = useState('');
  const [copied, setCopied] = useState('');
  const [schemaValid, setSchemaValid] = useState<Record<SchemaKey, boolean>>({ product: false, breadcrumb: false, organization: false, website: false, faq: false });
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });

  const [seo, setSeo] = useState<SEOData>({
    title: '', metaDescription: '', keywords: [], slug: '', canonicalUrl: '',
    focusKeyword: '', secondaryKeywords: [], imageAlt: '', imageTitle: '', imageCaption: '',
  });
  const [social, setSocial] = useState<SocialSEO>({
    ogTitle: '', ogDescription: '', ogImage: '',
    twitterCard: 'summary_large_image', twitterTitle: '', twitterDescription: '',
    pinterestDescription: '', pinterestImage: '',
  });
  const [content, setContent] = useState<ContentData>({
    premiumTitle: '', luxuryDescription: '', shortDescription: '',
    bulletFeatures: [], specifications: {}, benefits: [],
    useCases: [], careInstructions: '', packageContents: [],
    warrantyText: '', shippingInfo: '', focusKeyword: '', faqs: [],
  });
  const [schemas, setSchemas] = useState<StructuredSchemas>({
    product: '', breadcrumb: '', organization: _genOrgSchema(), website: _genWebsiteSchema(), faq: '',
  });
  const [score, setScore] = useState<SEOScore>({
    overall: 0, readability: 0, keywordDensity: 0, metaLength: 0, titleLength: 0, missingAlt: 0, issues: [],
  });

  const selProduct = products.find(p => p.id === selId);

  // Auto-populate from product
  useEffect(() => {
    const p = products.find(x => x.id === selId);
    if (!p) return;
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    setSeo(prev => ({
      ...prev,
      title: prev.title || p.name,
      slug: prev.slug || slug,
      canonicalUrl: `https://luxedge.us/#/products/${slug}`,
      imageAlt: prev.imageAlt || (p.name + ' product image'),
      imageTitle: prev.imageTitle || p.name,
    }));
    setSocial(prev => ({
      ...prev,
      ogTitle: prev.ogTitle || p.name,
      ogDescription: prev.ogDescription || p.shortDesc,
      ogImage: prev.ogImage || (p.images?.[0] || ''),
      twitterTitle: prev.twitterTitle || p.name,
      twitterDescription: prev.twitterDescription || p.shortDesc,
      pinterestImage: prev.pinterestImage || (p.images?.[0] || ''),
    }));
    setContent(prev => ({
      ...prev,
      premiumTitle: prev.premiumTitle || p.name,
      shortDescription: prev.shortDescription || p.shortDesc,
    }));
  }, [selId, products]);

  // Live SEO score
  useEffect(() => {
    setScore(_computeSEO(seo, content));
  }, [seo, content]);

  function generateSchemas() {
    if (!selProduct) return;
    const faqJson = _genFAQSchema(content.faqs);
    const next: StructuredSchemas = {
      product: _genProductSchema(selProduct, seo, content),
      breadcrumb: _genBreadcrumbSchema(selProduct, seo),
      organization: _genOrgSchema(),
      website: _genWebsiteSchema(),
      faq: faqJson,
    };
    setSchemas(next);
    const valid: Record<SchemaKey, boolean> = { product: false, breadcrumb: false, organization: false, website: false, faq: false };
    SEO_SCHEMA_KEYS.forEach(k => { valid[k] = _tryValidate(next[k]); });
    setSchemaValid(valid);
    notify('Schemas generated & validated', 'success');
  }

  async function generateAll() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const prompt = `You are a luxury e-commerce SEO expert for Luxedge (premium US dropshipping brand).

Generate complete SEO content for this product:
Name: ${selProduct.name}
Category: ${selProduct.category}
Price: $${selProduct.price} (was $${selProduct.originalPrice})
Description: ${selProduct.shortDesc}
Brand: ${selProduct.brand}
Rating: ${selProduct.rating}/5 (${selProduct.reviews} reviews)
Writing Tone: ${tone}

Return ONLY valid JSON (no markdown):
{
  "premiumTitle": "...",
  "luxuryDescription": "...",
  "shortDescription": "...",
  "bulletFeatures": ["feature 1","feature 2","feature 3","feature 4","feature 5","feature 6"],
  "specifications": {"Spec Name":"Value"},
  "benefits": ["benefit 1","benefit 2","benefit 3","benefit 4"],
  "useCases": ["use case 1","use case 2","use case 3"],
  "careInstructions": "...",
  "packageContents": ["item 1","item 2"],
  "warrantyText": "...",
  "shippingInfo": "...",
  "faqs": [{"q":"question?","a":"answer."},{"q":"question?","a":"answer."},{"q":"question?","a":"answer."}],
  "seoTitle": "...",
  "metaDescription": "...",
  "keywords": ["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8"],
  "slug": "url-friendly-slug",
  "focusKeyword": "primary keyword",
  "secondaryKeywords": ["secondary1","secondary2","secondary3"],
  "imageAlt": "...",
  "imageTitle": "...",
  "imageCaption": "...",
  "ogTitle": "...",
  "ogDescription": "...",
  "twitterTitle": "...",
  "twitterDescription": "...",
  "pinterestDescription": "..."
}

Rules:
- Tone: ${tone}
- luxuryDescription: 200+ words, compelling, conversion-focused, ${tone} voice
- seoTitle: 50-60 chars, include focus keyword near start
- metaDescription: 120-160 chars, include CTA
- All copy must target US market
- Return ONLY the JSON`;

    setAiLoading(true); setAiSection('all'); setAiStatus('Generating all SEO content…');
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const d = JSON.parse(cleaned) as Record<string, unknown>;
      const arr = (k: string): string[] => Array.isArray(d[k]) ? (d[k] as string[]) : [];
      const str = (k: string): string => typeof d[k] === 'string' ? d[k] as string : '';
      const obj = (k: string): Record<string,string> => (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) ? d[k] as Record<string,string> : {};
      const faqArr = (d['faqs'] as {q:string;a:string}[] | undefined) || [];

      setContent({
        premiumTitle: str('premiumTitle'), luxuryDescription: str('luxuryDescription'),
        shortDescription: str('shortDescription'), bulletFeatures: arr('bulletFeatures'),
        specifications: obj('specifications'), benefits: arr('benefits'),
        useCases: arr('useCases'), careInstructions: str('careInstructions'),
        packageContents: arr('packageContents'), warrantyText: str('warrantyText'),
        shippingInfo: str('shippingInfo'), focusKeyword: str('focusKeyword'), faqs: faqArr,
      });
      setSeo(prev => ({
        ...prev,
        title: str('seoTitle') || prev.title,
        metaDescription: str('metaDescription') || prev.metaDescription,
        keywords: arr('keywords').length ? arr('keywords') : prev.keywords,
        slug: str('slug') || prev.slug,
        focusKeyword: str('focusKeyword') || prev.focusKeyword,
        secondaryKeywords: arr('secondaryKeywords').length ? arr('secondaryKeywords') : prev.secondaryKeywords,
        imageAlt: str('imageAlt') || prev.imageAlt,
        imageTitle: str('imageTitle') || prev.imageTitle,
        imageCaption: str('imageCaption') || prev.imageCaption,
        canonicalUrl: `https://luxedge.us/#/products/${str('slug') || prev.slug}`,
      }));
      setSocial(prev => ({
        ...prev,
        ogTitle: str('ogTitle') || prev.ogTitle,
        ogDescription: str('ogDescription') || prev.ogDescription,
        twitterTitle: str('twitterTitle') || prev.twitterTitle,
        twitterDescription: str('twitterDescription') || prev.twitterDescription,
        pinterestDescription: str('pinterestDescription') || prev.pinterestDescription,
      }));
      notify('All SEO content generated!', 'success');
    } catch (e: any) {
      notify(`AI error: ${e.message}`, 'error');
    } finally {
      setAiLoading(false); setAiSection(''); setAiStatus('');
    }
  }

  async function regenSection(section: string, fieldHint: string) {
    if (!selProduct) return;
    const prompt = `You are a luxury e-commerce copywriter. Rewrite only the ${section} for this product in ${tone} tone.
Product: ${selProduct.name} ($${selProduct.price})
Category: ${selProduct.category}
${content.focusKeyword ? `Focus keyword: ${seo.focusKeyword}` : ''}

Return ONLY a JSON object with a single key "${fieldHint}".
Example: {"${fieldHint}": "your content here"}`;
    setAiLoading(true); setAiSection(section); setAiStatus(`Regenerating ${section}…`);
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const d = JSON.parse(cleaned) as Record<string, unknown>;
      const val = d[fieldHint];
      if (fieldHint === 'bulletFeatures' || fieldHint === 'benefits' || fieldHint === 'useCases' || fieldHint === 'packageContents') {
        setContent(prev => ({ ...prev, [fieldHint]: Array.isArray(val) ? val : prev[fieldHint as keyof ContentData] }));
      } else {
        setContent(prev => ({ ...prev, [fieldHint]: typeof val === 'string' ? val : prev[fieldHint as keyof ContentData] }));
      }
      notify(`${section} regenerated`, 'success');
    } catch (e: any) { notify(`AI error: ${e.message}`, 'error'); }
    finally { setAiLoading(false); setAiSection(''); setAiStatus(''); }
  }

  function copySchema(key: SchemaKey) {
    const text = schemas[key];
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => notify('Copy failed — use Ctrl+A in the text area', 'error'));
  }

  function saveToProduct() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const updates: Partial<Product> = {};
    if (content.premiumTitle) updates.name = content.premiumTitle;
    if (content.luxuryDescription) updates.description = content.luxuryDescription;
    if (content.shortDescription) updates.shortDesc = content.shortDescription;
    setProducts(prev => prev.map(p => p.id === selProduct.id ? { ...p, ...updates } : p));
    localStorage.setItem(`luxedge_seo_${selProduct.id}`, JSON.stringify({ seo, social, schemas, content }));
    notify(`SEO data saved to "${selProduct.name}"`, 'success');
  }

  // ── Reusable UI pieces ───────────────────────────────────────────────────
  const RegenBtn = ({ section, field }: { section: string; field: string }) => (
    <button onClick={() => regenSection(section, field)} disabled={aiLoading}
      className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 px-2 py-1 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-40 transition-colors">
      {aiLoading && aiSection === section ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
      Regen
    </button>
  );

  const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );

  const inp = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none';
  const ta = inp + ' resize-none';

  const ScoreCircle = ({ label, value, unit = '' }: { label: string; value: number; unit?: string }) => (
    <div className={`rounded-xl border p-3 text-center ${_scoreBg(value)}`}>
      <p className={`text-2xl font-bold ${_scoreColor(value)}`}>{Math.round(value)}{unit}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );

  const TAB_ITEMS: { key: SEOTab; label: string }[] = [
    { key: 'seo', label: '🔍 SEO' },
    { key: 'schema', label: '{ } Schema' },
    { key: 'social', label: '📱 Social' },
    { key: 'content', label: '✍️ Content' },
    { key: 'analysis', label: '📊 Analysis' },
    { key: 'preview', label: '👁 Preview' },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Search size={24} className="text-purple-600" /> Enterprise SEO & Content Engine
          </h1>
          <p className="text-gray-500 text-sm mt-1">AI-powered SEO · Structured Data · Social SEO · Content · Live Analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveToProduct} disabled={!selId}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Save size={15} /> Save to Product
          </button>
          <button onClick={() => navigate('/admin/products')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 px-3 py-2 border border-gray-200 rounded-xl transition-colors">
            <ArrowLeft size={15} /> Back
          </button>
        </div>
      </div>

      {/* Product selector + AI generate bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Product</label>
          <select value={selId} onChange={e => setSelId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
            <option value="">-- Select a product --</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} · ${p.price}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI Tone</label>
          <select value={tone} onChange={e => setTone(e.target.value as ToneOption)}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
            {SEO_TONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={generateAll} disabled={aiLoading || !selId}
          className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition-colors whitespace-nowrap">
          {aiLoading && aiSection === 'all' ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
          {aiLoading && aiSection === 'all' ? aiStatus || 'Generating…' : 'Generate All with AI'}
        </button>
        {selProduct && (
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-xl border border-purple-100 text-xs">
            {selProduct.images?.[0] && <img src={selProduct.images[0]} alt="" className="w-8 h-8 object-cover rounded-lg" />}
            <div>
              <p className="font-semibold text-gray-900 max-w-32 truncate">{selProduct.name}</p>
              <p className="text-purple-600">${selProduct.price} · {selProduct.category}</p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl flex-wrap">
        {TAB_ITEMS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 min-w-fit px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === t.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Product SEO ──────────────────────────────────────────────── */}
      {tab === 'seo' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Globe size={18} className="text-purple-600" /> Product SEO Fields</h2>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${_scoreBg(score.overall)} ${_scoreColor(score.overall)}`}>
              SEO Score: {score.overall}/100
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="SEO Title (50–60 chars)">
              <div className="relative">
                <input value={seo.title} onChange={e => setSeo(p => ({...p, title: e.target.value}))} className={inp} placeholder="Enter SEO title…" maxLength={80} />
                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold ${seo.title.length >= 50 && seo.title.length <= 60 ? 'text-green-600' : seo.title.length > 0 ? 'text-blue-500' : 'text-gray-400'}`}>{seo.title.length}</span>
              </div>
            </FieldRow>
            <FieldRow label="URL Slug">
              <input value={seo.slug} onChange={e => setSeo(p => ({...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')}))} className={inp} placeholder="url-friendly-slug" />
            </FieldRow>
            <FieldRow label="Meta Description (120–160 chars)">
              <div className="relative">
                <textarea value={seo.metaDescription} onChange={e => setSeo(p => ({...p, metaDescription: e.target.value}))} rows={3} className={ta} placeholder="Compelling meta description with CTA…" />
                <span className={`absolute right-3 bottom-3 text-xs font-bold ${seo.metaDescription.length >= 120 && seo.metaDescription.length <= 160 ? 'text-green-600' : seo.metaDescription.length > 0 ? 'text-blue-500' : 'text-gray-400'}`}>{seo.metaDescription.length}/160</span>
              </div>
            </FieldRow>
            <FieldRow label="Canonical URL">
              <input value={seo.canonicalUrl} onChange={e => setSeo(p => ({...p, canonicalUrl: e.target.value}))} className={inp} placeholder="https://luxedge.us/#/products/…" />
            </FieldRow>
            <FieldRow label="Focus Keyword">
              <input value={seo.focusKeyword} onChange={e => setSeo(p => ({...p, focusKeyword: e.target.value}))} className={inp} placeholder="Primary SEO keyword" />
            </FieldRow>
            <FieldRow label="Image ALT Text">
              <input value={seo.imageAlt} onChange={e => setSeo(p => ({...p, imageAlt: e.target.value}))} className={inp} placeholder="Descriptive ALT text for main image" />
            </FieldRow>
            <FieldRow label="Image Title">
              <input value={seo.imageTitle} onChange={e => setSeo(p => ({...p, imageTitle: e.target.value}))} className={inp} placeholder="Image title attribute" />
            </FieldRow>
            <FieldRow label="Image Caption">
              <input value={seo.imageCaption} onChange={e => setSeo(p => ({...p, imageCaption: e.target.value}))} className={inp} placeholder="Optional image caption" />
            </FieldRow>
          </div>
          {/* Keywords */}
          <FieldRow label="SEO Keywords">
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-8">
              {seo.keywords.map(k => (
                <span key={k} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs px-2.5 py-1 rounded-full border border-purple-100">
                  {k}<button onClick={() => setSeo(p => ({...p, keywords: p.keywords.filter(x => x !== k)}))} className="hover:text-red-500"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newKw} onChange={e => setNewKw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newKw.trim()) { setSeo(p => ({...p, keywords: [...p.keywords, newKw.trim()]})); setNewKw(''); e.preventDefault(); }}} placeholder="Add keyword…" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={() => { if (newKw.trim()) { setSeo(p => ({...p, keywords: [...p.keywords, newKw.trim()]})); setNewKw(''); }}} className="px-4 py-2 bg-purple-600 text-white rounded-xl text-sm hover:bg-purple-700"><Plus size={14} /></button>
            </div>
          </FieldRow>
          {/* Secondary Keywords */}
          <FieldRow label="Secondary Keywords">
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-8">
              {seo.secondaryKeywords.map(k => (
                <span key={k} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-full border border-indigo-100">
                  {k}<button onClick={() => setSeo(p => ({...p, secondaryKeywords: p.secondaryKeywords.filter(x => x !== k)}))} className="hover:text-red-500"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newSecKw} onChange={e => setNewSecKw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newSecKw.trim()) { setSeo(p => ({...p, secondaryKeywords: [...p.secondaryKeywords, newSecKw.trim()]})); setNewSecKw(''); e.preventDefault(); }}} placeholder="Add secondary keyword…" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={() => { if (newSecKw.trim()) { setSeo(p => ({...p, secondaryKeywords: [...p.secondaryKeywords, newSecKw.trim()]})); setNewSecKw(''); }}} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm hover:bg-indigo-700"><Plus size={14} /></button>
            </div>
          </FieldRow>
        </div>
      )}

      {/* ── TAB: Structured Data ─────────────────────────────────────────── */}
      {tab === 'schema' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Code size={18} className="text-purple-600" /> JSON-LD Structured Data</h2>
            <button onClick={generateSchemas} disabled={!selId}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50">
              <RefreshCw size={14} /> Generate All Schemas
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {SEO_SCHEMA_KEYS.map(key => (
              <div key={key} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 capitalize">{key === 'faq' ? 'FAQ' : key} Schema</span>
                    {schemas[key] && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${schemaValid[key] ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {schemaValid[key] ? '✓ Valid' : '✗ Invalid'}
                      </span>
                    )}
                    {key === 'faq' && !content.faqs.length && <span className="text-xs text-gray-400 italic">(no FAQs — generate AI content first)</span>}
                  </div>
                  <button onClick={() => copySchema(key)} disabled={!schemas[key]}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40">
                    <Clipboard size={12} /> {copied === key ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="p-4 text-xs text-gray-700 bg-gray-50 overflow-x-auto max-h-56 font-mono leading-relaxed">
                  {schemas[key] || <span className="text-gray-400 italic">Not generated yet — click "Generate All Schemas"</span>}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: Social SEO ──────────────────────────────────────────────── */}
      {tab === 'social' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><Share2 size={18} className="text-purple-600" /> Social SEO</h2>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Open Graph (Facebook / LinkedIn)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="OG Title (60–90 chars)"><input value={social.ogTitle} onChange={e => setSocial(p => ({...p, ogTitle: e.target.value}))} className={inp} placeholder="Open Graph title" /></FieldRow>
              <FieldRow label="OG Image URL"><input value={social.ogImage} onChange={e => setSocial(p => ({...p, ogImage: e.target.value}))} className={inp} placeholder="https://…" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="OG Description (100–200 chars)"><textarea value={social.ogDescription} onChange={e => setSocial(p => ({...p, ogDescription: e.target.value}))} rows={2} className={ta} placeholder="Engaging social description" /></FieldRow>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Twitter / X Card</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="Card Type">
                <select value={social.twitterCard} onChange={e => setSocial(p => ({...p, twitterCard: e.target.value}))} className={inp + ' bg-white'}>
                  <option value="summary_large_image">Summary Large Image</option>
                  <option value="summary">Summary</option>
                  <option value="product">Product</option>
                </select>
              </FieldRow>
              <FieldRow label="Twitter Title"><input value={social.twitterTitle} onChange={e => setSocial(p => ({...p, twitterTitle: e.target.value}))} className={inp} placeholder="Twitter card title" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="Twitter Description"><textarea value={social.twitterDescription} onChange={e => setSocial(p => ({...p, twitterDescription: e.target.value}))} rows={2} className={ta} placeholder="Twitter card description" /></FieldRow>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Pinterest Rich Pin</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="Pinterest Image URL"><input value={social.pinterestImage} onChange={e => setSocial(p => ({...p, pinterestImage: e.target.value}))} className={inp} placeholder="https://…" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="Pinterest Description"><textarea value={social.pinterestDescription} onChange={e => setSocial(p => ({...p, pinterestDescription: e.target.value}))} rows={2} className={ta} placeholder="Pinterest description with keywords" /></FieldRow>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: AI Content ──────────────────────────────────────────────── */}
      {tab === 'content' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Sparkles size={18} className="text-purple-600" /> AI Content</h2>
            {aiLoading && aiSection !== 'all' && <p className="text-xs text-purple-600 animate-pulse">{aiStatus}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4">
            {[
              { label: 'Premium Product Title', field: 'premiumTitle', section: 'Premium Title', type: 'input' },
              { label: 'Short Description (2–3 sentences)', field: 'shortDescription', section: 'Short Description', type: 'textarea2' },
              { label: 'Luxury Product Description (200+ words)', field: 'luxuryDescription', section: 'Luxury Description', type: 'textarea6' },
              { label: 'Care Instructions', field: 'careInstructions', section: 'Care Instructions', type: 'textarea2' },
              { label: 'Warranty Text', field: 'warrantyText', section: 'Warranty Text', type: 'textarea2' },
              { label: 'Shipping Information', field: 'shippingInfo', section: 'Shipping Info', type: 'textarea2' },
            ].map(({ label, field, section, type }) => (
              <div key={field} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">{label}</label>
                  <RegenBtn section={section} field={field} />
                </div>
                {type === 'input' ? (
                  <input value={(content[field as keyof ContentData] as string) || ''} onChange={e => setContent(p => ({...p, [field]: e.target.value}))} className={inp} placeholder={`AI will generate ${label.toLowerCase()}…`} />
                ) : (
                  <textarea value={(content[field as keyof ContentData] as string) || ''} onChange={e => setContent(p => ({...p, [field]: e.target.value}))} rows={type === 'textarea6' ? 6 : 2} className={ta} placeholder={`AI will generate ${label.toLowerCase()}…`} />
                )}
              </div>
            ))}
            {/* Bullet Features */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Bullet Features</label>
                <RegenBtn section="Bullet Features" field="bulletFeatures" />
              </div>
              <div className="space-y-2">
                {content.bulletFeatures.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-purple-400 text-sm">•</span>
                    <input value={f} onChange={e => setContent(p => ({...p, bulletFeatures: p.bulletFeatures.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, bulletFeatures: p.bulletFeatures.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, bulletFeatures: [...p.bulletFeatures, '']}))} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"><Plus size={12} /> Add Feature</button>
              </div>
            </div>
            {/* Benefits */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Benefits</label>
                <RegenBtn section="Benefits" field="benefits" />
              </div>
              <div className="space-y-2">
                {content.benefits.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-green-400 text-sm">✓</span>
                    <input value={b} onChange={e => setContent(p => ({...p, benefits: p.benefits.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, benefits: p.benefits.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, benefits: [...p.benefits, '']}))} className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1"><Plus size={12} /> Add Benefit</button>
              </div>
            </div>
            {/* Use Cases */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Use Cases</label>
                <RegenBtn section="Use Cases" field="useCases" />
              </div>
              <div className="space-y-2">
                {content.useCases.map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-blue-400 text-sm">→</span>
                    <input value={u} onChange={e => setContent(p => ({...p, useCases: p.useCases.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, useCases: p.useCases.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, useCases: [...p.useCases, '']}))} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"><Plus size={12} /> Add Use Case</button>
              </div>
            </div>
            {/* Specs */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Technical Specifications</label>
                <RegenBtn section="Specifications" field="specifications" />
              </div>
              <div className="space-y-2">
                {Object.entries(content.specifications).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <input value={k} readOnly className="w-36 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs bg-gray-50 font-medium text-gray-600" />
                    <span className="text-gray-400">:</span>
                    <input value={v} onChange={e => setContent(p => ({ ...p, specifications: { ...p.specifications, [k]: e.target.value } }))} className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => { const s = {...p.specifications}; delete s[k]; return {...p, specifications: s}; })} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                {!Object.keys(content.specifications).length && <p className="text-xs text-gray-400 italic">No specs yet — use AI Generate or add manually</p>}
              </div>
            </div>
            {/* Package Contents */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Package Contents</label>
                <RegenBtn section="Package Contents" field="packageContents" />
              </div>
              <div className="space-y-2">
                {content.packageContents.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">📦</span>
                    <input value={item} onChange={e => setContent(p => ({...p, packageContents: p.packageContents.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, packageContents: p.packageContents.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, packageContents: [...p.packageContents, '']}))} className="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"><Plus size={12} /> Add Item</button>
              </div>
            </div>
            {/* FAQs */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">FAQs (used in FAQ Schema)</label>
                <RegenBtn section="FAQs" field="faqs" />
              </div>
              <div className="space-y-3">
                {content.faqs.map((faq, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <input value={faq.q} onChange={e => setContent(p => ({...p, faqs: p.faqs.map((x,j) => j===i ? {...x, q: e.target.value} : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white font-medium focus:ring-1 focus:ring-purple-500 focus:outline-none" placeholder="Question?" />
                      <button onClick={() => setContent(p => ({...p, faqs: p.faqs.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500 mt-1"><X size={14} /></button>
                    </div>
                    <textarea value={faq.a} onChange={e => setContent(p => ({...p, faqs: p.faqs.map((x,j) => j===i ? {...x, a: e.target.value} : x)}))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none resize-none" placeholder="Answer…" />
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, faqs: [...p.faqs, {q:'', a:''}]}))} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"><Plus size={12} /> Add FAQ</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: SEO Analysis ────────────────────────────────────────────── */}
      {tab === 'analysis' && (
        <div className="space-y-4">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><TrendingUp size={18} className="text-purple-600" /> Live SEO Analysis</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <ScoreCircle label="SEO Score" value={score.overall} />
            <ScoreCircle label="Readability" value={score.readability} />
            <ScoreCircle label="KW Density" value={score.keywordDensity} unit="%" />
            <ScoreCircle label="Meta Chars" value={score.metaLength >= 120 && score.metaLength <= 160 ? 100 : score.metaLength >= 80 ? 65 : 30} />
            <ScoreCircle label="Title Chars" value={score.titleLength >= 50 && score.titleLength <= 60 ? 100 : score.titleLength >= 30 ? 65 : 30} />
            <ScoreCircle label="Image ALT" value={score.missingAlt === 0 ? 100 : 0} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.titleLength}</p>
              <p className="text-xs text-gray-500">Title length <span className="text-gray-400">(ideal 50–60)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.titleLength >= 50 && score.titleLength <= 60 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, (score.titleLength/70)*100)}%` }} /></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.metaLength}</p>
              <p className="text-xs text-gray-500">Meta length <span className="text-gray-400">(ideal 120–160)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.metaLength >= 120 && score.metaLength <= 160 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, (score.metaLength/200)*100)}%` }} /></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.keywordDensity.toFixed(1)}%</p>
              <p className="text-xs text-gray-500">Keyword density <span className="text-gray-400">(ideal 1–3%)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.keywordDensity >= 1 && score.keywordDensity <= 3 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, score.keywordDensity * 25)}%` }} /></div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Issues & Recommendations</h3>
            {score.issues.length === 0 ? (
              <p className="text-gray-400 text-sm italic">Generate content to see analysis…</p>
            ) : (
              <div className="space-y-1.5">
                {score.issues.map((issue, i) => (
                  <div key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${issue.type === 'good' ? 'bg-green-50' : issue.type === 'warning' ? 'bg-sky-50' : 'bg-red-50'}`}>
                    <span>{_issueIcon(issue.type)}</span>
                    <span className={issue.type === 'good' ? 'text-green-800' : issue.type === 'warning' ? 'text-blue-800' : 'text-red-800'}>{issue.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Internal Link Suggestions */}
          {selProduct && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Link2 size={15} /> Internal Link Suggestions</h3>
              <div className="space-y-2">
                {products.filter(p => p.id !== selId && p.category === selProduct.category).slice(0,4).map(p => (
                  <div key={p.id} className="flex items-center gap-3 text-sm p-2 rounded-lg hover:bg-gray-50">
                    <span className="text-purple-400">→</span>
                    <span className="text-gray-700">{p.name}</span>
                    <span className="text-gray-400 text-xs ml-auto font-mono">/#/products/{p.id}</span>
                  </div>
                ))}
                {!products.filter(p => p.id !== selId && p.category === selProduct.category).length && <p className="text-gray-400 text-sm italic">No related products in same category</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Preview ─────────────────────────────────────────────────── */}
      {tab === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {([['desktop','💻 Desktop'],['mobile','📱 Mobile'],['facebook','👥 Facebook'],['twitter','🐦 Twitter']] as const).map(([mode, label]) => (
              <button key={mode} onClick={() => setPreviewMode(mode)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${previewMode === mode ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-purple-50'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Google Desktop Preview */}
          {previewMode === 'desktop' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Monitor size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Google Search — Desktop</span>
              </div>
              <div className="border border-gray-200 rounded-xl p-5 max-w-2xl bg-white font-sans">
                <p className="text-xs text-gray-500 mb-1">https://luxedge.us › products › {seo.slug || 'product'}</p>
                <p className="text-xl text-blue-700 hover:underline cursor-pointer font-medium leading-tight mb-1">{seo.title || selProduct?.name || 'SEO Title will appear here'}</p>
                <p className="text-sm text-gray-600 leading-relaxed">{seo.metaDescription || 'Meta description will appear here. It shows up to 160 characters in Google search results.'}</p>
              </div>
              <p className="text-xs text-gray-400 mt-3">Title: {seo.title.length}/60 chars · Meta: {seo.metaDescription.length}/160 chars</p>
            </div>
          )}

          {/* Google Mobile Preview */}
          {previewMode === 'mobile' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Smartphone size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Google Search — Mobile</span>
              </div>
              <div className="max-w-sm mx-auto">
                <div className="border border-gray-200 rounded-2xl p-4 bg-white font-sans shadow-sm">
                  <p className="text-xs text-green-600 mb-0.5">luxedge.us › {seo.slug || 'products'}</p>
                  <p className="text-base text-blue-700 font-medium leading-tight mb-1 line-clamp-2">{seo.title || 'SEO Title'}</p>
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{seo.metaDescription || 'Meta description shown in mobile search results.'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Facebook Preview */}
          {previewMode === 'facebook' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Share2 size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Facebook / Open Graph Preview</span>
              </div>
              <div className="max-w-lg mx-auto border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm">
                {social.ogImage ? (
                  <img src={social.ogImage} alt="" className="w-full h-52 object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                ) : (
                  <div className="w-full h-52 bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center">
                    <p className="text-gray-400 text-sm">1200×630 OG Image</p>
                  </div>
                )}
                <div className="p-3 bg-gray-50 border-t border-gray-200">
                  <p className="text-xs text-gray-500 uppercase">LUXEDGE.US</p>
                  <p className="font-bold text-gray-900 text-sm leading-tight mt-0.5">{social.ogTitle || seo.title || 'OG Title'}</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{social.ogDescription || seo.metaDescription || 'OG Description'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Twitter Preview */}
          {previewMode === 'twitter' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-gray-400 text-sm font-bold">𝕏</span>
                <span className="text-sm font-medium text-gray-500">Twitter / X Card Preview</span>
              </div>
              <div className="max-w-lg mx-auto border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                {social.ogImage ? (
                  <img src={social.ogImage} alt="" className="w-full h-48 object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                ) : (
                  <div className="w-full h-48 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                    <p className="text-gray-400 text-sm">Twitter Card Image</p>
                  </div>
                )}
                <div className="p-3">
                  <p className="font-bold text-gray-900 text-sm">{social.twitterTitle || seo.title || 'Twitter Title'}</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{social.twitterDescription || seo.metaDescription || 'Twitter description'}</p>
                  <p className="text-xs text-gray-400 mt-1">luxedge.us</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ============================================================================
// ENTERPRISE VARIANT GENERATOR
// ============================================================================
const VARIANT_ATTRIBUTE_PRESETS: Record<string, string[]> = {
  Colors: ['Black','White','Gray','Navy','Red','Blue','Green','Yellow','Pink','Purple','Orange','Brown','Beige','Gold','Silver'],
  Sizes: ['XS','S','M','L','XL','XXL','XXXL','One Size','6','7','8','9','10','11','12'],
  Materials: ['Cotton','Polyester','Nylon','Leather','Stainless Steel','Aluminum','Silicone','Wood','Bamboo','Canvas','Linen'],
  Storage: ['16GB','32GB','64GB','128GB','256GB','512GB','1TB'],
  Styles: ['Classic','Modern','Vintage','Minimalist','Sport','Casual','Formal','Bohemian'],
  'Bundle Options': ['Single','2-Pack','3-Pack','5-Pack','10-Pack','Starter Kit','Pro Kit','Family Pack'],
};

const ATTR_ICONS: Record<string, string> = {
  Colors: '🎨', Sizes: '📏', Materials: '🧵', Storage: '💾', Styles: '✨', 'Bundle Options': '📦',
};

function _makeVid(): string {
  return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _cartesian(attrs: VariantAttribute[]): Record<string,string>[] {
  const active = attrs.filter(a => a.values.length > 0);
  if (!active.length) return [];
  return active.reduce<Record<string,string>[]>((acc, attr) => {
    if (!acc.length) return attr.values.map(v => ({ [attr.name]: v }));
    return acc.flatMap(combo => attr.values.map(v => ({ ...combo, [attr.name]: v })));
  }, []);
}

function _genSKU(base: string, combo: Record<string,string>, idx: number): string {
  const suffix = Object.values(combo).map(v => v.slice(0,3).toUpperCase().replace(/\s/g,'')).join('-');
  return base ? `${base}-${suffix}` : `SKU-${String(idx).padStart(3,'0')}-${suffix}`;
}

function _comboKey(combo: Record<string,string>): string {
  return Object.entries(combo).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join('|');
}

function _detectAttrsFromProduct(product: Product): VariantAttribute[] {
  const out: VariantAttribute[] = [];
  const colors = new Set<string>();
  const sizes = new Set<string>();
  (product.variants || []).forEach(pv => {
    if (pv.color) colors.add(pv.color);
    if (pv.size && pv.size !== 'One Size') sizes.add(pv.size);
  });
  if (colors.size) out.push({ id: _makeVid(), name: 'Colors', values: [...colors], autoDetected: true });
  if (sizes.size) out.push({ id: _makeVid(), name: 'Sizes', values: [...sizes], autoDetected: true });
  return out;
}

function AVariantGen() {
  const { products, setProducts, notify } = useApp();
  const navigate = useNavigate();

  type VGStep = 'product'|'attributes'|'matrix'|'done';
  const [step, setStep] = useState<VGStep>('product');
  const [selId, setSelId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualSku, setManualSku] = useState('');
  const [manualPrice, setManualPrice] = useState(0);
  const [attrs, setAttrs] = useState<VariantAttribute[]>([
    { id: _makeVid(), name: 'Colors', values: [], autoDetected: false },
    { id: _makeVid(), name: 'Sizes', values: [], autoDetected: false },
  ]);
  const [variants, setVariants] = useState<EnterpriseVariant[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newValInputs, setNewValInputs] = useState<Record<string,string>>({});
  const [editId, setEditId] = useState<string|null>(null);
  const [dupKeys, setDupKeys] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });

  const selProduct = products.find(p => p.id === selId);

  useEffect(() => {
    const p = products.find(x => x.id === selId);
    if (p) {
      const detected = _detectAttrsFromProduct(p);
      if (detected.length) {
        setAttrs(prev => [...detected, ...prev.filter(a => !a.autoDetected)]);
      }
      setManualSku(`PROD-${p.id}`);
      setManualPrice(p.price);
    }
  }, [selId, products]);

  useEffect(() => {
    const keys = variants.map(v => _comboKey(v.combo));
    const seen = new Set<string>();
    const dups = new Set<string>();
    keys.forEach(k => { if (seen.has(k)) dups.add(k); else seen.add(k); });
    setDupKeys(dups);
  }, [variants]);

  function generateMatrix() {
    const combos = _cartesian(attrs);
    if (!combos.length) { notify('Add at least one attribute with values first.', 'error'); return; }
    const base = selProduct ? selProduct.id.toUpperCase() : (manualSku || 'SKU');
    const basePrice = selProduct ? selProduct.price : manualPrice;
    setVariants(combos.map((combo, i) => ({
      id: _makeVid(),
      combo,
      sku: _genSKU(base, combo, i),
      barcode: '',
      costPrice: Math.round(basePrice * 0.45 * 100) / 100,
      sellingPrice: basePrice,
      comparePrice: Math.round(basePrice * 1.25 * 100) / 100,
      inventory: 50,
      weight: selProduct?.weight || '',
      dimensions: selProduct?.dimensions || '',
      image: selProduct?.images?.[0] || '',
      status: 'active' as const,
      lowStockThreshold: 5,
    })));
    setStep('matrix');
  }

  async function aiSuggest() {
    const info = selProduct
      ? `Product: ${selProduct.name}\nCategory: ${selProduct.category}\nDescription: ${selProduct.shortDesc}`
      : `Product: ${manualName}`;
    const prompt = `You are an expert e-commerce product specialist.

For this product, suggest variant attributes with specific realistic values:
${info}

Return ONLY valid JSON:
{
  "attributes": [
    {"name": "Colors", "values": ["Black", "White"]},
    {"name": "Sizes", "values": ["S", "M", "L"]}
  ]
}

Rules:
- Only include attributes that make sense for this specific product
- Provide realistic and specific values (not generic placeholders)
- Max 4 attribute groups, max 6 values each
- Focus on: Colors, Sizes, Materials, Storage, Styles, Bundle Options
- Return ONLY the JSON, no other text`;

    setAiLoading(true);
    setAiStatus('Analyzing product with AI…');
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const parsed = JSON.parse(cleaned) as { attributes: { name: string; values: string[] }[] };
      if (parsed.attributes?.length) {
        setAttrs(parsed.attributes.map(a => ({ id: _makeVid(), name: a.name, values: a.values, autoDetected: true })));
        notify(`AI suggested ${parsed.attributes.length} attribute groups`, 'success');
      }
    } catch (e: any) {
      notify(`AI error: ${e.message}`, 'error');
    } finally {
      setAiLoading(false);
      setAiStatus('');
    }
  }

  function addVal(attrId: string) {
    const val = (newValInputs[attrId] || '').trim();
    if (!val) return;
    setAttrs(prev => prev.map(a =>
      a.id === attrId && !a.values.includes(val) ? { ...a, values: [...a.values, val] } : a
    ));
    setNewValInputs(prev => ({ ...prev, [attrId]: '' }));
  }

  function removeVal(attrId: string, val: string) {
    setAttrs(prev => prev.map(a =>
      a.id === attrId ? { ...a, values: a.values.filter(v => v !== val) } : a
    ));
  }

  function removeAttr(attrId: string) {
    setAttrs(prev => prev.filter(a => a.id !== attrId));
  }

  function addAttr() {
    if (!newAttrName.trim()) return;
    setAttrs(prev => [...prev, { id: _makeVid(), name: newAttrName.trim(), values: [], autoDetected: false }]);
    setNewAttrName('');
  }

  function applyPresets(attrId: string, attrName: string) {
    const presets = VARIANT_ATTRIBUTE_PRESETS[attrName] || [];
    setAttrs(prev => prev.map(a =>
      a.id !== attrId ? a : { ...a, values: [...new Set([...a.values, ...presets])] }
    ));
  }

  function updateV(id: string, field: string, value: string | number) {
    setVariants(prev => prev.map(v => v.id === id ? ({ ...v, [field]: value } as EnterpriseVariant) : v));
  }

  function removeV(id: string) {
    setVariants(prev => prev.filter(v => v.id !== id));
  }

  function removeDuplicates() {
    setVariants(prev => {
      const seen = new Set<string>();
      const keep: EnterpriseVariant[] = [];
      for (const v of prev) {
        const k = _comboKey(v.combo);
        if (!seen.has(k)) { seen.add(k); keep.push(v); }
      }
      return keep;
    });
  }

  function saveToProduct() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const newVars: ProductVariant[] = variants.map(v => ({
      id: v.id,
      color: v.combo['Colors'] || v.combo[Object.keys(v.combo)[0]] || 'Default',
      size: v.combo['Sizes'] || v.combo[Object.keys(v.combo)[1]] || 'One Size',
      price: v.sellingPrice,
      salePrice: v.sellingPrice,
      stock: v.inventory,
      sku: v.sku,
      image: v.image || undefined,
    }));
    setProducts(prev => prev.map(p => p.id === selProduct.id ? { ...p, variants: newVars } : p));
    setSaved(true);
    setStep('done');
    notify(`Saved ${variants.length} variants to "${selProduct.name}"`, 'success');
  }

  function resetAll() {
    setSaved(false);
    setStep('product');
    setVariants([]);
    setSelId('');
    setManualName('');
    setManualSku('');
    setManualPrice(0);
    setAttrs([
      { id: _makeVid(), name: 'Colors', values: [], autoDetected: false },
      { id: _makeVid(), name: 'Sizes', values: [], autoDetected: false },
    ]);
  }

  const totalCombos = _cartesian(attrs).length;
  const dupCount = dupKeys.size;
  const editedV = variants.find(v => v.id === editId) ?? null;

  const VG_STEPS: { key: VGStep; label: string }[] = [
    { key: 'product', label: '1. Product' },
    { key: 'attributes', label: '2. Attributes' },
    { key: 'matrix', label: '3. Matrix' },
    { key: 'done', label: '4. Done' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layers size={24} className="text-purple-600" /> Enterprise Variant Generator
          </h1>
          <p className="text-gray-500 text-sm mt-1">Auto-detect attributes · AI suggestions · Complete variant matrix</p>
        </div>
        <button onClick={() => navigate('/admin/products')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Products
        </button>
      </div>

      {/* Step Progress */}
      <div className="flex items-center gap-0">
        {VG_STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <button
              onClick={() => { if (s.key !== 'done' || saved) setStep(s.key); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                step === s.key ? 'bg-purple-600 text-white' :
                (VG_STEPS.findIndex(x => x.key === step) > i) ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' :
                'text-gray-400 cursor-default'
              }`}
            >{s.label}</button>
            {i < VG_STEPS.length - 1 && <ChevronRight size={16} className="text-gray-400 mx-1" />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Product ─────────────────────────────────────────────────── */}
      {step === 'product' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Package size={18} className="text-purple-600" /> Select Product
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Existing Product</label>
                <select value={selId} onChange={e => setSelId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
                  <option value="">-- Select a product to generate variants for --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} · ${p.price}</option>)}
                </select>
              </div>
              {selProduct && (
                <div className="flex items-center gap-4 p-4 bg-purple-50 rounded-xl border border-purple-100">
                  {selProduct.images?.[0] && (
                    <img src={selProduct.images[0]} alt="" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">{selProduct.name}</p>
                    <p className="text-sm text-gray-500">{selProduct.category} · ${selProduct.price}</p>
                    <p className="text-xs text-purple-600 mt-1">
                      {selProduct.variants?.length || 0} existing variants · will be replaced on save
                    </p>
                  </div>
                </div>
              )}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Or set manually (for new products)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Product Name</label>
                    <input value={manualName} onChange={e => setManualName(e.target.value)}
                      placeholder="e.g. Premium T-Shirt"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Base SKU</label>
                    <input value={manualSku} onChange={e => setManualSku(e.target.value)}
                      placeholder="e.g. TSHIRT-001"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Base Price ($)</label>
                    <input type="number" value={manualPrice || ''} onChange={e => setManualPrice(parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (!selId && !manualName.trim()) { notify('Select a product or enter a product name', 'error'); return; }
                setStep('attributes');
              }}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"
            >
              Next: Configure Attributes <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Attributes ──────────────────────────────────────────────── */}
      {step === 'attributes' && (
        <div className="space-y-4">
          {/* AI Banner */}
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl p-5 flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="font-semibold">AI Attribute Suggestions</p>
              <p className="text-sm text-purple-100">Let AI analyze your product and suggest realistic variant attributes and values</p>
              {aiStatus && <p className="text-xs text-purple-200 mt-1 animate-pulse">{aiStatus}</p>}
            </div>
            <button onClick={aiSuggest} disabled={aiLoading}
              className="flex items-center gap-2 bg-white text-purple-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-purple-50 disabled:opacity-60 transition-colors whitespace-nowrap flex-shrink-0">
              {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {aiLoading ? 'Analyzing…' : 'AI Suggest'}
            </button>
          </div>

          {/* Attribute Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {attrs.map(attr => (
              <div key={attr.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg">{ATTR_ICONS[attr.name] || '📋'}</span>
                    <span className="font-semibold text-gray-900">{attr.name}</span>
                    {attr.autoDetected && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Auto-detected</span>
                    )}
                    <span className="text-xs text-gray-400">{attr.values.length} value{attr.values.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {VARIANT_ATTRIBUTE_PRESETS[attr.name] && (
                      <button onClick={() => applyPresets(attr.id, attr.name)}
                        className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-purple-50 transition-colors">
                        <Shuffle size={12} /> Presets
                      </button>
                    )}
                    <button onClick={() => removeAttr(attr.id)}
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {/* Values */}
                <div className="flex flex-wrap gap-1.5 mb-3 min-h-8">
                  {attr.values.map(v => (
                    <span key={v} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs px-2.5 py-1 rounded-full border border-purple-100 group">
                      {v}
                      <button onClick={() => removeVal(attr.id, v)} className="hover:text-red-500 ml-0.5 opacity-60 group-hover:opacity-100">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {!attr.values.length && (
                    <span className="text-xs text-gray-400 italic py-1">No values yet — type below or load presets</span>
                  )}
                </div>
                {/* Add value input */}
                <div className="flex gap-2">
                  <input
                    value={newValInputs[attr.id] || ''}
                    onChange={e => setNewValInputs(p => ({ ...p, [attr.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVal(attr.id); } }}
                    placeholder={`Add ${attr.name.toLowerCase()} value…`}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none"
                  />
                  <button onClick={() => addVal(attr.id)}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 transition-colors">
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add custom attribute */}
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Add Custom Attribute</p>
            <div className="flex gap-2">
              <input value={newAttrName} onChange={e => setNewAttrName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttr(); } }}
                placeholder="e.g. Connectivity, Voltage, Finish, Scent…"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={addAttr}
                className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm hover:bg-gray-800 flex items-center gap-2 transition-colors">
                <Plus size={16} /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.keys(VARIANT_ATTRIBUTE_PRESETS).map(preset => (
                <button key={preset} onClick={() => {
                  if (!attrs.find(a => a.name === preset)) {
                    setAttrs(prev => [...prev, { id: _makeVid(), name: preset, values: [], autoDetected: false }]);
                  }
                }} className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full hover:bg-purple-50 hover:text-purple-700 transition-colors">
                  + {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Matrix preview count */}
          {totalCombos > 0 && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle size={18} className="text-blue-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-800">
                  Will generate <strong>{totalCombos}</strong> variant{totalCombos !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  {attrs.filter(a => a.values.length).map(a => `${a.name}(${a.values.length})`).join(' × ')}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep('product')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-4 py-2.5">
              <ArrowLeft size={16} /> Back
            </button>
            <button onClick={generateMatrix} disabled={totalCombos === 0}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
              <Shuffle size={16} /> Generate {totalCombos > 0 ? `${totalCombos} Variants` : 'Matrix'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Matrix ──────────────────────────────────────────────────── */}
      {step === 'matrix' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Variants', value: variants.length, cls: 'text-purple-600' },
              { label: 'Duplicates', value: dupCount, cls: dupCount ? 'text-red-600' : 'text-green-600' },
              { label: 'Active', value: variants.filter(v => v.status === 'active').length, cls: 'text-green-600' },
              { label: 'Low Stock', value: variants.filter(v => v.inventory <= v.lowStockThreshold).length, cls: 'text-blue-600' },
            ].map(s => (
              <div key={s.label} className={`bg-white rounded-xl border p-3 text-center ${s.label === 'Duplicates' && dupCount ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {dupCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span>{dupCount} duplicate combination{dupCount > 1 ? 's' : ''} detected — remove before saving</span>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Table2 size={18} className="text-purple-600" /> Variant Matrix ({variants.length})
              </h3>
              <div className="flex gap-2">
                <button onClick={() => setStep('attributes')}
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg transition-colors">
                  <Sliders size={14} /> Attributes
                </button>
                <button onClick={removeDuplicates} disabled={!dupCount}
                  className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg disabled:opacity-40 transition-colors">
                  <Trash2 size={14} /> Remove Dupes
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Combination</th>
                    <th className="text-left px-4 py-3 font-medium">SKU</th>
                    <th className="text-right px-4 py-3 font-medium">Cost</th>
                    <th className="text-right px-4 py-3 font-medium">Price</th>
                    <th className="text-right px-4 py-3 font-medium">Compare</th>
                    <th className="text-right px-4 py-3 font-medium">Stock</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                    <th className="text-center px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {variants.map(v => {
                    const isDup = dupKeys.has(_comboKey(v.combo));
                    const isEd = editId === v.id;
                    return (
                      <tr key={v.id} className={`hover:bg-gray-50 transition-colors ${isDup ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(v.combo).map(([k, val]) => (
                              <span key={k} className="inline-flex items-center gap-0.5 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full border border-purple-100">
                                <span className="text-purple-400 text-[10px]">{k}:</span>{val}
                              </span>
                            ))}
                            {isDup && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold">DUPLICATE</span>}
                          </div>
                        </td>
                        {isEd ? (
                          <>
                            <td className="px-3 py-2">
                              <input value={v.sku} onChange={e => updateV(v.id,'sku',e.target.value)} className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.costPrice} onChange={e => updateV(v.id,'costPrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.sellingPrice} onChange={e => updateV(v.id,'sellingPrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.comparePrice} onChange={e => updateV(v.id,'comparePrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.inventory} onChange={e => updateV(v.id,'inventory',parseInt(e.target.value)||0)} className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <select value={v.status} onChange={e => updateV(v.id,'status',e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none">
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="draft">Draft</option>
                              </select>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-mono text-xs text-gray-600">{v.sku}</td>
                            <td className="px-4 py-3 text-right text-xs text-gray-500">${v.costPrice.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right font-semibold">${v.sellingPrice.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-xs text-gray-400 line-through">${v.comparePrice.toFixed(2)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${v.inventory <= v.lowStockThreshold ? 'text-blue-600' : ''}`}>{v.inventory}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v.status === 'active' ? 'bg-green-100 text-green-700' : v.status === 'draft' ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-600'}`}>
                                {v.status}
                              </span>
                            </td>
                          </>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setEditId(isEd ? null : v.id)}
                              className={`p-1.5 rounded-lg transition-colors ${isEd ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'}`}>
                              {isEd ? <Save size={14} /> : <Edit2 size={14} />}
                            </button>
                            <button onClick={() => removeV(v.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Extended fields panel */}
            {editedV && (
              <div className="p-5 bg-purple-50 border-t border-purple-100">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-4">
                  Extended Fields — {Object.values(editedV.combo).join(' / ')}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Barcode (UPC/EAN)</label>
                    <input value={editedV.barcode} onChange={e => updateV(editedV.id,'barcode',e.target.value)}
                      placeholder="123456789012"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Weight</label>
                    <input value={editedV.weight} onChange={e => updateV(editedV.id,'weight',e.target.value)}
                      placeholder="0.5 lbs"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Dimensions</label>
                    <input value={editedV.dimensions} onChange={e => updateV(editedV.id,'dimensions',e.target.value)}
                      placeholder="10×5×2 in"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Low Stock Alert</label>
                    <input type="number" value={editedV.lowStockThreshold}
                      onChange={e => updateV(editedV.id,'lowStockThreshold',parseInt(e.target.value)||0)}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Variant Image URL</label>
                    <input value={editedV.image} onChange={e => updateV(editedV.id,'image',e.target.value)}
                      placeholder="https://…"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  {editedV.image && (
                    <div className="flex items-center gap-2">
                      <img src={editedV.image} alt="" className="h-12 w-12 object-cover rounded-lg border border-gray-200"
                        onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                      <span className="text-xs text-gray-500">Preview</span>
                    </div>
                  )}
                </div>
                <button onClick={() => setEditId(null)}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 transition-colors">
                  <Save size={14} /> Done Editing
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center">
            <button onClick={() => setStep('attributes')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-4 py-2.5">
              <ArrowLeft size={16} /> Back to Attributes
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{variants.length} variant{variants.length !== 1 ? 's' : ''} ready</span>
              {selId ? (
                <button onClick={saveToProduct} disabled={!!dupCount || !variants.length}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
                  <Save size={16} /> Save All to Product
                </button>
              ) : (
                <button onClick={() => { notify('Select a product to save variants', 'error'); setStep('product'); }}
                  className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
                  <AlertTriangle size={16} /> Select Product First
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 4: Done ────────────────────────────────────────────────────── */}
      {step === 'done' && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle size={40} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Variants Saved!</h2>
          <p className="text-gray-500 max-w-sm">
            <strong>{variants.length}</strong> variant{variants.length !== 1 ? 's' : ''} created for{' '}
            <strong>{selProduct?.name || 'your product'}</strong>
          </p>
          <div className="bg-gray-50 rounded-xl p-4 text-left w-full max-w-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Summary</p>
            <div className="space-y-1 text-sm">
              <p><span className="text-gray-500">Attributes:</span> {attrs.filter(a => a.values.length).map(a => `${a.name}(${a.values.length})`).join(' × ')}</p>
              <p><span className="text-gray-500">Total combinations:</span> {variants.length}</p>
              <p><span className="text-gray-500">Price range:</span> ${Math.min(...variants.map(v => v.sellingPrice)).toFixed(2)} – ${Math.max(...variants.map(v => v.sellingPrice)).toFixed(2)}</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={resetAll}
              className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
              Start Over
            </button>
            <button onClick={() => navigate('/admin/products')}
              className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 flex items-center gap-2 transition-colors">
              <Package size={16} /> View Products
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AI HUB — Unified AI Management Dashboard
// ============================================================================
function AAIHub() {
  const { notify } = useApp();
  const navigate = useNavigate();
  const [aiProviders, setAiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [orCredits, setOrCredits] = useState<{ total: number; used: number } | null>(null);
  const [checkingCredits, setCheckingCredits] = useState(false);

  const I = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all';

  const save = (updated: AIProvider[]) => {
    setAiProviders(updated);
    localStorage.setItem('luxedge_ai_providers', JSON.stringify(updated));
    setSaving(true); notify('AI Providers saved!'); setTimeout(() => setSaving(false), 3000);
  };

  const toggleShow = (k: string) => setShowKeys(s => ({ ...s, [k]: !s[k] }));

  const testProvider = async (provider: AIProvider) => {
    if (!provider.apiKey.trim()) { setTestResult({ ...testResult, [provider.id]: 'No API key provided' }); return; }
    setTesting(provider.id);
    try {
      const p = await callAIProvider('Reply with only: OK', [provider]);
      setTestResult({ ...testResult, [provider.id]: p.includes('OK') ? 'Connected successfully!' : 'Response: OK' });
    } catch (e: any) {
      setTestResult({ ...testResult, [provider.id]: `Error: ${e.message?.slice(0, 80)}` });
    } finally { setTesting(null); }
  };

  const checkOpenRouterCredits = async () => {
    const or = aiProviders.find(p => p.id === 'openrouter');
    if (!or?.apiKey) { notify('Add OpenRouter API key first'); return; }
    setCheckingCredits(true);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${or.apiKey}` }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setOrCredits({ total: d.data?.limit || 0, used: d.data?.usage || 0 });
    } catch (e: any) { notify(`Credit check failed: ${e.message}`); }
    finally { setCheckingCredits(false); }
  };

  const providerIcons: Record<string, string> = {
    openrouter: '\u{1F310}', gemini: '\u{1F916}', openai: '\u{1F9E0}', anthropic: '\u{1F9EC}'
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
          <Bot size={26} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Hub</h1>
          <p className="text-sm text-gray-500">Manage AI providers, API keys, credits, and import settings</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => navigate('/admin/ai-import')} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Wand2 size={16} /> AI Import
          </button>
          <button onClick={() => navigate('/admin/marketing')} className="px-4 py-2 border border-purple-300 text-purple-700 hover:bg-purple-50 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Megaphone size={16} /> Marketing
          </button>
        </div>
      </div>

      {/* OpenRouter Credits Card */}
      {aiProviders.find(p => p.id === 'openrouter' && p.apiKey) && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm text-purple-800 flex items-center gap-2">
              <Globe size={16} /> OpenRouter Credits
            </h2>
            <button onClick={checkOpenRouterCredits} disabled={checkingCredits}
              className="px-3 py-1.5 bg-white border border-purple-200 rounded-lg text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {checkingCredits ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {checkingCredits ? 'Checking...' : 'Check Credits'}
            </button>
          </div>
          {orCredits ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-purple-700">${orCredits.total.toFixed(2)}</p>
                <p className="text-xs text-gray-500">Total Limit</p>
              </div>
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">${orCredits.used.toFixed(2)}</p>
                <p className="text-xs text-gray-500">Used</p>
              </div>
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-600">${(orCredits.total - orCredits.used).toFixed(2)}</p>
                <p className="text-xs text-gray-500">Remaining</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-purple-600">Click "Check Credits" to view your OpenRouter balance.</p>
          )}
          <p className="text-xs text-purple-400 mt-2">
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline hover:text-purple-600">Get OpenRouter credits →</a>
          </p>
        </div>
      )}

      {/* AI Providers */}
      <div className="bg-white rounded-2xl border border-purple-200 p-5">
        <h2 className="font-bold text-sm text-gray-700 mb-4 flex items-center gap-2">
          <Bot size={16} className="text-purple-500" /> AI Provider Configuration
        </h2>
        <p className="text-sm text-gray-500 mb-5">Add API keys and select models for each provider. The default provider is used for all AI operations.</p>
        <div className="space-y-3">
          {aiProviders.map((provider, idx) => (
            <div key={provider.id} className={`border rounded-xl p-4 transition-all ${provider.isDefault ? 'border-purple-300 bg-purple-50/50 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => save(aiProviders.map((p, i) => ({ ...p, enabled: i === idx ? !p.enabled : p.enabled })))}>
                    {provider.enabled ? <ToggleRight size={24} className="text-green-500" /> : <ToggleLeft size={24} className="text-gray-400" />}
                  </button>
                  <div>
                    <span className="font-semibold text-sm">{providerIcons[provider.id] || ''} {provider.name}</span>
                    {provider.isDefault && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Default</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => testProvider(provider)} disabled={testing === provider.id || !provider.apiKey}
                    className="px-3 py-1.5 text-xs border rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
                    {testing === provider.id ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    Test
                  </button>
                  {!provider.isDefault && provider.apiKey && (
                    <button type="button" onClick={() => save(aiProviders.map(p => ({ ...p, isDefault: p.id === provider.id })))}
                      className="text-xs text-purple-600 hover:text-purple-800 font-medium">Make Default</button>
                  )}
                </div>
              </div>
              {testResult[provider.id] && (
                <div className={`mb-3 p-2 rounded-lg text-xs ${testResult[provider.id].startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {testResult[provider.id]}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">API Key</label>
                  <div className="relative">
                    <input type={showKeys[`ai_${provider.id}`] ? 'text' : 'password'}
                      value={provider.apiKey}
                      onChange={e => setAiProviders(prev => prev.map((p, i) => i === idx ? { ...p, apiKey: e.target.value } : p))}
                      className={I + ' pr-10 text-xs'} placeholder={`Enter ${provider.name} API key...`} />
                    <button type="button" onClick={() => toggleShow(`ai_${provider.id}`)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showKeys[`ai_${provider.id}`] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Model</label>
                  <select value={provider.defaultModel} onChange={e => setAiProviders(prev => prev.map((p, i) => i === idx ? { ...p, defaultModel: e.target.value } : p))}
                    className={I + ' text-xs'}>
                    {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              {provider.id === 'openrouter' && (
                <p className="text-xs text-gray-400 mt-2">
                  Free models: google/gemini-2.0-flash-exp:free, meta-llama/llama-3.1-8b-instruct:free
                  <br />Paid models require credits. <a href="https://openrouter.ai/docs" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Docs</a>
                </p>
              )}
              {provider.id === 'gemini' && (
                <p className="text-xs text-gray-400 mt-2">
                  Free tier: 1,500 requests/day. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Get API key</a>
                </p>
              )}
              {provider.id === 'deepseek' && (
                <p className="text-xs text-gray-400 mt-2">
                  Budget-friendly and fast. <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Get API key</a>
                </p>
              )}
            </div>
          ))}
        </div>
        {saving && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-700 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> AI Providers saved successfully!
          </div>
        )}
        <button type="button" onClick={() => save(aiProviders)}
          className="mt-4 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors w-full sm:w-auto justify-center">
          <Save size={16} /> Save All AI Providers
        </button>
      </div>

      {/* Quick Start Cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wand2 size={18} className="text-blue-600" />
            <h3 className="font-bold text-sm">AI Product Import</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">Paste any product URL from AliExpress, Amazon, eBay, Etsy, Walmart, Temu — AI extracts all details.</p>
          <button onClick={() => navigate('/admin/ai-import')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Launch Import →
          </button>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Megaphone size={18} className="text-green-600" />
            <h3 className="font-bold text-sm">AI Content Generators</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">Generate product descriptions, ad copy, emails, social posts, blog ideas with AI.</p>
          <button onClick={() => navigate('/admin/marketing')} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open Marketing →
          </button>
        </div>
        <div className="bg-gradient-to-br from-sky-50 to-orange-50 border border-sky-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Search size={18} className="text-blue-600" />
            <h3 className="font-bold text-sm">SEO Engine</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">AI-powered SEO optimization: meta tags, structured data, keyword analysis, content scoring.</p>
          <button onClick={() => navigate('/admin/seo-engine')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open SEO Engine →
          </button>
        </div>
        <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Layers size={18} className="text-pink-600" />
            <h3 className="font-bold text-sm">Variant Generator</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">AI generates product variants (colors, sizes, materials) with SKUs and pricing.</p>
          <button onClick={() => navigate('/admin/variant-gen')} className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open Variant Gen →
          </button>
        </div>
      </div>

      {/* Scraping Configuration */}
      <div className="bg-white rounded-2xl border border-green-200 p-5">
        <h2 className="font-bold text-sm text-gray-700 mb-4 flex items-center gap-2">
          <Link2 size={16} className="text-green-500" /> Web Scraping Configuration
        </h2>
        <div className="rounded-xl border border-dashed border-green-300 bg-green-50 p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-green-700">scrape.do — Free Web Scraper</p>
            <p className="text-xs text-green-600 mt-0.5">1,000 free requests/month · No credit card · Permanent free tier</p>
          </div>
          <ol className="text-xs text-green-700 space-y-1 list-decimal list-inside">
            <li>Go to scrape.do and create a free account</li>
            <li>Copy your token from the dashboard</li>
            <li>Paste below — enables AliExpress, Amazon, and any URL import</li>
          </ol>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">scrape.do Token</label>
            <input type="password" value={(() => { try { return JSON.parse(localStorage.getItem('luxedge_api_keys') || '{}').scrapedoKey || ''; } catch { return ''; } })()}
              onChange={e => {
                try {
                  const keys = JSON.parse(localStorage.getItem('luxedge_api_keys') || '{}');
                  keys.scrapedoKey = e.target.value;
                  localStorage.setItem('luxedge_api_keys', JSON.stringify(keys));
                } catch {}
              }}
              className={I} placeholder="Paste your scrape.do token here" />
          </div>
          <p className="text-xs text-green-500 flex items-center gap-1">
            <CheckCircle size={12} /> Token is saved automatically
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AI PRODUCT IMPORT ENGINE
// ============================================================================
const SUPPORTED_PLATFORMS = ['AliExpress','Alibaba','Amazon','eBay','Etsy','Walmart','Temu','CJ Dropshipping','Daraz','Shopify Stores','Any public product page'];

function detectPlatform(url: string): string | null {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('aliexpress.com') || u.includes('aliexpress.us')) return 'AliExpress';
  if (u.includes('alibaba.com')) return 'Alibaba';
  if (u.includes('amazon.com') || u.includes('amzn.to')) return 'Amazon';
  if (u.includes('ebay.com') || u.includes('ebay.co')) return 'eBay';
  if (u.includes('etsy.com')) return 'Etsy';
  if (u.includes('walmart.com')) return 'Walmart';
  if (u.includes('temu.com')) return 'Temu';
  if (u.includes('daraz.pk') || u.includes('daraz.com')) return 'Daraz';
  if (u.includes('cjdropshipping.com')) return 'CJ Dropshipping';
  if (u.includes('myshopify.com') || u.includes('shopify.com')) return 'Shopify Store';
  if (u.startsWith('http')) return 'Website';
  return null;
}

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-600 bg-green-50' : score >= 50 ? 'text-blue-600 bg-sky-50' : 'text-red-500 bg-red-50';
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${color}`}>{score}%</span>;
}

function AAIImport() {
  const { setProducts, notify } = useApp();
  const navigate = useNavigate();

  type ImportSource = 'url'|'html'|'text'|'clipboard'|'image';
  type ImportStep = 'source'|'input'|'processing'|'preview'|'done'|'history';

  const [step, setStep] = useState<ImportStep>('source');
  const [source, setSource] = useState<ImportSource>('url');

  // Inputs
  const [urlInput, setUrlInput] = useState('');
  const [htmlInput, setHtmlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{msg:string;ok:boolean}[]>([]);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<any>(null);

  // Results
  const [extracted, setExtracted] = useState<AIExtractedProduct|null>(null);
  const [editField, setEditField] = useState<Partial<AIExtractedProduct>>({});
  const [selectedImgs, setSelectedImgs] = useState<string[]>([]);
  const [heroImg, setHeroImg] = useState('');

  // Providers
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });

  // History
  const [history, setHistory] = useState<ImportHistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('luxedge_import_history')||'[]'); }
    catch { return []; }
  });

  const addLog = (msg: string, ok=true) => setProgress(p => [...p, {msg, ok}]);

  const startTimer = () => {
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-t0)/1000)), 200);
  };
  const stopTimer = () => { clearInterval(timerRef.current); };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (text) setTextInput(text);
  }, []);

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => { setTextInput(`[Image uploaded: ${file.name}] ${ev.target?.result as string}`); };
      reader.readAsDataURL(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setTextInput(`[Image: ${file.name}] ${dataUrl}`);
        addLog(`Image loaded: ${file.name}`);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImport = async () => {
    setLoading(true); setError(''); setProgress([]); setElapsed(0);
    setStep('processing'); startTimer();
    try {
      let rawContent = '';
      let pageImages: string[] = [];

      if (source === 'url') {
        if (!urlInput.trim()) throw new Error('Please enter a URL');
        addLog(`Fetching: ${urlInput}`);
        const apiKeys = JSON.parse(localStorage.getItem('luxedge_api_keys')||'{}');
        const pageData = await fetchPageContent(urlInput.trim(), apiKeys.scrapedoKey);
        const parsed = JSON.parse(pageData);
        rawContent = parsed.text;
        pageImages = parsed.images || [];
        addLog(`Page fetched — ${rawContent.length} chars, ${pageImages.length} images found`, true);
      } else if (source === 'html') {
        if (!htmlInput.trim()) throw new Error('Please paste some HTML');
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlInput, 'text/html');
        doc.querySelectorAll('script,style').forEach(el => el.remove());
        pageImages = [];
        doc.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('src')||img.getAttribute('data-src')||'';
          if (src.startsWith('http')) pageImages.push(src);
        });
        rawContent = doc.body?.innerText || htmlInput;
        addLog(`HTML processed — ${rawContent.length} chars, ${pageImages.length} images`, true);
      } else if (source === 'text' || source === 'clipboard') {
        if (!textInput.trim()) throw new Error('Please paste some content');
        rawContent = textInput;
        addLog(`Content ready — ${rawContent.length} chars`, true);
      } else if (source === 'image') {
        if (!textInput.includes('[Image')) throw new Error('Please upload an image first');
        rawContent = `Product image provided. Extract product information from this image description. Image data: ${textInput.slice(0,200)}...`;
        addLog('Image content prepared', true);
      }

      addLog('Sending to AI for analysis…');
      const prompt = buildExtractionPrompt(rawContent, source);
      const aiText = await callAIProvider(prompt, aiProviders, (m) => addLog(m));

      addLog('Parsing AI response…');
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI returned invalid response. Please try again.');
      const data = JSON.parse(jsonMatch[0]) as AIExtractedProduct;

      // Merge page images with AI-found images
      const allImages = [...new Set([...(data.images||[]), ...pageImages])].filter(u => u.startsWith('http')).slice(0, 24);
      data.images = allImages;

      setExtracted(data);
      setEditField({...data});
      setSelectedImgs(allImages.slice(0, 6));
      setHeroImg(allImages[0] || '');

      // Save history
      const activeProvider = aiProviders.find(p => p.isDefault && p.enabled) || aiProviders.find(p => p.enabled && p.apiKey);
      const entry: ImportHistoryEntry = {
        id: `imp-${Date.now()}`, source: source === 'url' ? urlInput : source, sourceType: source,
        date: new Date().toISOString(), provider: activeProvider?.name||'Unknown',
        model: activeProvider?.defaultModel||'Unknown', productTitle: data.title,
        status: 'success', importTime: elapsed * 1000
      };
      const newHist = [entry, ...history].slice(0, 50);
      setHistory(newHist);
      localStorage.setItem('luxedge_import_history', JSON.stringify(newHist));

      addLog(`✓ Done in ${elapsed}s — ready to review!`, true);
      setStep('preview');

    } catch (e: any) {
      setError(e.message||'Import failed');
      addLog(`✗ ${e.message}`, false);
      setStep('input');
    } finally { setLoading(false); stopTimer(); }
  };

  const handleSave = () => {
    if (!extracted) return;
    const ef = editField;
    const product: any = {
      id: `ai-${Date.now()}`,
      name: ef.title || extracted.title,
      shortDesc: ef.shortDescription || extracted.shortDescription || '',
      description: ef.longDescription || extracted.longDescription || '',
      price: Number(ef.sellingPrice ?? extracted.sellingPrice) || 0,
      originalPrice: Number(ef.comparePrice ?? extracted.comparePrice) || 0,
      category: ef.category || extracted.category || 'Uncategorized',
      stock: Number(ef.stock ?? extracted.stock) || 100,
      images: selectedImgs.length ? selectedImgs : ['https://images.pexels.com/photos/5632371/pexels-photo-5632371.jpeg'],
      rating: 0, reviews: 0, isActive: false,
      brand: ef.brand || extracted.brand || 'Luxedge',
      condition: 'New',
      tags: ef.tags || extracted.tags || [],
      weight: ef.weight || extracted.weight || '',
      dimensions: ef.dimensions || extracted.dimensions || '',
      origin: ef.origin || extracted.origin || '',
      freeShipping: true, shippingCost: '0', variants: [],
    };
    setProducts(prev => [product, ...prev]);
    notify(`"${product.name}" saved as Draft!`);
    setStep('done');
  };

  const EF = (field: keyof AIExtractedProduct) => ({
    value: (editField[field] ?? extracted?.[field] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>) =>
      setEditField(prev => ({...prev, [field]: e.target.value} as Partial<AIExtractedProduct>))
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';

  // ── SOURCE SELECTION ──
  if (step === 'source') {
    const sources = [
      { id:'url', icon:<Link2 size={24}/>, label:'URL Import', desc:'Paste any product URL', color:'bg-blue-50 border-blue-200 hover:border-blue-400', iconColor:'text-blue-600' },
      { id:'html', icon:<FileText size={24}/>, label:'HTML Import', desc:'Paste copied HTML', color:'bg-orange-50 border-orange-200 hover:border-orange-400', iconColor:'text-orange-600' },
      { id:'text', icon:<PenLine size={24}/>, label:'Text Import', desc:'Paste product description', color:'bg-green-50 border-green-200 hover:border-green-400', iconColor:'text-green-600' },
      { id:'clipboard', icon:<Clipboard size={24}/>, label:'Clipboard', desc:'Ctrl+V anywhere to paste', color:'bg-purple-50 border-purple-200 hover:border-purple-400', iconColor:'text-purple-600' },
      { id:'image', icon:<ImageIcon size={24}/>, label:'Image Upload', desc:'JPG, PNG, WEBP, GIF', color:'bg-pink-50 border-pink-200 hover:border-pink-400', iconColor:'text-pink-600' },
    ];
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center">
            <Bot size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Product Import Engine</h1>
            <p className="text-sm text-gray-500">Import any product in under 60 seconds using AI</p>
          </div>
          <button onClick={() => setStep('history')} className="ml-auto flex items-center gap-2 px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <History size={16} /> History ({history.length})
          </button>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Choose Import Source</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sources.map(s => (
              <button key={s.id} onClick={() => { setSource(s.id as ImportSource); setStep('input'); }}
                className={`border-2 rounded-2xl p-5 text-left transition-all ${s.color} ${source===s.id?'ring-2 ring-offset-1':''}`}>
                <div className={`mb-3 ${s.iconColor}`}>{s.icon}</div>
                <p className="font-semibold text-gray-900">{s.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Supported Platforms</p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_PLATFORMS.map(p => <span key={p} className="px-3 py-1 bg-white border text-xs rounded-full text-gray-600">{p}</span>)}
          </div>
        </div>
      </div>
    );
  }

  // ── INPUT STEP ──
  if (step === 'input') {
    return (
      <div className="space-y-5 max-w-2xl">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep('source')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><ArrowLeft size={20}/></button>
          <h1 className="text-xl font-bold">
            {source==='url'?'URL Import':source==='html'?'HTML Import':source==='clipboard'?'Clipboard Import':source==='image'?'Image Upload':'Text Import'}
          </h1>
        </div>

        {error && <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm"><AlertTriangle size={18} className="mt-0.5 shrink-0"/><div><p className="font-semibold">Import Failed</p><p>{error}</p></div></div>}

        {source === 'url' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Product URL</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleImport()}
                    className={inputCls + ' w-full'} placeholder="https://www.aliexpress.com/item/... or any product page URL" />
                  {urlInput.trim() && detectPlatform(urlInput) && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      {detectPlatform(urlInput)}
                    </span>
                  )}
                </div>
                <button onClick={handleImport} disabled={!urlInput.trim()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 whitespace-nowrap transition-colors">
                  <Wand2 size={16}/> Import
                </button>
              </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-xs text-blue-700">
                <span className="font-semibold">Smart Import:</span> Paste any product URL — {
                  urlInput.trim() && detectPlatform(urlInput)
                    ? <span>detected as <span className="font-bold text-blue-800">{detectPlatform(urlInput)}</span> product</span>
                    : 'AI will extract title, price, images, specs, description, variants, SEO data automatically'
                }
              </p>
            </div>
            <div className="text-xs text-gray-500">
              <p className="font-medium mb-1">Supported platforms:</p>
              <div className="flex flex-wrap gap-1">{SUPPORTED_PLATFORMS.map(p=><span key={p} className="px-2 py-0.5 bg-gray-100 rounded">{p}</span>)}</div>
            </div>
          </div>
        )}

        {source === 'html' && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Paste HTML Source Code</label>
            <textarea value={htmlInput} onChange={e=>setHtmlInput(e.target.value)}
              className={inputCls + ' min-h-[200px] font-mono text-xs'} placeholder="Paste the HTML of the product page here..." />
            <button onClick={handleImport} disabled={!htmlInput.trim()}
              className="mt-3 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Wand2 size={16}/> Analyze HTML
            </button>
          </div>
        )}

        {(source === 'text' || source === 'clipboard') && (
          <div onPaste={handlePaste}>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {source==='clipboard' ? 'Press Ctrl+V to paste clipboard content' : 'Paste Product Text/Description'}
            </label>
            <textarea value={textInput} onChange={e=>setTextInput(e.target.value)}
              className={inputCls + ' min-h-[200px]'}
              placeholder={source==='clipboard' ? 'Click here and press Ctrl+V...' : 'Paste product title, description, features, specifications...'} />
            {source==='clipboard' && textInput && <p className="text-xs text-green-600 mt-1">✓ Content pasted ({textInput.length} chars)</p>}
            <button onClick={handleImport} disabled={!textInput.trim()}
              className="mt-3 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Wand2 size={16}/> {source==='clipboard'?'Import from Clipboard':'Analyze Text'}
            </button>
          </div>
        )}

        {source === 'image' && (
          <div>
            <div onDrop={handleImageDrop} onDragOver={e=>{e.preventDefault();setIsDragging(true)}} onDragLeave={()=>setIsDragging(false)}
              onClick={()=>fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${isDragging?'border-blue-400 bg-blue-50':'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}`}>
              <Upload size={32} className="mx-auto text-gray-400 mb-3"/>
              <p className="font-semibold text-gray-700">Drop image here or click to upload</p>
              <p className="text-xs text-gray-500 mt-1">PNG, JPG, JPEG, WEBP supported</p>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect}/>
            </div>
            {textInput.includes('[Image') && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm flex items-center gap-2">
                <CheckCircle size={16}/> Image loaded — AI will analyze it
              </div>
            )}
            <button onClick={handleImport} disabled={!textInput.includes('[Image')}
              className="mt-3 px-5 py-2.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Bot size={16}/> Analyze Image with AI
            </button>
          </div>
        )}

        <div className="border rounded-xl p-4 bg-sky-50 border-sky-200">
          <p className="text-xs font-semibold text-blue-700 mb-1">⚡ AI Provider</p>
          {(() => {
            const active = aiProviders.find(p=>p.isDefault&&p.enabled&&p.apiKey) || aiProviders.find(p=>p.enabled&&p.apiKey);
            return active
              ? <p className="text-xs text-blue-800">{active.name} · {active.defaultModel}</p>
              : <p className="text-xs text-red-600">No AI provider configured! <button onClick={()=>navigate('/admin/settings')} className="underline">Go to Settings → AI Providers</button></p>;
          })()}
        </div>
      </div>
    );
  }

  // ── PROCESSING STEP ──
  if (step === 'processing') {
    return (
      <div className="space-y-6 max-w-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center animate-pulse">
            <Bot size={22} className="text-white"/>
          </div>
          <div>
            <h1 className="text-xl font-bold">AI is analyzing your product…</h1>
            <p className="text-sm text-gray-500 font-mono">{elapsed}s elapsed</p>
          </div>
        </div>
        <div className="bg-gray-900 rounded-2xl p-5 min-h-[200px] font-mono text-sm space-y-1.5">
          {progress.map((p,i) => (
            <div key={i} className={`flex items-start gap-2 ${p.ok?'text-green-400':'text-red-400'}`}>
              <span className="text-gray-600 text-xs mt-0.5">[{String(i+1).padStart(2,'0')}]</span>
              <span>{p.msg}</span>
            </div>
          ))}
          {loading && <div className="flex items-center gap-2 text-blue-400"><Loader2 size={14} className="animate-spin"/><span>Processing…</span></div>}
        </div>
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700 text-sm font-semibold">{error}</p>
            <button onClick={()=>setStep('input')} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium">← Try Again</button>
          </div>
        )}
      </div>
    );
  }

  // ── PREVIEW STEP ──
  if (step === 'preview' && extracted) {
    const conf = extracted.confidence || {};
    const PreviewField = ({ label, field, multiline=false, conf: c=0 }: {label:string;field:keyof AIExtractedProduct;multiline?:boolean;conf?:number}) => (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
          {c > 0 && <ConfidenceBadge score={c}/>}
        </div>
        {multiline
          ? <textarea {...EF(field)} className={inputCls + ' text-sm min-h-[80px]'}/>
          : <input {...EF(field)} className={inputCls + ' text-sm'}/>
        }
      </div>
    );

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={()=>setStep('input')} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={20}/></button>
          <div>
            <h1 className="text-xl font-bold">Review & Edit</h1>
            <p className="text-sm text-gray-500">AI extracted {Object.keys(extracted).length} fields — edit any before saving</p>
          </div>
          <button onClick={handleSave} className="ml-auto px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-green-200">
            <CheckCircle size={16}/> Save as Draft Product
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* LEFT — Core Fields */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Package size={16} className="text-blue-500"/>Product Info</h2>
              <PreviewField label="Product Title" field="title" conf={conf.title}/>
              <PreviewField label="Luxury Title (Premium)" field="luxuryTitle"/>
              <PreviewField label="SEO Title" field="seoTitle" conf={conf.category}/>
              <PreviewField label="Brand" field="brand" conf={conf.brand}/>
              <div className="grid grid-cols-2 gap-3">
                <PreviewField label="Category" field="category" conf={conf.category}/>
                <PreviewField label="Subcategory" field="subcategory"/>
              </div>
              <PreviewField label="SKU" field="sku"/>
              <PreviewField label="Origin" field="origin"/>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><DollarSign size={16} className="text-green-500"/>Pricing</h2>
              <div className="grid grid-cols-3 gap-3">
                <PreviewField label="Sell Price ($)" field="sellingPrice" conf={conf.price}/>
                <PreviewField label="Compare Price ($)" field="comparePrice"/>
                <PreviewField label="Cost Price ($)" field="costPrice"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PreviewField label="Stock" field="stock"/>
                <PreviewField label="Weight" field="weight"/>
              </div>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><FileText size={16} className="text-purple-500"/>Descriptions</h2>
              <PreviewField label="Short Description" field="shortDescription" multiline conf={conf.description}/>
              <PreviewField label="Long Description" field="longDescription" multiline/>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Globe size={16} className="text-blue-500"/>SEO</h2>
              <PreviewField label="Slug" field="slug"/>
              <PreviewField label="Meta Title" field="metaTitle"/>
              <PreviewField label="Meta Description" field="metaDescription" multiline/>
              <PreviewField label="Focus Keyword" field="focusKeyword"/>
            </div>
          </div>

          {/* RIGHT — Images + Extra */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><ImageIcon size={16} className="text-pink-500"/>Images ({extracted.images?.length||0} found)</h2>
                <span className="text-xs text-gray-500">{selectedImgs.length} selected</span>
              </div>
              {extracted.images?.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {extracted.images.slice(0,18).map((img,i) => {
                    const isSelected = selectedImgs.includes(img);
                    const isHero = heroImg === img;
                    return (
                      <div key={i} className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${isSelected?'border-blue-500':'border-transparent'}`}
                        onClick={()=>{ setSelectedImgs(prev => isSelected ? prev.filter(x=>x!==img) : [...prev, img]); if(!heroImg) setHeroImg(img); }}>
                        <img src={img} className="w-full h-20 object-cover" onError={e=>(e.currentTarget.style.display='none')} alt=""/>
                        {isSelected && <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center"><CheckCircle size={12} className="text-white"/></div>}
                        {isHero && <div className="absolute bottom-0 left-0 right-0 bg-blue-500 text-white text-[10px] text-center font-bold py-0.5">HERO</div>}
                        {!isHero && isSelected && <button type="button" className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 hover:bg-blue-500 transition-colors"
                          onClick={e=>{e.stopPropagation();setHeroImg(img);}}>Set Hero</button>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <ImageIcon size={32} className="mx-auto mb-2 opacity-40"/>
                  <p className="text-sm">No images found. Add image URLs manually.</p>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={()=>setSelectedImgs(extracted.images?.slice(0,12)||[])} className="text-xs text-blue-600 hover:underline">Select All</button>
                <span className="text-gray-300">|</span>
                <button onClick={()=>setSelectedImgs([])} className="text-xs text-gray-500 hover:underline">Clear</button>
              </div>
            </div>

            {/* Features & Tags */}
            <div className="bg-white rounded-2xl border p-5 space-y-3">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Sparkles size={16} className="text-blue-500"/>Features & Tags</h2>
              {extracted.features?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Features</p>
                  <ul className="space-y-1">
                    {extracted.features.slice(0,6).map((f,i) => <li key={i} className="text-sm text-gray-700 flex items-start gap-2"><span className="text-green-500 mt-0.5">✓</span>{f}</li>)}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">{(extracted.tags||[]).map(t=><span key={t} className="px-2 py-0.5 bg-gray-100 text-xs rounded-full text-gray-600">{t}</span>)}</div>
              </div>
              {(extracted.colors?.length||0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Colors</p>
                  <div className="flex flex-wrap gap-1">{extracted.colors?.map(c=><span key={c} className="px-2 py-0.5 border text-xs rounded-full">{c}</span>)}</div>
                </div>
              )}
              {(extracted.sizes?.length||0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Sizes</p>
                  <div className="flex flex-wrap gap-1">{extracted.sizes?.map(s=><span key={s} className="px-2 py-0.5 border text-xs rounded-full">{s}</span>)}</div>
                </div>
              )}
            </div>

            {/* Specs */}
            {Object.keys(extracted.specifications||{}).length > 0 && (
              <div className="bg-white rounded-2xl border p-5">
                <h2 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2"><Tag size={16} className="text-gray-500"/>Specifications</h2>
                <div className="space-y-1.5">
                  {Object.entries(extracted.specifications).slice(0,12).map(([k,v]) => (
                    <div key={k} className="flex text-sm">
                      <span className="w-2/5 text-gray-500 text-xs font-medium pr-2 leading-5">{k}</span>
                      <span className="flex-1 text-gray-800 text-xs leading-5">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confidence Overview */}
            <div className="bg-white rounded-2xl border p-5">
              <h2 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2"><Star size={16} className="text-blue-500"/>AI Confidence Scores</h2>
              <div className="space-y-2">
                {Object.entries(conf).map(([k,v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-24 capitalize">{k}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${Number(v)>=80?'bg-green-500':Number(v)>=50?'bg-sky-400':'bg-red-400'}`} style={{width:`${v}%`}}/>
                    </div>
                    <span className="text-xs font-bold text-gray-600 w-8 text-right">{v}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="sticky bottom-0 bg-white border-t p-4 -mx-6 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-500">Product will be saved as <span className="font-semibold text-gray-700">Draft</span> — you can publish it from Products page.</p>
          <button onClick={handleSave} className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-green-200">
            <CheckCircle size={18}/> Save Product
          </button>
        </div>
      </div>
    );
  }

  // ── DONE ──
  if (step === 'done') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-5">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
          <CheckCircle size={40} className="text-green-500"/>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Imported!</h1>
          <p className="text-gray-500 mt-1">Saved as Draft — publish it when ready</p>
        </div>
        <div className="flex gap-3">
          <button onClick={()=>navigate('/admin/products')} className="px-6 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold flex items-center gap-2">
            <Package size={16}/> View Products
          </button>
          <button onClick={()=>{ setStep('source'); setExtracted(null); setEditField({}); setSelectedImgs([]); setUrlInput(''); setTextInput(''); setHtmlInput(''); }}
            className="px-6 py-2.5 border rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2">
            <RefreshCw size={16}/> Import Another
          </button>
        </div>
      </div>
    );
  }

  // ── HISTORY ──
  if (step === 'history') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={()=>setStep('source')} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={20}/></button>
          <h1 className="text-xl font-bold">Import History</h1>
        </div>
        {history.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <History size={40} className="mx-auto mb-3 opacity-40"/>
            <p>No imports yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="bg-white border rounded-xl p-4 flex items-center gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${h.status==='success'?'bg-green-100':'bg-red-100'}`}>
                  {h.status==='success'?<CheckCircle size={18} className="text-green-600"/>:<AlertTriangle size={18} className="text-red-500"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">{h.productTitle}</p>
                  <p className="text-xs text-gray-500">{new Date(h.date).toLocaleDateString()} · {h.provider} · {(h.importTime/1000).toFixed(1)}s</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${h.sourceType==='url'?'bg-blue-100 text-blue-700':h.sourceType==='html'?'bg-orange-100 text-orange-700':'bg-gray-100 text-gray-600'}`}>{h.sourceType}</span>
              </div>
            ))}
          </div>
        )}
        {history.length > 0 && (
          <button onClick={()=>{ setHistory([]); localStorage.removeItem('luxedge_import_history'); }}
            className="text-sm text-red-500 hover:text-red-700">Clear History</button>
        )}
      </div>
    );
  }

  return null;
}


// ============================================================================
// ADMIN — MARKETING & TRAFFIC
// ============================================================================
function AMarketingTraffic() {
  const { notify } = useApp();
  const [globalCfg, setGlobalCfg] = useState<MarketingConfig | null>(null);
  const [cfg, setCfg] = useState<MarketingConfig>(() => JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [adsTxtStatus, setAdsTxtStatus] = useState<'checking' | 'configured' | 'missing' | 'invalid'>('checking');
  const [hasPreview, setHasPreview] = useState(hasPreviewConfig());

  useEffect(() => {
    fetchGlobalConfig().then(g => {
      setGlobalCfg(g);
      const preview = hasPreviewConfig() ? getCachedPreview() : null;
      setCfg(JSON.parse(JSON.stringify(preview || g)));
      setHasPreview(hasPreviewConfig());
    });
  }, []);

  const set = (patch: Partial<MarketingConfig>) => setCfg(c => ({ ...c, ...patch }));
  const setEx = (k: keyof MarketingConfig['exclusions'], v: boolean) => setCfg(c => ({ ...c, exclusions: { ...c.exclusions, [k]: v } }));
  const setPl = (k: PlacementKey, patch: Partial<{ enabled: boolean; slot: string }>) => setCfg(c => ({ ...c, placements: { ...c.placements, [k]: { ...c.placements[k], ...patch } } }));

  const checkAdsTxt = async () => {
    try {
      const r = await fetch('/ads.txt');
      if (!r.ok) { setAdsTxtStatus('missing'); return; }
      const txt = (await r.text()).trim();
      const expected = (cfg.adsTxtRecord || DEFAULT_CONFIG.adsTxtRecord).trim();
      if (txt === expected) setAdsTxtStatus('configured');
      else if (txt.includes('pub-')) setAdsTxtStatus('invalid');
      else setAdsTxtStatus('missing');
    } catch {
      setAdsTxtStatus('missing');
    }
  };
  useEffect(() => { checkAdsTxt(); }, []);

  const handleSave = () => {
    const errs = validateConfig(cfg);
    setErrors(errs);
    if (Object.keys(errs).length > 0) { notify('Please fix the validation errors', 'error'); return; }
    savePreviewConfig(cfg);
    setHasPreview(true);
    setSaved(true);
    notify('Marketing settings saved (preview for this browser)');
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTest = async () => {
    const errs = validateConfig(cfg);
    setErrors(errs);
    if (Object.keys(errs).length > 0) { setTestResult({ ok: false, msg: 'Configuration has validation errors — fix them first.' }); return; }
    await checkAdsTxt();
    const clientOk = CLIENT_ID_RE.test(cfg.adsenseClientId.trim());
    const mode = activeModeLabel(cfg);
    const bits: string[] = [];
    if (cfg.adsenseEnabled && clientOk) bits.push('AdSense script would load with ' + cfg.adsenseClientId);
    if (cfg.autoAdsEnabled) bits.push('Auto Ads on');
    if (adsTxtStatus === 'configured') bits.push('ads.txt present at /ads.txt');
    if (cfg.gaEnabled && cfg.ga4Id) bits.push('GA4 script would load for ' + cfg.ga4Id);
    setTestResult({ ok: true, msg: `OK — ${mode}. ${bits.join(' · ') || 'Nothing enabled yet.'} Note: this only confirms code config; it is NOT a Google approval.` });
  };

  const copyAdsTxt = async () => {
    try { await navigator.clipboard.writeText(cfg.adsTxtRecord); notify('ads.txt entry copied'); }
    catch { notify('Copy failed — select the text manually', 'error'); }
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'site-config.json';
    a.click();
    URL.revokeObjectURL(url);
    notify('Downloaded site-config.json — commit it to the repo to make these settings global for all visitors');
  };

  const resetGlobal = () => {
    clearPreviewConfig();
    setHasPreview(false);
    if (globalCfg) setCfg(JSON.parse(JSON.stringify(globalCfg)));
    setErrors({});
    notify('Local preview cleared — now using the deployed global config');
  };

  const Toggle = ({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? 'bg-blue-600' : 'bg-gray-300'}`} role="switch" aria-checked={on} aria-label={label}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );

  const I = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const Card = ({ title, icon, badge, children }: { title: string; icon: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode }) => (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm flex items-center gap-2">{icon}{title}</h2>
        {badge}
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  );

  const StatusPill = ({ ok, text }: { ok: boolean; text: string }) => (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-400'}`} />{text}
    </span>
  );

  const enabledPlacements = PLACEMENT_KEYS.filter(k => cfg.placements[k].enabled && AD_SLOT_RE.test(cfg.placements[k].slot.trim()));
  const adsenseOk = cfg.adsenseEnabled && CLIENT_ID_RE.test(cfg.adsenseClientId.trim());

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Marketing &amp; Traffic</h1>
        <div className="flex items-center gap-2">
          {hasPreview && <StatusPill ok text="Local preview active (this browser)" />}
          <span className="text-[11px] text-gray-400">Code installed ≠ Google approved</span>
        </div>
      </div>

      {/* Traffic Overview */}
      <Card title="Traffic Overview" icon={<TrendingUp size={18} className="text-blue-600" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Google AdSense</p>
            <p className="font-semibold">{adsenseOk ? 'Configured' : cfg.adsenseEnabled ? 'Invalid config' : 'Disabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Auto Ads</p>
            <p className="font-semibold">{adsenseOk && cfg.autoAdsEnabled ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">ads.txt</p>
            <p className="font-semibold">{adsTxtStatus === 'configured' ? 'Configured' : adsTxtStatus === 'checking' ? 'Checking…' : 'Missing / Invalid'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Manual Ad Units</p>
            <p className="font-semibold">{enabledPlacements.length > 0 ? `${enabledPlacements.length} enabled` : 'None enabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Google Analytics</p>
            <p className="font-semibold">{cfg.gaEnabled && cfg.ga4Id ? `Connected (${cfg.ga4Id})` : 'Not configured'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Publisher</p>
            <p className="font-semibold text-[13px]">{cfg.publisherId || '—'}</p>
          </div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 leading-relaxed">
          <strong>Active mode:</strong> {activeModeLabel(cfg)}.
          {!adsenseOk && cfg.adsenseEnabled ? ' Fix the Client ID to enable ads.' : ''}
          These are configuration status cards — no visitor traffic numbers are shown here.
        </div>
      </Card>

      {/* Google AdSense */}
      <Card title="Google AdSense" icon={<Megaphone size={18} className="text-blue-600" />} badge={<StatusPill ok={adsenseOk} text={adsenseOk ? 'Configured' : 'Not configured'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Google AdSense</p>
            <p className="text-xs text-gray-400 mt-0.5">Loads the AdSense script on the public storefront.</p>
          </div>
          <Toggle on={cfg.adsenseEnabled} onChange={v => set({ adsenseEnabled: v })} label="Enable Google AdSense" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={L}>AdSense Client ID</label>
            <input className={I + (errors.adsenseClientId ? ' border-red-300' : '')} value={cfg.adsenseClientId}
              onChange={e => set({ adsenseClientId: e.target.value, publisherId: e.target.value.trim().startsWith('ca-pub-') ? e.target.value.trim().replace('ca-', '') : cfg.publisherId })} />
            {errors.adsenseClientId ? <p className="text-red-500 text-xs mt-1">{errors.adsenseClientId}</p>
              : <p className="text-xs text-gray-400 mt-1">Public Google AdSense publisher/client identifier. This is not a secret API key.</p>}
          </div>
          <div>
            <label className={L}>Publisher ID</label>
            <input className={I + (errors.publisherId ? ' border-red-300' : '')} value={cfg.publisherId}
              onChange={e => set({ publisherId: e.target.value })} />
            {errors.publisherId ? <p className="text-red-500 text-xs mt-1">{errors.publisherId}</p>
              : <p className="text-xs text-gray-400 mt-1">Kept in sync with the Client ID.</p>}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Auto Ads</p>
            <p className="text-xs text-gray-400 mt-0.5">Lets Google decide ad placement automatically. Loads the script once.</p>
          </div>
          <Toggle on={cfg.autoAdsEnabled} onChange={v => set({ autoAdsEnabled: v })} label="Enable Auto Ads" />
        </div>
      </Card>

      {/* ads.txt */}
      <Card title="ads.txt" icon={<FileText size={18} className="text-blue-600" />} badge={
        <StatusPill ok={adsTxtStatus === 'configured'} text={adsTxtStatus === 'configured' ? 'Configured' : adsTxtStatus === 'checking' ? 'Checking…' : adsTxtStatus === 'invalid' ? 'Invalid' : 'Missing'} />
      }>
        <p className="text-xs text-gray-400">Served at <code className="bg-gray-100 px-1 rounded">https://luxedge.us/ads.txt</code> (committed in <code className="bg-gray-100 px-1 rounded">public/ads.txt</code>).</p>
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-gray-200 bg-gray-50 p-3">
          <code className="text-xs font-mono break-all">{cfg.adsTxtRecord}</code>
          <button onClick={copyAdsTxt} className="shrink-0 px-3.5 py-2 bg-white border border-gray-200 hover:border-blue-300 text-xs font-semibold rounded-lg text-gray-700 transition-colors">Copy ads.txt Entry</button>
        </div>
        {adsTxtStatus === 'missing' && <p className="text-xs text-amber-600">ads.txt was not found at /ads.txt in this environment.</p>}
      </Card>

      {/* Ad Placements */}
      <Card title="Ad Placements" icon={<Layers size={18} className="text-blue-600" />} badge={<StatusPill ok={enabledPlacements.length > 0} text={enabledPlacements.length > 0 ? `${enabledPlacements.length} enabled` : 'None enabled'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Manual Ad Units</p>
            <p className="text-xs text-gray-400 mt-0.5">Places ads at the configured spots below.</p>
          </div>
          <Toggle on={cfg.manualAdsEnabled} onChange={v => set({ manualAdsEnabled: v })} label="Enable Manual Ad Units" />
        </div>

        <div className="space-y-3">
          {PLACEMENT_KEYS.map(k => (
            <div key={k} className="rounded-xl border border-gray-100 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{PLACEMENT_LABELS[k]}</p>
                  {cfg.placements[k].enabled && !cfg.placements[k].slot.trim() && (
                    <p className="text-[11px] text-amber-600 mt-0.5">Create an ad unit in Google AdSense and paste its data-ad-slot ID here.</p>
                  )}
                  {errors[`slot_${k}`] && <p className="text-[11px] text-red-500 mt-0.5">{errors[`slot_${k}`]}</p>}
                </div>
                <Toggle on={cfg.placements[k].enabled} onChange={v => setPl(k, { enabled: v })} label={PLACEMENT_LABELS[k]} />
              </div>
              {cfg.placements[k].enabled && (
                <div className="mt-3">
                  <label className="text-[11px] font-semibold text-gray-500">Google Ad Slot ID</label>
                  <input className={I + ' mt-1' + (errors[`slot_${k}`] ? ' border-red-300' : '')} placeholder="1234567890"
                    value={cfg.placements[k].slot} onChange={e => setPl(k, { slot: e.target.value.replace(/\D/g, '') })} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Density, Mobile, Exclusions */}
      <Card title="Density & Controls" icon={<Sliders size={18} className="text-blue-600" />}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={L}>Advertising Density (manual placements)</label>
            <select className={I} value={cfg.density} onChange={e => set({ density: e.target.value as MarketingConfig['density'] })}>
              <option value="low">Low</option><option value="balanced">Balanced</option><option value="high">High</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Controls how many Luxedge-managed manual units render per page. Does not override Google Auto Ads.</p>
          </div>
          <div>
            <label className={L}>Mobile Manual Ad Density</label>
            <select className={I} value={cfg.mobileDensity} onChange={e => set({ mobileDensity: e.target.value as MarketingConfig['mobileDensity'] })} disabled={!cfg.showAdsOnMobile}>
              <option value="low">Low</option><option value="balanced">Balanced</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Mobile stays light — fewer, non-overlapping units.</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Show Ads on Mobile</p>
            <p className="text-xs text-gray-400 mt-0.5">Manual ad units on phones &amp; small screens.</p>
          </div>
          <Toggle on={cfg.showAdsOnMobile} onChange={v => set({ showAdsOnMobile: v })} label="Show Ads on Mobile" />
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Disable Ads On</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {([['cart', 'Cart'], ['checkout', 'Checkout'], ['login', 'Login'], ['signup', 'Signup'], ['admin', 'Admin'], ['account', 'Account pages']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2.5 text-sm cursor-pointer">
                <span>{label}</span>
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={cfg.exclusions[k]} onChange={e => setEx(k, e.target.checked)} />
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Ads NEVER render inside the admin panel regardless of this setting.</p>
        </div>
      </Card>

      {/* Google Analytics */}
      <Card title="Google Analytics" icon={<Globe size={18} className="text-blue-600" />} badge={<StatusPill ok={!!cfg.gaEnabled && !!cfg.ga4Id} text={cfg.gaEnabled && cfg.ga4Id ? 'Connected' : 'Not configured'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Google Analytics (GA4)</p>
            <p className="text-xs text-gray-400 mt-0.5">Loads the gtag.js script and sends page_view + ecommerce events.</p>
          </div>
          <Toggle on={cfg.gaEnabled} onChange={v => set({ gaEnabled: v })} label="Enable Google Analytics" />
        </div>
        <div>
          <label className={L}>GA4 Measurement ID</label>
          <input className={I + (errors.ga4Id ? ' border-red-300' : '')} placeholder="G-XXXXXXXXXX"
            value={cfg.ga4Id} onChange={e => set({ ga4Id: e.target.value })} />
          {errors.ga4Id ? <p className="text-red-500 text-xs mt-1">{errors.ga4Id}</p>
            : <p className="text-xs text-gray-400 mt-1">Paste the GA4 Measurement ID from your Google Analytics property. No API key needed for standard browser tracking.</p>}
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">Events wired to real user actions: <code className="bg-gray-100 px-1 rounded">page_view</code>, <code className="bg-gray-100 px-1 rounded">view_item</code>, <code className="bg-gray-100 px-1 rounded">add_to_cart</code>, <code className="bg-gray-100 px-1 rounded">begin_checkout</code>, <code className="bg-gray-100 px-1 rounded">purchase</code>, <code className="bg-gray-100 px-1 rounded">search</code>. UTM campaign parameters are captured per session.</p>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <Save size={16} /> Save Settings
        </button>
        <button onClick={handleTest} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-blue-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <RefreshCw size={16} /> Test Configuration
        </button>
        <button onClick={exportConfig} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-blue-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <Download size={16} /> Export site-config.json
        </button>
        {hasPreview && (
          <button onClick={resetGlobal} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-red-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <RotateCcw size={16} /> Reset to Global
          </button>
        )}
      </div>

      {saved && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
          <CheckCircle size={16} /> Settings saved as a preview for this browser. Download site-config.json and commit it to the repo to make these settings global for all visitors.
        </div>
      )}
      {testResult && (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${testResult.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {testResult.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          {testResult.msg}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 leading-relaxed">
        <strong className="text-gray-700">Global deployment note:</strong> This project is a static site served by Vercel with no backend. Browser
        localStorage only previews changes on this device. To make settings apply to <em>all</em> visitors, download
        <code className="bg-white px-1 rounded"> site-config.json </code>, commit it to the repo at
        <code className="bg-white px-1 rounded"> public/site-config.json </code>, and deploy. The <code className="bg-white px-1 rounded">ads.txt</code>
        file at the site root ships with every deploy. A consent/CMP banner is not implemented on this site — depending on your jurisdiction you may
        need to add one before serving personalized ads/tracking to visitors.
      </div>
    </div>
  );
}


// ============================================================================
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
          {/* Admin - EACH SECTION IS ITS OWN ROUTE with Protection */}
          <Route path="/admin" element={<ProtectedRoute requireAdmin={true}><AdminLayout><ADashboard /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/products" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AProducts /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/products/new" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AProductEdit /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/products/edit/:id" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AProductEdit /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/orders" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AOrders /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AUsers /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/categories" element={<ProtectedRoute requireAdmin={true}><AdminLayout><ACategories /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/reviews" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AReviews /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/blogs" element={<ProtectedRoute requireAdmin={true}><AdminLayout><ABlogs /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/seo-engine" element={<ProtectedRoute requireAdmin={true}><AdminLayout><ASEOEngine /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/marketing" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AMarketingGen /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/variant-gen" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AVariantGen /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/ai" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AAIHub /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/ai-import" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AAIImport /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute requireAdmin={true}><AdminLayout><ASettings /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/marketing-traffic" element={<ProtectedRoute requireAdmin={true}><AdminLayout><AMarketingTraffic /></AdminLayout></ProtectedRoute>} />
          {/* Fallback */}
          <Route path="*" element={<SLayout><HomePage /></SLayout>} />
        </Routes>
        <Toast />
      </HashRouter>
    </AppProvider>
  );
}
