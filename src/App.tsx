import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import MarketingManager from './components/MarketingManager';
import AdSenseAd from './components/AdSenseAd';
import CookieConsent from './components/CookieConsent';
import WelcomePopup from './components/WelcomePopup';
import WhatsAppButton from './components/WhatsAppButton';
import AIAssistant from './components/AIAssistant';
import { trackEvent, utmParams } from './lib/marketing';
import { useAuthStore } from './store/authStore';
import { isSupabaseConfigured, updatePassword, updateUserMetadata, getAccessToken } from './services/supabase';
import { loadStorefrontCatalog, loadStorefrontPromotions, type CatalogProduct, type CatalogCategory, type StoreCoupon } from './services/catalog';
import { parseStoredCart, reconcileCart, CART_STORAGE_KEY } from './services/cartSafety';
import { createCheckoutSession, fetchCheckoutSessionStatus } from './services/checkout';
import {
  ShoppingBag01, Menu01, X, SearchMd, User01 as UserIcon, LogOut01, Package,
  ShieldTick, Star01, Truck01, RefreshCcw01, Zap, ArrowRight, Mail01, Phone,
  MarkerPin01,  Plus, Minus, Trash01, Lock01, Loading01, CheckCircle,
  LayoutGrid01, AlertTriangle, Eye,
  ChevronDown, ChevronRight, ArrowLeft, Upload01,
  Globe01, Clock, Send01, Headphones01, Stars01,
  PencilLine, Calendar, Tag01, BookOpen01, EyeOff,
  Sliders01, Feather,
} from '@untitledui/icons';

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
  images: string[]; imageAlts: string[]; rating: number; reviews: number; isActive: boolean;
  brand: string; condition: string; tags: string[];
  weight: string; dimensions: string; origin: string;
  freeShipping: boolean; shippingCost: string;
  variants: ProductVariant[];
  // Catalog Launch Phase — real merchandising data from the DB (never fake).
  featured?: boolean; newArrival?: boolean; saleEnabled?: boolean;
  stockStatus?: string; usInventory?: boolean;
  seoTitle?: string; seoDescription?: string; seoKeywords?: string[];
  supplierSource?: string;
  commerceReadiness?: string; sourceType?: string; inventorySource?: string;
  deliveryMinDays?: number | null; deliveryMaxDays?: number | null;
}
interface CartItem { product: Product; quantity: number; }
interface AppUser { id: string; email: string; name: string; role: 'admin' | 'buyer'; password?: string; isBlocked?: boolean; joined?: string; }
export interface Order {
  id: string; userId: string; userName: string; items: CartItem[];
  total: number; status: string; date: string; address?: string;
}
export interface Review {
  id: string; productId: string; productName: string; userName: string;
  rating: number; comment: string; status: 'pending' | 'approved' | 'rejected';
  date: string;
}
export interface AdminCategory { id: string; name: string; slug?: string; isActive: boolean; subs: { id: string; name: string; isActive: boolean; }[]; }
export interface BlogPost {
  id: string; slug: string; title: string; excerpt: string; content: string;
  image: string; images: string[]; tags: string[];
  authorId: string; authorName: string;
  status: 'published' | 'draft' | 'pending';
  date: string;
}

// Branded image fallback (cream + Luxedge wordmark) so a failed image never
// shows a broken-image icon. Inline SVG — no external asset dependency.
const LUXEDGE_IMAGE_FALLBACK = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'><rect width='100%' height='100%' fill='#F6F3EE'/><text x='50%' y='50%' font-family='Georgia, serif' font-size='64' letter-spacing='6' fill='#1A2440' text-anchor='middle' dominant-baseline='middle'>LUXEDGE</text></svg>"
);

/** Proxy CJ/external images through our worker to bypass CORS/ORB. */
function proxiedImage(src: string): string {
  if (!src || src.startsWith('data:')) return src;
  try {
    const u = new URL(src);
    const hosts = ['cf.cjdropshipping.com', 'oss-cf.cjdropshipping.com', 'img.ltwebstatic.com', 'ae01.alicdn.com'];
    if (hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) {
      return '/api/img-proxy?url=' + encodeURIComponent(src);
    }
  } catch { /* not a URL, use as-is */ }
  return src;
}

/** Swap a broken image to the branded fallback once (never loops). */
function onImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.onerror = null;
  if (img.src !== LUXEDGE_IMAGE_FALLBACK) img.src = LUXEDGE_IMAGE_FALLBACK;
}


// ============================================================================
// AI IMPORT ENGINE — extracted to src/features/ai/* (SECURITY: provider keys
// are server-side only; the browser proxies through /api/ai/*)
// ============================================================================
import type {
  AIProvider, ImportHistoryEntry, AIExtractedProduct, EnterpriseVariant,
  VariantAttribute, SEOData, SocialSEO, ContentData, SEOScore, StructuredSchemas,
} from "./features/ai/types";
import {
  DEFAULT_AI_PROVIDERS, loadAIProviders, saveAIProviders, resolveActiveProvider,
} from "./features/ai/providers";
import {
  callAIProvider, serverGenerate, serverTestProvider,
  serverOpenRouterCredits, serverProviderStatus,
} from "./features/ai/client";
import type { ProviderStatus, ProviderStatusMap } from "./features/ai/client";
import {
  fetchPageContent, buildExtractionPrompt, extractProductJson, parseHtmlPage,
  normalizeProductTitle, extractAliExpressItemId, assessAliExpressRisk,
  deriveImportReadiness, findDuplicateProduct, buildImportImages,
  buildImportVariants, buildImportProductInput,
  buildStorageImageInputs, importProductImagesToStorage,
  buildUrlEvidenceProduct, buildScrapedEvidenceProduct, mergeScrapedWithAi, requireReviewEvidence,
  extractAliExpressUrlEvidence, isEmptyExtraction,
} from "./features/ai/importer";

// Re-exported so existing consumers (e.g. the admin section importing from
// "../App") keep working without change.
export type {
  AIProvider, ImportHistoryEntry, AIExtractedProduct, EnterpriseVariant,
  VariantAttribute, SEOData, SocialSEO, ContentData, SEOScore, StructuredSchemas,
  ProviderStatus, ProviderStatusMap,
};
export {
  DEFAULT_AI_PROVIDERS, loadAIProviders, saveAIProviders, resolveActiveProvider,
  callAIProvider, serverGenerate, serverTestProvider, serverOpenRouterCredits,
  serverProviderStatus,
  fetchPageContent, buildExtractionPrompt,
  extractProductJson, parseHtmlPage, normalizeProductTitle,
  extractAliExpressItemId, assessAliExpressRisk, deriveImportReadiness,
  findDuplicateProduct, buildImportImages, buildImportVariants,
  buildImportProductInput, buildStorageImageInputs, importProductImagesToStorage,
  buildUrlEvidenceProduct, buildScrapedEvidenceProduct, mergeScrapedWithAi, requireReviewEvidence,
  extractAliExpressUrlEvidence, isEmptyExtraction,
};


// ============================================================================
// DATA
// (demo catalog constants removed — the storefront is DB-driven only; no fake
// products, fake ratings, or fake orders anywhere in the customer path)

// (demo admin credentials removed in Phase 3A — admin auth is Supabase-only)

// Map a Supabase catalog row to the storefront Product shape WITHOUT
// fabricating anything: ratings stay 0 (the UI shows stars only for verified
// user reviews), dimensions/origin stay empty, no shipping promises.
function mapCatalogProduct(p: CatalogProduct): Product {
  return {
    id: p.id,
    name: p.name,
    shortDesc: p.shortDesc,
    description: p.description,
    price: p.price,
    originalPrice: p.originalPrice,
    category: p.category || 'Pet Supplies',
    stock: p.stock,
    images: p.images.length ? p.images.map(proxiedImage) : [],
    // Ensure primary (hero) image is always first
    // (catalog may return images in insertion order, not primary-first)
    imageAlts: p.imageAlts || [],
    rating: 0,
    reviews: 0,
    isActive: p.isActive,
    brand: p.brand || 'Luxedge',
    condition: 'New',
    tags: p.tags,
    weight: '',
    dimensions: '',
    origin: '',
    freeShipping: p.freeShipping,
    shippingCost: '',
    featured: p.featured,
    newArrival: p.newArrival,
    saleEnabled: p.saleEnabled,
    stockStatus: p.stockStatus,
    usInventory: p.usInventory,
    commerceReadiness: p.commerceReadiness,
    sourceType: p.sourceType,
    deliveryMinDays: p.deliveryMinDays,
    deliveryMaxDays: p.deliveryMaxDays,
    inventorySource: p.inventorySource,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    seoKeywords: p.seoKeywords,
    supplierSource: p.supplierSource,
    variants: (p.variants || []).map((v) => ({
      id: v.id,
      color: v.attributes?.color || '',
      size: v.attributes?.size || 'One Size',
      price: v.price ?? p.price,
      salePrice: v.price ?? p.price,
      stock: v.inventoryQty,
      sku: v.sku,
      image: v.image || undefined,
    })),
  };
}

function mapCatalogCategory(c: CatalogCategory): AdminCategory {
  return { id: c.id, name: c.name, slug: c.slug, isActive: c.isActive, subs: [] };
}
// Demo buyer rows for the admin Users panel — no credentials (Phase 3A: real
// users come from Supabase Auth and are never represented with passwords).
// No fake customers — real users come from Supabase auth. Admin lists show
// real profiles only (empty until they exist).
const INIT_USERS: AppUser[] = [];

// No fake order history or reviews: real orders come from the Stripe webhook
// (luxedge_orders, shown in Admin → Orders) and real reviews do not exist
// yet. The storefront must never display invented customers or ratings.
const INIT_REVIEWS: Review[] = [];

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
  { id:'b13', slug:'how-to-stop-puppy-biting', title:'How to Stop a Puppy from Biting: A Step-by-Step Guide', excerpt:'Puppy nipping is normal — but it should not become a habit. Here is exactly how to teach gentle mouthing in a few weeks.', content:'Puppy biting is one of the most common (and most complained-about) behaviors new owners face. The good news: it is completely normal and very fixable.\n\n## Why Puppies Bite\nPuppies explore the world with their mouths the way babies do with their hands. Teething, play, and curiosity all drive nipping. None of it means your puppy is aggressive.\n\n## Step 1: Redirect, Don\u2019t Punish\nThe instant teeth touch skin, say a firm \u201cno\u201d or a high-pitched yelp, then offer a chew toy instead. Redirecting teaches what is acceptable to bite.\n\n## Step 2: End the Game\nIf nipping continues, stand up and turn away for 10-15 seconds. Puppies learn fast that biting ends the fun.\n\n## Step 3: Give Them Something to Chew\nTeething puppies need relief. Rope toys, silicone chews, and frozen treats give sore gums something appropriate to sink into.\n\n## Step 4: Crate and Nap Time\nAn overtired puppy bites more. Enforce naps — most puppies need 16-18 hours of sleep a day. A comfortable, quiet dog bed makes rest easier.\n\n## Step 5: Be Consistent\nEveryone in the house must use the same rules. Mixed signals confuse puppies and slow progress.\n\n## When to Ask a Professional\nIf biting is hard, draws blood, or continues past six months, a certified trainer or your vet can help rule out pain or anxiety. Most puppies, though, grow out of it with exactly this routine.', image:'https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['puppy','biting','training','behavior'], authorId:'adm', authorName:'Admin', status:'published', date:'2026-07-18' },
  { id:'b14', slug:'keep-dog-cool-in-summer', title:'How to Keep Your Dog Cool in Summer: 10 Real Tips', excerpt:'Heatstroke is a real summer danger for dogs. Learn the signs, the no-go rules, and the cooling products that actually help.', content:'Summer heat is harder on dogs than most people realize. Dogs cool down mainly by panting, which stops working when the air is hot and humid. Here is how to keep your dog safe.\n\n## 1. Never Leave a Dog in a Parked Car\nEven with windows cracked, a car can reach 100+°F in minutes. This is the single most dangerous summer mistake.\n\n## 2. Walk Early or Late\nPavement can burn paw pads. Test it with the back of your hand — if it is too hot for you, it is too hot for paws.\n\n## 3. Always Carry Water\nA portable travel water bottle means fresh water is available on every walk.\n\n## 4. Provide a Cooling Mat\nGel cooling mats give dogs a cool surface to lie on indoors and outdoors. They are a simple, low-cost comfort upgrade.\n\n## 5. Watch the Signs of Heatstroke\nExcessive panting, drooling, weakness, bright red gums, and vomiting are red flags. Move the dog to shade, offer water, and call your vet immediately.\n\n## 6. Keep Indoor Air Moving\nFans and air conditioning help. Make sure your dog always has access to the coolest room in the house.\n\n## 7. Avoid Midday Exercise\nSave fetch and running for the cooler hours of the morning and evening.\n\n## 8. Shorten the Coat Carefully\nSome double-coated breeds need their undercoat for insulation — check with a groomer before shaving.\n\n## 9. Frozen Treats\nFrozen dog-safe treats or ice cubes in the water bowl are a fun way to cool down from the inside.\n\n## 10. Know the Flat-Faced Risk\nBrachycephalic breeds (pugs, bulldogs, Frenchies) overheat much faster. Be extra careful with them in heat.', image:'https://images.pexels.com/photos/5732487/pexels-photo-5732487.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['summer','heat','cooling mat','safety'], authorId:'adm', authorName:'Admin', status:'published', date:'2026-07-10' },
  { id:'b15', slug:'cat-hydration-water-fountains', title:'Why Cats Drink So Little — and How a Water Fountain Helps', excerpt:'Cats evolved to get moisture from prey, not bowls. Here is why they ignore still water and how to get them drinking more.', content:'Dehydration is a silent, common problem in cats. Unlike dogs, most cats simply do not drink enough from a still bowl. Understanding why is the first step to fixing it.\n\n## The Instinct Behind It\nIn the wild, cats prefer moving water because standing water is more likely to harbor bacteria. That instinct never went away.\n\n## Why It Matters\nLow water intake strains the kidneys and urinary tract. Chronic dehydration is linked to kidney disease — the leading health issue in older cats.\n\n## How a Fountain Helps\nA stainless steel pet water fountain circulates and filters water continuously. The movement attracts cats and keeps water fresher and cooler, encouraging more drinking.\n\n## Placement Matters\nCats like their water away from their food bowl — it mimics avoiding contamination. Place fountains in quiet, low-traffic spots.\n\n## Keep It Clean\nA fountain only helps if it is clean. Rinse and refill daily, and change the filter on schedule. Stale filters can make water taste worse.\n\n## Try Wet Food\nWet food can be up to 80% water. Adding it to the diet is one of the simplest ways to boost hydration alongside a fountain.\n\n## Watch for Warning Signs\nSunken eyes, lethargy, dry gums, and reduced litter box output can all signal dehydration. If you notice any, contact your vet.', image:'https://images.pexels.com/photos/416160/pexels-photo-416160.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['cat','hydration','water fountain','health'], authorId:'adm', authorName:'Admin', status:'published', date:'2026-06-28' },
  { id:'b16', slug:'flying-with-pet-checklist', title:'Flying with a Dog or Cat: The Complete Checklist', excerpt:'From carrier rules to vet certificates, here is everything to prepare before flying with your pet — and what to pack in-cabin.', content:'Flying with a pet takes planning, but it is very doable. Whether it is a short hop or a cross-country move, this checklist covers the essentials.\n\n## 1. Book Pet-Friendly Flights Early\nAirlines cap the number of pets per flight. Book as far in advance as you can and confirm the in-cabin rules.\n\n## 2. Choose the Right Carrier\nIn-cabin carriers must fit under the seat in front of you and let your pet stand, turn, and lie down. A padded pet carrier backpack or soft carrier makes gate travel far easier.\n\n## 3. Get a Health Certificate\nMost airlines require a certificate from your vet issued within 10 days of travel. Book the appointment before you book the ticket.\n\n## 4. Check the Destination Rules\nHawaii and many international destinations have strict quarantine and microchip rules. Research them months ahead.\n\n## 5. Pack the Essentials\nWater, a travel bowl, a leash, waste bags, and a familiar toy or blanket all belong in your carry-on.\n\n## 6. Don\u2019t Sedate Without Asking\nSome sedatives can be dangerous at altitude. Ask your vet about safe options instead of assuming.\n\n## 7. Exercise Before You Fly\nA tired pet is a calmer pet. A long walk before the airport helps them settle once on board.\n\n## 8. Attach ID\nFresh ID tags and a current microchip are your pet\u2019s safety net if anything goes wrong en route.', image:'https://images.pexels.com/photos/127028/pexels-photo-127028.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['travel','flying','carrier','checklist'], authorId:'adm', authorName:'Admin', status:'published', date:'2026-06-15' },
  { id:'b17', slug:'horse-grooming-essentials-beginners', title:'Horse Grooming Essentials: A Beginner\u2019s Starter Kit', excerpt:'Good grooming keeps a horse healthy, comfortable, and easy to handle. Here is the starter kit every new owner needs.', content:'Grooming is one of the most important daily habits in horse care. It keeps the coat healthy, catches injuries early, and builds trust between horse and handler.\n\n## Why Groom Every Day\nDaily grooming removes dirt, sweat, and loose hair, distributes natural oils, and gives you a chance to check for cuts, swelling, or skin issues before they become problems.\n\n## The Core Kit\nA basic kit starts with a curry comb for loosening dirt, a stiff brush for the body, a soft brush for sensitive areas, a hoof pick for cleaning feet, and a mane and tail brush. That covers the essentials.\n\n## Hoof Care Is Non-Negotiable\nPicking hooves daily prevents stones, thrush, and bruising. If you are new to it, ask your farrier to show you the correct technique.\n\n## Bathe Sparingly\nHorses do not need frequent baths — over-bathing strips natural oils. Spot-clean and save full baths for shows or very dirty days.\n\n## Watch the Tack Areas\nGroom the areas where tack sits — the back, girth, and head — carefully. Dirt under tack causes rubbing and sores.\n\n## Build It Into Your Routine\nEven ten minutes a day keeps coats and feet in good shape. Horses quickly learn to enjoy the routine, and it makes every other part of ownership easier.', image:'https://images.pexels.com/photos/593655/pexels-photo-593655.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['horse','grooming','equestrian','care'], authorId:'adm', authorName:'Admin', status:'published', date:'2026-05-30' },
  { id:'b18', slug:'cattle-care-basics-small-farms', title:'Cattle Care Basics for Small Farms: Feed, Health & Handling', excerpt:'Raising cattle on a small farm is rewarding — and a real responsibility. Here are the fundamentals of keeping a healthy herd.', content:'Whether you keep a few beef cattle or a small dairy herd, the basics of cattle care are the same. Get these right and most problems never start.\n\n## Water Comes First\nCattle drink a lot — up to 20 gallons a day in hot weather. Clean, accessible water is the single most important thing you can provide.\n\n## Feed According to Stage\nNutrition needs change with age, weight, pregnancy, and season. Pasture alone rarely covers winter needs; hay and mineral supplements fill the gap. Work with a vet or nutritionist on a ration.\n\n## Minerals Are Not Optional\nLoose mineral supplements prevent a long list of deficiency problems, from weak calves to poor coats. Provide free-choice minerals year-round.\n\n## Health Basics\nLearn the normal signs — appetite, rumination, manure, and demeanor. Any sudden change deserves attention. Keep a working relationship with a large-animal vet before you need one.\n\n## Handling with Confidence\nCattle read body language. Move slowly, work from their shoulder, and use low-stress handling. A calm herd is safer and easier to manage.\n\n## Hoof and Parasite Care\nSchedule hoof trimming as needed and follow a parasite control program recommended for your region.\n\n## Records Keep You Honest\nTrack weights, vaccinations, and treatments. Simple records turn guesswork into decisions and make vet visits far more useful.', image:'https://images.pexels.com/photos/593655/pexels-photo-593655.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['cattle','livestock','farm','care'], authorId:'adm', authorName:'Admin', status:'published', date:'2026-05-20' },
];

export const CAT_LIST = ['All', 'Dog Supplies', 'Cat Supplies', 'Pet Beds', 'Pet Toys', 'Feeding & Water', 'Grooming', 'Pet Accessories', 'Bird Supplies', 'Horse', 'Cattle'];
const CAT_META: Record<string, { desc: string }> = {
  'Dog Supplies': { desc: 'Walking, training & everyday dog essentials' },
  'Cat Supplies': { desc: 'Play, comfort & everyday cat essentials' },
  'Pet Beds': { desc: 'Comfort-led pieces for deeper rest' },
  'Pet Toys': { desc: 'Interactive play and everyday enrichment' },
  'Feeding & Water': { desc: 'Considered pieces for daily mealtimes' },
  'Grooming': { desc: 'Simple tools for everyday care' },
  'Pet Accessories': { desc: 'Useful pieces for life together' },
  'Bird Supplies': { desc: 'Seed, feed & care essentials for feathered friends' },
  'Horse': { desc: 'Practical care and stable essentials for horses' },
  'Cattle': { desc: 'Useful feeding and care essentials for cattle and livestock' },
};

function firstUsableImage(product: Product | undefined): string | undefined {
  const raw = product?.images.find((image) => Boolean(image));
  return raw ? proxiedImage(raw) : undefined;
}
const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const fromSlug = (slug: string) => CAT_LIST.find(c => toSlug(c) === slug) || 'All';

// ============================================================================
// CONTEXT
// ============================================================================
interface Ctx {
  user: AppUser | null; cart: CartItem[];
  products: Product[]; users: AppUser[]; reviews: Review[]; categories: AdminCategory[];
  blogs: BlogPost[]; setBlogs: React.Dispatch<React.SetStateAction<BlogPost[]>>;
  login: (e: string, p: string, admin?: boolean) => Promise<string | null>;
  guestLogin: () => void;
  logout: () => void; signup: (n: string, e: string, p: string) => Promise<string | null>;
  changePassword: (current: string, newPass: string) => Promise<{ ok: boolean; msg: string }>;
  updateAdminProfile: (name: string, email: string) => void;
  addToCart: (p: Product) => void; removeFromCart: (id: string) => void;
  updateQty: (id: string, q: number) => void; clearCart: () => void;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>;
  setCategories: React.Dispatch<React.SetStateAction<AdminCategory[]>>;
  cartOpen: boolean; openCart: () => void; closeCart: () => void;
  notif: string | null; notify: (m: string, type?: 'success' | 'error' | 'info') => void;
  // Catalog Launch Phase — coupons + free-shipping strategy from the store.
  coupon: StoreCoupon | null;
  applyCoupon: (code: string) => string | null;
  removeCoupon: () => void;
  freeShippingEnabled: boolean;
  freeShippingThreshold: number;
}
const AC = createContext<Ctx | null>(null);
export function useApp() { const c = useContext(AC); if (!c) throw new Error('no ctx'); return c; }

// Cart persistence uses the catalog-safe v2 key (legacy demo-era payload is
// purged on load — Phase 4E.2A hotfix behavior, kept on luxedge-v2).
function loadCart(): CartItem[] {
  return parseStoredCart<Product>();
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
      typeof u.name === 'string' &&
      (u.role === 'admin' || u.role === 'buyer')
    ) {
      return { id: u.id, email: u.email, name: u.name, role: u.role, isBlocked: u.isBlocked, joined: u.joined };
    }
    return null;
  } catch {
    return null;
  }
}

function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(loadSession);
  const [cart, setCart] = useState<CartItem[]>(loadCart);
  // Phase 4E.1 — the storefront catalog starts EMPTY. Demo/fallback products
  // must NEVER appear when the database has no published products; only the
  // qualified/approved pipeline may populate the customer-facing catalog.
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<AppUser[]>(INIT_USERS);
  const [reviews, setReviews] = useState<Review[]>(INIT_REVIEWS);
  const [categories, setCategories] = useState<AdminCategory[]>(INIT_CATEGORIES);
  const [blogs, setBlogs] = useState<BlogPost[]>(INIT_BLOGS);
  const [notif, setNotif] = useState<string | null>(null);
  // Stable identity: components (e.g. CatalogProductEditor) depend on `notify`
  // inside useCallback/useEffect deps. An unmemoized notify was recreated on
  // every AppProvider render, which itself re-renders every time notify()
  // fires (setNotif) — so calling notify() during editing (e.g. "Image
  // added") retriggered any effect that listed notify as a dependency,
  // silently reloading/resetting in-progress form state right after the
  // update it was supposed to confirm.
  const notify = useCallback((m: string, _type?: 'success' | 'error' | 'info') => { setNotif(m); setTimeout(() => setNotif(null), 3000); }, []);
  const [cartOpen, setCartOpen] = useState(false);
  const openCart = useCallback(() => {
    setCartOpen((wasOpen) => {
      if (!wasOpen && cart.length > 0) trackEvent('view_cart', { currency: 'USD', value: cart.reduce((s, i) => s + i.product.price * i.quantity, 0), items: cart.map(i => ({ item_id: i.product.id, item_name: i.product.name, price: i.product.price, quantity: i.quantity })), ...utmParams() });
      return true;
    });
  }, [cart]);
  const closeCart = useCallback(() => setCartOpen(false), []);

  // Phase 3B: load the real storefront catalog from Supabase when it is
  // configured and populated. On any failure (unconfigured, unreachable,
  // empty DB) the catalog stays EMPTY — never demo/fallback products.
  useEffect(() => {
    let cancelled = false;
    void loadStorefrontCatalog().then((cat) => {
      if (cancelled) return;
      if (cat) {
        // Catalog load completed (even with zero products) — the cart can
        // now be safely reconciled against the real customer-visible set.
        setCatalogLoaded(true);
        if (cat.products.length) setProducts(cat.products.map(mapCatalogProduct));
        if (cat.categories.length) setCategories(cat.categories.map(mapCatalogCategory));
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Catalog Launch Phase — load store promotions (coupons + free-shipping
  // strategy). Safe defaults when unavailable (no coupons, free shipping off).
  const [promotions, setPromotions] = useState<{ coupons: StoreCoupon[]; freeShippingEnabled: boolean; freeShippingThreshold: number }>({
    coupons: [], freeShippingEnabled: false, freeShippingThreshold: 50,
  });
  const [coupon, setCoupon] = useState<StoreCoupon | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadStorefrontPromotions().then((pro) => { if (!cancelled) setPromotions(pro); });
    return () => { cancelled = true; };
  }, []);

  const applyCoupon = (code: string): string | null => {
    const found = promotions.coupons.find((c) => c.code === code.trim().toUpperCase());
    if (!found) return 'Coupon not found';
    if (found.usageLimit != null && found.usedCount >= found.usageLimit) return 'This coupon has reached its usage limit';
    if (found.endAt && new Date(found.endAt) < new Date()) return 'This coupon has expired';
    setCoupon(found);
    return null;
  };
  const removeCoupon = () => setCoupon(null);

  // Persist the cart so items survive a page refresh.
  useEffect(() => {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch { /* storage full or unavailable */ }
  }, [cart]);

  // Catalog Launch Phase defense in depth: the cart may only contain
  // products that exist in the current customer-visible catalog. Once the
  // catalog has actually loaded, any stored item not in it is stale and is
  // reconciled away — a manually-restored malformed payload never survives.
  // (Only runs after a successful catalog load, so a DB outage never wipes
  // a valid cart.)
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  useEffect(() => {
    if (!catalogLoaded) return;
    setCart(prev => {
      const valid = reconcileCart(prev, products);
      return valid.length === prev.length ? prev : valid;
    });
  }, [catalogLoaded, products]);

  // Persist the signed-in user so the session survives a page refresh.
  useEffect(() => {
    try {
      if (user) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch { /* storage full or unavailable */ }
  }, [user]);

  const login = async (e: string, p: string, admin = false): Promise<string | null> => {
    // Real authentication via Supabase Auth (Phase 3A). Returns null on
    // success or an honest error message on failure.
    const result = await useAuthStore.getState().signIn(e, p);
    if (!result.success) return result.message;
    const sbUser = result.user;
    if (!sbUser) return 'Sign-in did not return a session.';
    if (admin && sbUser.role !== 'admin') {
      return 'This account does not have admin access.';
    }
    setUser({ id: sbUser.id, email: sbUser.email, name: sbUser.name, role: sbUser.role, joined: new Date().toISOString().slice(0, 10) });
    notify(admin ? 'Welcome Admin!' : 'Login successful!');
    return null;
  };

  const guestLogin = () => {
    const guest: AppUser = { id: `guest-${Date.now()}`, email: 'guest@luxedge.us', name: 'Guest', role: 'buyer', joined: new Date().toISOString().slice(0, 10) };
    setUser(guest);
    notify('Shopping as guest — no account needed!');
  };

  const logout = async () => {
    await useAuthStore.getState().signOut();
    setUser(null);
    notify('Logged out');
  };

  const signup = async (n: string, e: string, p: string): Promise<string | null> => {
    if (p.length < 6) return 'Password must be at least 6 characters';
    const result = await useAuthStore.getState().signUp(n, e, p);
    if (!result.success) return result.message;
    if (result.user) {
      setUser({ id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role, joined: new Date().toISOString().slice(0, 10) });
    }
    notify('Account created!');
    return null;
  };

  const changePassword = async (_current: string, newPass: string): Promise<{ ok: boolean; msg: string }> => {
    // Current password is verified by Supabase on the server; it is never
    // stored or checked client-side.
    if (!user) return { ok: false, msg: 'Not logged in' };
    if (newPass.length < 6) return { ok: false, msg: 'New password must be at least 6 characters' };
    try {
      await updatePassword(newPass);
      return { ok: true, msg: 'Password updated successfully!' };
    } catch (e) {
      return { ok: false, msg: (e as Error).message || 'Could not update password' };
    }
  };

  const updateAdminProfile = async (name: string, email: string) => {
    if (user?.role === 'admin') {
      try {
        await updateUserMetadata({ name });
        setUser(prev => prev ? { ...prev, name, email } : prev);
        notify('Profile updated!');
      } catch (e) {
        notify((e as Error).message || 'Could not update profile');
      }
    }
  };
  const addToCart = (p: Product) => { setCart(prev => { const ex = prev.find(i => i.product.id === p.id); return ex ? prev.map(i => i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i) : [...prev, { product: p, quantity: 1 }]; }); setCartOpen(true); trackEvent('add_to_cart', { currency: 'USD', value: p.price, items: [{ item_id: p.id, item_name: p.name, price: p.price, quantity: 1 }], ...utmParams() }); notify(`Added to cart!`); };
  const removeFromCart = (id: string) => {
    const removed = cart.find(i => i.product.id === id);
    if (removed) trackEvent('remove_from_cart', { currency: 'USD', value: removed.product.price * removed.quantity, items: [{ item_id: removed.product.id, item_name: removed.product.name, price: removed.product.price, quantity: removed.quantity }], ...utmParams() });
    setCart(p => p.filter(i => i.product.id !== id));
  };
  const updateQty = (id: string, q: number) => { if (q <= 0) removeFromCart(id); else setCart(p => p.map(i => i.product.id === id ? { ...i, quantity: q } : i)); };
  const clearCart = () => setCart([]);
  // NOTE: real orders are created server-side by the Stripe webhook into
  // luxedge_orders (Admin → Orders). No client-side fake order path exists.
  const freeShippingEnabled = promotions.freeShippingEnabled;
  const freeShippingThreshold = promotions.freeShippingThreshold;

  return <AC.Provider value={{ user, cart, products, users, reviews, categories, blogs, setBlogs, login, guestLogin, logout, signup, changePassword, updateAdminProfile, addToCart, removeFromCart, updateQty, clearCart, setProducts, setUsers, setReviews, setCategories, cartOpen, openCart, closeCart, notif, notify, coupon, applyCoupon, removeCoupon, freeShippingEnabled, freeShippingThreshold }}>{children}</AC.Provider>;
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================
function Toast() { const { notif } = useApp(); if (!notif) return null; return <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-[200] animate-fade-in"><div className="bg-gray-900 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm"><CheckCircle strokeWidth={1.5} size={18} className="text-green-400" aria-hidden="true" />{notif}</div></div>; }

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full"><X strokeWidth={1.5} size={20} /></button>
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
const MEGA_MENU: { label: string; to: string; groups: { title: string; links: { label: string; to: string }[] }[] }[] = [
  {
    label: 'Dog', to: '/category/dog-supplies',
    groups: [
      { title: 'Walking & Gear', links: [{ label: 'Harnesses & Collars', to: '/category/dog-supplies' }, { label: 'Travel Accessories', to: '/category/pet-accessories' }] },
      { title: 'Comfort', links: [{ label: 'Beds', to: '/category/pet-beds' }, { label: 'Blankets & Mats', to: '/category/pet-beds' }] },
      { title: 'Feeding', links: [{ label: 'Bowls & Feeders', to: '/category/feeding-water' }, { label: 'Water Bottles', to: '/category/feeding-water' }] },
      { title: 'Grooming', links: [{ label: 'Brushes', to: '/category/grooming' }, { label: 'Grooming Tools', to: '/category/grooming' }] },
      { title: 'Play', links: [{ label: 'Chew Toys', to: '/category/pet-toys' }, { label: 'Rope & Tug Toys', to: '/category/pet-toys' }] },
    ],
  },
  {
    label: 'Cat', to: '/category/cat-supplies',
    groups: [
      { title: 'Play', links: [{ label: 'Toys & Wands', to: '/category/pet-toys' }, { label: 'Scratching', to: '/category/cat-supplies' }] },
      { title: 'Comfort', links: [{ label: 'Beds & Caves', to: '/category/pet-beds' }, { label: 'Perches & Towers', to: '/category/cat-supplies' }] },
      { title: 'Feeding', links: [{ label: 'Bowls & Fountains', to: '/category/feeding-water' }, { label: 'Feeders', to: '/category/feeding-water' }] },
      { title: 'Grooming', links: [{ label: 'Brushes', to: '/category/grooming' }, { label: 'Nail Care', to: '/category/grooming' }] },
    ],
  },
  {
    label: 'Birds', to: '/category/bird-supplies',
    groups: [
      { title: 'Feeding', links: [{ label: 'Bird Feed', to: '/category/bird-supplies' }, { label: 'Seed & Treats', to: '/category/bird-supplies' }] },
      { title: 'Care', links: [{ label: 'Cages & Accessories', to: '/category/bird-supplies' }, { label: 'Perches & Swings', to: '/category/bird-supplies' }] },
    ],
  },
];

function Header() {
  const [mob, setMob] = useState(false);
  const [um, setUm] = useState(false);
  const [hq, setHq] = useState('');
  const [mega, setMega] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [promoIdx, setPromoIdx] = useState(0);
  const loc = useLocation();
  const goTo = useNavigate();
  const { user, cart, logout, openCart } = useApp();
  const cc = cart.reduce((s, i) => s + i.quantity, 0);

  // Rotate promo messages every 3.5 seconds
  useEffect(() => {
    const id = setInterval(() => setPromoIdx(p => (p + 1) % 4), 3500);
    return () => clearInterval(id);
  }, []);

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
    { l: 'Horses', to: '/category/horse' },
    { l: 'Livestock', to: '/category/cattle' },
    { l: 'Birds', to: '/category/bird-supplies' },
    { l: 'Food & Feeding', to: '/category/feeding-water' },
    { l: 'Toys', to: '/category/pet-toys' },
    { l: 'Beds', to: '/category/pet-beds' },
    { l: 'Grooming', to: '/category/grooming' },
    { l: 'Travel', to: '/category/pet-accessories' },
  ];
  const isActive = (p: string) => (p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p));

  return (<>
    {/* ── Rotating promo bar ── */}
    <div className="site-utility-bar relative" style={{ minHeight: 30 }}>
      {[
        { icon: <Truck01 strokeWidth={1.5} size={12} />, text: 'Free Shipping on Orders $50+' },
        { icon: <RefreshCcw01 strokeWidth={1.5} size={12} />, text: '30-Day Easy Returns' },
        { icon: <Headphones01 strokeWidth={1.5} size={12} />, text: 'Customer Support Mon–Fri 9AM–6PM CT' },
        { icon: <ShieldTick strokeWidth={1.5} size={12} />, text: 'Thoughtfully Curated — Quality You Can Trust' },
      ].map((promo, i) => (
        <span key={i} className={`promo-slide ${promoIdx === i ? 'promo-active' : ''}`} aria-hidden={promoIdx !== i}>
          {promo.icon} {promo.text}
        </span>
      ))}
    </div>

    {/* ── Main header ── */}
    <header className={`site-header sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'site-header-scrolled' : ''}`}>
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-3 lg:gap-6">
        <button onClick={() => setMob(!mob)} aria-label="Open menu" aria-expanded={mob} className="lg:hidden p-2 -ml-1.5 hover:bg-luxe-cream rounded-lg text-luxe-black transition-colors">{mob ? <X strokeWidth={1.5} size={20} /> : <Menu01 strokeWidth={1.5} size={20} />}</button>
        <Link to="/" className="flex items-center gap-2 shrink-0 group" aria-label="Luxedge home">
          <img src="/luxedge-mark.png" alt="Luxedge" className="h-12 sm:h-12 w-auto transition-transform duration-300 group-hover:scale-105" />
          <span className="flex flex-col leading-none">
            <span className="font-brand text-base sm:text-lg font-bold tracking-[0.15em] text-luxe-black">LUXEDGE</span>
            <span className="hidden sm:block text-[6.5px] tracking-[0.25em] text-luxe-gold mt-0.5">PREMIUM PET ESSENTIALS</span>
          </span>
        </Link>

        {/* Search — refined pill */}
        <form onSubmit={submitSearch} role="search" className="hidden md:flex flex-1 max-w-xl mx-2 lg:mx-5">
          <div className="site-search">
            <SearchMd strokeWidth={1.5} size={16} className="ml-3 text-luxe-gray shrink-0" />
            <input value={hq} onChange={e => setHq(e.target.value)} placeholder="Search beds, toys, grooming & more" aria-label="Search products"
              className="flex-1 px-2.5 py-2.5 text-sm text-luxe-black placeholder-luxe-gray/70 focus:outline-none bg-transparent" />
            <button type="submit" className="site-search-submit">
              Search
            </button>
          </div>
        </form>

        <div className="flex items-center gap-1 sm:gap-1.5">
          {user ? (
            <div className="relative">
              <button onClick={() => setUm(!um)} aria-label="Account menu" aria-expanded={um} className="flex items-center gap-1.5 p-2 hover:bg-luxe-cream rounded-lg text-luxe-charcoal transition-colors">
                <span className="w-7 h-7 rounded-full bg-luxe-gold text-white flex items-center justify-center text-[11px] font-bold ring-1 ring-luxe-white/40">{user.name[0]}</span>
                <span className="hidden lg:block text-[11px] font-medium">{user.name.split(' ')[0]}</span>
              </button>
              {um && <><div className="fixed inset-0 z-40" onClick={() => setUm(false)} /><div className="absolute right-0 top-full mt-1.5 w-56 rounded-2xl shadow-xl border border-luxe-silver bg-white py-1.5 z-50 animate-scale-in">
                <div className="px-3.5 py-2.5 border-b border-luxe-silver/70"><p className="font-semibold text-xs text-luxe-black">{user.name}</p><p className="text-[10px] text-luxe-gray mt-0.5">{user.email}</p></div>
                {user.role === 'admin' && <Link to="/admin" className="flex items-center gap-2 px-3.5 py-2 text-xs text-luxe-charcoal hover:bg-luxe-cream transition-colors"><LayoutGrid01 strokeWidth={1.5} size={14} className="text-luxe-gold" />Admin Panel</Link>}
                <Link to="/orders" className="flex items-center gap-2 px-3.5 py-2 text-xs text-luxe-charcoal hover:bg-luxe-cream transition-colors"><Package strokeWidth={1.5} size={14} className="text-luxe-gray" />My Orders</Link>
                <button onClick={logout} className="flex items-center gap-2 px-3.5 py-2 text-xs text-luxe-red hover:bg-luxe-cream w-full text-left transition-colors"><LogOut01 strokeWidth={1.5} size={14} />Log Out</button>
              </div></>}
            </div>
          ) : (
            <Link to="/login" className="flex items-center gap-1.5 p-2 hover:bg-luxe-cream rounded-lg text-luxe-charcoal transition-colors">
              <UserIcon strokeWidth={1.5} size={17} /><span className="hidden sm:inline text-[11px] font-medium">Sign In</span>
            </Link>
          )}
          <button onClick={openCart} className="relative p-2 hover:bg-luxe-cream rounded-lg text-luxe-charcoal transition-colors" aria-label={`Open cart, ${cc} item${cc === 1 ? '' : 's'}`}>
            <ShoppingBag01 strokeWidth={1.5} size={18} />
            {cc > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-luxe-gold text-white flex items-center justify-center text-[8px] font-bold">{cc}</span>}
          </button>
        </div>
      </div>

      {/* ── Pet navigation bar ── */}
      <nav className="hidden lg:block border-t border-luxe-silver/60 bg-white/70 backdrop-blur-md" aria-label="Shop categories">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-11">
          {MEGA_MENU.map(m => (
            <div key={m.label} className="relative" onMouseEnter={() => setMega(m.label)} onMouseLeave={() => setMega(null)}>
              <Link to={m.to} className="nav-underline flex items-center gap-1.5 px-4 py-2 text-[13.5px] font-semibold text-luxe-charcoal hover:text-luxe-black transition-colors">
                {m.label}<ChevronDown strokeWidth={1.5} size={13} className={`text-luxe-gray transition-transform duration-200 ${mega === m.label ? 'rotate-180' : ''}`} />
              </Link>
              {mega === m.label && (
                <div className="absolute left-0 top-full pt-2 z-50 w-[580px]">
                  <div className="bg-white rounded-2xl border border-luxe-silver shadow-xl p-6 animate-fade-in-up">
                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-luxe-silver/70">
                      <p className="font-brand text-[11px] font-bold uppercase tracking-[0.18em] text-luxe-black">Shop {m.label}</p>
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
            <Link key={c.l} to={c.to} className="nav-underline px-4 py-2 text-[13.5px] font-semibold text-luxe-charcoal hover:text-luxe-black transition-colors">{c.l}</Link>
          ))}
          <Link to="/shop?q=deal" className="ml-auto px-4 py-2 text-[13.5px] font-bold text-luxe-gold hover:text-luxe-gold-dark transition-colors flex items-center gap-1.5"><Zap strokeWidth={1.5} size={12} /> Deals</Link>
        </div>
      </nav>

      {/* ── Mobile menu ── */}
      {mob && <div className="lg:hidden border-t border-luxe-silver/70 px-3 py-2 space-y-1 animate-fade-in-up bg-white">
        <form onSubmit={submitSearch} role="search" className="site-search mobile-site-search mb-2">
          <SearchMd strokeWidth={1.5} size={18} className="ml-3 text-luxe-gray shrink-0" />
          <input value={hq} onChange={e => setHq(e.target.value)} placeholder="Search products..." aria-label="Search products"
            className="flex-1 px-2.5 py-2 text-sm text-luxe-black placeholder-luxe-gray/70 focus:outline-none bg-transparent" />
          <button type="submit" className="px-3.5 py-2 bg-luxe-gold text-white text-[10px] font-bold uppercase tracking-wider rounded-full">Go</button>
        </form>
        <div className="flex flex-wrap gap-1 pt-1 pb-1.5 border-b border-luxe-silver/70">
          {catNav.map(c => <Link key={c.l} to={c.to} className="px-1 py-1 text-[10px] font-semibold text-luxe-charcoal border-b border-transparent hover:border-luxe-gold hover:text-luxe-gold transition-colors">{c.l}</Link>)}
          <Link to="/shop?q=deal" className="px-1 py-1 text-[10px] font-bold text-luxe-gold-dark border-b border-transparent hover:border-luxe-gold hover:text-luxe-gold transition-colors">Deals</Link>
        </div>
        {nav.map(i => <Link key={i.p} to={i.p} aria-current={isActive(i.p) ? 'page' : undefined} className="block px-3 py-2 text-[13px] font-medium rounded-lg text-luxe-charcoal hover:bg-luxe-cream transition-colors">{i.l}</Link>)}
        {!user && <Link to="/login" className="block px-3 py-2 text-[13px] font-medium rounded-lg text-luxe-gold hover:bg-luxe-cream transition-colors">Sign In</Link>}
      </div>}
    </header>
  </>);
}

function Footer() {
  const { categories } = useApp();

  // Premium footer: readable typography, balanced 12-column grid, clean groupings.
  const FL = 'block text-[13px] py-[3px] leading-relaxed text-luxe-white/70 hover:text-luxe-gold-light transition-colors';
  const ColTitle = ({ children }: { children: ReactNode }) => (
    <div className="mb-1">
      <h4 className="font-brand text-[11px] font-bold uppercase tracking-[0.22em] text-luxe-gold-light">{children}</h4>
      <span className="mt-2 block h-[2px] w-8 rounded-full bg-luxe-gold/70" aria-hidden="true" />
    </div>
  );

  return (
    <footer className="bg-luxe-black text-luxe-white">
      {/* Gold hairline divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-luxe-gold/60 to-transparent" aria-hidden="true" />

      {/* ── Main Footer Grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-x-8 gap-y-10">

          {/* Col 1 — Brand (lg:col-span-4) */}
          <div className="sm:col-span-2 lg:col-span-4">
            <Link to="/" className="flex items-center gap-3 mb-3 group w-fit" aria-label="Luxedge home">
              <img src="/luxedge-mark.png" alt="Luxedge" className="w-12 h-12 transition-transform duration-300 group-hover:scale-105" />
              <span className="flex flex-col leading-none">
                <span className="font-brand text-lg font-bold tracking-[0.18em] text-luxe-white">LUXEDGE</span>
                <span className="text-[9px] tracking-[0.26em] text-luxe-gold-light mt-1">PREMIUM PET ESSENTIALS</span>
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-luxe-white/65 max-w-sm mb-5">
              We source the best pet essentials from trusted suppliers around the world —
              then choose the pieces worth bringing home. Quality you can count on,
              honest prices, delivered to your door.
            </p>
                <Link to="/contact" className="inline-flex items-center gap-2 text-[13px] font-semibold text-luxe-gold-light hover:text-luxe-white transition-colors">
              Talk to the Luxedge team <ArrowRight strokeWidth={2} size={14} />
            </Link>
            {/* HQ card — clean address treatment (replaces awkward iframe) */}
            <div className="mt-6 max-w-sm rounded-2xl bg-luxe-white/[0.04] border border-luxe-white/10 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-luxe-gold-light mb-3">Visit Luxedge HQ</p>
              <div className="flex items-start gap-2.5">
                <MarkerPin01 strokeWidth={1.5} size={17} className="text-luxe-gold-light mt-0.5 shrink-0" />
                <a href="https://maps.google.com/?q=5041+Courtside+Dr,+Irving,+TX+75038" target="_blank" rel="noopener noreferrer"
                  className="text-sm leading-snug text-luxe-white/85 hover:text-luxe-gold-light transition-colors">
                  5041 Courtside Dr,<br />Irving, TX 75038
                </a>
              </div>
              <div className="mt-2.5 flex items-center gap-2.5">
                <Clock strokeWidth={1.5} size={16} className="text-luxe-gold-light shrink-0" />
                <span className="text-[13px] text-luxe-white/70">Mon – Fri · 9:00 AM – 6:00 PM CT</span>
              </div>
              <a href="https://maps.google.com/?q=5041+Courtside+Dr,+Irving,+TX+75038" target="_blank" rel="noopener noreferrer"
                className="mt-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-luxe-gold-light hover:text-luxe-white transition-colors">
                Get Directions <ArrowRight strokeWidth={2} size={14} />
              </a>
            </div>
          </div>

          {/* Col 2 — Shop */}
          <div className="lg:col-span-2">
            <ColTitle>Shop</ColTitle>
            <nav className="space-y-0" aria-label="Shop">
              <Link to="/category/dog-supplies" className={FL}>Dog</Link>
              <Link to="/category/cat-supplies" className={FL}>Cat</Link>
              <Link to="/category/pet-toys" className={FL}>Toys</Link>
              <Link to="/category/pet-beds" className={FL}>Beds</Link>
              <Link to="/category/feeding-water" className={FL}>Feeding</Link>
              <Link to="/category/grooming" className={FL}>Grooming</Link>
              <Link to="/shop?q=deal" className={FL}>Deals</Link>
            </nav>
          </div>

          {/* Col 3 — Help */}
          <div className="lg:col-span-2">
            <ColTitle>Help</ColTitle>
            <nav className="space-y-0" aria-label="Help">
              <Link to="/contact" className={FL}>Contact Us</Link>
              <Link to="/faq" className={FL}>FAQs</Link>
              <Link to="/shipping-policy" className={FL}>Shipping Policy</Link>
              <Link to="/returns" className={FL}>Return Policy</Link>
              <Link to="/orders" className={FL}>Track Order</Link>
            </nav>
          </div>

          {/* Col 4 — Company */}
          <div className="lg:col-span-2">
            <ColTitle>Company</ColTitle>
            <nav className="space-y-0" aria-label="Company">
              <Link to="/about" className={FL}>About Us</Link>
              <Link to="/blog" className={FL}>Blog</Link>
              <Link to="/privacy" className={FL}>Privacy Policy</Link>
              <Link to="/terms" className={FL}>Terms of Service</Link>
              <Link to="/careers" className={FL}>Careers</Link>
            </nav>
          </div>

          {/* Col 5 — Contact */}
          <div className="lg:col-span-2">
            <ColTitle>Contact</ColTitle>
            <div className="space-y-2.5">
              <a href="mailto:hello@luxedge.us" className="flex items-center gap-2.5 text-[13px] leading-snug text-luxe-white/75 hover:text-luxe-gold-light transition-colors">
                <Mail01 strokeWidth={1.5} size={16} className="text-luxe-gold-light shrink-0" />
                hello@luxedge.us
              </a>
              <a href="tel:4409418002" className="flex items-center gap-2.5 text-[13px] leading-snug text-luxe-white/75 hover:text-luxe-gold-light transition-colors">
                <Phone strokeWidth={1.5} size={16} className="text-luxe-gold-light shrink-0" />
                (440) 941-8002
              </a>
              <a href="https://wa.me/14409418002" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-[13px] leading-snug text-luxe-white/75 hover:text-luxe-gold-light transition-colors">
                <Send01 strokeWidth={1.5} size={16} className="text-luxe-gold-light shrink-0" />
                WhatsApp Us
              </a>
              <div className="flex items-center gap-2.5 text-[13px] leading-snug text-luxe-white/75">
                <Clock strokeWidth={1.5} size={16} className="text-luxe-gold-light shrink-0" />
                Mon – Fri · 9AM – 6PM CT
              </div>
            </div>
            <p className="mt-5 text-xs leading-relaxed text-luxe-white/50 max-w-[230px]">
              Real people answer — reach out any time and we'll point you in the right direction.
            </p>
          </div>
        </div>
      </div>

      {/* ── Categories Bar ── */}
      <div className="border-t border-luxe-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span className="font-brand text-[12px] font-semibold uppercase tracking-[0.18em] text-luxe-gold-light">Shop by Category:</span>
            {categories.filter(c => c.isActive && c.name !== 'Aquarium').map(c => (
              <Link key={c.id} to={`/category/${c.slug || toSlug(c.name)}`} className="text-sm text-luxe-white/65 hover:text-luxe-gold-light transition-colors">{c.name}</Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── Trust & Payment Bar ── */}
      <div className="border-t border-luxe-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2">
              {[
                { icon: Truck01, text: 'Free Shipping $50+' },
                { icon: RefreshCcw01, text: '30-Day Easy Returns' },
                { icon: Headphones01, text: 'Customer Support' },
                { icon: ShieldTick, text: 'Thoughtfully Curated' },
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-[13px] text-luxe-white/75">
                  <b.icon strokeWidth={1.5} size={16} className="text-luxe-gold-light" />
                  <span>{b.text}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-luxe-white/55">
              <Lock01 strokeWidth={1.5} size={14} className="text-luxe-gold-light shrink-0" />
              <span>{(import.meta as { env?: Record<string, string> }).env?.VITE_STRIPE_PUBLISHABLE_KEY ? 'Secure payments powered by Stripe.' : 'Payments launching soon — keep exploring the collection.'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Bar ── */}
      <div className="border-t border-luxe-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3">
            <p className="text-[13px] text-luxe-white/55 text-center md:text-left">
              © {new Date().getFullYear()} Luxedge. All rights reserved.
            </p>
            <div className="flex items-center gap-4 flex-wrap justify-center text-[13px]">
              <Link to="/privacy" className="text-luxe-white/65 hover:text-luxe-gold-light transition-colors">Privacy</Link>
              <Link to="/terms" className="text-luxe-white/65 hover:text-luxe-gold-light transition-colors">Terms</Link>
              <Link to="/returns" className="text-luxe-white/65 hover:text-luxe-gold-light transition-colors">Returns</Link>
              <a href="/sitemap.xml" className="text-luxe-white/65 hover:text-luxe-gold-light transition-colors">Sitemap</a>
            </div>
            <div className="flex items-center gap-1.5 text-[13px] text-luxe-white/55">
              <Globe01 strokeWidth={1.5} size={14} className="text-luxe-gold-light" /> USD ($) · English
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Homepage product grids are curated (small, admin-flagged sets), so a fixed
 * 5-column grid leaves huge empty tracks when a section only has 1-3 items —
 * it reads as a broken/incomplete page rather than a real storefront. Cap the
 * grid to the actual item count (up to 5) so cards sit close together instead
 * of stretching across mostly-empty rows.
 */
function productGridClass(count: number): string {
  if (count <= 1) return 'grid grid-cols-1 max-w-[220px] gap-2.5 sm:gap-3';
  if (count === 2) return 'grid grid-cols-2 max-w-[460px] gap-2.5 sm:gap-3';
  if (count === 3) return 'grid grid-cols-2 sm:grid-cols-3 max-w-[700px] gap-2.5 sm:gap-3';
  if (count === 4) return 'grid grid-cols-2 sm:grid-cols-4 max-w-[940px] gap-2.5 sm:gap-3';
  return 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-2.5';
}

function PCard({ product }: { product: Product }) {
  const { addToCart, reviews } = useApp();
  const { pathname } = useLocation();
  const selectProduct = () => trackEvent('select_item', { item_list_id: pathname || 'storefront', items: [{ item_id: product.id, item_name: product.name, price: product.price }], ...utmParams() });
  const image = firstUsableImage(product) || LUXEDGE_IMAGE_FALLBACK;
  const secondImage = product.images.find((candidate) => candidate && candidate !== image);
  const hasCompareAt = product.originalPrice > product.price;
  const discount = hasCompareAt ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;
  // Ratings come ONLY from verified user reviews — never the catalog stub.
  const verified = reviews.filter(r => r.productId === product.id && r.status === 'approved');
  const verifiedAvg = verified.length ? verified.reduce((s, r) => s + r.rating, 0) / verified.length : 0;
  return (
    <article className="product-card group">        <Link to={`/product/${product.id}`} onClick={selectProduct} className="block focus-visible:outline-luxe-gold" aria-label={`View ${product.name}`}>
        <div className="product-card-media">
          <img src={image} alt={product.name} loading="lazy" decoding="async" onError={onImageError} className="product-card-image" />
          {secondImage && (
            <img src={secondImage} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={onImageError}
              className="product-card-image product-card-image-secondary" />
          )}
          <div className="product-card-badge">
            {product.newArrival && <span className="badge-new">New</span>}
            {discount > 0 && <span className="badge-sale">-{discount}%</span>}
            {product.featured && !product.newArrival && <span className="badge-featured">Featured</span>}
          </div>
          <span className="product-card-view">View product <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" /></span>
        </div>
      </Link>
      <div className="product-card-info">
        <Link to={`/product/${product.id}`} className="block min-w-0">
          <p className="product-card-category">{product.category}</p>
          <h3 className="product-card-title line-clamp-2">{product.name}</h3>
        </Link>
        {verified.length > 0 && (
          <span className="product-card-rating mt-1 inline-flex" aria-label={`Rated ${verifiedAvg.toFixed(1)} out of 5 by ${verified.length} verified review${verified.length !== 1 ? 's' : ''}`}>
            <span className="inline-flex" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <Star01 key={i} strokeWidth={1.5} size={10} fill={i < Math.round(verifiedAvg) ? 'currentColor' : 'none'} />)}</span>
            <span>{verifiedAvg.toFixed(1)}</span>
          </span>
        )}
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-baseline gap-1.5">
            <span className="product-card-price">${product.price.toFixed(2)}</span>
            {hasCompareAt && <span className="product-card-compare">${product.originalPrice.toFixed(2)}</span>}
          </div>
        </div>
        <button type="button" onClick={(e) => { e.preventDefault(); addToCart(product); }}
          className="btn-glow mt-2 w-full py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-sm hover:shadow-gold product-card-add-visible"
          aria-label={`Add ${product.name} to cart`}>
          <ShoppingBag01 strokeWidth={1.5} size={12} aria-hidden="true" /> Add to Cart
        </button>
      </div>
    </article>
  );
}

// Premium alias — one card component across the whole storefront
function PCardPremium({ product }: { product: Product }) {
  return <PCard product={product} />;
}


// Per-route document title + meta description + canonical for SEO
function RouteTitle() {
  const { pathname } = useLocation();
  const { products, blogs } = useApp();
  useEffect(() => {
    const brand = "Luxedge";
    const segs = pathname.split("/").filter(Boolean);
    // Normalize seo_title values that already carry the brand suffix so the
    // brand is never duplicated ("… | Luxedge | Luxedge").
    const set = (t: string) => { document.title = t.replace(/\s*\|\s*Luxedge\s*$/i, '') + " | " + brand; };
    const full = (t: string) => { document.title = t; };
    const setMeta = (name: string, content: string) => {
      let el = document.head.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    const setOg = (prop: string, content: string) => {
      let el = document.head.querySelector(`meta[property="${prop}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    const setCanonical = () => {
      // BrowserRouter clean URLs — never hash (#/) canonicals.
      const href = `https://luxedge.us${pathname}`;
      let el = document.head.querySelector('link[rel="canonical"]');
      if (!el) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el); }
      el.setAttribute('href', href);
      setOg('og:url', href);
    };
    const desc = (d: string) => { setMeta('description', d); setOg('og:description', d); setOg('og:title', document.title); };
    setCanonical();
    if (segs.length === 0) { full("Luxedge — Premium Pet Essentials | Better Products for Happier Pets"); desc("Handpicked premium pet essentials — feeding, comfort, play and grooming."); }
    else if (segs[0] === "shop") { set("Shop All Products"); desc("Browse the full Luxedge collection of premium pet essentials for dogs and cats."); }
    else if (segs[0] === "category") { const c = fromSlug(decodeURIComponent(segs[1] || "")); set("Shop " + c); desc(CAT_META[c]?.desc || `Browse our ${c} collection at Luxedge.`); }
    else if (segs[0] === "product") {
      // Real catalog product (never the demo ALL_PRODUCTS fixture).
      const p = products.find((x) => x.id === decodeURIComponent(segs[1] || ""));
      set(p ? (p.seoTitle || p.name) : "Product");
      if (p) desc(p.seoDescription || p.shortDesc || p.description.slice(0, 155));
    }
    else if (segs[0] === "cart") { set("Shopping Cart"); desc("Review your Luxedge cart — free shipping on orders over $50."); }
    else if (segs[0] === "checkout") { set("Checkout"); desc("Complete your Luxedge order."); }
    else if (segs[0] === "orders") { set("My Orders"); desc("Track your Luxedge orders."); }
    else if (segs[0] === "about") { set("About Us"); desc("Luxedge curates premium, honest pet essentials for dogs and cats — quality you can trust."); }
    else if (segs[0] === "contact") { set("Contact Us"); desc("Reach the Luxedge customer support team — Mon–Fri, 9AM–6PM CT."); }
    else if (segs[0] === "privacy") { set("Privacy Policy"); desc("Luxedge privacy policy — how we handle your data, cookies and advertising."); }
    else if (segs[0] === "terms") { set("Terms of Service"); desc("Luxedge terms of service."); }
    else if (segs[0] === "returns") { set("Return Policy"); desc("Luxedge 30-day easy return policy."); }
    else if (segs[0] === "shipping-policy") { set("Shipping Policy"); desc("Luxedge shipping policy — free shipping on orders over $50."); }
    else if (segs[0] === "faq") { set("Frequently Asked Questions"); desc("Answers to common questions about shopping at Luxedge."); }
    else if (segs[0] === "careers") { set("Careers"); desc("Join the Luxedge team."); }
    else if (segs[0] === "blog") {
      const post = segs[1] && segs[1] !== "write" ? blogs.find(b => b.slug === segs[1]) : undefined;
      set(post ? post.title : (segs[1] ? (segs[1] === "write" ? "Write a Post" : "Blog") : "Blog & Insights"));
      desc(post ? (post.excerpt || post.content.slice(0, 155)) : "Pet care tips and insights from the Luxedge team.");
    }
    else if (segs[0] === "login") { set("Sign In"); desc("Sign in to your Luxedge account."); }
    else if (segs[0] === "signup") { set("Create Account"); desc("Create your Luxedge account."); }
    else if (segs[0] === "admin") { set("Admin Dashboard"); }
    else set("Luxedge");
  }, [pathname, products, blogs]); // products re-run so PDP titles resolve once the catalog loads
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
      <WelcomePopup />
      <WhatsAppButton />
      <AIAssistant />
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
  const [ctaVisible, setCtaVisible] = useState(true);
  const ctaRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  // Sync the mobile swipe gallery indicator to the scrolled image index.
  const onGalleryScroll = useCallback(() => {
    const el = galleryRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    setSelImg(Math.max(0, Math.min(idx, (product?.images.length || 1) - 1)));
  }, [product?.images.length]);

  // Hide the sticky mobile Add to Cart bar while the inline CTA is on screen.
  useEffect(() => {
    const el = ctaRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCtaVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [product?.id]);

  // Per-product SEO: canonical, meta description and Product + Breadcrumb
  // structured data. Only verified review data is ever emitted.
  useEffect(() => {
    if (!product) return;
    const verified = allReviews.filter(r => r.productId === product.id && r.status === 'approved');
    const setMeta = (name: string, content: string) => {
      let el = document.head.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    const setCanonical = () => {
      const href = `https://luxedge.us/product/${product.id}`;
      let el = document.head.querySelector('link[rel="canonical"]');
      if (!el) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el); }
      el.setAttribute('href', href);
    };
    setMeta('description', product.shortDesc || product.description.slice(0, 155));
    setCanonical();
    if (product.images[0]) {
      const ogImg = document.head.querySelector('meta[property="og:image"]');
      if (ogImg) ogImg.setAttribute('content', product.images[0]);
      const twImg = document.head.querySelector('meta[name="twitter:image"]');
      if (twImg) twImg.setAttribute('content', product.images[0]);
    }
    const jsonLd: Record<string, unknown>[] = [{
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://luxedge.us/' },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: 'https://luxedge.us/shop' },
        { '@type': 'ListItem', position: 3, name: product.name, item: `https://luxedge.us/product/${product.id}` },
      ],
    }];
    const offers: Record<string, unknown> = {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'USD',
      // Honest availability: only claim InStock for real supplier-verified stock.
      availability: product.stockStatus === 'in_stock' || (product.usInventory && product.stock > 0)
        ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    };
    if (product.variants[0]?.sku) offers.sku = product.variants[0].sku;
    const prodSchema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      image: product.images.slice(0, 8),
      description: product.shortDesc || product.description,
      brand: { '@type': 'Brand', name: product.brand || 'Luxedge' },
      offers,
    };
    if (product.category) prodSchema.category = product.category;
    // Only verified, user-submitted reviews go into schema — never the catalog stub.
    if (verified.length > 0) {
      const avg = verified.reduce((s, r) => s + r.rating, 0) / verified.length;
      prodSchema.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: avg.toFixed(1),
        reviewCount: verified.length,
      };
    }
    jsonLd.push(prodSchema);
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'product-jsonld';
    script.text = JSON.stringify(jsonLd);
    document.getElementById('product-jsonld')?.remove();
    document.head.appendChild(script);
    return () => { document.getElementById('product-jsonld')?.remove(); };
  }, [product?.id]);

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
  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const uniqueColors = [...new Set(product.variants.map(v => v.color).filter(Boolean))];
  const uniqueSizes = [...new Set(product.variants.map(v => v.size).filter(Boolean))];

  const handleAddToCart = () => {
    if (activeStock === 0) return;
    for (let i = 0; i < qty; i++) addToCart(product);
    notify(`${qty}× ${product.name} added to cart!`);
  };

  const handleBuyNow = () => {
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
    <div className="pdp-shell w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400 mb-5">
        <Link to="/" className="hover:text-luxe-gold transition-colors">Home</Link>
        <ChevronRight strokeWidth={1.5} size={11} />
        <Link to="/shop" className="hover:text-luxe-gold transition-colors">Shop</Link>
        <ChevronRight strokeWidth={1.5} size={11} />
        <Link to={`/category/${toSlug(product.category)}`} className="hover:text-luxe-gold transition-colors">{product.category}</Link>
        <ChevronRight strokeWidth={1.5} size={11} />
        <span className="text-gray-700 truncate min-w-0 max-w-[220px] font-medium">{product.name}</span>
      </nav>

      <div className="pdp-grid grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 lg:gap-10 xl:gap-14">
        {/* LEFT: Image Gallery */}
        <div className="pdp-gallery min-w-0 lg:sticky lg:top-24 self-start">
          {/* Mobile: swipeable gallery with image indicator dots */}
          <div
            ref={galleryRef}
            onScroll={onGalleryScroll}
            aria-label={`${product.name} — image gallery`}
            className="flex lg:hidden overflow-x-auto snap-x snap-mandatory scrollbar-hide rounded-3xl border border-luxe-silver/70 bg-luxe-cream shadow-md"
          >
            {product.images.map((img, i) => (
              <div key={i} className="w-full shrink-0 snap-center">
                <div className="aspect-[4/3]">
                  <img src={img} alt={`${product.name} — image ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" onError={onImageError} className="pdp-gallery-image w-full h-full object-contain" />
                </div>
              </div>
            ))}
          </div>
          {product.images.length > 1 && (
            <div className="flex lg:hidden justify-center gap-1.5 mt-3">
              {product.images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => { const el = galleryRef.current; if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' }); }}
                  aria-label={`Go to image ${i + 1}`}
                  aria-current={selImg === i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${selImg === i ? 'w-6 bg-luxe-gold' : 'w-1.5 bg-luxe-silver hover:bg-luxe-gray'}`}
                />
              ))}
            </div>
          )}

          {/* Desktop: large main image + thumbnail rail */}
          <div className="hidden lg:block">
            <div className="pdp-main-frame relative rounded-3xl overflow-hidden border border-luxe-silver/70 bg-luxe-cream shadow-md">
              <div className="aspect-[4/3]">
                <img key={selImg} src={product.images[selImg] || product.images[0]} alt={product.name} fetchPriority="high" decoding="async" onError={onImageError} className="pdp-gallery-image w-full h-full object-contain" />
              </div>
              {discount > 0 && (
                <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                  <span className="px-2 py-1 bg-sale text-white text-[10px] font-bold rounded-full shadow">-{discount}%</span>
                </div>
              )}
              {product.freeShipping && <span className="absolute top-3 right-3 px-2 py-1 bg-luxe-black/90 text-luxe-gold-light text-[9px] font-bold rounded-full">FREE SHIP</span>}
            </div>
            {product.images.length > 1 && (
              <div className="flex gap-2.5 mt-3 overflow-x-auto pb-1">
                {product.images.map((img, i) => (
                  <button key={i} onClick={() => setSelImg(i)} aria-label={`View image ${i + 1}`} aria-current={selImg === i}
                    className={`w-16 h-16 rounded-xl overflow-hidden border-2 shrink-0 transition-all ${selImg === i ? 'border-luxe-gold ring-2 ring-luxe-gold/20 shadow-md' : 'border-luxe-silver hover:border-luxe-gold/50 opacity-80 hover:opacity-100'}`}>
                    <img src={img} alt="" onError={onImageError} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Product Info — AliExpress-style premium */}
        <div className="pdp-info min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {product.brand && <span className="text-[11px] font-bold text-luxe-gold uppercase tracking-wider">{product.brand}</span>}
            {product.condition !== 'New' && <span className="text-[11px] text-gray-400">| {product.condition}</span>}
            <span className="text-[11px] text-gray-500 px-2 py-0.5 bg-gray-100 rounded-full font-medium">{product.category}</span>
          </div>

          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-luxe-black tracking-tight mb-3">{product.name}</h1>

          {/* Rating — shown ONLY when verified user reviews exist */}
          {reviews.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="flex gap-0.5" aria-hidden="true">{[...Array(5)].map((_, i) => <Star01 strokeWidth={1.5} key={i} size={14} fill={i < Math.round(avgRating) ? 'currentColor' : 'none'} className={i < Math.round(avgRating) ? 'text-star' : 'text-gray-200'} />)}</div>
              <span className="text-xs font-semibold text-luxe-gold hover:underline cursor-pointer" onClick={() => setTab('reviews')}>{avgRating.toFixed(1)} ({reviews.length} verified review{reviews.length !== 1 ? 's' : ''})</span>
            </div>
          ) : (
            <p className="text-xs text-luxe-gray mb-4">No verified reviews yet.</p>
          )}

          {/* Price */}
          <div className="rounded-2xl bg-luxe-gold-soft/70 border border-luxe-gold/25 p-5 mb-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-serif text-3xl font-bold text-luxe-black">${activePrice.toFixed(2)}</span>
              {discount > 0 && <span className="text-sm text-luxe-gray line-through">${activeOriginal.toFixed(2)}</span>}
              {discount > 0 && <span className="px-2 py-0.5 bg-sale text-white text-[11px] font-bold rounded-full">Save ${(activeOriginal - activePrice).toFixed(2)}</span>}
            </div>
            {discount > 0 && <p className="text-[11px] text-luxe-gold-dark mt-2 font-semibold">{discount}% off — limited time deal</p>}
          </div>

          {/* Stock + Shipping — honest: only real supplier-verified stock is
              presented as In Stock / Low Stock; otherwise availability is
              confirmed at checkout. No invented scarcity. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs">
            {product.usInventory && activeStock > 10 && <span className="text-green-600 font-medium"><CheckCircle strokeWidth={1.5} size={13} className="inline mr-1" />In Stock</span>}
            {product.usInventory && activeStock > 0 && activeStock <= 10 && <span className="text-luxe-gold font-medium"><AlertTriangle strokeWidth={1.5} size={13} className="inline mr-1" />Only {activeStock} left in stock</span>}
            {product.usInventory && activeStock === 0 && <span className="text-red-500 font-medium"><X strokeWidth={1.5} size={13} className="inline mr-1" />Out of Stock</span>}
            {!product.usInventory && activeStock > 0 && <span className="text-gray-500"><CheckCircle strokeWidth={1.5} size={13} className="inline mr-1" />Availability confirmed at checkout</span>}
            {product.freeShipping && <span className="text-gray-500"><Truck01 strokeWidth={1.5} size={13} className="inline mr-1" />Free shipping</span>}
            <span className="text-gray-500"><RefreshCcw01 strokeWidth={1.5} size={13} className="inline mr-1" />30-day easy returns</span>
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
          <div ref={ctaRef} className="flex items-stretch gap-3 mb-4">
            <div className="flex items-center border-2 border-gray-200 rounded-xl">
              <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-3 py-2.5 hover:bg-gray-50 text-gray-500"><Minus strokeWidth={1.5} size={14} /></button>
              <span className="px-3 py-2.5 text-sm font-semibold border-x-2 border-gray-100 min-w-[2.25rem] text-center">{qty}</span>
              <button onClick={() => setQty(Math.min(activeStock || 1, qty + 1))} className="px-3 py-2.5 hover:bg-gray-50 text-gray-500"><Plus strokeWidth={1.5} size={14} /></button>
            </div>
            <button onClick={handleAddToCart} disabled={activeStock === 0}
              className="btn-glow flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:bg-luxe-silver disabled:cursor-not-allowed disabled:text-luxe-gray shadow-gold hover:shadow-luxe-gold/30 hover:scale-[1.02] bg-luxe-gold hover:bg-luxe-gold-dark">
              <ShoppingBag01 strokeWidth={1.5} size={15} /> {activeStock === 0 ? 'Out of Stock' : 'Add to Cart'}
            </button>
            <button onClick={handleBuyNow} disabled={activeStock === 0}
              className="btn-glow flex-1 py-3 bg-luxe-black hover:bg-luxe-charcoal disabled:bg-luxe-silver disabled:cursor-not-allowed disabled:text-luxe-gray text-white text-sm font-bold rounded-xl transition-colors">
              Buy Now
            </button>
          </div>

          {/* Trust */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { icon: Truck01, t: 'Free ship $50+' },
              { icon: RefreshCcw01, t: '30-day returns' },
              { icon: ShieldTick, t: 'Thoughtfully curated' },
              { icon: Lock01, t: 'Encrypted connection' },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 bg-luxe-cream rounded-xl border border-luxe-silver/70">
                <b.icon strokeWidth={1.5} size={14} className="text-luxe-gold shrink-0" />
                <span className="text-[10px] sm:text-[11px] text-luxe-gray font-medium leading-tight">{b.t}</span>
              </div>
            ))}
          </div>

          {product.deliveryMinDays != null && product.deliveryMaxDays != null && (
            <p className="flex items-center gap-2 text-xs text-luxe-gray"><Truck01 strokeWidth={1.5} size={14} className="text-luxe-gold shrink-0" /> Estimated delivery: {product.deliveryMinDays}–{product.deliveryMaxDays} business days</p>
          )}

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
          {reviews.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl font-bold text-gray-900">{avgRating.toFixed(1)}</span>
              <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star01 strokeWidth={1.5} key={i} size={16} fill={i < Math.round(avgRating) ? 'currentColor' : 'none'} className={i < Math.round(avgRating) ? 'text-star' : 'text-gray-200'} />)}</div>
              <span className="text-xs text-gray-500">{reviews.length} verified review{reviews.length !== 1 ? 's' : ''}</span>
            </div>
          )}

          {user ? (
            <button onClick={() => setShowRevForm(!showRevForm)} className="text-xs font-semibold text-luxe-gold hover:underline mb-4 block">{showRevForm ? 'Cancel' : 'Write a Review'}</button>
          ) : (
            <p className="text-xs text-gray-500 mb-4"><Link to="/login" className="text-luxe-gold font-semibold hover:underline">Sign in</Link> to review</p>
          )}

          {showRevForm && (
            <form onSubmit={submitReview} className="bg-luxe-cream rounded-xl p-4 mb-5 space-y-3 border border-luxe-silver/70">
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map(s => (
                <button key={s} type="button" onClick={() => setRevForm({ ...revForm, rating: s })}>
                  <Star01 strokeWidth={1.5} size={18} fill={s <= revForm.rating ? 'currentColor' : 'none'} className={s <= revForm.rating ? 'text-star' : 'text-gray-300'} />
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
                  <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star01 strokeWidth={1.5} key={i} size={11} fill={i < r.rating ? 'currentColor' : 'none'} className={i < r.rating ? 'text-star' : 'text-gray-200'} />)}</div>
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

      {/* ── Sticky mobile Add to Cart (hidden on desktop) ── */}
      <div className={`lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-luxe-silver/70 shadow-[0_-8px_30px_-12px_rgba(16,26,46,0.2)] transition-transform duration-300 luxe-safe-bottom ${ctaVisible ? 'translate-y-full' : 'translate-y-0'}`} aria-hidden={ctaVisible} inert={ctaVisible}>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-luxe-black leading-tight">${activePrice.toFixed(2)}</p>
            {discount > 0 && <p className="text-[10px] text-luxe-gray line-through">${activeOriginal.toFixed(2)}</p>}
          </div>
          <button onClick={handleAddToCart} disabled={activeStock === 0}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 bg-luxe-gold hover:bg-luxe-gold-dark disabled:bg-luxe-silver disabled:cursor-not-allowed disabled:text-luxe-gray shadow-gold">
            <ShoppingBag01 strokeWidth={1.5} size={15} /> {activeStock === 0 ? 'Out of Stock' : 'Add to Cart'}
          </button>
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
    <div className="flex items-end justify-between gap-3 mb-5">
      <div>
        <p className="eyebrow mb-1.5">{eyebrow}</p>
        <h2 className="text-xl sm:text-2xl font-serif font-bold text-luxe-black tracking-tight">{title}</h2>
      </div>
      {to && <Link to={to} className="hidden sm:inline-flex items-center gap-1 text-[12px] font-bold text-luxe-gold hover:text-luxe-gold-dark transition-colors group">
        {linkLabel} <ArrowRight strokeWidth={1.5} size={13} className="transition-transform group-hover:translate-x-0.5" />
      </Link>}
    </div>
  );
}

function HomePage() {
  const { products, freeShippingEnabled, freeShippingThreshold } = useApp();
  const [nlEmail, setNlEmail] = useState('');
  const [nlDone, setNlDone] = useState(false);
  const [nlSaved, setNlSaved] = useState(false);
  // Catalog Launch Phase — every section remains REAL catalog data. The
  // homepage is intentionally art-directed: weak/collage-heavy supplier
  // images stay available in Shop but are not promoted into editorial slots.
  const featured = products.filter(p => p.isActive);
  const homepageVisualProducts = featured.filter((p) => firstUsableImage(p));
  const topPicks = homepageVisualProducts.filter(p => p.featured);
  const newArrivals = homepageVisualProducts.filter(p => p.newArrival);
  // Deals include either a real compare-at saving or an admin-enabled sale.
  // Never invent a discount when the source catalog has no compare-at price.
  const deals = homepageVisualProducts
    .filter(p => p.saleEnabled || p.originalPrice > p.price)
    .sort((a, b) => {
      const saving = (p: Product) => p.originalPrice > p.price ? 1 - p.price / p.originalPrice : 0;
      return saving(b) - saving(a);
    });
  // Supplier sections are evidence-based: CJ rows appear only when the live
  // catalog explicitly records CJ as their source and they are customer-visible.
  const cjProducts = homepageVisualProducts.filter(p => /cjdropshipping|\bcj\b/i.test(`${p.supplierSource || ''} ${p.sourceType || ''} ${p.inventorySource || ''}`));
  // "Trending" is merchandising intent from the catalog, not fabricated sales.
  const trendingProducts = homepageVisualProducts.filter(p => p.featured || p.newArrival || p.saleEnabled).slice(0, 10);
  const dogEssentials = homepageVisualProducts.filter(p => p.category === 'Dog Supplies' || p.tags.includes('dog'));
  const catEssentials = homepageVisualProducts.filter(p => p.category === 'Cat Supplies' || p.tags.includes('cat'));
  const heroProduct = (topPicks.find((p) => firstUsableImage(p)) || featured.find((p) => firstUsableImage(p)));
  const heroDogImage = 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=800&h=1000&fit=crop&crop=faces&auto=format&q=88';
  const heroCatImage = 'https://images.unsplash.com/photo-1495360010541-f48722b34f7d?w=800&h=1000&fit=crop&crop=faces&auto=format&q=88';
  const heroParrotImage = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Ara_ararauna_01.jpg/960px-Ara_ararauna_01.jpg';
  const catVisual = featured.find((p) => firstUsableImage(p) && (p.category === 'Cat Supplies' || p.tags.some((tag) => tag.toLowerCase().includes('cat'))));
  const categoryVisuals = [
    { label: 'Walk & travel', to: '/category/pet-accessories', product: featured.find((p) => /carrier backpack/i.test(p.name) && firstUsableImage(p)) },
    { label: 'Play', to: '/category/pet-toys', product: featured.find((p) => p.category === 'Pet Toys' && firstUsableImage(p)) },
    { label: 'Feeding', to: '/category/feeding-water', product: featured.find((p) => p.category === 'Feeding & Water' && firstUsableImage(p)) },
    { label: 'Comfort', to: '/category/pet-beds', product: featured.find((p) => /dog\s+(bed|mat|sofa)/i.test(p.name) && firstUsableImage(p)) || featured.find((p) => p.category === 'Pet Beds' && firstUsableImage(p)) },
    { label: 'Cat essentials', to: '/category/cat-supplies', product: catVisual },
  ].filter((tile): tile is { label: string; to: string; product: Product } => Boolean(tile.product && firstUsableImage(tile.product)))
    .filter((tile, index, all) => all.findIndex((candidate) => candidate.product.id === tile.product.id) === index);
  const editorialProduct = featured.find((p) => p.id !== heroProduct?.id && /carrier backpack/i.test(p.name) && firstUsableImage(p))
    || featured.find((p) => p.id !== heroProduct?.id && /dog\s+(bed|mat|sofa)/i.test(p.name) && firstUsableImage(p))
    || catVisual
    || heroProduct;
  // GA4: fire view_item_list once for the homepage featured order on load.
  useEffect(() => {
    if (topPicks.length === 0 && trendingProducts.length === 0) return;
    const list = (topPicks.length ? topPicks : trendingProducts).slice(0, 20);
    trackEvent('view_item_list', {
      item_list_id: 'homepage-featured',
      items: list.map(p => ({ item_id: p.id, item_name: p.name, price: p.price })),
      ...utmParams(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const shipCopy = freeShippingEnabled ? `Free shipping over $${freeShippingThreshold}` : 'Shipping calculated at checkout';

  return (
    <div className="bg-white">
      {/* ════════ EDITORIAL HERO ════════ */}
      <section className="home-hero">
        <div className="home-hero-wash" aria-hidden="true" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-9 sm:py-10 lg:py-12 grid lg:grid-cols-[0.44fr_0.56fr] items-center gap-6 lg:gap-10">
          <div className="hero-stagger text-center lg:text-left">
            <p className="eyebrow mb-4">Sourced worldwide. Chosen with care.</p>
            <h1 className="home-hero-title">
              <span className="block">The Best Finds for Every Pet,</span>
              <span className="block">Thoughtfully <em>Curated.</em></span>
            </h1>
            <p className="home-hero-copy">
              We search trusted sources around the world for well-made essentials, then choose the pieces worth bringing home.
            </p>
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3">
              <Link to="/shop" className="editorial-button editorial-button-dark">
                Shop essentials <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" />
              </Link>
              <Link to="/shop" className="editorial-button editorial-button-light">
                Explore categories
              </Link>
            </div>
            <div className="home-hero-notes" aria-label="Luxedge shopping information">
              <span><Truck01 strokeWidth={1.5} size={12} aria-hidden="true" /> {shipCopy}</span>
              <span><RefreshCcw01 strokeWidth={1.5} size={12} aria-hidden="true" /> Returns &amp; support</span>
              <span><Headphones01 strokeWidth={1.5} size={12} aria-hidden="true" /> Real customer support</span>
            </div>
          </div>

          <div className="home-hero-visual">
            <div className="home-hero-accent" aria-hidden="true" />
            <div className="home-hero-pet-collage" aria-label="Happy dog, cat and parrot">
              <Link to="/category/dog-supplies" className="home-hero-pet-card home-hero-dog-card group">
                <img src={heroDogImage} alt="Happy dog" loading="eager" fetchPriority="high" decoding="async" onError={onImageError} />
                <span>Shop dog essentials <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" /></span>
              </Link>
              <Link to="/category/cat-supplies" className="home-hero-pet-card home-hero-cat-card group">
                <img src={heroCatImage} alt="Relaxed cat" loading="eager" fetchPriority="high" decoding="async" onError={onImageError} />
                <span>Shop cat essentials <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" /></span>
              </Link>
              <Link to="/category/bird-supplies" className="home-hero-pet-card home-hero-parrot-card group">
                <img src={heroParrotImage} alt="Colorful parrot" loading="eager" decoding="async" onError={onImageError} />
                <span>Shop bird essentials <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" /></span>
              </Link>
              {heroProduct && <Link to={`/product/${heroProduct.id}`} className="home-hero-product-chip">
                <span>Featured from the collection</span><strong>{heroProduct.name}</strong>
              </Link>}
            </div>
          </div>
        </div>
      </section>

      {/* ════════ Ad: After Hero ════════ */}
      <div className="max-w-7xl mx-auto px-4"><AdSenseAd placement="home_after_hero" /></div>

      {/* ════════ SHOP BY PET — Circular Avatars ════════ */}
      <section className="section-compact bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="mb-5">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow mb-1">Shop by pet</p>
                <h2 className="section-title">Who are you shopping for?</h2>
              </div>
            </div>
          </Reveal>
          <Reveal delay={40}>
            <div className="pet-avatar-grid">
              {[
                { label: 'Dog', to: '/category/dog-supplies', img: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=420&h=420&fit=crop&auto=format&q=88' },
                { label: 'Cat', to: '/category/cat-supplies', img: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=420&h=420&fit=crop&auto=format&q=88' },
                { label: 'Birds', to: '/category/bird-supplies', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Ara_ararauna_01.jpg/480px-Ara_ararauna_01.jpg' },
                { label: 'Horse', to: '/category/horse', img: 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=420&h=420&fit=crop&auto=format&q=88' },
                { label: 'Livestock', to: '/category/cattle', img: 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=420&h=420&fit=crop&auto=format&q=88' },
              ].map((pet, index) => (
                <Reveal key={pet.label} delay={index * 60}>
                  <Link to={pet.to} className="pet-avatar-item">
                    <div className="pet-avatar-circle">
                      <img src={pet.img} alt={pet.label} loading="lazy" decoding="async" onError={onImageError} />
                    </div>
                    <span className="pet-avatar-name">{pet.label}</span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ════════ POPULAR CATEGORIES — Horizontal Scroll ════════ */}
      <section className="section-compact bg-luxe-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="section-heading-row">
              <div>
                <p className="eyebrow mb-1">Browse</p>
                <h2 className="section-title" style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.6rem)' }}>Popular Categories</h2>
              </div>
              <Link to="/shop" className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-luxe-gold hover:text-luxe-gold-dark transition-colors group">View All <ArrowRight strokeWidth={1.5} size={12} className="transition-transform group-hover:translate-x-0.5" /></Link>
            </div>
          </Reveal>
          <Reveal delay={40}>
            <div className="category-scroll">
              {[
                { label: 'Dog Walking', to: '/category/dog-supplies', icon: <Truck01 strokeWidth={1.5} size={14} /> },
                { label: 'Beds & Mats', to: '/category/pet-beds', icon: <Star01 strokeWidth={1.5} size={14} /> },
                { label: 'Grooming', to: '/category/grooming', icon: <Stars01 strokeWidth={1.5} size={14} /> },
                { label: 'Feeding', to: '/category/feeding-water', icon: <Zap strokeWidth={1.5} size={14} /> },
                { label: 'Toys', to: '/category/pet-toys', icon: <Star01 strokeWidth={1.5} size={14} /> },
                { label: 'Travel', to: '/category/pet-accessories', icon: <Globe01 strokeWidth={1.5} size={14} /> },
                { label: 'Cat Essentials', to: '/category/cat-supplies', icon: <Stars01 strokeWidth={1.5} size={14} /> },
                { label: 'Birds', to: '/category/bird-supplies', icon: <Feather strokeWidth={1.5} size={14} /> },
                { label: 'New Arrivals', to: '/shop', icon: <Zap strokeWidth={1.5} size={14} /> },
              ].map((cat) => (
                <Link key={cat.label} to={cat.to} className="category-pill">
                  <span className="text-luxe-gold" aria-hidden="true">{cat.icon}</span>
                  {cat.label}
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ════════ DEAL BANNER ════════ */}
      {deals.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <Link to="/shop?q=deal" className="deal-banner block p-6 sm:p-8 lg:p-10">
              <div className="relative z-10 flex flex-col sm:flex-row items-center gap-6">
                <div className="flex-1 text-center sm:text-left">
                  <p className="eyebrow mb-2 text-luxe-gold-light">Limited Time</p>
                  <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white mb-2">Special Deals on Pet Essentials</h2>
                  <p className="text-white/70 text-sm mb-4 max-w-md">Save on handpicked premium products for your furry friends. Quality you trust, prices you'll love.</p>
                  <span className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-luxe-gold text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all hover:bg-luxe-gold-dark">
                    Shop Deals <ArrowRight strokeWidth={1.5} size={13} />
                  </span>
                </div>
                <div className="flex -space-x-3">
                  {deals.slice(0, 3).map((p) => (
                    <div key={p.id} className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden border-2 border-white/20 bg-white/10">
                      <img src={firstUsableImage(p) || LUXEDGE_IMAGE_FALLBACK} alt={p.name} loading="lazy" onError={onImageError} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            </Link>
          </Reveal>
        </section>
      )}

      {/* ════════ SHOP BY CATEGORY ════════ */}
      <section className="section-compact bg-luxe-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="mb-5">
            <p className="eyebrow mb-2">Shop by category</p>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
              <h2 className="section-title">Essentials for better everyday moments.</h2>
              <Link to="/shop" className="editorial-link text-luxe-gold">View the collection <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" /></Link>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <div className="editorial-category-grid">
              {categoryVisuals.map((tile, index) => (
                <Link key={`${tile.label}-${tile.product.id}`} to={tile.to} className={`editorial-category-tile group ${index < 4 ? 'editorial-category-large' : 'editorial-category-small'} ${index === 1 ? 'editorial-category-crop' : ''}`}>
                  <img src={firstUsableImage(tile.product) || LUXEDGE_IMAGE_FALLBACK} alt={tile.product.name} loading="lazy" decoding="async" onError={onImageError} />
                  <div className="editorial-category-overlay" aria-hidden="true" />
                  <span className="editorial-category-name">{tile.label}</span>
                  <ArrowRight strokeWidth={1.5} size={15} className="editorial-category-arrow" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ════════ Ad: After Categories ════════ */}
      <div className="max-w-7xl mx-auto px-4"><AdSenseAd placement="home_after_categories" /></div>


      {/* ════════ PRODUCT SECTIONS (or premium empty-catalog state) ════════ */}
      {/* Phase 4E.1 — when the catalog has zero products (no published DB rows),
          show ONE premium curation notice instead of empty product grids. No
          fake product cards, no fake counts, no fake launch dates. */}
      {featured.length === 0 ? (
        <section className="section-compact bg-luxe-cream">
          <div className="max-w-2xl mx-auto px-4 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-5"><Stars01 strokeWidth={1.5} size={22} className="text-luxe-gold" /></div>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-luxe-black mb-3">New premium pet essentials are being curated</h2>
            <p className="text-sm text-luxe-gray leading-relaxed">Our team is selecting thoughtful, quality pet products for the Luxedge collection. Check back soon — every product is verified before it reaches your door.</p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 mt-8 pt-7 border-t border-luxe-silver">
              <div className="flex items-center gap-2 text-[12px] text-luxe-gray"><Truck01 strokeWidth={1.5} size={14} className="text-luxe-gold" /> {shipCopy}</div>
              <div className="flex items-center gap-2 text-[12px] text-luxe-gray"><RefreshCcw01 strokeWidth={1.5} size={14} className="text-luxe-gold" /> Returns &amp; support</div>
              <div className="flex items-center gap-2 text-[12px] text-luxe-gray"><ShieldTick strokeWidth={1.5} size={14} className="text-luxe-gold" /> Thoughtfully curated</div>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* New Arrivals — real newArrival flag, admin-set */}
          {newArrivals.length > 0 && (
            <section className="section-compact bg-luxe-cream">
              <div className="max-w-7xl mx-auto px-4">
                <Reveal><SectionHeader eyebrow="Just In" title="New Arrivals" to="/shop" /></Reveal>
                <Reveal delay={60}>
                  <div className={productGridClass(Math.min(newArrivals.length, 10))}>
                    {newArrivals.slice(0, 10).map(p => <PCard key={p.id} product={p} />)}
                  </div>
                </Reveal>
              </div>
            </section>
          )}

          {/* Trending — real catalog merchandising flags only; no fake sales/rankings */}
          {trendingProducts.length > 0 && (
            <section className="section-compact bg-white">
              <div className="max-w-7xl mx-auto px-4">
                <Reveal><SectionHeader eyebrow="Worth a closer look" title="Trending Now" to="/shop" /></Reveal>
                <Reveal delay={60}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
                    {trendingProducts.map(p => <PCard key={`trending-${p.id}`} product={p} />)}
                  </div>
                </Reveal>
              </div>
            </section>
          )}

          {/* CJ listings — only active catalog products with explicit CJ source evidence */}
          {cjProducts.length > 0 && (
            <section className="section-compact bg-luxe-cream">
              <div className="max-w-7xl mx-auto px-4">
                <Reveal><SectionHeader eyebrow="Supplier-verified collection" title="CJ Pet Picks" to="/shop" /></Reveal>
                <Reveal delay={60}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
                    {cjProducts.slice(0, 10).map(p => <PCard key={`cj-${p.id}`} product={p} />)}
                  </div>
                </Reveal>
              </div>
            </section>
          )}

          {/* Top Picks — real featured flag (admin merchandising decision) */}
          {topPicks.length > 0 && (
            <section className="section-compact bg-white">
              <div className="max-w-7xl mx-auto px-4">
                <Reveal><SectionHeader eyebrow="Curated" title="Top Picks" to="/shop" /></Reveal>
                <Reveal delay={60}>
                  <div className={productGridClass(Math.min(topPicks.length, 10))}>
                    {topPicks.slice(0, 10).map(p => <PCard key={p.id} product={p} />)}
                  </div>
                </Reveal>
              </div>
            </section>
          )}

          {/* ════════ Ad: Between Product Sections ════════ */}
          <div className="max-w-7xl mx-auto px-4"><AdSenseAd placement="home_between_sections" /></div>

          {/* Dog Essentials — real category data */}
          {dogEssentials.length > 0 && (
            <section className="section-compact bg-luxe-cream">
              <div className="max-w-7xl mx-auto px-4">
                <Reveal><SectionHeader eyebrow="For Dogs" title="Dog Essentials" to="/category/dog-supplies" /></Reveal>
                <Reveal delay={60}>
                  <div className={productGridClass(Math.min(dogEssentials.length, 10))}>
                    {dogEssentials.slice(0, 10).map(p => <PCard key={p.id} product={p} />)}
                  </div>
                </Reveal>
              </div>
            </section>
          )}

          {/* Cat Essentials — real category data */}
          {catEssentials.length > 0 && (
            <section className="section-compact bg-white">
              <div className="max-w-7xl mx-auto px-4">
                <Reveal><SectionHeader eyebrow="For Cats" title="Cat Essentials" to="/category/cat-supplies" /></Reveal>
                <Reveal delay={60}>
                  <div className={productGridClass(Math.min(catEssentials.length, 10))}>
                    {catEssentials.slice(0, 10).map(p => <PCard key={p.id} product={p} />)}
                  </div>
                </Reveal>
              </div>
            </section>
          )}

          {/* All Products — full catalog browsing */}
          {featured.length > 0 && (
            <section className="section-compact bg-white">
              <div className="max-w-7xl mx-auto px-4">
                <Reveal><SectionHeader eyebrow="Collection" title="Shop All Products" to="/shop" /></Reveal>
                <Reveal delay={60}>
                  <div className={productGridClass(Math.min(homepageVisualProducts.length, 20))}>
                    {homepageVisualProducts.slice(0, 20).map(p => <PCard key={p.id} product={p} />)}
                  </div>
                </Reveal>
              </div>
            </section>
          )}
        </>
      )}

      {/* ════════ EDITORIAL COLLECTION ════════ */}
      {editorialProduct && (
        <section className="section-compact bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Reveal>
              <div className="editorial-story">
                <div className="editorial-story-media">
                  <img src={firstUsableImage(editorialProduct) || LUXEDGE_IMAGE_FALLBACK} alt={editorialProduct.name} loading="lazy" decoding="async" onError={onImageError} />
                </div>
                <div className="editorial-story-copy">
                  <p className="eyebrow mb-3">Designed for everyday life</p>
                  <h2 className="section-title">Pet essentials that belong in your home.</h2>
                  <p className="section-intro mt-4">Functional, thoughtful pieces for the routines you share — selected to feel considered in your space.</p>
                  <Link to="/shop" className="editorial-link mt-5 text-luxe-black">Explore essentials <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" /></Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ════════ ON SALE (only when real compare-at pricing exists) ════════ */}
      {deals.length > 0 && (
        <section className="section-compact bg-luxe-cream">
          <div className="max-w-7xl mx-auto px-4">
            <Reveal><SectionHeader eyebrow="Offers" title="On Sale Now" to="/shop?q=deal" /></Reveal>
            <Reveal delay={60}>
              <div className={productGridClass(Math.min(deals.length, 10))}>
                {deals.slice(0, 10).map(p => <PCard key={p.id} product={p} />)}
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ════════ TRUST PILLS — truthful store information ════════ */}
      <section className="section-compact bg-white" aria-label="Why shop at Luxedge">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="trust-pill-row">
              {[
                { icon: <Truck01 strokeWidth={1.5} size={13} />, text: freeShippingEnabled ? `Free Shipping $${freeShippingThreshold}+` : 'Fast Shipping' },
                { icon: <RefreshCcw01 strokeWidth={1.5} size={13} />, text: '30-Day Easy Returns' },
                { icon: <ShieldTick strokeWidth={1.5} size={13} />, text: 'Thoughtfully Curated' },
                { icon: <Headphones01 strokeWidth={1.5} size={13} />, text: 'Customer Support' },
                { icon: <Lock01 strokeWidth={1.5} size={13} />, text: 'Encrypted Connection' },
              ].map((item, i) => (
                <span key={i} className="trust-pill">
                  {item.icon}
                  {item.text}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ════════ NEWSLETTER — dark bookend ════════ */}
      <section className="relative bg-luxe-black text-luxe-white overflow-hidden">
        <div aria-hidden="true" className="absolute -top-24 right-0 w-[22rem] h-[22rem] rounded-full bg-luxe-gold/10 blur-[100px]" />
        <div className="relative max-w-3xl mx-auto px-4 py-10 sm:py-14 text-center">
          <p className="eyebrow mb-2 text-luxe-gold-light">Stay in the Loop</p>
          <h2 className="text-xl sm:text-2xl font-serif font-bold text-luxe-white tracking-tight mb-2">Join the Luxedge Pet Family</h2>
          <p className="text-luxe-white/65 text-sm mb-6 max-w-md mx-auto">Get new arrivals, pet essentials, and member-only offers delivered to your inbox.</p>
          {nlDone ? (
            <div className="max-w-md mx-auto p-4 rounded-2xl bg-luxe-white/8 border border-luxe-white/15 text-center">
              <p className="text-sm font-semibold text-luxe-white mb-1">You're on the list! 🐾</p>
              <p className="text-xs text-luxe-white/65">{nlSaved
                ? <>We saved <span className="text-luxe-gold-light font-medium">{nlEmail}</span> to your Luxedge account team — you'll hear from us soon.</>
                : <>We recorded <span className="text-luxe-gold-light font-medium">{nlEmail}</span> and will let you know when email updates go live.</>}</p>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); if (!nlEmail.trim()) return; const em = nlEmail.trim(); try { const list = JSON.parse(localStorage.getItem('luxedge_newsletter') || '[]'); list.push({ email: em, at: new Date().toISOString() }); localStorage.setItem('luxedge_newsletter', JSON.stringify(list)); } catch { /* storage unavailable */ } fetch('/api/crm/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, pageUrl: window.location.href }) }).then(r => r.json()).then((d: { ok?: boolean; leadSaved?: boolean }) => { setNlSaved(!!(d && d.ok && d.leadSaved)); }).catch(() => setNlSaved(false)).finally(() => setNlDone(true)); }} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input type="email" required value={nlEmail} onChange={e => setNlEmail(e.target.value)} placeholder="Your email address" aria-label="Email address"
                className="flex-1 px-5 py-3.5 bg-luxe-white/5 border border-luxe-white/20 rounded-full text-sm text-luxe-white placeholder-luxe-white/40 focus:outline-none focus:border-luxe-gold-light focus:ring-4 focus:ring-luxe-gold/15 transition-all" />
              <button type="submit" className="px-8 py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-all hover:-translate-y-0.5 shadow-gold">
                Subscribe
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function ShopPage() {
  const { slug } = useParams<{ slug?: string }>();
  const { products, reviews } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const initialCat = slug ? fromSlug(slug) : 'All';
  const [cat, setCat] = useState(initialCat);
  const [q, setQ] = useState(params.get('q') || '');
  const [sort, setSort] = useState('featured');
  const [maxPrice, setMaxPrice] = useState(() => { const m = params.get('max'); return m ? +m : 0; }); // 0 = no limit
  const [minRating, setMinRating] = useState(0); // 0 = any
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [onlyFreeShipping, setOnlyFreeShipping] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDeals = q.toLowerCase() === 'deal';
  const hasRealDeals = products.some(p => p.isActive && (p.saleEnabled || p.originalPrice > p.price));
  const dealFallbackIds = new Set(
    hasRealDeals ? [] : products
      .filter(p => p.isActive && p.images.length > 0 && (p.featured || p.newArrival))
      .slice(0, 12)
      .map(p => p.id)
  );

  // Sync when URL slug or query changes
  useEffect(() => { setCat(slug ? fromSlug(slug) : 'All'); }, [slug]);
  useEffect(() => { const qp = params.get('q'); if (qp) trackEvent('search', { search_term: qp, ...utmParams() }); setQ(qp || ''); }, [params]);
  useEffect(() => { const m = params.get('max'); if (m !== null) setMaxPrice(+m); }, [params]);

  // Rating filter uses verified review averages only — catalog rating is stub data.
  const verifiedAvgFor = (pid: string): number => {
    const v = reviews.filter(r => r.productId === pid && r.status === 'approved');
    return v.length ? v.reduce((s, r) => s + r.rating, 0) / v.length : 0;
  };

  const f = products.filter(p => p.isActive)
    .filter(p => cat === 'All' || p.category === cat)
    .filter(p => isDeals
      ? (p.saleEnabled || p.originalPrice > p.price || dealFallbackIds.has(p.id))
      : p.name.toLowerCase().includes(q.toLowerCase()))
    .filter(p => maxPrice === 0 || p.price <= maxPrice)
    .filter(p => minRating === 0 || verifiedAvgFor(p.id) >= minRating)
    .filter(p => !onlyInStock || p.stock > 0)
    .filter(p => !onlyFreeShipping || p.freeShipping)
    .filter(p => !onlyNew || p.newArrival)
    .sort((a, b) => {
      if (sort === 'price-low') return a.price - b.price;
      if (sort === 'price-high') return b.price - a.price;
      if (sort === 'newest') return (b.newArrival ? 1 : 0) - (a.newArrival ? 1 : 0);
      if (sort === 'featured') return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
      return 0;
    });

  // GA4: fire view_item_list whenever the visible filtered set changes (max 20 rows).
  useEffect(() => {
    if (f.length === 0) return;
    trackEvent('view_item_list', {
      item_list_id: isDeals ? 'shop-deals' : `shop-${cat.toLowerCase().replace(/\s+/g, '-')}`,
      items: f.slice(0, 20).map(p => ({ item_id: p.id, item_name: p.name, price: p.price })),
      ...utmParams(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, q, sort, maxPrice, minRating, onlyInStock, onlyFreeShipping, onlyNew]);

  const handleCatChange = (newCat: string) => {
    if (newCat === 'All') nav('/shop');
    else nav(`/category/${toSlug(newCat)}`);
  };

  const pageTitle = isDeals ? 'Deals' : (cat === 'All' ? 'Shop All Products' : cat);
  const pageDesc = isDeals
    ? (hasRealDeals ? 'Real catalog offers and sale picks, updated as new deals land.' : 'Featured pet essentials selected from the current collection.')
    : (cat === 'All' ? 'Handpicked for quality, comfort, and value.' : CAT_META[cat]?.desc || `Browse our ${cat} collection`);
  const activeFilters = (cat !== 'All' ? 1 : 0) + (maxPrice > 0 ? 1 : 0) + (minRating > 0 ? 1 : 0) + (onlyInStock ? 1 : 0) + (onlyFreeShipping ? 1 : 0) + (onlyNew ? 1 : 0);

  const clearAll = () => { setCat('All'); setQ(''); setMaxPrice(0); setMinRating(0); setOnlyInStock(false); setOnlyFreeShipping(false); setOnlyNew(false); nav('/shop'); };

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
        <h3 className="text-xs font-bold text-luxe-black uppercase tracking-wider mb-3">Availability</h3>
        <div className="space-y-1">
          {[['in-stock', 'In stock', onlyInStock, setOnlyInStock] as const, ['free-shipping', 'Free shipping', onlyFreeShipping, setOnlyFreeShipping] as const, ['new', 'New arrivals', onlyNew, setOnlyNew] as const].map(([id, label, active, setter]) => (
            <button key={id} onClick={() => setter(!active)}
              className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors ${
                active ? 'bg-luxe-gold-soft text-luxe-gold-dark font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              <span className="flex items-center gap-1"><CheckCircle strokeWidth={1.5} size={12} className={active ? 'text-luxe-gold' : 'text-gray-300'} /> {label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-xs font-bold text-luxe-black uppercase tracking-wider mb-3">Verified rating</h3>
        <div className="space-y-1">
          {[4.5, 4, 0].map(r => (
            <button key={r} onClick={() => setMinRating(r)}
              className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors ${
                minRating === r ? 'bg-luxe-gold-soft text-luxe-gold-dark font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {r === 0 ? 'Any rating' : (
                <span className="flex items-center gap-1"><Star01 strokeWidth={1.5} size={12} className="text-amber-400 fill-amber-400" /> {r}+ &amp; up</span>
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
        <div className="max-w-[1440px] mx-auto px-4 py-10 sm:py-12">
          <p className="eyebrow mb-2">{isDeals ? 'Savings' : (cat === 'All' ? 'Our Collection' : cat)}</p>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black tracking-tight">{pageTitle}</h1>
          <p className="text-luxe-gray text-xs sm:text-sm max-w-xl mt-2">{pageDesc}</p>
        </div>
      </section>

      {/* Toolbar: mobile Filter button + search + sort — sticks below the header */}
      <div className="bg-white/90 backdrop-blur-md border-b border-luxe-silver/70 sticky top-16 lg:top-[7.1rem] z-30 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="max-w-[1440px] mx-auto px-3 py-2.5 flex items-center gap-2">
          <button onClick={() => setDrawerOpen(true)}
            className="lg:hidden shrink-0 flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-2 border border-luxe-silver rounded-lg text-luxe-charcoal hover:border-luxe-gold/60 hover:text-luxe-gold transition-colors">
            <Sliders01 strokeWidth={1.5} size={14} /> Filter{activeFilters > 0 && <span className="w-4 h-4 rounded-full bg-luxe-gold text-white text-[9px] font-bold flex items-center justify-center">{activeFilters}</span>}
          </button>
          <div className="relative flex-1 min-w-0">
            <SearchMd strokeWidth={1.5} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-luxe-gray" />
            <input placeholder="Search products..." value={q} onChange={e => setQ(e.target.value)} aria-label="Search products"
              className="w-full pl-9 pr-3 py-2 border border-luxe-silver rounded-lg text-[13px] focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 bg-luxe-cream/60" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="shrink-0 text-[12px] bg-transparent border-0 focus:outline-none text-luxe-gray font-medium">
            <option value="featured">Featured</option>
            <option value="newest">Newest</option>
            <option value="price-low">Price: Low→High</option>
            <option value="price-high">Price: High→Low</option>
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
                className="p-1.5 rounded-lg text-luxe-gray hover:bg-luxe-cream"><X strokeWidth={1.5} size={16} /></button>
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
      <div className="max-w-[1440px] mx-auto px-3 sm:px-4 py-4 sm:py-6">
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
              /* Phase 4E.1 — genuinely empty catalog (no published DB products):
                 premium curation notice, never fake cards or fake counts. */
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Stars01 strokeWidth={1.5} size={22} className="text-luxe-gold" /></div>
                <p className="font-serif text-lg font-bold text-luxe-black mb-1">New premium pet essentials are being curated</p>
                <p className="text-sm text-luxe-gray mb-5">Every product is verified before it reaches your door. Please check back soon.</p>
                <Link to="/" className="inline-block px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold uppercase tracking-wider rounded-full transition-colors">Back to home</Link>
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><SearchMd strokeWidth={1.5} size={22} className="text-luxe-gold" /></div>
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
  const { cart, cartOpen, closeCart, updateQty, removeFromCart, coupon, applyCoupon, removeCoupon, freeShippingEnabled, freeShippingThreshold, notify } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [codeInput, setCodeInput] = useState('');

  // Close the drawer whenever the route changes (e.g. Proceed to Checkout).
  useEffect(() => { closeCart(); }, [loc.pathname, closeCart]);

  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const sh = freeShippingEnabled && sub >= freeShippingThreshold ? 0 : 4.99;
  const discount = coupon ? (coupon.discountType === 'percent' ? Math.round(sub * (coupon.discountValue / 100) * 100) / 100 : Math.min(sub, coupon.discountValue)) : 0;
  const tot = Math.max(0, sub - discount) + sh;
  const remaining = freeShippingEnabled ? freeShippingThreshold - sub : 0;
  const applyCode = () => {
    const err = applyCoupon(codeInput);
    if (err) notify(err, 'error'); else { notify('Coupon applied'); setCodeInput(''); }
  };

  const checkout = () => {
    closeCart();
    nav('/checkout');
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
              <ShoppingBag01 strokeWidth={1.5} size={20} className="text-luxe-gold" />
              <h2 className="text-lg font-semibold text-luxe-black">Your Cart ({cart.length})</h2>
            </div>
            <button onClick={closeCart} aria-label="Close cart" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <X strokeWidth={1.5} size={18} />
            </button>
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center"><ShoppingBag01 strokeWidth={1.5} size={28} className="text-luxe-gold" /></div>
              <p className="text-luxe-black text-sm font-semibold">Your cart is empty</p>
              <p className="text-luxe-gray text-xs">Add some handpicked essentials to get started.</p>
              <button onClick={() => { closeCart(); nav('/shop'); }} className="btn-glow mt-2 px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold uppercase tracking-wider rounded-full transition-colors">
                Shop Now
              </button>
            </div>
          ) : (
            <>
              {/* Items */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {freeShippingEnabled ? (sub < freeShippingThreshold ? (
                  <div className="rounded-lg bg-luxe-light border border-luxe-silver px-3 py-2.5">
                    <p className="text-[11px] text-gray-600">You're <span className="font-bold text-luxe-gold">${remaining.toFixed(2)}</span> away from free shipping</p>
                    <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-luxe-gold rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (sub / freeShippingThreshold) * 100)}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 flex items-center gap-2">
                    <CheckCircle strokeWidth={1.5} size={14} className="text-green-600 shrink-0" />
                    <p className="text-[11px] font-semibold text-green-700">You've unlocked FREE shipping!</p>
                  </div>
                )) : null}

                {/* Coupon (real active store coupons only) */}
                <div className="rounded-lg border border-luxe-silver px-3 py-2.5">
                  {coupon ? (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-green-700"><CheckCircle strokeWidth={1.5} size={12} className="inline mr-1" />{coupon.code} applied (−${discount.toFixed(2)})</span>
                      <button onClick={removeCoupon} className="text-[11px] text-gray-400 hover:text-red-500">Remove</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="Coupon code" aria-label="Coupon code"
                        className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-luxe-gold"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } }} />
                      <button onClick={applyCode} className="px-3 py-2 bg-luxe-black hover:bg-luxe-gold text-white text-xs font-semibold rounded-lg transition-colors">Apply</button>
                    </div>
                  )}
                </div>

                {cart.map(item => {
                  // Defensive rendering: a cart item may never crash the
                  // drawer. Fall back to the branded placeholder image, safe
                  // text, and a $0 price for any missing field.
                  const img = (Array.isArray(item.product.images) && item.product.images[0]) || LUXEDGE_IMAGE_FALLBACK;
                  const nm = item.product.name || 'Product';
                  const cat = item.product.category || '';
                  const pr = typeof item.product.price === 'number' && Number.isFinite(item.product.price) ? item.product.price : 0;
                  return (
                  <div key={item.product.id} className="flex gap-3 p-3 bg-luxe-cream rounded-xl border border-luxe-silver/50">
                    <img src={img} alt={nm} onError={onImageError} className="w-20 h-20 object-cover rounded-lg shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-luxe-black truncate">{nm}</h4>
                      <p className="text-[11px] text-gray-400 truncate">{cat}</p>
                      <p className="text-sm font-bold text-luxe-gold mt-0.5">${pr.toFixed(2)}</p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200">
                          <button onClick={() => updateQty(item.product.id, item.quantity - 1)} aria-label="Decrease quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Minus strokeWidth={1.5} size={12} /></button>
                          <span className="text-xs font-semibold w-6 text-center">{item.quantity}</span>
                          <button onClick={() => updateQty(item.product.id, item.quantity + 1)} aria-label="Increase quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Plus strokeWidth={1.5} size={12} /></button>
                        </div>
                        <button onClick={() => removeFromCart(item.product.id)} aria-label="Remove item" className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash01 strokeWidth={1.5} size={14} /></button>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-luxe-black shrink-0">${(pr * item.quantity).toFixed(2)}</p>
                  </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="border-t border-gray-100 px-5 py-4 space-y-3">
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-semibold text-luxe-black">${sub.toFixed(2)}</span></div>
                  {discount > 0 && <div className="flex justify-between"><span className="text-gray-500">Coupon ({coupon?.code})</span><span className="font-semibold text-green-600">−${discount.toFixed(2)}</span></div>}
                  <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className={`font-semibold ${sh === 0 ? 'text-green-600' : 'text-luxe-black'}`}>{sh === 0 ? 'FREE' : `$${sh.toFixed(2)}`}</span></div>
                  <div className="flex justify-between pt-2 border-t border-gray-100 text-base"><span className="font-semibold text-luxe-black">Total</span><span className="font-bold text-luxe-black">${tot.toFixed(2)}</span></div>
                </div>
                <button onClick={checkout} className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl transition-colors uppercase text-xs tracking-wider flex items-center justify-center gap-2 shadow-gold">
                  <Lock01 strokeWidth={1.5} size={14} /> Proceed to Checkout
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
  const { cart, updateQty, removeFromCart } = useApp(); const nav = useNavigate();
  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0); const sh = sub >= 50 ? 0 : 4.99; const tot = sub + sh;
  const remaining = 50 - sub;

  if (cart.length === 0) return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><ShoppingBag01 strokeWidth={1.5} size={28} className="text-luxe-gold" /></div>
        <h2 className="font-serif text-2xl font-bold text-luxe-black mb-2">Your cart is empty</h2>
        <p className="text-luxe-gray text-sm mb-6">Discover handpicked essentials your pet will love.</p>
        <Link to="/shop" className="btn-glow inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Shop Now</Link>
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
            {cart.map(i => {
              const img = (Array.isArray(i.product.images) && i.product.images[0]) || LUXEDGE_IMAGE_FALLBACK;
              return (
              <div key={i.product.id} className="flex gap-4 p-5">
                <img src={img} alt={i.product.name || 'Product'} onError={onImageError} className="w-20 h-20 object-cover rounded-xl border border-luxe-silver/60" />
                <div className="flex-1 min-w-0">
                  <Link to={`/product/${i.product.id}`} className="font-semibold text-luxe-black hover:text-luxe-gold-dark transition-colors line-clamp-1">{i.product.name}</Link>
                  <p className="text-luxe-gray text-xs mt-0.5">{i.product.category}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex items-center gap-1 bg-luxe-cream border border-luxe-silver rounded-lg">
                      <button onClick={() => updateQty(i.product.id, i.quantity - 1)} aria-label="Decrease quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Minus strokeWidth={1.5} size={13} /></button>
                      <span className="text-xs font-semibold w-7 text-center">{i.quantity}</span>
                      <button onClick={() => updateQty(i.product.id, i.quantity + 1)} aria-label="Increase quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Plus strokeWidth={1.5} size={13} /></button>
                    </div>
                    <button onClick={() => removeFromCart(i.product.id)} aria-label="Remove item" className="p-1.5 text-luxe-gray hover:text-luxe-red transition-colors"><Trash01 strokeWidth={1.5} size={15} /></button>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-luxe-black">${((i.product.price || 0) * i.quantity).toFixed(2)}</p>
                  <p className="text-xs text-luxe-gray">${(i.product.price || 0).toFixed(2)} each</p>
                </div>
              </div>
              );
            })}
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
            <button onClick={() => nav('/checkout')} className="mt-5 w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl text-sm transition-colors shadow-gold flex items-center justify-center gap-2">
              <Lock01 strokeWidth={1.5} size={14} /> Proceed to Checkout
            </button>
            <Link to="/shop" className="mt-3 block w-full py-2.5 text-center text-xs text-luxe-gray hover:text-luxe-gold transition-colors">Continue Shopping</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckoutPage() {
  const { cart, coupon, applyCoupon, removeCoupon, freeShippingEnabled, freeShippingThreshold, user, notify } = useApp();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const cancelled = searchParams.get('cancelled') === '1';
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState({ email: user?.email || '', firstName: user?.name?.split(' ')[0] || '', lastName: user?.name?.split(' ').slice(1).join(' ') || '', phone: '', address: '', city: '', state: '', zip: '' });

  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const couponDisc = coupon ? (coupon.discountType === 'percent' ? Math.round(sub * (coupon.discountValue / 100) * 100) / 100 : Math.min(sub, coupon.discountValue)) : 0;
  const discountedSub = Math.max(0, sub - couponDisc);
  const shipCost = freeShippingEnabled && discountedSub >= freeShippingThreshold ? 0 : 4.99;
  // NO hard-coded tax. Stripe automatic tax computes the real rate from the
  // collected shipping address at checkout. This is the pre-tax total.
  const totalBeforeTax = +(discountedSub + shipCost).toFixed(2);

  useEffect(() => { if (cart.length === 0) nav('/shop'); }, [cart.length, nav]);
  if (cart.length === 0) return null;

  const validate = () => {
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

  const handleCoupon = () => {
    if (!couponInput.trim()) return;
    const errMsg = applyCoupon(couponInput);
    if (errMsg) notify(errMsg, 'error'); else notify('Coupon applied!');
    setCouponInput('');
  };

  // Payment provider state — a single isolated integration point. Nothing is
  // charged until the owner configures a real provider (Stripe keys). Until
  // then checkout uses a polished disabled state that never fakes an order.
  const paymentsConfigured = !!(import.meta as { env?: Record<string, string> }).env?.VITE_STRIPE_PUBLISHABLE_KEY;

  const handleCheckout = async () => {
    if (!paymentsConfigured) return; // disabled state — never submit a fake order
    if (!validate()) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSubmitting(true);
    setPayError('');
    try {
      trackEvent('begin_checkout', { currency: 'USD', value: totalBeforeTax, items: cart.map(i => ({ item_id: i.product.id, item_name: i.product.name, price: i.product.price, quantity: i.quantity })), ...utmParams() });
      const res = await createCheckoutSession({
        items: cart.map(i => ({ id: i.product.id, quantity: i.quantity })),
        couponCode: coupon?.code || undefined,
        customer: { email: f.email, name: `${f.firstName} ${f.lastName}`.trim(), phone: f.phone, address: f.address, city: f.city, state: f.state, zip: f.zip },
      });
      // Stripe-hosted checkout — the browser is redirected to Stripe. Luxedge
      // never sees or stores card details.
      window.location.assign(res.url);
    } catch (e) {
      setPayError((e as Error).message);
      setSubmitting(false);
    }
  };

  const I = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const ER = (field: string) => errors[field] ? <p className="text-red-500 text-xs mt-1">{errors[field]}</p> : null;
  const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

  return (
    <div className="bg-luxe-cream min-h-screen">
      {cancelled && (
        <div className="max-w-5xl mx-auto px-4 pt-6">
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle strokeWidth={1.5} size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Payment cancelled</p>
              <p className="text-xs text-amber-700">Your cart is still saved. No payment was taken — you can try again whenever you're ready.</p>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto px-4 py-10">
        <p className="eyebrow mb-2">Checkout</p>
        <h1 className="font-serif text-3xl font-bold text-luxe-black mb-8">Complete Your Order</h1>
        <div className="grid lg:grid-cols-5 gap-8">
          {/* ──── LEFT: Contact + Shipping ──── */}
          <div className="lg:col-span-3 space-y-6">
            {payError && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <AlertTriangle strokeWidth={1.5} size={18} className="text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Checkout could not start</p>
                  <p className="text-xs text-red-700">{payError}</p>
                </div>
              </div>
            )}
            <div className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm">
              <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><UserIcon strokeWidth={1.5} size={18} className="text-luxe-gold" /> Contact Information</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className={L}>First Name *</label><input value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} className={I} placeholder="John" />{ER('firstName')}</div>
                <div><label className={L}>Last Name *</label><input value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} className={I} placeholder="Doe" />{ER('lastName')}</div>
                <div><label className={L}>Email *</label><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={I} placeholder="john@example.com" />{ER('email')}</div>
                <div><label className={L}>Phone *</label><input type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={I} placeholder="(555) 123-4567" />{ER('phone')}</div>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm">
              <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><Truck01 strokeWidth={1.5} size={18} className="text-luxe-gold" /> Shipping Address</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2"><label className={L}>Street Address *</label><input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} className={I} placeholder="123 Main Street, Apt 4B" />{ER('address')}</div>
                <div><label className={L}>City *</label><input value={f.city} onChange={e => setF({ ...f, city: e.target.value })} className={I} placeholder="Irving" />{ER('city')}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={L}>State *</label><select value={f.state} onChange={e => setF({ ...f, state: e.target.value })} className={I}><option value="">--</option>{US_STATES.map(s => <option key={s}>{s}</option>)}</select>{ER('state')}</div>
                  <div><label className={L}>ZIP *</label><input value={f.zip} onChange={e => setF({ ...f, zip: e.target.value })} className={I} placeholder="75038" maxLength={10} />{ER('zip')}</div>
                </div>
              </div>
            </div>
          </div>

          {/* ──── RIGHT: Order Summary ──── */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border border-luxe-silver/70 p-6 shadow-sm sticky top-20">
              <h2 className="font-bold text-lg mb-5">Order Summary</h2>
              <div className="space-y-4 mb-6 max-h-64 overflow-y-auto pr-1">
                {cart.map(item => (
                  <div key={item.product.id} className="flex gap-3">
                    <div className="relative shrink-0">
                      <img src={(Array.isArray(item.product.images) && item.product.images[0]) || LUXEDGE_IMAGE_FALLBACK} alt="" onError={onImageError} className="w-16 h-16 object-cover rounded-lg border" />
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
              {/* Coupon — real active store coupons only (e.g. WELCOME10) */}
              <div className="mb-4">
                {coupon ? (
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                    <div>
                      <p className="text-xs font-bold text-green-700">{coupon.code} applied</p>
                      <p className="text-[10px] text-green-600">{coupon.discountType === 'percent' ? `${coupon.discountValue}% off` : `$${coupon.discountValue} off`}</p>
                    </div>
                    <button onClick={removeCoupon} className="text-[11px] text-green-700 underline">Remove</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input value={couponInput} onChange={e => setCouponInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleCoupon())} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Coupon code (e.g. WELCOME10)" />
                    <button onClick={handleCoupon} className="px-4 py-2 bg-luxe-charcoal text-white rounded-lg text-xs font-semibold">Apply</button>
                  </div>
                )}
              </div>
              <div className="border-t pt-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-medium">${sub.toFixed(2)}</span></div>
                {couponDisc > 0 && <div className="flex justify-between"><span className="text-gray-500">Coupon ({coupon?.code})</span><span className="font-medium text-green-600">−${couponDisc.toFixed(2)}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className={`font-medium ${shipCost === 0 ? 'text-green-600' : ''}`}>{shipCost === 0 ? 'FREE' : `$${shipCost.toFixed(2)}`}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Tax</span><span className="font-medium text-gray-400">calculated at checkout</span></div>
                {freeShippingEnabled && shipCost > 0 && <p className="text-xs text-luxe-gold">💡 Add ${(freeShippingThreshold - discountedSub).toFixed(2)} more for free shipping!</p>}
                <div className="flex justify-between pt-3 border-t">
                  <span className="font-bold text-lg">Total before tax</span>
                  <div className="text-right">
                    <span className="font-bold text-xl text-gray-900">${totalBeforeTax.toFixed(2)}</span>
                    <p className="text-[10px] text-gray-400">USD · tax added by Stripe at checkout</p>
                  </div>
                </div>
              </div>
              <button onClick={handleCheckout} disabled={!paymentsConfigured || submitting}
                className="mt-6 w-full py-4 bg-luxe-gold hover:bg-luxe-gold-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-gold text-sm">
                {!paymentsConfigured ? (
                  'Payments Coming Soon'
                ) : submitting ? <Loading01 strokeWidth={1.5} size={16} className="animate-spin" /> : <Lock01 strokeWidth={1.5} size={16} />}
                {!paymentsConfigured ? null : submitting ? 'Starting secure checkout…' : 'Continue to Secure Checkout'}
              </button>
              {!paymentsConfigured && (
                <div className="mt-4 rounded-xl bg-luxe-gold-soft border border-luxe-gold/20 p-4 text-center">
                  <p className="text-[13px] font-semibold text-luxe-black">We're wiring up payments right now.</p>
                  <p className="text-xs text-luxe-gray mt-1">Your cart is saved — nothing has been charged. Check back shortly, or email <a className="underline text-luxe-gold-dark" href="mailto:hello@luxedge.us?subject=Checkout+question">hello@luxedge.us</a>.</p>
                </div>
              )}
              <p className="mt-3 text-center text-[10px] text-gray-400 flex items-center justify-center gap-1"><ShieldTick strokeWidth={1.5} size={12} className="text-luxe-gold" />{paymentsConfigured ? "You'll complete payment securely on Stripe's checkout page — Luxedge never sees your card details." : 'Luxedge never stores card details — payment is handled by a trusted provider.'}</p>
              <div className="mt-4 pt-4 border-t space-y-2.5">
                {[
                  { i: Truck01, t: freeShippingEnabled && shipCost === 0 ? 'Free shipping on this order' : 'Standard shipping 7–14 days' },
                  { i: RefreshCcw01, t: '30-day hassle-free returns' },
                  { i: ShieldTick, t: 'Encrypted connection' },
                ].map((b, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-xs text-gray-500">
                    <b.i strokeWidth={1.5} size={14} className="text-luxe-gold shrink-0" />{b.t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PAYMENT RESULT (real status from Stripe — never a fake success)
// ============================================================================
function CheckoutSuccessPage() {
  const { clearCart, removeCoupon } = useApp();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id') || '';
  const [status, setStatus] = useState<'loading' | 'paid' | 'unpaid' | 'error'>('loading');
  const [info, setInfo] = useState<{ orderNumber: string | null; total: number | null; currency: string | null; email: string | null }>({ orderNumber: null, total: null, currency: null, email: null });

  useEffect(() => {
    if (!sessionId) { setStatus('error'); return; }
    let active = true;
    (async () => {
      try {
        const r = await fetchCheckoutSessionStatus(sessionId);
        if (!active) return;
        setInfo({ orderNumber: r.order?.orderNumber ?? null, total: r.order?.total ?? r.session?.amountTotal ?? null, currency: r.order?.currency ?? r.session?.currency ?? null, email: r.session?.customerEmail ?? null });
        setStatus(r.session?.paymentStatus === 'paid' ? 'paid' : 'unpaid');
        if (r.session?.paymentStatus === 'paid') { clearCart(); removeCoupon(); }
      } catch {
        if (active) setStatus('error');
      }
    })();
    return () => { active = false; };
  }, [sessionId, clearCart, removeCoupon]);

  if (status === 'loading') return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <Loading01 strokeWidth={1.5} size={36} className="text-luxe-gold animate-spin mx-auto mb-4" />
        <p className="text-sm text-luxe-gray">Verifying your payment with Stripe…</p>
      </div>
    </div>
  );

  if (status === 'error' || status === 'unpaid') {
    const unpaid = status === 'unpaid';
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 ${unpaid ? 'bg-amber-100' : 'bg-gray-100'}`}>
            {unpaid ? <Clock strokeWidth={1.5} size={38} className="text-amber-500" /> : <AlertTriangle strokeWidth={1.5} size={38} className="text-gray-400" />}
          </div>
          <h1 className="font-serif text-2xl font-bold text-luxe-black mb-2">{unpaid ? 'Payment not completed' : 'Could not verify payment'}</h1>
          <p className="text-sm text-luxe-gray mb-6">{unpaid ? 'Your payment has not been completed yet. If you were charged, the order will be confirmed shortly.' : 'We could not confirm your payment status right now. Check your email for a receipt.'}</p>
          <div className="flex gap-3 justify-center">
            <Link to="/cart" className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Back to Cart</Link>
            <Link to="/shop" className="px-6 py-3 border border-gray-200 hover:bg-gray-50 font-semibold rounded-full text-sm">Continue Shopping</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle strokeWidth={1.5} size={40} className="text-green-600" /></div>
        <h1 className="font-serif text-2xl font-bold text-luxe-black mb-2">Thank you for your order!</h1>
        {info.orderNumber && <p className="text-gray-600 mb-1">Order <span className="font-mono font-semibold text-gray-800">{info.orderNumber}</span></p>}
        <p className="text-sm text-gray-400 mb-6">{info.email ? `A receipt is on its way to ${info.email}.` : 'Your payment was confirmed by Stripe.'}</p>
        <div className="flex gap-3 justify-center">
          <Link to="/orders" className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">View Orders</Link>
          <Link to="/shop" className="px-6 py-3 border border-gray-200 hover:bg-gray-50 font-semibold rounded-full text-sm">Continue Shopping</Link>
        </div>
      </div>
    </div>
  );
}

interface RealOrderRow { id: string; order_number: string; customer_email: string | null; total: number | null; currency: string | null; status: string; created_at: string; }

function OrdersPage() {
  const { user } = useApp();
  const nav = useNavigate();
  const [realOrders, setRealOrders] = useState<RealOrderRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (!user) nav('/login'); }, [user, nav]);
  // Real orders only: created server-side by the Stripe webhook. Buyers have
  // no customer-orders endpoint yet — the honest state is "No Orders Yet".
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'admin') { setLoaded(true); return; }
    const token = getAccessToken();
    if (!token) { setLoaded(true); return; }
    fetch('/api/checkout?action=orders', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: { orders?: RealOrderRow[] }) => setRealOrders(Array.isArray(d.orders) ? d.orders : []))
      .catch(() => setRealOrders([]))
      .finally(() => setLoaded(true));
  }, [user]);

  const empty = <div className="min-h-[60vh] flex items-center justify-center px-4"><div className="text-center"><div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Package strokeWidth={1.5} size={28} className="text-luxe-gold" /></div><h2 className="font-serif text-2xl font-bold text-luxe-black mb-2">No Orders Yet</h2><p className="text-sm text-luxe-gray mb-6">When you place an order, it will appear here.</p><Link to="/shop" className="inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Shop Now</Link></div></div>;
  if (!user) return null;
  if (user.role !== 'admin') return empty;
  if (!loaded) return <div className="min-h-[60vh] flex items-center justify-center text-sm text-luxe-gray">Loading orders…</div>;
  if (realOrders.length === 0) return empty;
  return (
    <div className="py-12 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-serif font-bold mb-2">Orders</h1>
        <p className="text-sm text-luxe-gray mb-8">Real payment records persisted by the Stripe webhook.</p>
        {realOrders.map(o => (
          <div key={o.id} className="bg-white rounded-xl border p-6 mb-4">
            <div className="flex justify-between mb-4">
              <div><p className="font-semibold">{o.order_number}</p><p className="text-sm text-gray-500">{new Date(o.created_at).toLocaleString()}</p></div>
              <span className="px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-sm capitalize">{o.status.replace('_', ' ')}</span>
            </div>
            <div className="pt-4 mt-4 border-t flex justify-between">
              <span className="font-semibold text-sm text-gray-500">{o.customer_email || '—'}</span>
              <span className="font-semibold">Total <span className="text-lg font-bold text-luxe-gold">${Number(o.total || 0).toFixed(2)}</span></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginPage() {
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, guestLogin, cart } = useApp();
  const nav = useNavigate();

  const sub = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const errMsg = await login(e, p);
    if (errMsg) { setErr(errMsg); setLoading(false); return; }
    // Admin accounts go straight to the admin dashboard; customers go home.
    nav(useAuthStore.getState().isAdmin ? '/admin' : '/');
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
          {!isSupabaseConfigured() && (
            <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs leading-relaxed">
              Account sign-in is not configured yet (Supabase env vars missing). You can still shop as a guest — no account needed.
            </div>
          )}

          <form onSubmit={sub} className="space-y-5">
            <div className="relative">
              <Mail01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={e} onChange={ev => setE(ev.target.value)} placeholder="Email address"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Lock01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPw ? 'text' : 'password'} required value={p} onChange={ev => setP(ev.target.value)} placeholder="Password"
                className="w-full pl-12 pr-12 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-luxe-gold transition-colors">
                {showPw ? <EyeOff strokeWidth={1.5} size={18} /> : <Eye strokeWidth={1.5} size={18} />}
              </button>
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer text-gray-600">
                <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-luxe-gold" defaultChecked />
                Remember me
              </label>
              <Link to="/contact" className="text-luxe-gold hover:text-luxe-gold-dark transition-colors">Need help signing in?</Link>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-gold">
              {loading ? <Loading01 strokeWidth={1.5} size={18} className="animate-spin" /> : <>{'Sign In'}<ArrowRight strokeWidth={1.5} size={16} /></>}
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
            <UserIcon strokeWidth={1.5} size={16} className="text-luxe-gold" />
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
            <ShoppingBag01 strokeWidth={1.5} size={15} className="text-luxe-gold" />
            Go to store
          </Link>
        </div>

        {/* Trust line */}
        <div className="mt-8 flex items-center justify-center gap-6 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><ShieldTick strokeWidth={1.5} size={13} className="text-luxe-gold" /> Secure checkout</span>
          <span className="flex items-center gap-1.5"><Truck01 strokeWidth={1.5} size={13} className="text-luxe-gold" /> Free shipping $50+</span>
          <span className="flex items-center gap-1.5"><RefreshCcw01 strokeWidth={1.5} size={13} className="text-luxe-gold" /> 30-day returns</span>
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
    setLoading(true);
    const errMsg = await signup(n, e, p);
    if (errMsg) { setErr(errMsg); setLoading(false); return; }
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
          {!isSupabaseConfigured() && (
            <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs leading-relaxed">
              Account creation is not configured yet (Supabase env vars missing). You can still shop as a guest — no account needed.
            </div>
          )}

          <form onSubmit={sub} className="space-y-5">
            <div className="relative">
              <UserIcon strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" required value={n} onChange={ev => setN(ev.target.value)} placeholder="Full Name"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Mail01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={e} onChange={ev => setE(ev.target.value)} placeholder="Email address"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Lock01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPw ? 'text' : 'password'} required value={p} onChange={ev => setP(ev.target.value)} placeholder="Password (6+ characters)" minLength={6}
                className="w-full pl-12 pr-12 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-luxe-gold transition-colors">
                {showPw ? <EyeOff strokeWidth={1.5} size={18} /> : <Eye strokeWidth={1.5} size={18} />}
              </button>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-gold">
              {loading ? <Loading01 strokeWidth={1.5} size={18} className="animate-spin" /> : <>{'Create Account'}<ArrowRight strokeWidth={1.5} size={16} /></>}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            Have an account?{' '}
            <Link to="/login" className="text-luxe-gold font-semibold hover:text-luxe-gold-dark transition-colors">Sign In</Link>
          </p>

          {/* Go to store — browse without an account */}
          <Link to="/shop"
            className="mt-4 w-full py-2.5 rounded-xl border border-luxe-silver bg-white hover:bg-luxe-cream hover:border-luxe-gold/50 text-gray-600 hover:text-luxe-gold text-sm font-medium transition-all flex items-center justify-center gap-2">
            <ShoppingBag01 strokeWidth={1.5} size={15} className="text-luxe-gold" />
            Go to store
          </Link>
        </div>

        {/* Trust line */}
        <div className="mt-8 flex items-center justify-center gap-6 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><ShieldTick strokeWidth={1.5} size={13} className="text-luxe-gold" /> Secure checkout</span>
          <span className="flex items-center gap-1.5"><Truck01 strokeWidth={1.5} size={13} className="text-luxe-gold" /> Free shipping $50+</span>
          <span className="flex items-center gap-1.5"><RefreshCcw01 strokeWidth={1.5} size={13} className="text-luxe-gold" /> 30-day returns</span>
        </div>
      </div>
    </div>
  );
}

function AdminLoginPage() {
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useApp();
  const nav = useNavigate();

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr('');
    if (!isSupabaseConfigured()) { setErr('Admin authentication is not configured yet (Supabase).'); return; }
    setLoading(true);
    const errMsg = await login(e, p, true);
    setLoading(false);
    if (errMsg) { setErr(errMsg); return; }
    nav('/admin');
  };

  return (
    <div className="min-h-screen bg-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
        <div className="flex items-center justify-center gap-2 mb-2">
          <ShieldTick strokeWidth={1.5} className="text-luxe-gold" size={28} />
          <span className="text-xl font-bold">Admin Login</span>
        </div>
        <p className="text-center text-sm text-gray-500 mb-6">Secure access to admin dashboard</p>

        {!isSupabaseConfigured() && (
          <div className="p-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs leading-relaxed">
            Admin authentication is not configured yet — add <code className="font-mono">VITE_SUPABASE_URL</code> + <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> and promote your admin user (<code className="font-mono">app_metadata.role = 'admin'</code>). No demo credentials exist.
          </div>
        )}

        {err && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            <AlertTriangle strokeWidth={1.5} size={16} />{err}
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
          <button type="submit" disabled={loading} className="w-full py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-gold disabled:opacity-70">
            {loading ? <Loading01 strokeWidth={1.5} size={16} className="animate-spin" /> : <Lock01 strokeWidth={1.5} size={16} />} {loading ? 'Signing in…' : 'Access Dashboard'}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-2 text-xs text-gray-400 justify-center">
          <ShieldTick strokeWidth={1.5} size={12} /> Protected admin area
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
      <p className="text-gray-600 leading-relaxed">We decided to build something different. Based in Irving, Texas, Luxedge is a curated ecommerce destination where every product is handpicked by our team before it ever reaches our shelves. We carefully compare and curate hundreds of items to list only the ones we'd genuinely recommend to friends and family.</p>
      <h2 className="text-xl font-bold text-gray-900 pt-4">Our Mission</h2>
      <p className="text-gray-600 leading-relaxed">To make premium-quality products accessible to everyone — without the premium markup. We believe great design and solid craftsmanship shouldn't cost a fortune. Every item on Luxedge represents the best value we could find at its price point.</p>
      <h2 className="text-xl font-bold text-gray-900 pt-4">Customer-First, Always</h2>
      <p className="text-gray-600 leading-relaxed">We stand behind everything we sell. That means free shipping on orders over $50, a 30-day hassle-free return policy, and a support team that actually responds. If something isn't right with your order, we make it right — no runaround, no fine print.</p>
      <p className="text-gray-600 leading-relaxed">Whether you're setting up a cozy corner for your cat, outfitting your dog for adventure, or simply spoiling your furry friend with something well-made, Luxedge is here to help you shop smarter and keep your pet happier.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-10 pt-8 border-t">
        {[{v:'$50+',l:'Free Shipping'},{v:'30-Day',l:'Returns & Replacements'},{v:'1-3 days',l:'Order Processing'},{v:'Mon–Fri',l:'Support 9AM–6PM CT'}].map((s,i)=>
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
      <LS t="Shipping Methods & Times"><div className="mt-3 overflow-x-auto"><table className="w-full text-sm border-collapse"><thead><tr className="bg-gray-50"><th className="text-left px-4 py-2 border">Method</th><th className="text-left px-4 py-2 border">Estimated Delivery</th><th className="text-left px-4 py-2 border">Cost</th></tr></thead><tbody><tr><td className="px-4 py-2 border">Standard Shipping</td><td className="px-4 py-2 border">5–14 business days (varies by product)</td><td className="px-4 py-2 border">$4.99 (FREE on orders $50+)</td></tr></tbody></table><p className="mt-2 text-sm text-gray-500">Each product page shows its specific estimated delivery window. Express shipping is not currently offered.</p></div></LS>
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
      { q: 'How long does shipping take?', a: 'Standard delivery is estimated at 5–14 business days depending on the product (each product page shows its specific window). Processing takes an additional 1–3 business days before shipment. Express shipping is not currently offered.' },
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
      { q: 'What payment methods do you accept?', a: 'We are connecting a trusted payment provider (Stripe) and will accept all major cards as soon as it is live. Nothing is charged until then — your cart stays saved and secure.' },
      { q: 'Is my payment information secure?', a: 'Yes. Luxedge never sees or stores card details — payment is handled entirely by our PCI-compliant provider (Stripe) once checkout goes live.' },
      { q: 'Can I cancel an order?', a: 'Orders can be canceled within 2 hours of placement. After that, the order enters processing and cannot be canceled. Contact us at hello@luxedge.us as soon as possible if you need to cancel.' },
    ]},
    { c: 'Products & Quality', qs: [
      { q: 'How do you select your products?', a: 'Every product on Luxedge goes through a rigorous curation process. We evaluate quality, design, value, and customer reviews before listing any item. Only products that meet our standards make it to our store.' },
      { q: 'Are your products authentic?', a: 'We aim to source products from verified manufacturers and authorized distributors. Every item is carefully selected and reviewed before it\'s listed on our store.' },
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
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><ChevronRight strokeWidth={1.5} size={16} className="text-luxe-gold" />{section.c}</h2>
            <div className="space-y-2">
              {section.qs.map(faq => {
                const key = faq.q;
                const isOpen = open === key;
                return (
                  <div key={key} className="bg-white rounded-xl border overflow-hidden">
                    <button onClick={() => setOpen(isOpen ? null : key)} className="w-full flex items-center justify-between px-5 py-4 text-left">
                      <span className="text-sm font-medium text-gray-900 pr-4">{faq.q}</span>
                      <ChevronDown strokeWidth={1.5} size={16} className={`text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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
          <Link to="/contact" className="px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg text-sm inline-flex items-center gap-2 transition-colors"><Mail01 strokeWidth={1.5} size={16} />Contact Support</Link>
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
            { i: Mail01, l: 'Email', v: 'hello@luxedge.us', s: 'We reply within 24hrs' },
            { i: Phone, l: 'Phone', v: '(440) 941-8002', s: 'Mon-Fri, 9AM-6PM CT' },
            { i: MarkerPin01, l: 'Address', v: 'Irving, TX 75038', s: 'United States' },
            { i: Clock, l: 'Hours', v: 'Mon - Fri', s: '9:00 AM - 6:00 PM CT' },
          ].map((x, i) => (
            <div key={i} className="text-center p-5 bg-gray-50 rounded-xl border border-gray-100">
              <x.i strokeWidth={1.5} className="mx-auto mb-2 text-luxe-gold" size={22} />
              <p className="text-[10px] text-luxe-gold font-semibold uppercase tracking-wider">{x.l}</p>
              <p className="font-semibold text-sm mt-1">{x.v}</p>
              <p className="text-xs text-gray-500">{x.s}</p>
            </div>
          ))}
        </div>

        <div className="max-w-2xl mx-auto">
          {ok ? (
            <div className="text-center py-16 bg-green-50 rounded-2xl border border-green-200">
              <CheckCircle strokeWidth={1.5} className="mx-auto text-green-500 mb-4" size={48} />
              <h2 className="text-xl font-bold mb-2">Message Received!</h2>
              <p className="text-sm text-gray-500">Thank you for reaching out. We'll get back to you within 24 hours.</p>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); setOk(true); notify('Message sent!'); }} className="bg-white rounded-2xl border p-6 sm:p-8 space-y-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Send01 strokeWidth={1.5} size={18} className="text-luxe-gold" /> Send Us a Message</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Name *</label><input required placeholder="Your full name" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email *</label><input required type="email" placeholder="you@example.com" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold" /></div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Subject *</label>
                <select required className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold"><option value="">Select a topic</option><option>Order Question</option><option>Shipping & Tracking</option><option>Returns & Refunds</option><option>Product Inquiry</option><option>Technical Support</option><option>Other</option></select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Message *</label><textarea required placeholder="Tell us how we can help..." rows={5} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold resize-none" /></div>
              <button type="submit" className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm transition-colors shadow-gold"><Send01 strokeWidth={1.5} size={16} />Send Message</button>
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
              { icon: Star01, title: 'Growth-Focused', desc: 'We invest in our people. Learn, grow, and level up with us.' },
              { icon: Send01, title: 'Collaborative', desc: 'Small team, big impact. Every voice matters here.' },
              { icon: Globe01, title: 'Remote-Friendly', desc: 'Work from anywhere. We care about results, not locations.' },
              { icon: Zap, title: 'Innovation-Driven', desc: 'We encourage new ideas and creative problem-solving.' },
            ].map((v, i) => (
              <div key={i} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <span className="w-9 h-9 rounded-lg bg-luxe-gold-soft ring-1 ring-luxe-gold/15 text-luxe-gold flex items-center justify-center"><v.icon strokeWidth={1.5} size={16} /></span>
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
            <Mail01 strokeWidth={1.5} size={16} /> Get in Touch
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
                <PencilLine strokeWidth={1.5} size={16} /> Write a Post
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
                      <div className="flex items-center gap-1.5 text-xs text-gray-400"><Calendar strokeWidth={1.5} size={12} />{new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <span className="text-gray-200">·</span>
                      <span className="text-xs text-gray-400">{post.authorName}</span>
                    </div>
                    <h2 className="font-bold text-gray-900 mb-2 group-hover:text-luxe-gold transition-colors leading-tight">{post.title}</h2>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-4">{post.excerpt}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1.5">{post.tags.slice(0, 3).map(t => <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-medium">#{t}</span>)}</div>
                      <span className="text-luxe-gold text-sm font-semibold group-hover:underline flex items-center gap-1">Read More <ArrowRight strokeWidth={1.5} size={14} /></span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-xl border">
              <BookOpen01 strokeWidth={1.5} size={48} className="mx-auto text-gray-200 mb-4" />
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

  // SEO: canonical + meta description + BlogPosting & BreadcrumbList JSON-LD
  useEffect(() => {
    if (!post) return;
    const setMeta = (n: string, c: string) => {
      let el = document.head.querySelector(`meta[name="${n}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', n); document.head.appendChild(el); }
      el.setAttribute('content', c);
    };
    setMeta('description', (post.excerpt || post.content.slice(0, 155)));
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.setAttribute('rel', 'canonical'); document.head.appendChild(canonical); }
    canonical.setAttribute('href', `https://luxedge.us/blog/${post.slug}`);
    const jsonLd = [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://luxedge.us/' },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://luxedge.us/blog' },
          { '@type': 'ListItem', position: 3, name: post.title, item: `https://luxedge.us/blog/${post.slug}` },
        ],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.excerpt || post.content.slice(0, 155),
        image: post.image || undefined,
        datePublished: post.date,
        dateModified: post.date,
        author: { '@type': 'Person', name: post.authorName || 'Luxedge' },
        publisher: { '@type': 'Organization', name: 'Luxedge', url: 'https://luxedge.us' },
        mainEntityOfPage: `https://luxedge.us/blog/${post.slug}`,
        keywords: post.tags.join(', '),
      },
    ];
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'blog-jsonld';
    script.text = JSON.stringify(jsonLd);
    document.getElementById('blog-jsonld')?.remove();
    document.head.appendChild(script);
    return () => { document.getElementById('blog-jsonld')?.remove(); };
  }, [post?.id, post?.slug]);

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
            <Link to="/" className="hover:text-luxe-gold">Home</Link><ChevronRight strokeWidth={1.5} size={12} />
            <Link to="/blog" className="hover:text-luxe-gold">Blog</Link><ChevronRight strokeWidth={1.5} size={12} />
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
              <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar strokeWidth={1.5} size={11} />{new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
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
          <Link to="/blog" className="text-luxe-gold font-semibold text-sm hover:underline flex items-center justify-center gap-2"><ArrowLeft strokeWidth={1.5} size={16} /> Back to All Posts</Link>
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
        <Link to="/blog" className="text-sm text-gray-500 hover:text-luxe-gold flex items-center gap-1 mb-6"><ArrowLeft strokeWidth={1.5} size={14} />Back to Blog</Link>
        <h1 className="text-2xl font-bold mb-8 flex items-center gap-2"><PencilLine strokeWidth={1.5} size={22} className="text-luxe-gold" />Write a Blog Post</h1>

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
                <Upload01 strokeWidth={1.5} size={28} className="text-gray-400 mb-2" />
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
            {images.length < 5 && <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-luxe-gold text-sm text-gray-500 hover:text-luxe-gold w-fit"><Upload01 strokeWidth={1.5} size={16} />Add images<input type="file" accept="image/*" multiple onChange={handleImages} className="hidden" /></label>}
          </div>

          {/* Tags */}
          <div className="bg-white rounded-2xl border p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Tags</label>
            <div className="flex flex-wrap gap-2 mb-3">{tags.map(t => <span key={t} className="flex items-center gap-1 px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-sm"><Tag01 strokeWidth={1.5} size={12} />{t}<button type="button" onClick={() => setTags(prev => prev.filter(x => x !== t))} className="text-luxe-gold hover:text-red-500 ml-1">×</button></span>)}</div>
            <div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className={I} placeholder="Add tag & press Enter" /><button type="button" onClick={addTag} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium shrink-0">Add</button></div>
          </div>

          {user?.role !== 'admin' && <div className="p-4 bg-luxe-gold-soft border border-luxe-gold/30 rounded-xl text-sm text-luxe-gold-dark flex items-center gap-2"><Eye strokeWidth={1.5} size={16} />Your post will be reviewed by admin before publishing.</div>}

          <div className="flex gap-3">
            <button type="submit" className="flex-1 py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2"><Send01 strokeWidth={1.5} size={16} />{user?.role === 'admin' ? 'Publish Now' : 'Submit for Review'}</button>
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
        <Loading01 strokeWidth={1.5} size={28} className="animate-spin text-luxe-gold" />
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
      <BrowserRouter>
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
          <Route path="/checkout/success" element={<SLayout><CheckoutSuccessPage /></SLayout>} />
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
      </BrowserRouter>
    </AppProvider>
  );
}
