import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ShoppingBag, Menu, X, Search, User as UserIcon, LogOut, Package,
  Shield, Star, Truck, RotateCcw, Award, Zap, ArrowRight, Mail, Phone,
  MapPin, Plus, Minus, Trash2, Lock, Loader2, CheckCircle, CreditCard,
  FolderTree, Edit2, Users as UsersIcon, Settings, LayoutDashboard,
  ShoppingCart, AlertTriangle, ToggleLeft, ToggleRight, Eye,
  ChevronDown, ChevronRight, Save, ArrowLeft, DollarSign, Upload, ImageIcon,
  Globe, Clock, Send, Headphones, ChevronLeft, Sparkles, TrendingUp,
  FileText, PenLine, Calendar, Tag, BookOpen, EyeOff, ChevronUp,
  Bot, Clipboard, Link2, RefreshCw, Wand2, History, Layers, Shuffle, Table2, Sliders,
  Monitor, Smartphone, Share2, Code,
  Megaphone, Target,
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

async function callAIProvider(prompt: string, providers: AIProvider[], onProgress?: (m:string)=>void): Promise<string> {
  const active = providers.filter(p => p.enabled && p.apiKey.trim());
  if (!active.length) throw new Error('No AI provider configured. Go to Settings → AI Providers and add an API key.');
  const provider = active.find(p => p.isDefault) || active[0];
  onProgress?.(`Using ${provider.name} (${provider.defaultModel})…`);
  if (provider.id === 'openai') return _callOpenAI(prompt, provider);
  if (provider.id === 'gemini') return _callGemini(prompt, provider);
  if (provider.id === 'openrouter') return _callOpenRouter(prompt, provider);
  if (provider.id === 'anthropic') return _callAnthropic(prompt, provider);
  throw new Error('Unknown AI provider');
}

async function fetchPageContent(url: string, scrapedoKey?: string): Promise<string> {
  const proxies = [
    scrapedoKey?.trim() ? `https://api.scrape.do/?token=${scrapedoKey.trim()}&url=${encodeURIComponent(url)}&render=true` : null,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ].filter(Boolean) as string[];
  let lastErr = '';
  for (const proxy of proxies) {
    try {
      const r = await fetch(proxy, { signal: AbortSignal.timeout(20000) });
      if (r.ok) {
        const html = await r.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('script,style,nav,footer,aside').forEach(el => el.remove());
        // Extract images from the page
        const imgs: string[] = [];
        doc.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
          if (src.startsWith('http') && (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp'))) {
            imgs.push(src);
          }
        });
        const text = (doc.body?.innerText || '').slice(0, 12000);
        return JSON.stringify({ text, images: [...new Set(imgs)].slice(0, 30) });
      }
    } catch (e: any) { lastErr = e.message; }
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
  "category": "best matching: Tech & Gadgets | Home & Living | Wellness | Accessories | Style",
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
- luxuryTitle: make it sound premium, e.g. "ProSound Elite Wireless Earbuds" → "Elite Noise-Cancelling Audio Experience | ProSound"
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
  { ...DP, id:'1', name:'ProSound Elite Wireless Earbuds', shortDesc:'Noise-cancelling wireless earbuds', description:'Crystal-clear audio with active noise cancellation, 36-hour battery life, Bluetooth 5.3.', price:49.99, originalPrice:89.99, category:'Tech & Gadgets', stock:145, images:['https://images.pexels.com/photos/3780681/pexels-photo-3780681.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.8, reviews:2341, isActive:true, brand:'ProSound', weight:'0.15 lbs', tags:['earbuds','wireless','audio'], variants:[{id:'v1',color:'Black',size:'One Size',price:49.99,salePrice:49.99,stock:80,sku:'PS-BLK'},{id:'v2',color:'White',size:'One Size',price:49.99,salePrice:49.99,stock:65,sku:'PS-WHT'}] },
  { ...DP, id:'2', name:'LuxeTime Pro Smartwatch', shortDesc:'Premium health smartwatch', description:'Health monitoring, GPS, and premium design. Heart rate, sleep tracking, 100+ workout modes.', price:79.99, originalPrice:149.99, category:'Tech & Gadgets', stock:89, images:['https://images.pexels.com/photos/437037/pexels-photo-437037.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.7, reviews:1856, isActive:true, brand:'LuxeTime', weight:'0.12 lbs', tags:['smartwatch','fitness','gps'], variants:[{id:'v3',color:'Black',size:'42mm',price:79.99,salePrice:79.99,stock:50,sku:'LT-B42'},{id:'v4',color:'Silver',size:'46mm',price:89.99,salePrice:89.99,stock:39,sku:'LT-S46'}] },
  { ...DP, id:'3', name:'AuraGlow LED Desk Lamp', shortDesc:'Smart RGB desk lamp', description:'Smart ambient lighting with 16M colors and app control.', price:34.99, originalPrice:59.99, category:'Home & Living', stock:234, images:['https://images.pexels.com/photos/1112598/pexels-photo-1112598.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.9, reviews:3102, isActive:true, brand:'AuraGlow', weight:'1.2 lbs', tags:['lamp','led','smart home'] },
  { ...DP, id:'4', name:'VortexFit Resistance Band Set', shortDesc:'5-level resistance bands', description:'Professional-grade bands for home workouts. 5 levels included.', price:29.99, originalPrice:54.99, category:'Wellness', stock:8, images:['https://images.pexels.com/photos/4498362/pexels-photo-4498362.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.6, reviews:1245, isActive:true, brand:'VortexFit', weight:'0.8 lbs', tags:['fitness','bands','workout'] },
  { ...DP, id:'5', name:'Luxe Minimalist Leather Wallet', shortDesc:'RFID-blocking slim wallet', description:'RFID-blocking genuine leather. Slim profile, maximum organization.', price:24.99, originalPrice:44.99, category:'Accessories', stock:178, images:['https://images.pexels.com/photos/2079171/pexels-photo-2079171.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.8, reviews:987, isActive:true, brand:'Luxedge', weight:'0.2 lbs', tags:['wallet','leather','rfid'], variants:[{id:'v5',color:'Black',size:'Standard',price:24.99,salePrice:24.99,stock:90,sku:'W-BLK'},{id:'v6',color:'Brown',size:'Standard',price:24.99,salePrice:24.99,stock:88,sku:'W-BRN'}] },
  { ...DP, id:'6', name:'CloudRest Memory Foam Pillow', shortDesc:'Cooling gel pillow', description:'Ergonomic cooling gel memory foam pillow for perfect sleep.', price:39.99, originalPrice:69.99, category:'Home & Living', stock:5, images:['https://images.pexels.com/photos/6311392/pexels-photo-6311392.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.9, reviews:2876, isActive:true, brand:'CloudRest', weight:'2.5 lbs', tags:['pillow','memory foam','sleep'] },
  { ...DP, id:'7', name:'TechPro Laptop Stand', shortDesc:'Aluminum laptop riser', description:'Adjustable aluminum stand for better posture and airflow.', price:32.99, originalPrice:59.99, category:'Tech & Gadgets', stock:67, images:['https://images.pexels.com/photos/4065891/pexels-photo-4065891.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.7, reviews:1534, isActive:true, brand:'TechPro', weight:'1.5 lbs', tags:['laptop','stand','ergonomic'] },
  { ...DP, id:'8', name:'Signature Fragrance Collection', shortDesc:'Premium unisex perfume', description:'Premium unisex long-lasting fragrance. Notes of sandalwood & bergamot.', price:44.99, originalPrice:79.99, category:'Style', stock:56, images:['https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&w=600'], rating:4.8, reviews:765, isActive:true, brand:'Luxedge', weight:'0.5 lbs', tags:['fragrance','perfume','unisex'] },
];

const INIT_ADMIN: AppUser = { id: 'adm', email: 'admin@luxedge.us', password: 'admin123', name: 'Admin', role: 'admin', joined: '2024-01-01' };
const INIT_USERS: AppUser[] = [
  { id: 'u1', email: 'john@test.com', password: 'password123', name: 'John Smith', role: 'buyer', joined: '2024-01-15' },
  { id: 'u2', email: 'sarah@test.com', password: 'password123', name: 'Sarah Johnson', role: 'buyer', joined: '2024-02-20' },
  { id: 'u3', email: 'mike@test.com', password: 'password123', name: 'Mike Williams', role: 'buyer', joined: '2024-03-01' },
];

const INIT_ORDERS: Order[] = [
  { id: 'ORD-001', userId: 'u1', userName: 'John Smith', items: [{ product: INIT_PRODUCTS[0], quantity: 1 }], total: 49.99, status: 'Delivered', date: '2024-03-01', address: '123 Main St, Austin TX' },
  { id: 'ORD-002', userId: 'u2', userName: 'Sarah Johnson', items: [{ product: INIT_PRODUCTS[2], quantity: 2 }], total: 69.98, status: 'Shipped', date: '2024-03-10', address: '456 Oak Ave, Dallas TX' },
  { id: 'ORD-003', userId: 'u1', userName: 'John Smith', items: [{ product: INIT_PRODUCTS[4], quantity: 1 }], total: 24.99, status: 'Processing', date: '2024-03-14', address: '123 Main St, Austin TX' },
  { id: 'ORD-004', userId: 'u3', userName: 'Mike Williams', items: [{ product: INIT_PRODUCTS[6], quantity: 1 }, { product: INIT_PRODUCTS[7], quantity: 1 }], total: 77.98, status: 'Pending', date: '2024-03-15', address: '789 Pine St, Houston TX' },
];

const INIT_REVIEWS: Review[] = [
  { id: 'r1', productId: '1', productName: 'ProSound Elite Wireless Earbuds', userName: 'John Smith', rating: 5, comment: 'Best earbuds ever!', status: 'approved', date: '2024-03-05' },
  { id: 'r2', productId: '3', productName: 'AuraGlow LED Desk Lamp', userName: 'Sarah Johnson', rating: 4, comment: 'Great lamp, love the colors.', status: 'approved', date: '2024-03-08' },
  { id: 'r3', productId: '5', productName: 'Luxe Minimalist Leather Wallet', userName: 'Mike Williams', rating: 5, comment: 'Sleek and functional!', status: 'pending', date: '2024-03-14' },
  { id: 'r4', productId: '6', productName: 'CloudRest Memory Foam Pillow', userName: 'Sarah Johnson', rating: 5, comment: 'Sleep has never been better.', status: 'pending', date: '2024-03-15' },
];

const INIT_CATEGORIES: AdminCategory[] = [
  { id: 'c1', name: 'Tech & Gadgets', isActive: true, subs: [{ id: 'c1s1', name: 'Smartwatches', isActive: true }, { id: 'c1s2', name: 'Audio', isActive: true }] },
  { id: 'c2', name: 'Home & Living', isActive: true, subs: [{ id: 'c2s1', name: 'Lighting', isActive: true }, { id: 'c2s2', name: 'Bedding', isActive: true }] },
  { id: 'c3', name: 'Wellness', isActive: true, subs: [] },
  { id: 'c4', name: 'Accessories', isActive: true, subs: [] },
  { id: 'c5', name: 'Style', isActive: true, subs: [] },
];

const INIT_BLOGS: BlogPost[] = [
  { id:'b1', slug:'top-5-tech-gadgets-2025', title:'Top 5 Tech Gadgets You Need in 2025', excerpt:'From smart earbuds to next-gen smartwatches, here are the must-have tech products this year.', content:'Technology is evolving rapidly, and 2025 brings some incredible innovations to everyday life.\n\n## 1. Wireless Earbuds with ANC\nNoise-cancelling earbuds have become essential. The ProSound Elite offers crystal-clear audio with 36-hour battery life. With Bluetooth 5.3 and IPX5 water resistance, these are perfect for commuters and gym-goers alike.\n\n## 2. Health-Focused Smartwatches\nThe LuxeTime Pro tracks heart rate, sleep, and 100+ workouts while looking premium on your wrist. With a 7-day battery life and AMOLED display, it rivals watches costing twice the price.\n\n## 3. Smart Lighting\nLED desk lamps like the AuraGlow transform your workspace with 16 million colors controlled via app. They reduce eye strain and boost productivity during late-night work sessions.\n\n## 4. Ergonomic Laptop Stands\nWork-from-home setups demand proper posture. Aluminum stands improve airflow, reduce neck strain, and create a cleaner workspace. The TechPro stand is adjustable for any laptop size.\n\n## 5. Portable Fitness Gear\nResistance bands and compact equipment let you work out anywhere without a gym membership. The VortexFit set includes 5 resistance levels for full-body training.', image:'https://images.pexels.com/photos/3780681/pexels-photo-3780681.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['tech','gadgets','2025','best products'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-03-10' },
  { id:'b2', slug:'how-to-create-perfect-workspace', title:'How to Create the Perfect Home Workspace', excerpt:'Tips for building a productive and stylish home office that boosts your focus and creativity.', content:'Working from home is here to stay. Here\'s how to create a workspace that makes you actually want to sit down and be productive.\n\n## Choose the Right Desk\nYour desk is your foundation. Go for something spacious with cable management. A standing desk converter can add flexibility to your routine.\n\n## Lighting Matters\nNatural light is king, but a smart LED lamp like the AuraGlow adds ambient warmth for evening work sessions. Studies show proper lighting reduces eye fatigue by up to 50%.\n\n## Invest in Ergonomics\nA good laptop stand, ergonomic chair, and proper monitor height prevent back pain and improve focus. Your screen should be at eye level to avoid neck strain.\n\n## Keep It Minimal\nClutter kills productivity. Use organizers and keep only essentials on your desk. A clean workspace leads to a clear mind.\n\n## Add Personal Touches\nA plant, a fragrance diffuser, or a quality leather desk mat can make your space feel premium. Small upgrades have a big impact on your daily motivation.', image:'https://images.pexels.com/photos/1112598/pexels-photo-1112598.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['workspace','home office','productivity','remote work'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-03-05' },
  { id:'b3', slug:'wellness-routine-for-busy-people', title:'A Simple Wellness Routine for Busy People', excerpt:'Stay healthy without spending hours at the gym. Quick routines that actually work for real schedules.', content:'You don\'t need two hours at the gym to stay fit. Here\'s a realistic wellness routine for people with packed schedules.\n\n## Morning Stretch (5 min)\nStart your day with basic stretches. Use resistance bands for added benefit. Just 5 minutes of morning movement increases energy levels by 20%.\n\n## Walk More\nAim for 8,000 steps daily. Take calls while walking, use stairs instead of elevators, and park further away from entrances.\n\n## Stay Hydrated\nKeep a water bottle at your desk. Aim for 8 glasses daily. Dehydration is the #1 cause of afternoon fatigue.\n\n## Evening Wind-Down\nA memory foam pillow and proper sleep hygiene can transform your recovery. The CloudRest pillow is designed with cooling gel for optimal neck support.\n\n## Quick Home Workouts\nResistance band sets offer 5 intensity levels for full-body workouts in under 20 minutes. No gym required — just consistency.', image:'https://images.pexels.com/photos/4498362/pexels-photo-4498362.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['wellness','fitness','health','self care'], authorId:'u1', authorName:'John Smith', status:'published', date:'2025-02-28' },
  { id:'b4', slug:'best-gifts-under-50-dollars', title:'Best Gift Ideas Under $50 That Look Expensive', excerpt:'Impress anyone without breaking the bank. These curated gift ideas look premium but cost less than fifty dollars.', content:'Finding the perfect gift doesn\'t mean spending a fortune. Here are premium-looking gifts that won\'t break the bank.\n\n## 1. Leather Wallet ($24.99)\nAn RFID-blocking slim wallet is practical, stylish, and something everyone needs. It looks like a $100 gift.\n\n## 2. Smart LED Lamp ($34.99)\nThe AuraGlow creates ambient lighting with millions of colors. It\'s a unique, memorable gift for any home.\n\n## 3. Wireless Earbuds ($49.99)\nProSound Elite earbuds deliver premium sound quality at a fraction of brand-name prices.\n\n## 4. Memory Foam Pillow ($39.99)\nThe CloudRest pillow with cooling gel technology is the gift of better sleep.\n\n## 5. Fragrance Collection ($44.99)\nA signature unisex fragrance is always a classy choice. Long-lasting notes of sandalwood and bergamot.', image:'https://images.pexels.com/photos/2079171/pexels-photo-2079171.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['gifts','budget','under 50','holiday'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-02-20' },
  { id:'b5', slug:'smart-home-gadgets-beginners-guide', title:'Smart Home Gadgets: A Beginner\'s Complete Guide', excerpt:'Transform your home with affordable smart tech. No technical skills required.', content:'Smart home technology isn\'t just for tech experts anymore. Here\'s how anyone can get started.\n\n## Start with Smart Lighting\nSmart bulbs and LED lamps are the easiest entry point. Control colors, brightness, and schedules from your phone.\n\n## Add Smart Speakers\nVoice assistants help you control lights, play music, set timers, and get answers hands-free.\n\n## Smart Plugs Are Underrated\nTurn any device into a smart device. Schedule your coffee maker, fans, or lamps to turn on automatically.\n\n## Security Basics\nSmart doorbells and cameras provide peace of mind. Many work without monthly subscriptions.\n\n## Build Gradually\nDon\'t buy everything at once. Start with one room and expand as you learn what works for your lifestyle.', image:'https://images.pexels.com/photos/1112598/pexels-photo-1112598.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['smart home','technology','IoT','beginner guide'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-02-15' },
  { id:'b6', slug:'how-to-sleep-better-tonight', title:'How to Sleep Better Tonight: Science-Backed Tips', excerpt:'Struggling with sleep? These proven techniques will help you fall asleep faster and wake up refreshed.', content:'Sleep quality affects everything from productivity to mood. Here are science-backed strategies.\n\n## Temperature Matters\nKeep your bedroom between 65-68°F. A cooling memory foam pillow helps regulate head temperature throughout the night.\n\n## The 10-3-2-1-0 Rule\n10 hours before bed: no caffeine. 3 hours: no food. 2 hours: no work. 1 hour: no screens. 0: the number of times you hit snooze.\n\n## Invest in Your Pillow\nYour pillow is the most important sleep investment. The CloudRest ergonomic pillow supports proper neck alignment.\n\n## Create a Dark Environment\nBlackout curtains or a sleep mask block light that disrupts your circadian rhythm.\n\n## Consistent Schedule\nGo to bed and wake up at the same time every day, even weekends. Your body thrives on routine.', image:'https://images.pexels.com/photos/6311392/pexels-photo-6311392.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['sleep','health','wellness','self improvement'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-02-10' },
  { id:'b7', slug:'minimalist-edc-essentials', title:'Minimalist EDC: 7 Everyday Carry Essentials for Men', excerpt:'Streamline your pockets with these essential everyday carry items that combine function and style.', content:'Every Day Carry (EDC) is about having just what you need, nothing more.\n\n## 1. Slim Wallet\nDitch the bulky bifold. A minimalist RFID-blocking wallet holds essentials without the bulk.\n\n## 2. Quality Watch\nA smartwatch combines timekeeping with health tracking. The LuxeTime Pro is perfect for daily wear.\n\n## 3. Wireless Earbuds\nCompact earbuds for calls, music, and podcasts on the go. ANC blocks distractions in noisy environments.\n\n## 4. Key Organizer\nStop the jingle. Key organizers keep everything compact and scratch-free.\n\n## 5. Portable Charger\nA slim power bank ensures you never run out of battery when it matters most.\n\n## 6. Quality Pen\nFor signing documents or jotting notes, a good pen makes an impression.\n\n## 7. Fragrance\nA subtle signature scent completes your daily carry with confidence.', image:'https://images.pexels.com/photos/2079171/pexels-photo-2079171.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['EDC','minimalist','men','accessories'], authorId:'u2', authorName:'Sarah Johnson', status:'published', date:'2025-02-05' },
  { id:'b8', slug:'resistance-band-workout-guide', title:'Complete Resistance Band Workout Guide for Beginners', excerpt:'Build muscle and improve flexibility with just resistance bands. Full workout plan included.', content:'Resistance bands are the most underrated fitness tool. Here\'s a complete beginner guide.\n\n## Why Bands Over Weights?\nBands provide constant tension, are portable, joint-friendly, and cost a fraction of gym equipment.\n\n## Upper Body Routine\nBicep curls, shoulder press, chest fly, and rows — all possible with bands. Start with medium resistance.\n\n## Lower Body Routine\nSquats with bands, lateral walks, glute bridges, and leg press alternatives target every major muscle group.\n\n## Core Workout\nWoodchops, pallof press, and band-resisted planks build functional core strength.\n\n## Sample Weekly Plan\nMonday: Upper body. Wednesday: Lower body. Friday: Full body + core. Weekend: Active recovery with stretching.\n\n## Progressive Overload\nStart with lighter bands and progress to heavier resistance as you get stronger. The VortexFit set includes 5 levels for exactly this progression.', image:'https://images.pexels.com/photos/4498362/pexels-photo-4498362.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['fitness','workout','resistance bands','exercise'], authorId:'u3', authorName:'Mike Williams', status:'published', date:'2025-01-30' },
  { id:'b9', slug:'online-shopping-safety-tips', title:'10 Online Shopping Safety Tips to Protect Your Money', excerpt:'Stay safe while shopping online. Expert tips to avoid scams and protect your personal information.', content:'Online shopping is convenient but requires awareness. Protect yourself with these tips.\n\n## 1. Shop on Secure Sites\nLook for HTTPS and the lock icon. Curated stores like Luxedge use 256-bit SSL encryption.\n\n## 2. Use Strong Passwords\nNever reuse passwords across shopping sites. Use a password manager for convenience.\n\n## 3. Check Return Policies\nBefore buying, know the return policy. Luxedge offers 30-day hassle-free returns.\n\n## 4. Read Real Reviews\nLook for verified purchase reviews with photos. Be wary of generic 5-star ratings.\n\n## 5. Use Credit Cards, Not Debit\nCredit cards offer better fraud protection than debit cards.\n\n## 6. Avoid Public WiFi\nNever enter payment info on public networks. Use mobile data or a VPN instead.\n\n## 7. Monitor Your Statements\nCheck bank statements regularly for unauthorized charges.\n\n## 8. Be Wary of Too-Good Deals\nIf a price seems impossibly low, it probably is.\n\n## 9. Use Trusted Payment Methods\nPayPal and Stripe provide buyer protection layers.\n\n## 10. Keep Software Updated\nUpdated browsers and devices have the latest security patches.', image:'https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['online shopping','safety','security','tips'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-01-25' },
  { id:'b10', slug:'fragrance-guide-choosing-right-scent', title:'How to Choose the Right Fragrance: A Complete Guide', excerpt:'Find your signature scent with this expert guide to fragrances, notes, and occasions.', content:'Choosing a fragrance is personal. Here\'s how to find one that suits you.\n\n## Understanding Fragrance Notes\nTop notes hit first (citrus, bergamot). Middle notes develop (floral, spice). Base notes linger (sandalwood, vanilla, musk).\n\n## Fragrance Concentration\nEau de Toilette lasts 3-5 hours. Eau de Parfum lasts 6-8 hours. Choose based on your needs.\n\n## Season Matters\nLight, fresh scents for summer. Warm, woody scents for winter. Our Signature Collection works year-round.\n\n## Where to Apply\nPulse points: wrists, neck, behind ears. Don\'t rub — it breaks down the molecules.\n\n## Less is More\n2-3 sprays is enough. You want people to notice when they\'re close, not from across the room.\n\n## Test Before You Commit\nWear a sample for a full day. Fragrance reacts differently with each person\'s skin chemistry.', image:'https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['fragrance','perfume','style','grooming'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-01-20' },
  { id:'b11', slug:'sustainable-shopping-eco-friendly', title:'Sustainable Shopping: How to Buy Better, Not More', excerpt:'Make environmentally conscious choices without sacrificing quality or style.', content:'Sustainability starts with intentional purchasing decisions.\n\n## Buy Quality Over Quantity\nOne well-made item that lasts years beats five cheap items that break in months. Luxedge curates for durability.\n\n## Check Materials\nLook for genuine leather over faux, aluminum over plastic, bamboo over synthetic materials.\n\n## Support Transparent Brands\nBrands that share their sourcing and manufacturing processes are worth your support.\n\n## Reduce Packaging Waste\nChoose retailers that use minimal, recyclable packaging.\n\n## Care for What You Own\nProper maintenance extends product life. Clean your leather wallet, charge devices properly, wash with care.\n\n## The 30-Day Rule\nBefore impulse buying, wait 30 days. If you still want it, it\'s a genuine need — not a passing urge.', image:'https://images.pexels.com/photos/4065891/pexels-photo-4065891.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['sustainable','eco friendly','conscious shopping'], authorId:'u2', authorName:'Sarah Johnson', status:'published', date:'2025-01-15' },
  { id:'b12', slug:'work-from-home-productivity-hacks', title:'15 Work From Home Productivity Hacks That Actually Work', excerpt:'Boost your remote work output with these proven strategies used by top performers.', content:'Remote work productivity requires intentional habits. Here are 15 that actually work.\n\n## 1. Start with Your Hardest Task\nTackle the most challenging work when your energy is highest — usually first thing in the morning.\n\n## 2. Use the Pomodoro Technique\n25 minutes of focused work, 5-minute break. Repeat. It prevents burnout and maintains concentration.\n\n## 3. Create Physical Boundaries\nA dedicated workspace — even a corner — signals to your brain that it\'s work time.\n\n## 4. Upgrade Your Setup\nAn ergonomic laptop stand, proper lighting, and a comfortable chair are investments in your productivity.\n\n## 5. Batch Similar Tasks\nGroup emails, calls, and admin work together. Context-switching kills efficiency.\n\n## 6. Use Noise-Cancelling Earbuds\nBlock distractions with ANC earbuds. ProSound Elite are designed for exactly this.\n\n## 7. Take Walking Breaks\nMovement between work blocks refreshes your mind and body.\n\n## 8-15: Advanced Tips\nTime-block your calendar. Say no to unnecessary meetings. Use a second monitor. Keep a done list. Optimize your lighting. Stay hydrated. End your day with a shutdown ritual. Review weekly.', image:'https://images.pexels.com/photos/4065891/pexels-photo-4065891.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['productivity','WFH','remote work','tips'], authorId:'adm', authorName:'Admin', status:'published', date:'2025-01-10' },
];

const CAT_LIST = ['All', 'Tech & Gadgets', 'Home & Living', 'Wellness', 'Accessories', 'Style'];
const CAT_META: Record<string, { icon: string; emoji: string; desc: string; img: string }> = {
  'Tech & Gadgets': { icon: '💻', emoji: '⚡', desc: 'Smart tech & electronics', img: 'https://images.pexels.com/photos/3780681/pexels-photo-3780681.jpeg?auto=compress&cs=tinysrgb&w=300' },
  'Home & Living': { icon: '🏠', emoji: '✨', desc: 'Decor, lighting & comfort', img: 'https://images.pexels.com/photos/1112598/pexels-photo-1112598.jpeg?auto=compress&cs=tinysrgb&w=300' },
  'Wellness': { icon: '💪', emoji: '🧘', desc: 'Health & fitness gear', img: 'https://images.pexels.com/photos/4498362/pexels-photo-4498362.jpeg?auto=compress&cs=tinysrgb&w=300' },
  'Accessories': { icon: '👜', emoji: '🎒', desc: 'Wallets, bags & more', img: 'https://images.pexels.com/photos/2079171/pexels-photo-2079171.jpeg?auto=compress&cs=tinysrgb&w=300' },
  'Style': { icon: '✨', emoji: '👔', desc: 'Fragrance & fashion', img: 'https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&w=300' },
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
  notif: string | null; notify: (m: string) => void;
}
const AC = createContext<Ctx | null>(null);
function useApp() { const c = useContext(AC); if (!c) throw new Error('no ctx'); return c; }

function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>(INIT_ORDERS);
  const [products, setProducts] = useState<Product[]>(INIT_PRODUCTS);
  const [users, setUsers] = useState<AppUser[]>(INIT_USERS);
  const [reviews, setReviews] = useState<Review[]>(INIT_REVIEWS);
  const [categories, setCategories] = useState<AdminCategory[]>(INIT_CATEGORIES);
  const [blogs, setBlogs] = useState<BlogPost[]>(INIT_BLOGS);
  const [adminCreds, setAdminCreds] = useState<AppUser>(INIT_ADMIN);
  const [notif, setNotif] = useState<string | null>(null);
  const notify = (m: string) => { setNotif(m); setTimeout(() => setNotif(null), 3000); };

  const login = (e: string, p: string, admin = false) => {
    // Admin login — checks against live adminCreds state
    if (admin) {
      if (e === adminCreds.email && p === adminCreds.password) {
        setUser({ ...adminCreds });
        notify('Welcome Admin!');
        return true;
      }
      return false;
    }
    // Buyer login — check registered users first, then allow new
    const existing = users.find(u => u.email.toLowerCase() === e.toLowerCase());
    if (existing) {
      if (existing.password === p) {
        if (existing.isBlocked) { notify('Account blocked. Contact support.'); return false; }
        setUser(existing);
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

  const logout = () => { setUser(null); notify('Logged out'); };

  const signup = (n: string, e: string, p: string) => {
    if (users.some(u => u.email.toLowerCase() === e.toLowerCase())) { notify('Email already registered'); return false; }
    if (p.length >= 6) {
      const newUser: AppUser = { id: `u${Date.now()}`, email: e, password: p, name: n, role: 'buyer', joined: new Date().toISOString().slice(0, 10) };
      setUsers(prev => [...prev, newUser]);
      setUser(newUser);
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
      return { ok: true, msg: 'Password updated successfully!' };
    } else {
      if (current !== user.password) return { ok: false, msg: 'Current password is incorrect' };
      if (newPass.length < 6) return { ok: false, msg: 'New password must be at least 6 characters' };
      const updated = { ...user, password: newPass };
      setUser(updated);
      setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
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
  const addToCart = (p: Product) => { setCart(prev => { const ex = prev.find(i => i.product.id === p.id); return ex ? prev.map(i => i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i) : [...prev, { product: p, quantity: 1 }]; }); notify(`Added to cart!`); };
  const removeFromCart = (id: string) => setCart(p => p.filter(i => i.product.id !== id));
  const updateQty = (id: string, q: number) => { if (q <= 0) removeFromCart(id); else setCart(p => p.map(i => i.product.id === id ? { ...i, quantity: q } : i)); };
  const clearCart = () => setCart([]);
  const placeOrder = (addr: string) => { const oid = `ORD-${Date.now()}`; const t = cart.reduce((s, i) => s + i.product.price * i.quantity, 0); setOrders(p => [{ id: oid, userId: user?.id || '', userName: user?.name || '', items: [...cart], total: t, status: 'Pending', date: new Date().toISOString(), address: addr }, ...p]); clearCart(); return oid; };

  return <AC.Provider value={{ user, cart, orders, products, users, reviews, categories, blogs, setBlogs, adminCreds, login, logout, signup, changePassword, updateAdminProfile, addToCart, removeFromCart, updateQty, clearCart, placeOrder, setProducts, setOrders, setUsers, setReviews, setCategories, notif, notify }}>{children}</AC.Provider>;
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
function Header() {
  const [mob, setMob] = useState(false);
  const [um, setUm] = useState(false);
  const loc = useLocation();
  const { user, cart, logout } = useApp();
  const cc = cart.reduce((s, i) => s + i.quantity, 0);
  useEffect(() => { setMob(false); setUm(false); }, [loc.pathname]);
  const nav = [{ p: '/', l: 'Home' }, { p: '/shop', l: 'Shop' }, { p: '/blog', l: 'Blog' }, { p: '/about', l: 'About' }, { p: '/contact', l: 'Contact' }];
  return (<>
    <div className="bg-gray-900 text-white text-center py-2 px-4 text-xs tracking-wider">✦ Free Shipping Over $50 | 30-Day Returns ✦</div>
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
        <button onClick={() => setMob(!mob)} className="lg:hidden p-2">{mob ? <X size={24} /> : <Menu size={24} />}</button>
        <Link to="/" className="flex items-center gap-2"><div className="w-8 h-8 bg-gray-900 rounded flex items-center justify-center"><span className="text-white font-serif font-bold">L</span></div><span className="font-serif text-xl font-bold">LUXEDGE</span></Link>
        <nav className="hidden lg:flex items-center gap-8">{nav.map(i => <Link key={i.p} to={i.p} className={`text-sm font-medium uppercase tracking-wide ${loc.pathname === i.p ? 'text-amber-600' : 'text-gray-700 hover:text-amber-600'}`}>{i.l}</Link>)}</nav>
        <div className="flex items-center gap-2">
          <Link to="/shop" className="p-2 hover:text-amber-600"><Search size={20} /></Link>
          {user ? (<div className="relative"><button onClick={() => setUm(!um)} className="p-2"><div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center"><span className="text-xs font-bold text-amber-700">{user.name[0]}</span></div></button>
            {um && <><div className="fixed inset-0 z-40" onClick={() => setUm(false)} /><div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-xl border py-2 z-50">
              <div className="px-4 py-2 border-b"><p className="font-semibold text-sm">{user.name}</p><p className="text-xs text-gray-500">{user.email}</p></div>
              {user.role === 'admin' && <Link to="/admin" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50"><LayoutDashboard size={16} />Admin</Link>}
              <Link to="/orders" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50"><Package size={16} />Orders</Link>
              <button onClick={logout} className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"><LogOut size={16} />Log Out</button>
            </div></>}</div>
          ) : <Link to="/login" className="flex items-center gap-1 p-2 hover:text-amber-600"><UserIcon size={20} /><span className="hidden sm:inline text-sm font-medium">Sign In</span></Link>}
          <Link to="/cart" className="p-2 hover:text-amber-600 relative"><ShoppingBag size={20} />{cc > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 text-white text-xs font-bold rounded-full flex items-center justify-center">{cc}</span>}</Link>
          <Link to="/admin/login" className="hidden sm:flex items-center gap-1 ml-2 px-3 py-1.5 bg-gray-800 text-white text-xs font-medium rounded-lg"><Shield size={14} />Admin</Link>
        </div>
      </div>
      {mob && <div className="lg:hidden border-t bg-white px-4 py-4 space-y-2">{nav.map(i => <Link key={i.p} to={i.p} className="block px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-100">{i.l}</Link>)}{!user && <Link to="/login" className="block px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-100">Sign In</Link>}<Link to="/admin/login" className="block px-4 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg mt-2">Admin Panel</Link></div>}
    </header>
  </>);
}

function Footer() {
  const [nlEmail, setNlEmail] = useState('');
  const [nlDone, setNlDone] = useState(false);
  const { categories } = useApp();

  const handleNl = (e: React.FormEvent) => {
    e.preventDefault();
    if (nlEmail) { setNlDone(true); setNlEmail(''); setTimeout(() => setNlDone(false), 4000); }
  };

  const FL = 'block text-sm text-gray-400 hover:text-amber-400 transition-colors py-1';

  return (
    <footer className="bg-gray-950 text-white">
      {/* ── Newsletter Banner ── */}
      <div className="bg-gradient-to-r from-amber-600 to-amber-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            <div className="text-center lg:text-left">
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">Join the Luxedge Inner Circle</h3>
              <p className="text-amber-100 text-sm">Get exclusive offers, new arrivals & member‑only deals — straight to your inbox.</p>
            </div>
            {nlDone ? (
              <div className="flex items-center gap-2 bg-white/20 backdrop-blur rounded-xl px-6 py-3 text-white font-semibold">
                <CheckCircle size={18} /> You're subscribed!
              </div>
            ) : (
              <form onSubmit={handleNl} className="flex w-full max-w-md">
                <input type="email" required placeholder="Enter your email address" value={nlEmail} onChange={e => setNlEmail(e.target.value)}
                  className="flex-1 px-5 py-3.5 rounded-l-xl bg-white/15 backdrop-blur border border-white/20 text-white placeholder-amber-100 text-sm focus:outline-none focus:bg-white/20" />
                <button type="submit" className="px-6 py-3.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-r-xl transition-colors flex items-center gap-2 text-sm">
                  <Send size={16} /> Subscribe
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Footer Grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-10 lg:gap-8">

          {/* Col 1 — Brand */}
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-serif font-bold text-lg">L</span>
              </div>
              <span className="font-serif text-xl font-bold tracking-tight">LUXEDGE</span>
            </Link>
            <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-xs">
              Curating the world's best products so you shop with confidence. Premium quality, honest prices, delivered to your door.
            </p>

            {/* Social Icons */}
            <div className="flex gap-3">
              {[
                { label: 'Facebook', letter: 'f', path: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z' },
                { label: 'Instagram', letter: 'i', path: 'M16 4H8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4zm-4 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm4.5-7.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z' },
                { label: 'TikTok', letter: 'T', path: 'M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5' },
                { label: 'YouTube', letter: 'Y', path: 'M2.5 17a2.5 2.5 0 0 1-2.5-2.5v-5A2.5 2.5 0 0 1 2.5 7h19A2.5 2.5 0 0 1 24 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-19zM10 15l5-3-5-3v6z' },
              ].map(s => (
                <a key={s.label} href="#" title={s.label}
                  className="w-10 h-10 bg-gray-800 hover:bg-amber-500 rounded-lg flex items-center justify-center transition-all duration-300 group">
                  <span className="text-gray-400 group-hover:text-white text-sm font-bold">{s.letter.toUpperCase()}</span>
                </a>
              ))}
            </div>
          </div>

          {/* Col 2 — Quick Links */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white mb-4">Quick Links</h4>
            <nav className="space-y-0.5">
              <Link to="/" className={FL}>Home</Link>
              <Link to="/shop" className={FL}>Shop All</Link>
              <Link to="/shop" className={FL}>New Arrivals</Link>
              <Link to="/shop" className={FL}>Deals</Link>
              <Link to="/login" className={FL}>Login / Signup</Link>
            </nav>
          </div>

          {/* Col 3 — Customer Support */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white mb-4">Support</h4>
            <nav className="space-y-0.5">
              <Link to="/contact" className={FL}>Contact Us</Link>
              <Link to="/faq" className={FL}>FAQs</Link>
              <Link to="/returns" className={FL}>Returns & Refunds</Link>
              <Link to="/shipping-policy" className={FL}>Shipping Policy</Link>
              <Link to="/orders" className={FL}>Track Order</Link>
            </nav>
          </div>

          {/* Col 4 — Company */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white mb-4">Company</h4>
            <nav className="space-y-0.5">
              <Link to="/about" className={FL}>About Us</Link>
              <Link to="/about" className={FL}>Our Story</Link>
              <Link to="/blog" className={FL}>Blog</Link>
              <Link to="/careers" className={FL}>Careers</Link>
              <Link to="/privacy" className={FL}>Privacy Policy</Link>
              <Link to="/terms" className={FL}>Terms of Service</Link>
            </nav>
          </div>

          {/* Col 5 — Contact + Map */}
          <div className="col-span-2 md:col-span-1">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white mb-4">Get in Touch</h4>
            <div className="space-y-3 mb-5">
              <a href="mailto:hello@luxedge.us" className="flex items-start gap-3 text-sm text-gray-400 hover:text-amber-400 transition-colors">
                <Mail size={16} className="text-amber-500 mt-0.5 shrink-0" />
                hello@luxedge.us
              </a>
              <a href="tel:4409418002" className="flex items-start gap-3 text-sm text-gray-400 hover:text-amber-400 transition-colors">
                <Phone size={16} className="text-amber-500 mt-0.5 shrink-0" />
                (440) 941-8002
              </a>
              <div className="flex items-start gap-3 text-sm text-gray-400">
                <MapPin size={16} className="text-amber-500 mt-0.5 shrink-0" />
                Irving, TX 75038, USA
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-400">
                <Clock size={16} className="text-amber-500 mt-0.5 shrink-0" />
                Mon – Fri, 9AM – 6PM CT
              </div>
            </div>

            {/* Mini Map */}
            <div className="rounded-xl overflow-hidden border border-gray-800 h-28">
              <iframe
                title="Luxedge Location"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d107176.94372626498!2d-97.03528895!3d32.85707655!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x864e7d124c349327%3A0x5eb3b1b65ad0e508!2sIrving%2C%20TX!5e0!3m2!1sen!2sus!4v1710000000000"
                width="100%" height="100%" style={{ border: 0 }} allowFullScreen loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Categories Bar ── */}
      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Shop by Category:</span>
            {categories.filter(c => c.isActive).map(c => (
              <Link key={c.id} to={`/category/${toSlug(c.name)}`} className="text-xs text-gray-500 hover:text-amber-400 transition-colors">{c.name}</Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── Trust & Payment Bar ── */}
      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            {/* Trust Badges */}
            <div className="flex flex-wrap items-center gap-4">
              {[
                { icon: Shield, text: 'Secure Checkout' },
                { icon: Truck, text: 'Free Shipping $50+' },
                { icon: RotateCcw, text: '30-Day Returns' },
                { icon: Headphones, text: '24/7 Support' },
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                  <b.icon size={14} className="text-amber-500" />
                  <span>{b.text}</span>
                </div>
              ))}
            </div>

            {/* Payment Methods */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-600 mr-1">We accept:</span>
              {['VISA', 'MC', 'AMEX', 'PayPal', 'Apple Pay'].map(c => (
                <span key={c} className="px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-[10px] font-bold text-gray-400 tracking-wide">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Bar ── */}
      <div className="border-t border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-600">
              © {new Date().getFullYear()} Luxedge. All rights reserved. | Irving, TX, USA
            </p>
            <div className="flex items-center gap-4">
              <Link to="/privacy" className="text-xs text-gray-600 hover:text-amber-400 transition-colors">Privacy Policy</Link>
              <span className="text-gray-800">|</span>
              <Link to="/terms" className="text-xs text-gray-600 hover:text-amber-400 transition-colors">Terms of Service</Link>
              <span className="text-gray-800">|</span>
              <Link to="/shop" className="text-xs text-gray-600 hover:text-amber-400 transition-colors">Sitemap</Link>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <Globe size={12} className="text-amber-500" /> USD ($) · English
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function PCard({ product }: { product: Product }) {
  const { addToCart, user } = useApp(); const nav = useNavigate();
  const d = Math.round((1 - product.price / product.originalPrice) * 100);
  return (
    <div className="bg-white rounded-xl border overflow-hidden group hover:shadow-xl transition-all">
      <Link to={`/product/${product.id}`} className="block">
        <div className="relative aspect-square overflow-hidden bg-gray-100">
          <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
          <span className="absolute top-3 right-3 px-2 py-1 bg-red-500 text-white text-xs font-bold rounded-full">-{d}%</span>
          {product.stock <= 10 && product.stock > 0 && <span className="absolute top-3 left-3 px-2 py-1 bg-amber-500 text-white text-xs font-bold rounded-full">Low Stock</span>}
          {product.stock === 0 && <span className="absolute top-3 left-3 px-2 py-1 bg-red-600 text-white text-xs font-bold rounded-full">Sold Out</span>}
        </div>
        <div className="p-4">
          <p className="text-xs text-amber-600 font-semibold uppercase tracking-wider mb-1">{product.category}</p>
          <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 min-h-[2.5rem]">{product.name}</h3>
          <div className="flex items-center gap-1 mb-2">{[...Array(5)].map((_, i) => <Star key={i} size={12} className={i < Math.round(product.rating) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'} />)}<span className="text-xs text-gray-500 ml-1">({product.reviews})</span></div>
          <div className="flex items-center gap-2 mb-3"><span className="text-lg font-bold">${product.price}</span><span className="text-sm text-gray-400 line-through">${product.originalPrice}</span></div>
        </div>
      </Link>
      <div className="px-4 pb-4">
        <button onClick={(e) => { e.stopPropagation(); user ? addToCart(product) : nav('/login'); }} className="w-full py-2.5 bg-gray-900 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors">Add to Cart</button>
      </div>
    </div>
  );
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
      <ScrollToTop />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
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
  const [zoom, setZoom] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const [revForm, setRevForm] = useState({ rating: 5, comment: '' });
  const [showRevForm, setShowRevForm] = useState(false);
  const [selColor, setSelColor] = useState('');
  const [selSize, setSelSize] = useState('');

  // Scroll to top on product change
  useEffect(() => { window.scrollTo(0, 0); setSelImg(0); setSelVariant(null); setQty(1); setTab('desc'); }, [id]);

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
          <Link to="/shop" className="px-6 py-3 bg-amber-500 text-white font-semibold rounded-lg">Back to Shop</Link>
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
    nav('/cart');
  };

  const submitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { nav('/login'); return; }
    setReviews(prev => [{ id: `r${Date.now()}`, productId: product.id, productName: product.name, userName: user.name, rating: revForm.rating, comment: revForm.comment, status: 'pending', date: new Date().toISOString() }, ...prev]);
    notify('Review submitted! It will appear after approval.');
    setRevForm({ rating: 5, comment: '' });
    setShowRevForm(false);
  };

  const handleZoomMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setZoomPos({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
  };

  const related = products.filter(p => p.isActive && p.id !== product.id && p.category === product.category).slice(0, 4);
  const relatedFallback = related.length === 0 ? products.filter(p => p.isActive && p.id !== product.id).slice(0, 4) : [];

  return (
    <div className="bg-white">
      {/* Breadcrumb */}
      <div className="bg-gray-50 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <nav className="flex items-center gap-2 text-sm text-gray-500">
            <Link to="/" className="hover:text-amber-600 transition-colors">Home</Link>
            <ChevronRight size={14} />
            <Link to="/shop" className="hover:text-amber-600 transition-colors">Shop</Link>
            <ChevronRight size={14} />
            <Link to="/shop" className="hover:text-amber-600 transition-colors">{product.category}</Link>
            <ChevronRight size={14} />
            <span className="text-gray-900 font-medium truncate max-w-[200px]">{product.name}</span>
          </nav>
        </div>
      </div>

      {/* Main Product Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-14">

          {/* ─── LEFT: Image Gallery ─── */}
          <div className="space-y-4">
            {/* Main Image with Zoom */}
            <div
              className="aspect-square rounded-2xl overflow-hidden bg-gray-100 relative cursor-crosshair group"
              onMouseEnter={() => setZoom(true)}
              onMouseLeave={() => setZoom(false)}
              onMouseMove={handleZoomMove}
            >
              <img
                src={product.images[selImg] || product.images[0]}
                alt={product.name}
                className={`w-full h-full object-cover transition-transform duration-200 ${zoom ? 'scale-[2]' : 'scale-100'}`}
                style={zoom ? { transformOrigin: `${zoomPos.x}% ${zoomPos.y}%` } : undefined}
              />
              {/* Badges */}
              {discount > 0 && <div className="absolute top-4 left-4 px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-full shadow-lg">-{discount}% OFF</div>}
              {activeStock > 0 && activeStock <= 10 && <div className="absolute top-4 right-4 px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-full shadow-lg flex items-center gap-1"><Zap size={12} />Low Stock</div>}
              {activeStock === 0 && <div className="absolute top-4 right-4 px-3 py-1.5 bg-gray-800 text-white text-xs font-bold rounded-full shadow-lg">Sold Out</div>}
              <div className="absolute bottom-4 right-4 text-[10px] text-gray-400 bg-white/80 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">🔍 Hover to zoom</div>
            </div>

            {/* Thumbnails */}
            <div className="flex gap-3 overflow-x-auto pb-1">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelImg(i)}
                  className={`w-20 h-20 rounded-xl overflow-hidden border-2 shrink-0 transition-all ${selImg === i ? 'border-amber-500 shadow-md ring-2 ring-amber-200' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {/* ─── RIGHT: Product Info ─── */}
          <div>
            {/* Brand & Category */}
            <div className="flex items-center gap-3 mb-2">
              {product.brand && <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">{product.brand}</span>}
              <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">{product.category}</span>
              {product.condition !== 'New' && <span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">{product.condition}</span>}
            </div>

            {/* Title */}
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-3 leading-tight">{product.name}</h1>

            {/* Rating Summary */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star key={i} size={16} className={i < Math.round(avgRating) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'} />)}</div>
              <span className="text-sm text-gray-500">{avgRating.toFixed(1)}</span>
              <span className="text-sm text-gray-300">|</span>
              <button onClick={() => setTab('reviews')} className="text-sm text-blue-600 hover:underline">{product.reviews.toLocaleString()} reviews</button>
              <span className="text-sm text-gray-300">|</span>
              <span className="text-xs text-green-600 font-medium">✓ {Math.floor(product.reviews * 0.87)} sold</span>
            </div>

            {/* Price Block */}
            <div className="bg-amber-50 rounded-xl p-5 mb-6">
              <div className="flex items-end gap-3 mb-1">
                <span className="text-3xl font-bold text-gray-900">${activePrice.toFixed(2)}</span>
                {discount > 0 && <>
                  <span className="text-lg text-gray-400 line-through">${activeOriginal.toFixed(2)}</span>
                  <span className="px-2.5 py-1 bg-red-500 text-white text-xs font-bold rounded-full">-{discount}%</span>
                </>}
              </div>
              {discount > 0 && <p className="text-sm text-green-700">You save <span className="font-bold">${(activeOriginal - activePrice).toFixed(2)}</span></p>}
              {product.freeShipping && <p className="text-xs text-amber-700 mt-2 flex items-center gap-1"><Truck size={12} /> Free Shipping</p>}
            </div>

            {/* Short Description */}
            {product.shortDesc && <p className="text-gray-600 mb-6">{product.shortDesc}</p>}

            {/* ─── Variant Selection ─── */}
            {product.variants.length > 0 && (
              <div className="space-y-5 mb-6">
                {/* Color Selector */}
                {uniqueColors.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                      Color: <span className="text-gray-900 normal-case">{selColor}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {uniqueColors.map(c => {
                        const colorMap: Record<string, string> = { Black: '#000', White: '#fff', Blue: '#3b82f6', Red: '#ef4444', Silver: '#9ca3af', Brown: '#92400e', Green: '#16a34a', Gold: '#d97706', Pink: '#ec4899' };
                        const bg = colorMap[c];
                        return (
                          <button key={c} onClick={() => setSelColor(c)} className={`relative rounded-lg transition-all ${selColor === c ? 'ring-2 ring-amber-500 ring-offset-2' : 'hover:ring-2 hover:ring-gray-300 hover:ring-offset-1'}`}>
                            {bg ? (
                              <div className={`w-10 h-10 rounded-lg border-2 ${c === 'White' ? 'border-gray-200' : 'border-transparent'}`} style={{ backgroundColor: bg }} />
                            ) : (
                              <div className="px-4 py-2 border-2 rounded-lg text-sm font-medium" style={{ borderColor: selColor === c ? '#f59e0b' : '#e5e7eb' }}>{c}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Size Selector */}
                {uniqueSizes.length > 0 && uniqueSizes[0] !== 'One Size' && uniqueSizes[0] !== 'Standard' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                      Size: <span className="text-gray-900 normal-case">{selSize}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {uniqueSizes.map(s => (
                        <button key={s} onClick={() => setSelSize(s)}
                          className={`min-w-[3rem] px-4 py-2.5 border-2 rounded-lg text-sm font-medium transition-all ${selSize === s ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Variant Info */}
                {selVariant && (
                  <div className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                    Selected: <span className="font-medium text-gray-700">{selVariant.color} / {selVariant.size}</span>
                    {selVariant.sku && <span className="ml-2">· SKU: {selVariant.sku}</span>}
                    <span className="ml-2">· Stock: {selVariant.stock}</span>
                  </div>
                )}
              </div>
            )}

            {/* Stock Status */}
            <div className="mb-5">
              {activeStock > 10 && <p className="text-green-600 text-sm font-medium flex items-center gap-1.5"><CheckCircle size={14} /> In Stock ({activeStock} available)</p>}
              {activeStock > 0 && activeStock <= 10 && <p className="text-amber-600 text-sm font-medium flex items-center gap-1.5"><AlertTriangle size={14} /> Only {activeStock} left — order soon!</p>}
              {activeStock === 0 && <p className="text-red-600 text-sm font-medium flex items-center gap-1.5"><X size={14} /> Out of Stock</p>}
            </div>

            {/* Quantity + Buttons */}
            <div className="space-y-3 mb-8">
              <div className="flex flex-wrap gap-3">
                {/* Quantity */}
                <div className="flex items-center border border-gray-200 rounded-xl">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-4 py-3 hover:bg-gray-50 rounded-l-xl transition-colors"><Minus size={16} /></button>
                  <span className="px-4 py-3 font-semibold min-w-[3rem] text-center border-x border-gray-200">{qty}</span>
                  <button onClick={() => setQty(Math.min(activeStock || 1, qty + 1))} className="px-4 py-3 hover:bg-gray-50 rounded-r-xl transition-colors"><Plus size={16} /></button>
                </div>

                {/* Add to Cart */}
                <button onClick={handleAddToCart} disabled={activeStock === 0}
                  className="flex-1 min-w-[180px] py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
                  <ShoppingBag size={18} />{activeStock === 0 ? 'Out of Stock' : 'Add to Cart'}
                </button>
              </div>

              {/* Buy Now */}
              <button onClick={handleBuyNow} disabled={activeStock === 0}
                className="w-full py-3.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
                <Zap size={16} /> Buy Now
              </button>
            </div>

            {/* Trust Badges */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Truck, t: 'Free Shipping', s: 'On orders $50+' },
                { icon: RotateCcw, t: '30-Day Returns', s: 'No questions asked' },
                { icon: Shield, t: 'Quality Guarantee', s: 'Money back' },
                { icon: Lock, t: 'Secure Checkout', s: 'SSL encrypted' },
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <b.icon size={18} className="text-amber-500 shrink-0" />
                  <div><p className="text-xs font-semibold text-gray-800">{b.t}</p><p className="text-[10px] text-gray-400">{b.s}</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Tabs: Description / Specs / Reviews ─── */}
        <div className="mt-14 border-t pt-10">
          <div className="flex border-b mb-8 overflow-x-auto">
            {([['desc', '📝 Description'], ['specs', '📋 Specifications'], ['reviews', `⭐ Reviews (${reviews.length})`]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`px-6 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${tab === key ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Description Tab */}
          {tab === 'desc' && (
            <div className="max-w-3xl">
              <p className="text-gray-700 leading-relaxed whitespace-pre-line">{product.description}</p>
              {product.tags.length > 0 && (
                <div className="mt-6 pt-6 border-t flex flex-wrap gap-2">
                  {product.tags.map(t => <span key={t} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">#{t}</span>)}
                </div>
              )}
            </div>
          )}

          {/* Specifications Tab */}
          {tab === 'specs' && (
            <div className="max-w-2xl">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ['Brand', product.brand],
                    ['Category', product.category],
                    ['Condition', product.condition],
                    ['Weight', product.weight],
                    ['Dimensions', product.dimensions],
                    ['Country of Origin', product.origin],
                    ['Shipping', product.freeShipping ? 'Free Shipping' : `$${product.shippingCost}`],
                    ['Variants', product.variants.length > 0 ? `${product.variants.length} options` : 'None'],
                  ].filter(([, v]) => v).map(([k, v], i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                      <td className="px-4 py-3 font-medium text-gray-600 w-1/3">{k}</td>
                      <td className="px-4 py-3 text-gray-900">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Reviews Tab */}
          {tab === 'reviews' && (
            <div className="max-w-3xl">
              {/* Review Summary */}
              <div className="flex flex-col sm:flex-row gap-8 mb-8 p-6 bg-gray-50 rounded-xl">
                <div className="text-center sm:pr-8 sm:border-r">
                  <p className="text-5xl font-bold text-gray-900">{avgRating.toFixed(1)}</p>
                  <div className="flex gap-0.5 justify-center my-2">{[...Array(5)].map((_, i) => <Star key={i} size={16} className={i < Math.round(avgRating) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'} />)}</div>
                  <p className="text-sm text-gray-500">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex-1 space-y-2">
                  {[5, 4, 3, 2, 1].map(stars => {
                    const count = reviews.filter(r => r.rating === stars).length;
                    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                    return (
                      <div key={stars} className="flex items-center gap-3">
                        <span className="text-sm text-gray-500 w-8">{stars}★</span>
                        <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} /></div>
                        <span className="text-xs text-gray-400 w-8">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Write Review */}
              {user ? (
                <div className="mb-8">
                  {!showRevForm ? (
                    <button onClick={() => setShowRevForm(true)} className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg">Write a Review</button>
                  ) : (
                    <form onSubmit={submitReview} className="bg-gray-50 rounded-xl p-6 space-y-4">
                      <h3 className="font-semibold text-gray-900">Your Review</h3>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Rating</label>
                        <div className="flex gap-1">{[1, 2, 3, 4, 5].map(s => (
                          <button key={s} type="button" onClick={() => setRevForm({ ...revForm, rating: s })}>
                            <Star size={24} className={s <= revForm.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'} />
                          </button>
                        ))}</div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Comment</label>
                        <textarea required rows={4} value={revForm.comment} onChange={e => setRevForm({ ...revForm, comment: e.target.value })} className="w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:border-amber-400 resize-none" placeholder="Share your experience..." />
                      </div>
                      <div className="flex gap-3">
                        <button type="submit" className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg">Submit</button>
                        <button type="button" onClick={() => setShowRevForm(false)} className="px-6 py-2.5 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-8"><Link to="/login" className="text-amber-600 font-semibold hover:underline">Sign in</Link> to write a review</p>
              )}

              {/* Reviews List */}
              {reviews.length > 0 ? (
                <div className="space-y-6">
                  {reviews.map(r => (
                    <div key={r.id} className="border-b border-gray-100 pb-6 last:border-0">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center"><span className="font-bold text-amber-700 text-sm">{r.userName.charAt(0)}</span></div>
                        <div>
                          <p className="font-semibold text-sm text-gray-900">{r.userName}</p>
                          <div className="flex items-center gap-2">
                            <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star key={i} size={12} className={i < r.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200'} />)}</div>
                            <span className="text-xs text-gray-400">{new Date(r.date).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 ml-[52px]">{r.comment}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-gray-50 rounded-xl"><p className="text-gray-400">No reviews yet. Be the first to review!</p></div>
              )}
            </div>
          )}
        </div>

        {/* ─── Related Products ─── */}
        <div className="mt-14 pt-10 border-t">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">You May Also Like</h2>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {(related.length > 0 ? related : relatedFallback).map(p => <PCard key={p.id} product={p} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STORE PAGES
// ============================================================================
function HomePage() {
  const { products } = useApp();
  const featured = products.filter(p => p.isActive);
  const heroProducts = featured.slice(0, 4);

  // Carousel
  const [cs, setCs] = useState(0);
  const [locked, setLocked] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>|null>(null);

  const go = useCallback((i: number) => { if (locked) return; setLocked(true); setCs(i); setTimeout(() => setLocked(false), 500); }, [locked]);
  const next = useCallback(() => go((cs + 1) % heroProducts.length), [cs, heroProducts.length, go]);
  const prev = useCallback(() => go((cs - 1 + heroProducts.length) % heroProducts.length), [cs, heroProducts.length, go]);

  useEffect(() => { if (heroProducts.length <= 1) return; timer.current = setInterval(next, 4000); return () => { if (timer.current) clearInterval(timer.current); }; }, [next, heroProducts.length]);
  const rst = () => { if (timer.current) clearInterval(timer.current); timer.current = setInterval(next, 4000); };

  const hp = heroProducts[cs];
  const disc = hp ? Math.round((1 - hp.price / hp.originalPrice) * 100) : 0;

  return (
    <div>
      {/* ════════ COMPACT HERO ════════ */}
      <section className="relative bg-gray-950 text-white overflow-hidden">
        {/* BG layers */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950" />
          <div className="absolute -top-32 right-0 w-[500px] h-[500px] bg-amber-500/5 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 -left-20 w-[350px] h-[350px] bg-amber-500/4 rounded-full blur-[90px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 lg:py-0">
          <div className="grid lg:grid-cols-2 gap-6 lg:gap-10 items-center lg:min-h-[65vh]">

            {/* LEFT — Copy */}
            <div className="order-2 lg:order-1 text-center lg:text-left py-4 lg:py-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400 text-[11px] font-semibold tracking-wider mb-4">
                <Sparkles size={12} />NEW ARRIVALS WEEKLY
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.12] mb-4">
                Discover Products<br />
                <span className="bg-gradient-to-r from-amber-400 to-amber-500 bg-clip-text text-transparent">Worth Owning.</span>
              </h1>

              <p className="text-gray-400 text-sm sm:text-base mb-6 max-w-md mx-auto lg:mx-0 leading-relaxed">
                Handpicked for quality, design, and value — delivered to your door.
              </p>

              <div className="flex flex-wrap gap-3 justify-center lg:justify-start mb-6">
                <Link to="/shop" className="group px-6 py-3 bg-amber-500 hover:bg-amber-400 text-gray-900 font-bold rounded-lg flex items-center gap-2 text-sm shadow-lg shadow-amber-500/20 transition-all">
                  Shop Now <ArrowRight size={15} className="group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link to="/about" className="px-6 py-3 border border-gray-700 hover:border-amber-500/40 text-gray-300 hover:text-amber-400 rounded-lg font-semibold text-sm transition-all">
                  Our Story
                </Link>
              </div>

              {/* Compact trust */}
              <div className="flex items-center justify-center lg:justify-start gap-4">
                <div className="flex -space-x-1.5">
                  {'SJME'.split('').map((l,i) => <div key={i} className="w-7 h-7 rounded-full bg-gray-800 border-2 border-gray-950 flex items-center justify-center text-[10px] font-bold text-gray-400">{l}</div>)}
                  <div className="w-7 h-7 rounded-full bg-amber-500 border-2 border-gray-950 flex items-center justify-center text-[9px] font-bold text-white">2k+</div>
                </div>
                <div>
                  <div className="flex gap-0.5">{[...Array(5)].map((_,i)=><Star key={i} size={10} className="text-amber-400 fill-amber-400" />)}</div>
                  <p className="text-[10px] text-gray-500">2,000+ happy customers</p>
                </div>
              </div>
            </div>

            {/* RIGHT — Product Showcase */}
            <div className="order-1 lg:order-2">
              {hp && (
                <div>
                  {/* Product Card */}
                  <Link to={`/product/${hp.id}`} className="block">
                    <div className="relative bg-gray-800/60 backdrop-blur rounded-2xl border border-gray-700/50 hover:border-amber-500/30 transition-all duration-500 group overflow-hidden">
                      {/* Image — constrained height */}
                      <div className="relative h-48 sm:h-56 lg:h-64 overflow-hidden">
                        <img key={hp.id} src={hp.images[0]} alt={hp.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                          style={{ animation: 'fadeIn 0.5s ease-out' }} loading="eager" />
                        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-gray-900/20 to-transparent" />

                        {disc > 0 && <span className="absolute top-3 left-3 px-2.5 py-1 bg-red-500 text-white text-[10px] font-bold rounded-full">-{disc}%</span>}
                        <span className="absolute top-3 right-3 px-2.5 py-1 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center gap-1"><TrendingUp size={10} />Trending</span>

                        {/* Product info overlaid at bottom of image */}
                        <div className="absolute bottom-0 left-0 right-0 p-4">
                          <p className="text-amber-400 text-[10px] font-semibold uppercase tracking-wider">{hp.category}</p>
                          <h3 className="text-white font-bold text-base sm:text-lg leading-tight mt-0.5 group-hover:text-amber-300 transition-colors">{hp.name}</h3>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-xl font-bold text-white">${hp.price.toFixed(2)}</span>
                            {disc > 0 && <span className="text-sm text-gray-400 line-through">${hp.originalPrice.toFixed(2)}</span>}
                            <div className="flex gap-0.5 ml-auto">{[...Array(5)].map((_,i)=><Star key={i} size={10} className={i < Math.round(hp.rating) ? 'text-amber-400 fill-amber-400' : 'text-gray-600'} />)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>

                  {/* Navigation strip */}
                  {heroProducts.length > 1 && (
                    <div className="flex items-center gap-3 mt-3">
                      <button onClick={() => { prev(); rst(); }} className="w-8 h-8 bg-gray-800 hover:bg-amber-500 border border-gray-700 rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-all shrink-0">
                        <ChevronLeft size={16} />
                      </button>

                      {/* Thumbnails */}
                      <div className="flex gap-2 flex-1 overflow-x-auto">
                        {heroProducts.map((p,i)=>(
                          <button key={p.id} onClick={() => { go(i); rst(); }}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border shrink-0 transition-all ${i===cs ? 'bg-gray-800 border-amber-500/50' : 'bg-gray-900/50 border-gray-800 hover:border-gray-700'}`}>
                            <img src={p.images[0]} alt="" className="w-8 h-8 rounded object-cover" loading="lazy" />
                            <span className="hidden sm:block text-[11px] font-semibold text-white truncate max-w-[70px]">{p.name.split(' ').slice(0,2).join(' ')}</span>
                          </button>
                        ))}
                      </div>

                      <button onClick={() => { next(); rst(); }} className="w-8 h-8 bg-gray-800 hover:bg-amber-500 border border-gray-700 rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-all shrink-0">
                        <ChevronRight size={16} />
                      </button>

                      {/* Dots */}
                      <div className="flex gap-1.5 ml-1">
                        {heroProducts.map((_,i)=>(
                          <button key={i} onClick={() => { go(i); rst(); }}
                            className={`h-1.5 rounded-full transition-all duration-300 ${i===cs ? 'w-5 bg-amber-500' : 'w-1.5 bg-gray-700'}`} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ════════ TRUST BAR ════════ */}
      <section className="bg-amber-50 border-y border-amber-100">
        <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { i: Truck, l: 'Free Shipping', d: 'On orders $50+' },
            { i: RotateCcw, l: '30-Day Returns', d: 'No questions' },
            { i: Shield, l: 'Secure Checkout', d: '100% encrypted' },
            { i: Award, l: 'Quality Promise', d: 'Handpicked' },
          ].map((x,i)=>(
            <div key={i} className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center shrink-0"><x.i size={16} className="text-amber-600" /></div>
              <div><p className="text-xs font-semibold leading-tight">{x.l}</p><p className="text-[10px] text-gray-500">{x.d}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* ════════ CATEGORIES ════════ */}
      <section className="py-10 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-8">
            <p className="text-amber-600 text-xs font-semibold uppercase tracking-wider mb-1">Browse</p>
            <h2 className="text-2xl font-bold text-gray-900">Shop by Category</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {CAT_LIST.filter(c => c !== 'All').map(c => {
              const meta = CAT_META[c];
              const count = featured.filter(p => p.category === c).length;
              return (
                <Link key={c} to={`/category/${toSlug(c)}`}
                  className="group relative rounded-2xl overflow-hidden border border-gray-100 hover:border-amber-300 hover:shadow-xl transition-all duration-300">
                  {/* Background Image */}
                  <div className="aspect-[4/3] relative">
                    <img src={meta?.img || ''} alt={c} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 via-gray-900/40 to-gray-900/10 group-hover:from-amber-900/80 transition-all duration-300" />
                    {/* Content */}
                    <div className="absolute inset-0 flex flex-col items-center justify-end p-4 text-center">
                      <span className="text-2xl mb-1">{meta?.icon}</span>
                      <h3 className="text-white font-bold text-sm">{c}</h3>
                      <p className="text-gray-300 text-[11px]">{count} product{count !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ════════ TRENDING PRODUCTS ════════ */}
      <section className="py-12 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-10">
            <p className="text-amber-600 text-xs font-semibold uppercase tracking-wider mb-1">Handpicked For You</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Trending This Week</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {featured.slice(0,8).map(p=><PCard key={p.id} product={p} />)}
          </div>
          <div className="text-center mt-8">
            <Link to="/shop" className="inline-flex items-center gap-2 px-7 py-3 bg-gray-900 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors text-sm">
              View All Products <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ════════ CTA ════════ */}
      <section className="py-14 bg-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-transparent" />
        <div className="max-w-3xl mx-auto px-4 text-center relative">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Ready to Upgrade Your Life?</h2>
          <p className="text-gray-400 mb-6 text-sm max-w-lg mx-auto">Join 2,000+ customers who shop smarter with Luxedge.</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/signup" className="px-7 py-3 bg-amber-500 hover:bg-amber-400 text-gray-900 font-bold rounded-lg flex items-center gap-2 text-sm shadow-lg shadow-amber-500/20">Create Account <ArrowRight size={15} /></Link>
            <Link to="/shop" className="px-7 py-3 border border-gray-700 hover:border-amber-500/40 text-white rounded-lg font-semibold text-sm transition-all">Browse Products</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function ShopPage() {
  const { slug } = useParams<{ slug?: string }>();
  const { products } = useApp();
  const nav = useNavigate();

  const initialCat = slug ? fromSlug(slug) : 'All';
  const [cat, setCat] = useState(initialCat);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('featured');

  // Sync when URL slug changes
  useEffect(() => { setCat(slug ? fromSlug(slug) : 'All'); }, [slug]);

  const f = products.filter(p => p.isActive)
    .filter(p => cat === 'All' || p.category === cat)
    .filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'price-low') return a.price - b.price;
      if (sort === 'price-high') return b.price - a.price;
      if (sort === 'rating') return b.rating - a.rating;
      return 0;
    });

  const handleCatChange = (newCat: string) => {
    if (newCat === 'All') nav('/shop');
    else nav(`/category/${toSlug(newCat)}`);
  };

  const pageTitle = cat === 'All' ? 'Shop All Products' : cat;
  const pageDesc = cat === 'All' ? 'Handpicked for quality, style, and value.' : CAT_META[cat]?.desc || `Browse our ${cat} collection`;

  return (
    <div>
      {/* Hero */}
      <section className="bg-gray-900 py-10">
        <div className="max-w-7xl mx-auto px-4 text-center">
          {/* Breadcrumb */}
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-4">
            <Link to="/" className="hover:text-amber-400 transition-colors">Home</Link>
            <ChevronRight size={12} />
            {cat !== 'All' ? <>
              <Link to="/shop" className="hover:text-amber-400 transition-colors">Shop</Link>
              <ChevronRight size={12} />
              <span className="text-amber-400">{cat}</span>
            </> : <span className="text-amber-400">Shop</span>}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{pageTitle}</h1>
          <p className="text-gray-400 text-sm">{pageDesc}</p>
        </div>
      </section>

      {/* Category Pills */}
      <section className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {CAT_LIST.map(c => (
              <button key={c} onClick={() => handleCatChange(c)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  cat === c
                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {c !== 'All' && <span className="mr-1.5">{CAT_META[c]?.icon}</span>}
                {c}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="py-8 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          {/* Search + Sort */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input placeholder="Search products..." value={q} onChange={e => setQ(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" />
            </div>
            <select value={sort} onChange={e => setSort(e.target.value)}
              className="px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400">
              <option value="featured">Featured</option>
              <option value="price-low">Price: Low → High</option>
              <option value="price-high">Price: High → Low</option>
              <option value="rating">Highest Rated</option>
            </select>
          </div>

          <p className="text-sm text-gray-500 mb-4">{f.length} product{f.length !== 1 ? 's' : ''}{cat !== 'All' ? ` in ${cat}` : ''}</p>

          {f.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {f.map(p => <PCard key={p.id} product={p} />)}
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-xl border">
              <p className="text-4xl mb-3">🔍</p>
              <p className="text-lg font-semibold text-gray-700 mb-1">No products found</p>
              <p className="text-sm text-gray-500 mb-6">{cat !== 'All' ? `No items in "${cat}" match your search.` : 'Try different search terms.'}</p>
              <button onClick={() => { setCat('All'); setQ(''); nav('/shop'); }} className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium">
                View All Products
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CartPage() {
  const { cart, updateQty, removeFromCart, user } = useApp(); const nav = useNavigate();
  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0); const sh = sub >= 50 ? 0 : 4.99; const tot = sub + sh;
  if (cart.length === 0) return <div className="min-h-[60vh] flex items-center justify-center"><div className="text-center"><ShoppingBag size={64} className="mx-auto text-gray-200 mb-4" /><h2 className="text-2xl font-bold mb-2">Cart Empty</h2><Link to="/shop" className="px-6 py-3 bg-amber-500 text-white font-semibold rounded-lg inline-block mt-4">Shop Now</Link></div></div>;
  return (<div className="py-12 bg-gray-50 min-h-screen"><div className="max-w-4xl mx-auto px-4"><h1 className="text-3xl font-serif font-bold mb-8">Shopping Cart</h1>
    <div className="bg-white rounded-xl border p-6 mb-6">{cart.map(i => <div key={i.product.id} className="flex gap-4 py-4 border-b last:border-0"><img src={i.product.images[0]} alt="" className="w-20 h-20 object-cover rounded-lg" /><div className="flex-1"><h3 className="font-semibold">{i.product.name}</h3><p className="text-amber-600 text-sm">${i.product.price}</p><div className="flex items-center gap-2 mt-2"><button onClick={() => updateQty(i.product.id, i.quantity - 1)} className="p-1 border rounded"><Minus size={14} /></button><span className="w-8 text-center">{i.quantity}</span><button onClick={() => updateQty(i.product.id, i.quantity + 1)} className="p-1 border rounded"><Plus size={14} /></button><button onClick={() => removeFromCart(i.product.id)} className="p-1 text-red-500 ml-4"><Trash2 size={16} /></button></div></div><p className="font-bold">${(i.product.price * i.quantity).toFixed(2)}</p></div>)}</div>
    <div className="bg-white rounded-xl border p-6"><div className="space-y-2 text-sm mb-4"><div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${sub.toFixed(2)}</span></div><div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className={sh === 0 ? 'text-green-600' : ''}>{sh === 0 ? 'FREE' : `$${sh}`}</span></div><div className="flex justify-between text-lg font-bold pt-2 border-t"><span>Total</span><span>${tot.toFixed(2)}</span></div></div><button onClick={() => nav(user ? '/checkout' : '/login')} className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg">{user ? 'Checkout' : 'Sign In to Checkout'}</button></div>
  </div></div>);
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

  const I = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all';
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

  const handleNext = () => { if (step === 1 && validateStep1()) setStep(2); };
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
          <Link to="/orders" className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl text-center text-sm">View Orders</Link>
          <Link to="/shop" className="flex-1 py-3 border border-gray-200 hover:bg-gray-50 font-semibold rounded-xl text-center text-sm">Continue Shopping</Link>
        </div>
      </div>
    </div>
  );

  // ── Processing ──
  if (step === 3) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6"><Loader2 size={36} className="text-amber-500 animate-spin" /></div>
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
                <div className={`flex items-center gap-2 ${step >= s.n ? 'text-amber-600' : 'text-gray-400'}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step > s.n ? 'bg-green-500 text-white' : step === s.n ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
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
                  <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><UserIcon size={18} className="text-amber-500" /> Contact Information</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><label className={L}>First Name *</label><input value={f.firstName} onChange={e => setF({...f, firstName: e.target.value})} className={I} placeholder="John" />{ER('firstName')}</div>
                    <div><label className={L}>Last Name *</label><input value={f.lastName} onChange={e => setF({...f, lastName: e.target.value})} className={I} placeholder="Doe" />{ER('lastName')}</div>
                    <div><label className={L}>Email *</label><input type="email" value={f.email} onChange={e => setF({...f, email: e.target.value})} className={I} placeholder="john@example.com" />{ER('email')}</div>
                    <div><label className={L}>Phone *</label><input type="tel" value={f.phone} onChange={e => setF({...f, phone: e.target.value})} className={I} placeholder="(555) 123-4567" />{ER('phone')}</div>
                  </div>
                </div>

                {/* Shipping Address */}
                <div className="bg-white rounded-2xl border p-6">
                  <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><Truck size={18} className="text-amber-500" /> Shipping Address</h2>
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
                  <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><Package size={18} className="text-amber-500" /> Shipping Method</h2>
                  <div className="space-y-3">
                    {[
                      { id: 'standard' as const, label: 'Standard Shipping', time: '7-12 business days', price: sub >= 50 ? 'FREE' : '$4.99', badge: sub >= 50 ? '🎉 Free!' : '' },
                      { id: 'express' as const, label: 'Express Shipping', time: '2-4 business days', price: '$9.99', badge: '' },
                    ].map(o => (
                      <label key={o.id} className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${shipMethod === o.id ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="radio" name="ship" checked={shipMethod === o.id} onChange={() => setShipMethod(o.id)} className="w-4 h-4 text-amber-500 border-gray-300" />
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

                <button onClick={handleNext} className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
                  Continue to Payment <ArrowRight size={16} />
                </button>
              </>
            )}

            {/* Step 2: Payment */}
            {step === 2 && (
              <>
                <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-amber-600 flex items-center gap-1 mb-2"><ArrowLeft size={14} /> Back to Information</button>

                <div className="bg-white rounded-2xl border p-6">
                  <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><CreditCard size={18} className="text-amber-500" /> Payment Method</h2>

                  {/* Method Toggle */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <button onClick={() => setPayMethod('card')} className={`p-4 rounded-xl border-2 text-left transition-all ${payMethod === 'card' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-7 bg-gradient-to-r from-blue-600 to-blue-400 rounded flex items-center justify-center"><span className="text-white text-[8px] font-bold">STRIPE</span></div>
                        <div><p className="font-semibold text-sm">Credit / Debit</p><p className="text-[10px] text-gray-500">Visa, MC, Amex</p></div>
                      </div>
                    </button>
                    <button onClick={() => setPayMethod('paypal')} className={`p-4 rounded-xl border-2 text-left transition-all ${payMethod === 'paypal' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'}`}>
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

                <button onClick={handlePay} className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
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
                {shipCost > 0 && sub < 50 && <p className="text-xs text-amber-600">💡 Add ${(50 - sub).toFixed(2)} more for free shipping!</p>}
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
                    <b.i size={14} className="text-amber-500 shrink-0" />{b.t}
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
  if (orders.filter(o => o.userId === user?.id).length === 0 && user?.role !== 'admin') return <div className="min-h-[60vh] flex items-center justify-center"><div className="text-center"><Package size={64} className="mx-auto text-gray-200 mb-4" /><h2 className="text-2xl font-bold mb-2">No Orders</h2><Link to="/shop" className="text-amber-600 font-semibold">Shop Now</Link></div></div>;
  return <div className="py-12 bg-gray-50 min-h-screen"><div className="max-w-4xl mx-auto px-4"><h1 className="text-3xl font-serif font-bold mb-8">My Orders</h1>{orders.filter(o => user?.role === 'admin' || o.userId === user?.id).map(o => <div key={o.id} className="bg-white rounded-xl border p-6 mb-4"><div className="flex justify-between mb-4"><div><p className="font-semibold">{o.id}</p><p className="text-sm text-gray-500">{new Date(o.date).toLocaleDateString()}</p></div><span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">{o.status}</span></div>{o.items.map(i => <div key={i.product.id} className="flex items-center gap-4 py-2 border-t"><img src={i.product.images[0]} alt="" className="w-12 h-12 rounded object-cover" /><div className="flex-1"><p className="font-medium">{i.product.name}</p><p className="text-sm text-gray-500">Qty: {i.quantity}</p></div><p className="font-semibold">${(i.product.price * i.quantity).toFixed(2)}</p></div>)}<div className="pt-4 mt-4 border-t flex justify-between"><span className="font-semibold">Total</span><span className="text-lg font-bold text-amber-600">${o.total.toFixed(2)}</span></div></div>)}</div></div>;
}

function LoginPage() { const [e, setE] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const { login } = useApp(); const nav = useNavigate();
  const sub = (ev: React.FormEvent) => { ev.preventDefault(); if (login(e, p)) nav('/'); else setErr('Invalid credentials'); };
  return <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4"><div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8"><div className="text-center mb-6"><Link to="/"><span className="font-serif text-2xl font-bold">LUXEDGE</span></Link></div><h1 className="text-2xl font-bold text-center mb-6">Sign In</h1>{err && <p className="text-red-500 text-sm text-center mb-4">{err}</p>}<form onSubmit={sub} className="space-y-4"><input type="email" placeholder="Email" value={e} onChange={ev => setE(ev.target.value)} className="w-full px-4 py-3 border rounded-lg" required /><input type="password" placeholder="Password" value={p} onChange={ev => setP(ev.target.value)} className="w-full px-4 py-3 border rounded-lg" required /><button type="submit" className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg">Sign In</button></form><p className="text-center text-sm text-gray-500 mt-4">No account? <Link to="/signup" className="text-amber-600 font-semibold">Sign Up</Link></p></div></div>;
}

function SignupPage() { const [n, setN] = useState(''); const [e, setE] = useState(''); const [p, setP] = useState(''); const { signup } = useApp(); const nav = useNavigate();
  return <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4"><div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8"><h1 className="text-2xl font-bold text-center mb-6">Create Account</h1><form onSubmit={ev => { ev.preventDefault(); if (signup(n, e, p)) nav('/'); }} className="space-y-4"><input placeholder="Full Name" value={n} onChange={ev => setN(ev.target.value)} className="w-full px-4 py-3 border rounded-lg" required /><input type="email" placeholder="Email" value={e} onChange={ev => setE(ev.target.value)} className="w-full px-4 py-3 border rounded-lg" required /><input type="password" placeholder="Password (6+)" value={p} onChange={ev => setP(ev.target.value)} className="w-full px-4 py-3 border rounded-lg" required minLength={6} /><button type="submit" className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg">Sign Up</button></form><p className="text-center text-sm text-gray-500 mt-4">Have an account? <Link to="/login" className="text-amber-600 font-semibold">Sign In</Link></p></div></div>;
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
          <Shield className="text-blue-500" size={28} />
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
            <input type="email" placeholder="Enter admin email" value={e} onChange={ev => setE(ev.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Password</label>
            <input type="password" placeholder="Enter password" value={p} onChange={ev => setP(ev.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" required />
          </div>
          <button type="submit" className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2">
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
      <section className="bg-gray-900 py-10"><div className="max-w-4xl mx-auto px-4 text-center"><h1 className="text-3xl font-bold text-white">{title}</h1></div></section>
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
    <section className="bg-gray-900 py-16"><div className="max-w-4xl mx-auto px-4 text-center">
      <p className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-3">Our Story</p>
      <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">About Luxedge</h1>
      <p className="text-gray-400 max-w-xl mx-auto">More than a store — a commitment to quality you can feel.</p>
    </div></section>
    <section className="py-14"><div className="max-w-3xl mx-auto px-4 space-y-6">
      <p className="text-lg text-gray-700 leading-relaxed">Luxedge was born from a simple frustration: finding quality products online shouldn't feel like a gamble. Too many marketplaces are flooded with low-quality items, misleading photos, and unreliable sellers.</p>
      <p className="text-gray-600 leading-relaxed">We decided to build something different. Based in Irving, Texas, Luxedge is a curated ecommerce destination where every product is handpicked by our team before it ever reaches our shelves. We test, compare, and reject hundreds of items to list only the ones we'd genuinely recommend to friends and family.</p>
      <h2 className="text-xl font-bold text-gray-900 pt-4">Our Mission</h2>
      <p className="text-gray-600 leading-relaxed">To make premium-quality products accessible to everyone — without the premium markup. We believe great design and solid craftsmanship shouldn't cost a fortune. Every item on Luxedge represents the best value we could find at its price point.</p>
      <h2 className="text-xl font-bold text-gray-900 pt-4">Customer-First, Always</h2>
      <p className="text-gray-600 leading-relaxed">We stand behind everything we sell. That means free shipping on orders over $50, a 30-day hassle-free return policy, and a support team that actually responds. If something isn't right with your order, we make it right — no runaround, no fine print.</p>
      <p className="text-gray-600 leading-relaxed">Whether you're upgrading your workspace, looking for the perfect gift, or simply treating yourself to something well-made, Luxedge is here to help you shop smarter and live better.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-10 pt-8 border-t">
        {[{v:'2,000+',l:'Happy Customers'},{v:'500+',l:'Products Curated'},{v:'99%',l:'Satisfaction Rate'},{v:'24/7',l:'Customer Support'}].map((s,i)=>
          <div key={i} className="text-center"><p className="text-2xl font-bold text-amber-500">{s.v}</p><p className="text-xs text-gray-500 mt-1">{s.l}</p></div>
        )}
      </div>
    </div></section>
  </div>);
}

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="March 15, 2025">
      <LS t="1. Introduction"><p>At Luxedge ("we," "our," or "us"), we respect your privacy and are committed to protecting your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your data when you visit luxedge.us and make purchases through our platform.</p></LS>
      <LS t="2. Information We Collect"><p><strong>Personal Information:</strong> When you create an account, place an order, or contact us, we may collect your name, email address, phone number, shipping address, and billing information.</p><p className="mt-2"><strong>Automatically Collected Data:</strong> We collect certain information automatically, including your IP address, browser type, device information, pages visited, time spent on pages, and referring URLs. This data helps us improve our website and your shopping experience.</p></LS>
      <LS t="3. How We Use Your Information"><p>We use your information to: process and fulfill orders; send order confirmations and shipping updates; respond to customer service requests; personalize your shopping experience; send promotional communications (with your consent); prevent fraud and maintain security; comply with legal obligations.</p></LS>
      <LS t="4. Third-Party Services"><p>We work with trusted third-party providers to operate our business:</p><ul className="list-disc pl-5 mt-2 space-y-1"><li><strong>Payment Processing:</strong> Stripe and PayPal process payments securely. We never store your full credit card number.</li><li><strong>Analytics:</strong> Google Analytics helps us understand how visitors use our site.</li><li><strong>Advertising:</strong> Google AdSense displays relevant advertisements. Google may use cookies to serve ads based on your browsing history.</li><li><strong>Shipping Partners:</strong> Carrier services receive your shipping address to deliver orders.</li></ul></LS>
      <LS t="5. Cookies & Tracking"><p>Luxedge uses cookies and similar technologies to remember your preferences, maintain your shopping cart, analyze traffic, and display relevant ads. You can manage cookie preferences through your browser settings. Note that disabling cookies may affect certain features of our website.</p></LS>
      <LS t="6. Data Security"><p>We implement industry-standard security measures, including 256-bit SSL encryption for all data transmission and PCI-DSS compliant payment processing. While no method of electronic storage is 100% secure, we continuously work to protect your personal information.</p></LS>
      <LS t="7. Data Retention"><p>We retain your personal information for as long as your account is active or as needed to provide you services, comply with legal obligations, resolve disputes, and enforce our agreements.</p></LS>
      <LS t="8. Your Rights"><p>Depending on your location, you may have the right to: access the personal data we hold about you; request correction of inaccurate data; request deletion of your data; opt out of marketing communications; withdraw consent where processing is based on consent. To exercise these rights, email us at hello@luxedge.us.</p></LS>
      <LS t="9. Children's Privacy"><p>Luxedge is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13.</p></LS>
      <LS t="10. Changes to This Policy"><p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date. We encourage you to review this policy periodically.</p></LS>
      <LS t="11. Contact Us"><p>If you have questions about this Privacy Policy, contact us at:<br />Email: hello@luxedge.us<br />Phone: (440) 941-8002<br />Address: Luxedge, Irving, TX 75038, USA</p></LS>
    </LegalPage>
  );
}

function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="March 15, 2025">
      <LS t="1. Agreement to Terms"><p>By accessing or using Luxedge.us (the "Site"), you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not access the Site. These terms apply to all visitors, users, and customers.</p></LS>
      <LS t="2. Eligibility"><p>You must be at least 18 years old to use this Site or make purchases. By using Luxedge, you represent and warrant that you meet this age requirement.</p></LS>
      <LS t="3. Products & Pricing"><p>All prices on Luxedge are displayed in US Dollars (USD). We make every effort to display accurate pricing and product information, but errors may occur. We reserve the right to correct any errors and to change or update product information at any time without prior notice. Product availability is subject to change without notice.</p></LS>
      <LS t="4. Orders & Payment"><p>When you place an order, you are making an offer to purchase. We reserve the right to accept or decline your order for any reason, including product availability, pricing errors, or suspected fraud. We accept Visa, MasterCard, American Express, Discover, and PayPal. Payment is processed at the time of order placement.</p></LS>
      <LS t="5. Shipping & Delivery"><p>Luxedge ships to addresses within the United States. Standard shipping typically takes 7-12 business days, and express shipping takes 2-4 business days. Free standard shipping is available on orders totaling $50 or more. Delivery times are estimates and not guarantees. Luxedge is not responsible for delays caused by carriers, weather, or customs processing.</p></LS>
      <LS t="6. Returns & Refunds"><p>We offer a 30-day return policy from the date of delivery. Items must be unused, unworn, and in their original packaging with all tags attached. To initiate a return, contact our support team at hello@luxedge.us. Refunds are processed within 5-7 business days after we receive and inspect the returned item. Original shipping costs are non-refundable. For detailed conditions, please see our Returns & Refund Policy page.</p></LS>
      <LS t="7. Account Responsibilities"><p>You are responsible for maintaining the confidentiality of your account credentials. You agree to accept responsibility for all activities that occur under your account. Luxedge reserves the right to suspend or terminate accounts that violate these terms.</p></LS>
      <LS t="8. User-Generated Content"><p>By submitting product reviews, blog posts, or any other content to Luxedge, you grant us a non-exclusive, royalty-free, worldwide license to use, display, and distribute your content on our platform and marketing channels. You represent that your content is original and does not infringe on third-party rights.</p></LS>
      <LS t="9. Intellectual Property"><p>All content on Luxedge, including text, graphics, logos, images, and software, is the property of Luxedge or its content suppliers and is protected by copyright and trademark laws. You may not reproduce, distribute, or create derivative works without our written permission.</p></LS>
      <LS t="10. Limitation of Liability"><p>Luxedge shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Site or purchase of products. Our total liability shall not exceed the amount you paid for the specific product giving rise to the claim.</p></LS>
      <LS t="11. Governing Law"><p>These Terms are governed by the laws of the State of Texas, United States, without regard to conflict of law principles. Any disputes shall be resolved in the courts of Dallas County, Texas.</p></LS>
      <LS t="12. Contact"><p>Questions about these Terms? Contact us at hello@luxedge.us or (440) 941-8002.</p></LS>
    </LegalPage>
  );
}

function ReturnsPage() {
  return (
    <LegalPage title="Returns & Refund Policy" updated="March 15, 2025">
      <LS t="Our Promise"><p>At Luxedge, your satisfaction is our priority. If you're not completely happy with your purchase, we're here to make it right. We offer a straightforward 30-day return policy — no hoops, no hassle.</p></LS>
      <LS t="Return Window"><p>You have <strong>30 calendar days</strong> from the date you receive your item to initiate a return. Items received after the 30-day window may not be eligible for a refund.</p></LS>
      <LS t="Eligible Items"><p>To qualify for a return, your item must be:</p><ul className="list-disc pl-5 mt-2 space-y-1"><li>Unused and in the same condition you received it</li><li>In its original packaging with all tags and accessories</li><li>Free from signs of wear, damage, or alteration</li></ul></LS>
      <LS t="Non-Returnable Items"><p>The following items cannot be returned:</p><ul className="list-disc pl-5 mt-2 space-y-1"><li>Items marked as "Final Sale" or "Non-Returnable"</li><li>Personal care products that have been opened or used (fragrances, skincare)</li><li>Gift cards and digital products</li><li>Items damaged through customer misuse</li></ul></LS>
      <LS t="How to Start a Return"><p>1. Email us at <strong>hello@luxedge.us</strong> with your order number and reason for return.<br/>2. Our team will respond within 24 hours with return instructions and a return authorization.<br/>3. Ship the item back using the method outlined in our response.<br/>4. Once received and inspected, we'll process your refund.</p></LS>
      <LS t="Refund Process"><p>Refunds are processed within <strong>5-7 business days</strong> after we receive and inspect your returned item. The refund will be credited to your original payment method. Please allow an additional 3-5 business days for the refund to appear on your bank statement.</p></LS>
      <LS t="Exchanges"><p>We don't do direct exchanges. If you need a different size, color, or product, simply return the original item for a refund and place a new order for the item you prefer.</p></LS>
      <LS t="Damaged or Defective Items"><p>If you received a damaged or defective product, contact us within 48 hours of delivery at hello@luxedge.us with photos of the issue. We will arrange a replacement or full refund at no additional cost to you, including return shipping.</p></LS>
      <LS t="Shipping Costs"><p>Original shipping charges are non-refundable. Return shipping costs are the responsibility of the customer, unless the return is due to a Luxedge error (wrong item, defective product, etc.).</p></LS>
      <LS t="Questions?"><p>Our customer support team is available Monday through Friday, 9 AM - 6 PM CT. Email hello@luxedge.us or call (440) 941-8002.</p></LS>
    </LegalPage>
  );
}

function ShippingPolicyPage() {
  return (
    <LegalPage title="Shipping Policy" updated="March 15, 2025">
      <LS t="Where We Ship"><p>Luxedge currently ships to all 50 US states and territories. We are working on expanding to international destinations — sign up for our newsletter to be notified when international shipping becomes available.</p></LS>
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
      { q: 'Do you ship internationally?', a: 'Currently, we ship only within the United States (all 50 states and territories). International shipping is coming soon — join our newsletter to be the first to know.' },
      { q: 'Can I change my shipping address after ordering?', a: 'If your order hasn\'t shipped yet, contact us immediately at hello@luxedge.us and we\'ll do our best to update the address. Once shipped, address changes are not possible.' },
    ]},
    { c: 'Returns & Refunds', qs: [
      { q: 'What is your return policy?', a: 'We offer a 30-day return policy. Items must be unused, in original packaging, and with all tags attached. Email hello@luxedge.us to start a return.' },
      { q: 'How long does a refund take?', a: 'Refunds are processed within 5-7 business days after we receive your return. It may take an additional 3-5 business days for the credit to appear on your statement.' },
      { q: 'Can I exchange an item?', a: 'We don\'t do direct exchanges. Simply return the original item for a refund and place a new order for the item you want. This ensures fastest processing.' },
      { q: 'What if I receive a damaged item?', a: 'Contact us within 48 hours of delivery with photos of the damage. We\'ll send a replacement or issue a full refund, including return shipping costs.' },
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
      <section className="bg-gray-900 py-10"><div className="max-w-4xl mx-auto px-4 text-center"><h1 className="text-3xl font-bold text-white mb-2">Frequently Asked Questions</h1><p className="text-gray-400 text-sm">Quick answers to common questions about shopping at Luxedge.</p></div></section>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {faqs.map(section => (
          <div key={section.c}>
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><ChevronRight size={16} className="text-amber-500" />{section.c}</h2>
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
          <Link to="/contact" className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm inline-flex items-center gap-2"><Mail size={16} />Contact Support</Link>
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
      <section className="bg-gray-900 py-10"><div className="max-w-4xl mx-auto px-4 text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Contact Us</h1>
        <p className="text-gray-400 text-sm max-w-lg mx-auto">Have a question, concern, or just want to say hello? We'd love to hear from you. Our team typically responds within 24 hours.</p>
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
              <x.i className="mx-auto mb-2 text-amber-500" size={22} />
              <p className="text-[10px] text-amber-600 font-semibold uppercase tracking-wider">{x.l}</p>
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
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Send size={18} className="text-amber-500" /> Send Us a Message</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Name *</label><input required placeholder="Your full name" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email *</label><input required type="email" placeholder="you@example.com" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400" /></div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Subject *</label>
                <select required className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400"><option value="">Select a topic</option><option>Order Question</option><option>Shipping & Tracking</option><option>Returns & Refunds</option><option>Product Inquiry</option><option>Technical Support</option><option>Other</option></select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Message *</label><textarea required placeholder="Tell us how we can help..." rows={5} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400 resize-none" /></div>
              <button type="submit" className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm transition-colors"><Send size={16} />Send Message</button>
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
      <section className="bg-gray-900 py-10"><div className="max-w-4xl mx-auto px-4 text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Careers at Luxedge</h1>
        <p className="text-gray-400 text-sm max-w-lg mx-auto">Join our growing team and help shape the future of curated ecommerce.</p>
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
              <div key={i} className="p-5 border border-gray-200 rounded-xl hover:border-amber-300 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-gray-900">{job.title}</h3>
                    <p className="text-xs text-amber-600 font-medium mt-0.5">{job.type}</p>
                    <p className="text-sm text-gray-600 mt-2">{job.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-3">How to Apply</h2>
          <p className="text-gray-600 leading-relaxed mb-4">Send your resume and a brief note about why you'd be a great fit to <strong>careers@luxedge.us</strong>. Include the role you're interested in as the subject line. We review all applications and aim to respond within one week.</p>
          <Link to="/contact" className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm inline-flex items-center gap-2">
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

// AdSense Ad Unit Component
function AdUnit({ slot, format = 'auto', className = '' }: { slot?: string; format?: string; className?: string }) {
  const adRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { if (adRef.current && typeof window !== 'undefined' && (window as any).adsbygoogle) { (window as any).adsbygoogle.push({}); } } catch (e) {}
  }, []);

  return (
    <div className={`ad-container my-6 ${className}`} ref={adRef}>
      <div className="text-center">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Advertisement</p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl min-h-[100px] flex items-center justify-center overflow-hidden">
          <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client="ca-pub-5473713135927706" data-ad-slot={slot || ''} data-ad-format={format} data-full-width-responsive="true" />
        </div>
      </div>
    </div>
  );
}

function BlogListPage() {
  const { blogs, user } = useApp();
  const published = blogs.filter(b => b.status === 'published');

  return (
    <div>
      <section className="bg-gray-900 py-10">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-2">Luxedge Blog</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Insights & Inspiration</h1>
          <p className="text-gray-400 text-sm max-w-lg mx-auto">Tips, guides, and stories from the world of curated products.</p>
        </div>
      </section>

      <section className="py-10 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4">
          {user && (
            <div className="flex justify-end mb-6">
              <Link to="/blog/write" className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg flex items-center gap-2 text-sm">
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
                    <h2 className="font-bold text-gray-900 mb-2 group-hover:text-amber-600 transition-colors leading-tight">{post.title}</h2>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-4">{post.excerpt}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1.5">{post.tags.slice(0, 3).map(t => <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-medium">#{t}</span>)}</div>
                      <span className="text-amber-600 text-sm font-semibold group-hover:underline flex items-center gap-1">Read More <ArrowRight size={14} /></span>
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
          {published.length > 0 && <AdUnit slot="blog-listing" />}
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
      <div className="text-center"><p className="text-5xl mb-4">📝</p><h2 className="text-2xl font-bold mb-2">Post Not Found</h2><Link to="/blog" className="px-6 py-3 bg-amber-500 text-white font-semibold rounded-lg">Back to Blog</Link></div>
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
      <div className="relative h-64 sm:h-80 lg:h-96 bg-gray-900">
        <img src={post.image} alt={post.title} className="w-full h-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 via-gray-900/40 to-transparent" />
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-20 relative z-10">
        {/* Post Header */}
        <div className="bg-white rounded-2xl shadow-xl border p-6 sm:p-10 mb-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-gray-400 mb-4">
            <Link to="/" className="hover:text-amber-600">Home</Link><ChevronRight size={12} />
            <Link to="/blog" className="hover:text-amber-600">Blog</Link><ChevronRight size={12} />
            <span className="text-gray-600 truncate max-w-[200px]">{post.title}</span>
          </nav>

          {/* Tags */}
          <div className="flex gap-2 mb-4">{post.tags.map(t => <span key={t} className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">#{t}</span>)}</div>

          {/* Title */}
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight mb-4">{post.title}</h1>

          {/* Meta */}
          <div className="flex items-center gap-4 pb-6 border-b mb-8">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center"><span className="font-bold text-amber-700 text-sm">{post.authorName.charAt(0)}</span></div>
            <div>
              <p className="font-semibold text-sm text-gray-900">{post.authorName}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar size={11} />{new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
          </div>

          {/* Ad: Top of Article */}
          <AdUnit slot="top-article" className="mt-2 mb-6" />

          {/* Content with mid-article ad */}
          <article className="prose-custom">
            {(() => {
              const lines = renderContent(post.content);
              const mid = Math.floor(lines.length / 2);
              return <>
                {lines.slice(0, mid)}
                <AdUnit slot="mid-article" className="my-6" />
                {lines.slice(mid)}
              </>;
            })()}
          </article>

          {/* Inline images */}
          {post.images.length > 0 && (
            <div className="grid grid-cols-2 gap-4 mt-8">
              {post.images.map((img, i) => <img key={i} src={img} alt="" className="rounded-xl w-full object-cover" />)}
            </div>
          )}

          {/* Ad: End of Article */}
          <AdUnit slot="end-article" className="mt-8" />

          {/* Related Posts */}
          {relatedPosts.length > 0 && (
            <div className="mt-10 pt-8 border-t">
              <h3 className="font-bold text-lg text-gray-900 mb-4">You May Also Like</h3>
              <div className="grid sm:grid-cols-3 gap-4">
                {relatedPosts.map(r => (
                  <Link key={r.id} to={`/blog/${r.slug}`} className="group flex gap-3 p-3 bg-gray-50 rounded-xl hover:bg-amber-50 transition-colors">
                    <img src={r.image} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 line-clamp-2 leading-tight">{r.title}</p>
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
          <Link to="/blog" className="text-amber-600 font-semibold text-sm hover:underline flex items-center justify-center gap-2"><ArrowLeft size={16} /> Back to All Posts</Link>
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

  const I = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100';

  return (
    <div className="py-10 bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4">
        <Link to="/blog" className="text-sm text-gray-500 hover:text-amber-600 flex items-center gap-1 mb-6"><ArrowLeft size={14} />Back to Blog</Link>
        <h1 className="text-2xl font-bold mb-8 flex items-center gap-2"><PenLine size={22} className="text-amber-500" />Write a Blog Post</h1>

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
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 transition-all">
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
            {images.length < 5 && <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-amber-400 text-sm text-gray-500 hover:text-amber-600 w-fit"><Upload size={16} />Add images<input type="file" accept="image/*" multiple onChange={handleImages} className="hidden" /></label>}
          </div>

          {/* Tags */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Tags</label>
            <div className="flex flex-wrap gap-2 mb-3">{tags.map(t => <span key={t} className="flex items-center gap-1 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-sm"><Tag size={12} />{t}<button type="button" onClick={() => setTags(prev => prev.filter(x => x !== t))} className="text-amber-400 hover:text-red-500 ml-1">×</button></span>)}</div>
            <div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className={I} placeholder="Add tag & press Enter" /><button type="button" onClick={addTag} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium shrink-0">Add</button></div>
          </div>

          {user?.role !== 'admin' && <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 flex items-center gap-2"><Eye size={16} />Your post will be reviewed by admin before publishing.</div>}

          <div className="flex gap-3">
            <button type="submit" className="flex-1 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2"><Send size={16} />{user?.role === 'admin' ? 'Publish Now' : 'Submit for Review'}</button>
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
        <Link to="/blog/write" className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />New Post</Link>
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
                  <Link to={`/blog/${b.slug}`} className="p-2 hover:bg-blue-50 rounded text-blue-600"><Eye size={16} /></Link>
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
    { to: '/admin/variant-gen', icon: Layers, label: 'Variant Gen ⭐' },
    { to: '/admin/ai-import', icon: Bot, label: 'AI Import ⭐' },
  { to: '/admin/settings', icon: Settings, label: 'Settings' },
  ];

  const Sidebar = ({ mobile }: { mobile?: boolean }) => (
    <aside className={`bg-gray-900 text-white flex flex-col ${mobile ? 'w-full h-full' : 'w-64 min-h-screen hidden lg:flex'}`}>
      <div className="p-5 border-b border-gray-800 flex items-center justify-between">
        <span className="font-bold text-lg">Luxedge Admin</span>
        {mobile && <button onClick={() => setMobSide(false)}><X size={20} /></button>}
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map(l => (
          <Link key={l.to} to={l.to} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${loc.pathname === l.to ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
            <l.icon size={18} />{l.label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800 space-y-2">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white px-4 py-2"><ArrowLeft size={16} />Back to Store</Link>
        <button onClick={() => { logout(); nav('/admin/login'); }} className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 px-4 py-2 w-full"><LogOut size={16} />Logout</button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex">
      <Sidebar />
      {mobSide && <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-black/50" onClick={() => setMobSide(false)} /><div className="absolute left-0 top-0 h-full w-64"><Sidebar mobile /></div></div>}
      <div className="flex-1 flex flex-col">
        <header className="h-16 bg-white border-b flex items-center justify-between px-4 lg:px-8 sticky top-0 z-40">
          <button onClick={() => setMobSide(true)} className="lg:hidden p-2"><Menu size={20} /></button>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">A</div>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8">{children}</main>
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

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Dashboard</h1>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[{ l: 'Revenue', v: `$${rev.toFixed(2)}`, i: DollarSign, c: 'bg-green-500' }, { l: 'Orders', v: orders.length, i: ShoppingCart, c: 'bg-blue-500' }, { l: 'Customers', v: users.length, i: UsersIcon, c: 'bg-purple-500' }, { l: 'Products', v: products.length, i: Package, c: 'bg-amber-500' }].map((s, i) => <div key={i} className="bg-white rounded-xl p-5 shadow-sm"><div className={`w-10 h-10 ${s.c} rounded-lg flex items-center justify-center text-white mb-3`}><s.i size={18} /></div><p className="text-2xl font-bold">{s.v}</p><p className="text-sm text-gray-500">{s.l}</p></div>)}
    </div>
    <div className="grid lg:grid-cols-2 gap-6">
      {lowStock > 0 && <div className="bg-amber-50 border border-amber-200 rounded-xl p-5"><div className="flex items-center gap-2 text-amber-700 font-semibold mb-2"><AlertTriangle size={18} />Low Stock Alert</div><p className="text-sm text-amber-600">{lowStock} product(s) low on stock</p><Link to="/admin/products" className="text-sm text-amber-700 font-medium mt-2 inline-block hover:underline">View →</Link></div>}
      {pending > 0 && <div className="bg-blue-50 border border-blue-200 rounded-xl p-5"><div className="flex items-center gap-2 text-blue-700 font-semibold mb-2"><ShoppingCart size={18} />Pending Orders</div><p className="text-sm text-blue-600">{pending} order(s) need attention</p><Link to="/admin/orders" className="text-sm text-blue-700 font-medium mt-2 inline-block hover:underline">View →</Link></div>}
      {pendingR > 0 && <div className="bg-purple-50 border border-purple-200 rounded-xl p-5"><div className="flex items-center gap-2 text-purple-700 font-semibold mb-2"><Star size={18} />Pending Reviews</div><p className="text-sm text-purple-600">{pendingR} review(s) need approval</p><Link to="/admin/reviews" className="text-sm text-purple-700 font-medium mt-2 inline-block hover:underline">View →</Link></div>}
    </div>
    <div className="bg-white rounded-xl shadow-sm p-6"><h2 className="font-semibold mb-4">Recent Orders</h2>{orders.slice(0, 5).map(o => <div key={o.id} className="flex items-center justify-between py-3 border-b last:border-0"><div><p className="font-medium text-sm">{o.id}</p><p className="text-xs text-gray-500">{o.userName}</p></div><div className="text-right"><p className="font-semibold text-sm">${o.total.toFixed(2)}</p><span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{o.status}</span></div></div>)}</div>
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
const EMPTY_PRODUCT: Product = { id:'',name:'',shortDesc:'',description:'',price:0,originalPrice:0,category:'Tech & Gadgets',stock:0,images:[],rating:0,reviews:0,isActive:true,brand:'',condition:'New',tags:[],weight:'',dimensions:'',origin:'China',freeShipping:true,shippingCost:'0',variants:[] };

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
              <div><label className={L}>Product Name *</label><input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} className={I} placeholder="e.g. ProSound Elite Wireless Earbuds" /></div>
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
              <div><label className={L}>Global Stock (if no variants) *</label><input type="number" value={p.stock || ''} onChange={e => setP({ ...p, stock: +e.target.value })} className={I} placeholder="0" />{p.stock > 0 && p.stock <= 10 && <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle size={12} />Low stock warning will appear</p>}</div>
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
      <div className="flex gap-2"><button onClick={() => toggleBlock(u.id)} className={`flex-1 py-2 rounded-lg text-xs font-medium ${u.isBlocked ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>{u.isBlocked ? 'Unblock' : 'Block'}</button><button onClick={() => setDelId(u.id)} className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium">Delete</button></div>
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
      <div className="flex gap-0.5 mb-2">{[...Array(5)].map((_, i) => <Star key={i} size={14} className={i < r.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200'} />)}</div>
      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg mb-4">{r.comment}</p>
      <div className="flex gap-2">{r.status === 'pending' && <><button onClick={() => approve(r.id)} className="px-4 py-2 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100">✓ Approve</button><button onClick={() => reject(r.id)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100">✕ Reject</button></>}<button onClick={() => del(r.id)} className="px-4 py-2 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 ml-auto">Delete</button></div>
    </div>)}</div>}
  </div>;
}

function ASettings() {
  const { user, changePassword, updateAdminProfile, notify } = useApp();

  // API Keys (persisted in localStorage)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('luxedge_api_keys') || '{}'); } catch { return {}; }
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [apiSaved, setApiSaved] = useState(false);
  const toggleShow = (k: string) => setShowKeys(s => ({ ...s, [k]: !s[k] }));

  // Accordion open state
  const [open, setOpen] = useState<Record<string, boolean>>({ api: true, store: false, profile: false, password: false });
  const toggle = (k: string) => setOpen(s => ({ ...s, [k]: !s[k] }));

  // Profile form
  const [profName, setProfName] = useState(user?.name || '');
  const [profEmail, setProfEmail] = useState(user?.email || '');

  // Password form
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

  const I = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

  const SecField = ({ label, k, placeholder, hint, isUrl }: { label: string; k: string; placeholder: string; hint?: string; isUrl?: boolean }) => (
    <div>
      <label className={L}>{label}</label>
      <div className="relative">
        <input
          type={isUrl ? 'url' : (showKeys[k] ? 'text' : 'password')}
          value={apiKeys[k] || ''}
          onChange={e => setApiKeys(s => ({ ...s, [k]: e.target.value }))}
          className={I + (isUrl ? '' : ' pr-10')}
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

  const Accordion = ({ id, title, icon, borderClass, children }: { id: string; title: string; icon: React.ReactNode; borderClass?: string; children: React.ReactNode }) => (
    <div className={`bg-white rounded-xl border ${borderClass || ''}`}>
      <button type="button" onClick={() => toggle(id)} className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 rounded-xl transition-colors">
        <span className="font-semibold flex items-center gap-2">{icon}{title}</span>
        {open[id] ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>
      {open[id] && <div className="px-5 pb-6 border-t border-gray-100">{children}</div>}
    </div>
  );

  // AI Providers
  const [aiProviders, setAiProviders] = useState<AIProvider[]>(() => {
    try { return JSON.parse(localStorage.getItem('luxedge_ai_providers') || 'null') || DEFAULT_AI_PROVIDERS; }
    catch { return DEFAULT_AI_PROVIDERS; }
  });
  const [aiSaved, setAiSaved] = useState(false);
  const saveAIProviders = (updated: AIProvider[]) => {
    setAiProviders(updated);
    localStorage.setItem('luxedge_ai_providers', JSON.stringify(updated));
    setAiSaved(true); notify('AI Providers saved!');
    setTimeout(() => setAiSaved(false), 3000);
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* ── AI Providers ── */}
      <Accordion id="ai" title="AI Providers" icon={<Bot size={18} className="text-purple-600" />} borderClass="border-purple-300">
        <div className="pt-5 space-y-4">
          <p className="text-sm text-gray-500">Configure AI providers for the AI Product Import Engine. Add API keys and select your default provider and model.</p>
          <div className="space-y-3">
            {aiProviders.map((provider, idx) => (
              <div key={provider.id} className={`border rounded-xl p-4 ${provider.isDefault ? 'border-purple-300 bg-purple-50' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => saveAIProviders(aiProviders.map((p,i) => ({...p, enabled: i===idx ? !p.enabled : p.enabled})))}
                      className={`text-sm font-semibold ${provider.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                      {provider.enabled ? <ToggleRight size={24} className="text-green-500" /> : <ToggleLeft size={24} className="text-gray-400" />}
                    </button>
                    <span className="font-semibold text-sm">{provider.name}</span>
                    {provider.isDefault && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Default</span>}
                  </div>
                  {!provider.isDefault && provider.apiKey && (
                    <button type="button" onClick={() => saveAIProviders(aiProviders.map(p => ({...p, isDefault: p.id === provider.id})))}
                      className="text-xs text-purple-600 hover:text-purple-800 font-medium">Set Default</button>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <input type={showKeys[`ai_${provider.id}`] ? 'text' : 'password'}
                      value={provider.apiKey}
                      onChange={e => setAiProviders(prev => prev.map((p,i) => i===idx ? {...p, apiKey: e.target.value} : p))}
                      onBlur={() => localStorage.setItem('luxedge_ai_providers', JSON.stringify(aiProviders))}
                      className={I + ' pr-10 text-xs'} placeholder={`${provider.name} API Key`} />
                    <button type="button" onClick={() => toggleShow(`ai_${provider.id}`)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showKeys[`ai_${provider.id}`] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <select value={provider.defaultModel} onChange={e => setAiProviders(prev => prev.map((p,i) => i===idx ? {...p, defaultModel: e.target.value} : p))}
                    onBlur={() => localStorage.setItem('luxedge_ai_providers', JSON.stringify(aiProviders))}
                    className={I + ' text-xs'}>
                    {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
          {aiSaved && <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-700 text-sm"><CheckCircle size={16} /> AI Providers saved!</div>}
          <button type="button" onClick={() => saveAIProviders(aiProviders)} className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Save size={16} /> Save AI Provider Settings
          </button>
        </div>
      </Accordion>

      {/* ── API Keys ── */}
      <Accordion id="api" title="API Keys" icon={<Globe size={18} className="text-green-600" />} borderClass="border-green-300">
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
            <SecField label="scrape.do Token" k="scrapedoKey" placeholder="paste your scrape.do token here" hint="Required for AliExpress product import" />
          </div>

          <SecField label="OpenAI API Key" k="openAiKey" placeholder="sk-proj-..." hint="For AI product descriptions · platform.openai.com" />

          <div className="grid sm:grid-cols-2 gap-4">
            <SecField label="Supabase Project URL" k="supabaseUrl" placeholder="https://xxx.supabase.co" hint="From supabase.com dashboard" isUrl />
            <SecField label="Supabase Anon Key" k="supabaseAnonKey" placeholder="eyJhbGci..." hint="anon/public key from API settings" />
          </div>

          <SecField label="Stripe Publishable Key" k="stripePublishableKey" placeholder="pk_live_..." hint="stripe.com → Developers → API Keys" />
          <SecField label="Google OAuth Client ID" k="googleClientId" placeholder="123456789.apps.googleusercontent.com" hint="console.cloud.google.com → Credentials" />

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
      <Accordion id="store" title="Store Information" icon={<Settings size={18} className="text-blue-500" />}>
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
      <Accordion id="profile" title="Admin Profile" icon={<UserIcon size={18} className="text-blue-500" />}>
        <div className="pt-5">
          <form onSubmit={handleProfile} className="space-y-4">
            <div><label className={L}>Name</label><input value={profName} onChange={e => setProfName(e.target.value)} className={I} placeholder="Admin name" /></div>
            <div><label className={L}>Email</label><input type="email" value={profEmail} onChange={e => setProfEmail(e.target.value)} className={I} placeholder="admin email" /></div>
            <button type="submit" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"><Save size={16} />Save Profile</button>
          </form>
        </div>
      </Accordion>

      {/* ── Change Password ── */}
      <Accordion id="password" title="Change Password" icon={<Lock size={18} className="text-blue-500" />}>
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
  const { products } = useAppContext();
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

  const allProviders: AIProvider[] = (() => { try { const s = localStorage.getItem('luxedge_ai_providers'); return s ? JSON.parse(s) : DEFAULT_AI_PROVIDERS; } catch { return DEFAULT_AI_PROVIDERS; } })();
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
    return <span className={`text-xs font-mono ${n > max ? 'text-red-500 font-bold' : n > w ? 'text-amber-500' : 'text-gray-400'}`}>{n}/{max}</span>;
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
                  {email.urgency && <p className="text-amber-600 font-semibold">{email.urgency}</p>}
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
  return n >= 70 ? 'text-green-600' : n >= 45 ? 'text-amber-500' : 'text-red-500';
}
function _scoreBg(n: number): string {
  return n >= 70 ? 'bg-green-50 border-green-200' : n >= 45 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
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
    "description": "Premium curated products for modern living",
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
    try { return JSON.parse(localStorage.getItem('luxedge_ai_providers')||'null')||DEFAULT_AI_PROVIDERS; }
    catch { return DEFAULT_AI_PROVIDERS; }
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
    warrantyText: '', shippingInfo: '', faqs: [],
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
        shippingInfo: str('shippingInfo'), faqs: faqArr,
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
                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold ${seo.title.length >= 50 && seo.title.length <= 60 ? 'text-green-600' : seo.title.length > 0 ? 'text-amber-500' : 'text-gray-400'}`}>{seo.title.length}</span>
              </div>
            </FieldRow>
            <FieldRow label="URL Slug">
              <input value={seo.slug} onChange={e => setSeo(p => ({...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')}))} className={inp} placeholder="url-friendly-slug" />
            </FieldRow>
            <FieldRow label="Meta Description (120–160 chars)">
              <div className="relative">
                <textarea value={seo.metaDescription} onChange={e => setSeo(p => ({...p, metaDescription: e.target.value}))} rows={3} className={ta} placeholder="Compelling meta description with CTA…" />
                <span className={`absolute right-3 bottom-3 text-xs font-bold ${seo.metaDescription.length >= 120 && seo.metaDescription.length <= 160 ? 'text-green-600' : seo.metaDescription.length > 0 ? 'text-amber-500' : 'text-gray-400'}`}>{seo.metaDescription.length}/160</span>
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
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.titleLength >= 50 && score.titleLength <= 60 ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, (score.titleLength/70)*100)}%` }} /></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.metaLength}</p>
              <p className="text-xs text-gray-500">Meta length <span className="text-gray-400">(ideal 120–160)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.metaLength >= 120 && score.metaLength <= 160 ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, (score.metaLength/200)*100)}%` }} /></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.keywordDensity.toFixed(1)}%</p>
              <p className="text-xs text-gray-500">Keyword density <span className="text-gray-400">(ideal 1–3%)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.keywordDensity >= 1 && score.keywordDensity <= 3 ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, score.keywordDensity * 25)}%` }} /></div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Issues & Recommendations</h3>
            {score.issues.length === 0 ? (
              <p className="text-gray-400 text-sm italic">Generate content to see analysis…</p>
            ) : (
              <div className="space-y-1.5">
                {score.issues.map((issue, i) => (
                  <div key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${issue.type === 'good' ? 'bg-green-50' : issue.type === 'warning' ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <span>{_issueIcon(issue.type)}</span>
                    <span className={issue.type === 'good' ? 'text-green-800' : issue.type === 'warning' ? 'text-amber-800' : 'text-red-800'}>{issue.msg}</span>
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
    try { return JSON.parse(localStorage.getItem('luxedge_ai_providers')||'null')||DEFAULT_AI_PROVIDERS; }
    catch { return DEFAULT_AI_PROVIDERS; }
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
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  Will generate <strong>{totalCombos}</strong> variant{totalCombos !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
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
              { label: 'Low Stock', value: variants.filter(v => v.inventory <= v.lowStockThreshold).length, cls: 'text-amber-600' },
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
                            <td className={`px-4 py-3 text-right font-medium ${v.inventory <= v.lowStockThreshold ? 'text-amber-600' : ''}`}>{v.inventory}</td>
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
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
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
// AI PRODUCT IMPORT ENGINE
// ============================================================================
const SUPPORTED_PLATFORMS = ['AliExpress','Alibaba','Amazon','eBay','Etsy','Walmart','Temu','CJ Dropshipping','Any public product page'];

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-600 bg-green-50' : score >= 50 ? 'text-amber-600 bg-amber-50' : 'text-red-500 bg-red-50';
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
    try { return JSON.parse(localStorage.getItem('luxedge_ai_providers')||'null')||DEFAULT_AI_PROVIDERS; }
    catch { return DEFAULT_AI_PROVIDERS; }
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
                <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleImport()}
                  className={inputCls + ' flex-1'} placeholder="https://www.aliexpress.com/item/..." />
                <button onClick={handleImport} disabled={!urlInput.trim()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 whitespace-nowrap transition-colors">
                  <Wand2 size={16}/> Import
                </button>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              <p className="font-medium mb-1">Supported:</p>
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

        <div className="border rounded-xl p-4 bg-amber-50 border-amber-200">
          <p className="text-xs font-semibold text-amber-700 mb-1">⚡ AI Provider</p>
          {(() => {
            const active = aiProviders.find(p=>p.isDefault&&p.enabled&&p.apiKey) || aiProviders.find(p=>p.enabled&&p.apiKey);
            return active
              ? <p className="text-xs text-amber-800">{active.name} · {active.defaultModel}</p>
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
                        {isHero && <div className="absolute bottom-0 left-0 right-0 bg-amber-500 text-white text-[10px] text-center font-bold py-0.5">HERO</div>}
                        {!isHero && isSelected && <button type="button" className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 hover:bg-amber-500 transition-colors"
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
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Sparkles size={16} className="text-amber-500"/>Features & Tags</h2>
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
              <h2 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2"><Star size={16} className="text-amber-500"/>AI Confidence Scores</h2>
              <div className="space-y-2">
                {Object.entries(conf).map(([k,v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-24 capitalize">{k}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${Number(v)>=80?'bg-green-500':Number(v)>=50?'bg-amber-400':'bg-red-400'}`} style={{width:`${v}%`}}/>
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
// APP WITH ROUTES
// ============================================================================
export default function App() {
  return (
    <AppProvider>
      <HashRouter>
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
          {/* Admin - EACH SECTION IS ITS OWN ROUTE */}
          <Route path="/admin" element={<AdminLayout><ADashboard /></AdminLayout>} />
          <Route path="/admin/products" element={<AdminLayout><AProducts /></AdminLayout>} />
          <Route path="/admin/products/new" element={<AdminLayout><AProductEdit /></AdminLayout>} />
          <Route path="/admin/products/edit/:id" element={<AdminLayout><AProductEdit /></AdminLayout>} />
          <Route path="/admin/orders" element={<AdminLayout><AOrders /></AdminLayout>} />
          <Route path="/admin/users" element={<AdminLayout><AUsers /></AdminLayout>} />
          <Route path="/admin/categories" element={<AdminLayout><ACategories /></AdminLayout>} />
          <Route path="/admin/reviews" element={<AdminLayout><AReviews /></AdminLayout>} />
          <Route path="/admin/blogs" element={<AdminLayout><ABlogs /></AdminLayout>} />
          <Route path="/admin/seo-engine" element={<AdminLayout><ASEOEngine /></AdminLayout>} />
          <Route path="/admin/marketing" element={<AdminLayout><AMarketingGen /></AdminLayout>} />
          <Route path="/admin/variant-gen" element={<AdminLayout><AVariantGen /></AdminLayout>} />
          <Route path="/admin/ai-import" element={<AdminLayout><AAIImport /></AdminLayout>} />
          <Route path="/admin/settings" element={<AdminLayout><ASettings /></AdminLayout>} />
          {/* Fallback */}
          <Route path="*" element={<SLayout><HomePage /></SLayout>} />
        </Routes>
        <Toast />
      </HashRouter>
    </AppProvider>
  );
}
