import { useState, useEffect, ReactNode, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import MarketingManager from './components/MarketingManager';
import AdSenseAd from './components/AdSenseAd';
import CookieConsent from './components/CookieConsent';
import { trackEvent, utmParams } from './lib/marketing';
import { useAuthStore } from './store/authStore';
import { isSupabaseConfigured, updatePassword, updateUserMetadata, getAccessToken } from './services/supabase';
import { loadStorefrontCatalog, loadStorefrontPromotions, type CatalogProduct, type CatalogCategory, type StoreCoupon } from './services/catalog';
import { parseStoredCart, reconcileCart, CART_STORAGE_KEY } from './services/cartSafety';
import { createCheckoutSession, fetchCheckoutSessionStatus } from './services/checkout';
import {
  ShoppingBag01, X, SearchMd, User01 as UserIcon,
  ShieldTick, Star01, Truck01, RefreshCcw01, ArrowRight, Mail01, Phone,
  MarkerPin01, Plus, Minus, Trash01, Lock01, Loading01, CheckCircle,
  AlertTriangle, Eye,
  ChevronRight, ArrowLeft, Upload01,
  Clock, Send01, Headphones01, Stars01,
  PencilLine, Calendar, Tag01, BookOpen01, EyeOff,
  Sliders01, Package, Globe01, Zap,
} from '@untitledui/icons';

// ── Storefront presentation layer ──────────────────────────────────────────
// Extracted from this file so each piece can be designed on its own; the
// shared contract lives in components/storefront/context so nothing here
// creates an import cycle.
import Header from './components/storefront/Header';
import Footer from './components/storefront/Footer';
import Hero from './components/storefront/Hero';
import ProductCard, { ProductRail } from './components/storefront/ProductCard';
import { AnimalPanels, CollectionGrid, SectionHead } from './components/storefront/Discovery';
import { Reveal, Stagger, staggerStyle, useEscape, useScrollLock } from './components/storefront/motion';
import {
  AppCtx, useApp, LUXEDGE_IMAGE_FALLBACK, onImageError, firstUsableImage, toSlug, money,
  verifiedRating,
  type Product, type ProductVariant, type CartItem, type AppUser, type Order,
  type Review, type AdminCategory, type BlogPost, type Ctx,
} from './components/storefront/context';
import {
  NAV_COLLECTIONS, PRIMARY_ANIMAL_COLLECTIONS, NEED_COLLECTIONS, resolveCollection,
  collectionForCategoryName, filterByCollection, countIn, matchesCollection,
  primaryCollectionFor, isLegacyCollection,
  type Collection,
} from './features/catalog/taxonomy';

// Re-exported so existing consumers (the admin bundle imports these from
// '../App') keep working unchanged.
export { useApp, toSlug };
export type { Product, ProductVariant, Order, Review, AdminCategory, BlogPost, AppUser, Ctx };


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
  serverProviderStatus, fetchPageContent, buildExtractionPrompt,
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
    images: p.images.length ? p.images : [],
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
  return { id: c.id, name: c.name, isActive: c.isActive, subs: [] };
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
];

/**
 * Legacy DB category names. This is a STORAGE vocabulary and it stays exactly
 * as it is — the admin category editor writes these values and existing rows
 * depend on them. How the storefront *merchandises* the catalog now lives in
 * features/catalog/taxonomy.ts instead.
 */
export const CAT_LIST = ['All', 'Dog Supplies', 'Cat Supplies', 'Pet Beds', 'Pet Toys', 'Feeding & Water', 'Grooming', 'Pet Accessories'];

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
  const notify = (m: string, _type?: 'success' | 'error' | 'info') => { setNotif(m); setTimeout(() => setNotif(null), 3000); };
  const [cartOpen, setCartOpen] = useState(false);
  const openCart = useCallback(() => setCartOpen(true), []);
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
  const removeFromCart = (id: string) => setCart(p => p.filter(i => i.product.id !== id));
  const updateQty = (id: string, q: number) => { if (q <= 0) removeFromCart(id); else setCart(p => p.map(i => i.product.id === id ? { ...i, quantity: q } : i)); };
  const clearCart = () => setCart([]);
  // NOTE: real orders are created server-side by the Stripe webhook into
  // luxedge_orders (Admin → Orders). No client-side fake order path exists.
  const freeShippingEnabled = promotions.freeShippingEnabled;
  const freeShippingThreshold = promotions.freeShippingThreshold;

  return <AppCtx.Provider value={{ user, cart, products, users, reviews, categories, blogs, setBlogs, login, guestLogin, logout, signup, changePassword, updateAdminProfile, addToCart, removeFromCart, updateQty, clearCart, setProducts, setUsers, setReviews, setCategories, cartOpen, openCart, closeCart, notif, notify, coupon, applyCoupon, removeCoupon, freeShippingEnabled, freeShippingThreshold }}>{children}</AppCtx.Provider>;
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================
function Toast() {
  const { notif } = useApp();
  if (!notif) return null;
  return (
    <div role="status" aria-live="polite" className="toast">
      <CheckCircle strokeWidth={1.5} size={16} className="text-luxe-gold-light shrink-0" aria-hidden="true" />
      {notif}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEscape(open, onClose);
  useScrollLock(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-luxe-black/45 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-[0_44px_90px_-40px_rgba(23,21,18,0.4)] animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-luxe-silver">
          <h2 className="font-serif text-xl">{title}</h2>
          <button onClick={onClose} className="icon-btn -mr-2" aria-label="Close"><X strokeWidth={1.5} size={19} aria-hidden="true" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ============================================================================
// SHARED STOREFRONT PIECES
// ============================================================================

/**
 * Curated homepage rows are small (often 2-4 admin-flagged products), so a
 * fixed 5-column grid leaves the page looking broken. Cap the track count to
 * the real item count and keep the row left-aligned.
 */
function ProductGrid({ products, priority = false }: { products: Product[]; priority?: boolean }) {
  const count = products.length;
  const cols =
    count <= 1 ? 'grid-cols-1 max-w-[16rem]' :
    count === 2 ? 'grid-cols-2 max-w-[34rem]' :
    count === 3 ? 'grid-cols-2 sm:grid-cols-3 max-w-[52rem]' :
    'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  return (
    <Stagger className={`grid ${cols} gap-x-4 gap-y-9 sm:gap-x-6 sm:gap-y-12`} step={60}>
      {products.map((p, i) => (
        <div key={p.id} style={staggerStyle(i)}>
          <ProductCard product={p} priority={priority && i < 4} />
        </div>
      ))}
    </Stagger>
  );
}

// Per-route document title + meta description + canonical for SEO
function RouteTitle() {
  const { pathname } = useLocation();
  const { products } = useApp();
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
    if (segs.length === 0) { full("Luxedge — Premium Pet Essentials | Horse, Cattle & Everyday Animal Care"); desc("Premium pet essentials from Luxedge — horse and cattle gear, feeding, stable, comfort, grooming and travel, verified before it is listed."); }
    else if (segs[0] === "shop") { set("Shop All Products"); desc("Browse the full Luxedge collection — feeding, stable, comfort, grooming, travel and play."); }
    else if (segs[0] === "category") {
      const slug = decodeURIComponent(segs[1] || "");
      const c = resolveCollection(slug);
      set(c ? `Shop ${c.label}` : "Shop");
      desc(c ? c.blurb : "Browse the Luxedge collection.");
    }
    else if (segs[0] === "product") {
      // Real catalog product (never the demo ALL_PRODUCTS fixture).
      const p = products.find((x) => x.id === decodeURIComponent(segs[1] || ""));
      set(p ? (p.seoTitle || p.name) : "Product");
      if (p) desc(p.seoDescription || p.shortDesc || p.description.slice(0, 155));
    }
    else if (segs[0] === "cart") { set("Shopping Cart"); desc("Review your Luxedge cart before checkout."); }
    else if (segs[0] === "checkout") { set("Checkout"); desc("Complete your Luxedge order."); }
    else if (segs[0] === "orders") { set("My Orders"); desc("Track your Luxedge orders."); }
    else if (segs[0] === "about") { set("About Us"); desc("Luxedge curates premium, honest essentials for horses, cattle, dogs and cats."); }
    else if (segs[0] === "contact") { set("Contact Us"); desc("Reach the Luxedge customer support team — Mon–Fri, 9AM–6PM CT."); }
    else if (segs[0] === "privacy") { set("Privacy Policy"); desc("Luxedge privacy policy — how we handle your data, cookies and advertising."); }
    else if (segs[0] === "terms") { set("Terms of Service"); desc("Luxedge terms of service."); }
    else if (segs[0] === "returns") { set("Return Policy"); desc("Luxedge 30-day easy return policy."); }
    else if (segs[0] === "shipping-policy") { set("Shipping Policy"); desc("How and when Luxedge orders ship."); }
    else if (segs[0] === "faq") { set("Frequently Asked Questions"); desc("Answers to common questions about shopping at Luxedge."); }
    else if (segs[0] === "careers") { set("Careers"); desc("Join the Luxedge team."); }
    else if (segs[0] === "blog") { set(segs[1] ? (segs[1] === "write" ? "Write a Post" : "Journal") : "The Luxedge Journal"); desc("Field notes on animal care from the Luxedge team."); }
    else if (segs[0] === "login") { set("Sign In"); desc("Sign in to your Luxedge account."); }
    else if (segs[0] === "signup") { set("Create Account"); desc("Create your Luxedge account."); }
    else if (segs[0] === "admin") { set("Admin Dashboard"); }
    else set("Luxedge");
  }, [pathname, products]); // products re-run so PDP titles resolve once the catalog loads
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
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-5 focus:py-3 focus:bg-luxe-black focus:text-white focus:rounded-full focus:text-sm"
      >
        Skip to content
      </a>
      <ScrollToTop />
      <Header />
      {/* Keyed on the path so each route gets a short entrance crossfade
          rather than snapping in. Cheap: one opacity animation, no layout. */}
      <main id="main-content" key={pathname} className="flex-1 route-enter">{children}</main>
      <Footer />
      <CartDrawer />
      <CookieConsent />
    </div>
  );
}

// ============================================================================
// PRODUCT DETAIL PAGE
// ============================================================================

/** Collapsible content section — replaces the old tab strip. Accordions read
 *  better on mobile (no horizontal tab scroll) and let a customer open two
 *  sections at once rather than losing the description to read the specs. */
function Accordion({ title, children, defaultOpen = false, plain = false }: { title: string; children: ReactNode; defaultOpen?: boolean; plain?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `acc-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="accordion-item">
      <button
        type="button"
        className={`accordion-trigger${plain ? ' accordion-trigger-plain' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        <Plus strokeWidth={1.5} size={16} aria-hidden="true" />
      </button>
      <div className="accordion-panel" data-open={open || undefined} id={id} role="region">
        <div><div className="pb-6 text-[15px] leading-relaxed text-luxe-gray">{children}</div></div>
      </div>
    </div>
  );
}

function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { products, addToCart, user, reviews: allReviews, setReviews, notify } = useApp();
  const nav = useNavigate();
  const product = products.find(p => p.id === id);

  // ALL hooks MUST run before any early return.
  const [qty, setQty] = useState(1);
  const [selImg, setSelImg] = useState(0);
  const [selVariant, setSelVariant] = useState<ProductVariant | null>(null);
  const [revForm, setRevForm] = useState({ rating: 5, comment: '' });
  const [showRevForm, setShowRevForm] = useState(false);
  const [selColor, setSelColor] = useState('');
  const [selSize, setSelSize] = useState('');
  const [ctaVisible, setCtaVisible] = useState(true);
  const [justAdded, setJustAdded] = useState(false);
  const ctaRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync the mobile swipe gallery indicator to the scrolled image index.
  const onGalleryScroll = useCallback(() => {
    const el = galleryRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    setSelImg(Math.max(0, Math.min(idx, (product?.images.length || 1) - 1)));
  }, [product?.images.length]);

  // The sticky mobile buy bar only appears once the inline CTA scrolls away.
  useEffect(() => {
    const el = ctaRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCtaVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [product?.id]);

  useEffect(() => () => { if (addedTimer.current) clearTimeout(addedTimer.current); }, []);

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
    // Only verified, user-submitted reviews go into schema — never a stub.
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

  // Reset per-product view state.
  useEffect(() => {
    window.scrollTo(0, 0);
    setSelImg(0); setSelVariant(null); setQty(1);
    if (product) {
      trackEvent('view_item', { currency: 'USD', value: product.price, items: [{ item_id: product.id, item_name: product.name, price: product.price }], ...utmParams() });
    }
  }, [id, product?.id]);

  useEffect(() => {
    if (product && product.variants.length > 0) {
      const colors = [...new Set(product.variants.map(v => v.color).filter(Boolean))];
      const sizes = [...new Set(product.variants.map(v => v.size).filter(Boolean))];
      setSelColor(colors[0] || '');
      setSelSize(sizes[0] || '');
    }
  }, [product?.id]);

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

  if (!product) {
    return (
      <div className="shell empty-state min-h-[60vh] justify-center">
        <span className="empty-mark"><SearchMd strokeWidth={1.5} size={22} aria-hidden="true" /></span>
        <h1 className="section-title mx-auto">This product is no longer listed.</h1>
        <p className="section-intro mx-auto mt-3">It may have sold through or been withdrawn during a sourcing review.</p>
        <Link to="/shop" className="btn btn-primary mt-7">Back to the collection</Link>
      </div>
    );
  }

  const reviews = allReviews.filter(r => r.productId === product.id && r.status === 'approved');
  const activePrice = selVariant ? selVariant.salePrice : product.price;
  const activeOriginal = selVariant ? selVariant.price : product.originalPrice;
  const activeStock = selVariant ? selVariant.stock : product.stock;
  const discount = activeOriginal > activePrice ? Math.round((1 - activePrice / activeOriginal) * 100) : 0;
  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const uniqueColors = [...new Set(product.variants.map(v => v.color).filter(Boolean))];
  const uniqueSizes = [...new Set(product.variants.map(v => v.size).filter(Boolean))];
  const soldOut = product.usInventory === true && activeStock === 0;
  const images = product.images.length ? product.images : [LUXEDGE_IMAGE_FALLBACK];

  const SWATCH_HEX: Record<string, string> = {
    Black: '#171512', White: '#FFFFFF', Blue: '#3E5F79', Red: '#B3402C', Silver: '#B8B2A8',
    Brown: '#6B4A2F', Green: '#4A5F42', Gold: '#A75B2E', Pink: '#C98B8B', Tan: '#C6A57F', Grey: '#8A857C', Gray: '#8A857C',
  };

  const handleAddToCart = () => {
    if (soldOut) return;
    for (let i = 0; i < qty; i++) addToCart(product);
    setJustAdded(true);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setJustAdded(false), 1800);
  };

  const handleBuyNow = () => {
    if (soldOut) return;
    for (let i = 0; i < qty; i++) addToCart(product);
    nav('/checkout');
  };

  const submitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { nav('/login'); return; }
    setReviews(prev => [{ id: `r${Date.now()}`, productId: product.id, productName: product.name, userName: user.name, rating: revForm.rating, comment: revForm.comment, status: 'pending', date: new Date().toISOString() }, ...prev]);
    notify('Review submitted — it appears once approved.');
    setRevForm({ rating: 5, comment: '' });
    setShowRevForm(false);
  };

  // Prefer a navigable collection so a breadcrumb never points the customer at
  // a collection the navigation hides; falls back to a legacy one only when
  // nothing else matches, so legacy Dog/Cat products still get a real crumb.
  const collection = primaryCollectionFor(product);
  const relatedPool = products.filter(p => p.isActive && p.id !== product.id);
  const related = (collection ? relatedPool.filter(p => matchesCollection(p, collection)) : [])
    .concat(relatedPool)
    .filter((p, i, all) => all.findIndex(x => x.id === p.id) === i)
    .slice(0, 4);

  const specs: [string, string][] = ([
    ['Brand', product.brand], ['Category', product.category], ['Condition', product.condition],
    ['Weight', product.weight], ['Dimensions', product.dimensions], ['Origin', product.origin],
    ['Shipping', product.freeShipping ? 'Free' : product.shippingCost ? `$${product.shippingCost}` : ''],
  ] as [string, string][]).filter(([, v]) => Boolean(v));

  return (
    <div>
      <div className="shell pt-6 pb-16 sm:pb-24">
        <nav className="crumbs mb-8" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <ChevronRight strokeWidth={1.5} size={11} aria-hidden="true" />
          <Link to="/shop">Shop</Link>
          {collection && <>
            <ChevronRight strokeWidth={1.5} size={11} aria-hidden="true" />
            <Link to={`/category/${collection.slug}`}>{collection.label}</Link>
          </>}
          <ChevronRight strokeWidth={1.5} size={11} aria-hidden="true" />
          <span className="text-luxe-black truncate max-w-[16rem] normal-case tracking-normal font-sans">{product.name}</span>
        </nav>

        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-16">
          {/* ── Gallery ─────────────────────────────────────────────── */}
          <div className="lg:sticky lg:self-start" style={{ top: 'calc(var(--header-h) + 1.5rem)' }}>
            {/* Mobile: swipe gallery with dot indicator */}
            <div
              ref={galleryRef}
              onScroll={onGalleryScroll}
              aria-label={`${product.name} — image gallery`}
              className="flex lg:hidden overflow-x-auto snap-x snap-mandatory scrollbar-hide rounded-[10px] bg-luxe-cream"
            >
              {images.map((img, i) => (
                <div key={i} className="w-full shrink-0 snap-center aspect-square">
                  <img
                    src={img}
                    alt={product.imageAlts?.[i] || `${product.name} — image ${i + 1}`}
                    loading={i === 0 ? 'eager' : 'lazy'}
                    fetchPriority={i === 0 ? 'high' : 'auto'}
                    decoding="async"
                    onError={onImageError}
                    className="w-full h-full object-contain p-[6%]"
                  />
                </div>
              ))}
            </div>
            {images.length > 1 && (
              <div className="flex lg:hidden justify-center gap-1.5 mt-4">
                {images.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { const el = galleryRef.current; if (el) el.scrollTo({ left: el.clientWidth * i, behavior: 'smooth' }); }}
                    aria-label={`Go to image ${i + 1}`}
                    aria-current={selImg === i}
                    className={`h-[3px] rounded-full transition-all duration-300 ${selImg === i ? 'w-7 bg-luxe-black' : 'w-3 bg-luxe-silver'}`}
                  />
                ))}
              </div>
            )}

            {/* Desktop: main plate + thumbnail rail */}
            <div className="hidden lg:grid grid-cols-[4.5rem_1fr] gap-4">
              <div className="flex flex-col gap-2.5">
                {images.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelImg(i)}
                    className="pdp-thumb"
                    data-active={selImg === i || undefined}
                    aria-label={`View image ${i + 1}`}
                    aria-current={selImg === i}
                  >
                    <img src={img} alt="" aria-hidden="true" onError={onImageError} loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
              <div className="pdp-gallery-main" data-zoom="true">
                <img
                  key={selImg}
                  src={images[selImg] || images[0]}
                  alt={product.imageAlts?.[selImg] || product.name}
                  fetchPriority="high"
                  decoding="async"
                  onError={onImageError}
                />
                {discount > 0 && <span className="pcard-badge pcard-badge-sale absolute top-4 left-4">Save {discount}%</span>}
              </div>
            </div>
          </div>

          {/* ── Purchase panel ──────────────────────────────────────── */}
          <div>
            <p className="eyebrow mb-4">{product.brand || 'Luxedge'}</p>
            <h1 className="pdp-title">{product.name}</h1>

            {reviews.length > 0 ? (
              <button type="button" className="flex items-center gap-2 mt-4 text-[13px] text-luxe-gray hover:text-luxe-black transition-colors">
                <span className="flex gap-0.5" aria-hidden="true">
                  {[...Array(5)].map((_, i) => (
                    <Star01 key={i} strokeWidth={1.5} size={13} fill={i < Math.round(avgRating) ? 'currentColor' : 'none'} className={i < Math.round(avgRating) ? 'text-star' : 'text-luxe-silver'} />
                  ))}
                </span>
                <span className="num">{avgRating.toFixed(1)}</span>
                <span className="underline underline-offset-2">{reviews.length} verified review{reviews.length === 1 ? '' : 's'}</span>
              </button>
            ) : (
              <p className="mt-4 text-[13px] text-luxe-gray">No verified reviews yet.</p>
            )}

            <div className="flex flex-wrap items-baseline gap-3 mt-6">
              <span className="pdp-price">{money(activePrice)}</span>
              {discount > 0 && <>
                <span className="text-luxe-gray line-through num text-sm">{money(activeOriginal)}</span>
                <span className="pcard-badge pcard-badge-sale">Save {money(activeOriginal - activePrice)}</span>
              </>}
            </div>

            {product.shortDesc && <p className="mt-5 text-[15px] leading-relaxed text-luxe-gray max-w-prose">{product.shortDesc}</p>}

            {/* Availability — never invented scarcity. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-5 text-[13px]">
              {product.usInventory && activeStock > 10 && <span className="text-luxe-success flex items-center gap-1.5"><CheckCircle strokeWidth={1.5} size={14} aria-hidden="true" />In stock</span>}
              {product.usInventory && activeStock > 0 && activeStock <= 10 && <span className="text-luxe-gold flex items-center gap-1.5"><AlertTriangle strokeWidth={1.5} size={14} aria-hidden="true" />Only {activeStock} left</span>}
              {soldOut && <span className="text-luxe-red flex items-center gap-1.5"><X strokeWidth={1.5} size={14} aria-hidden="true" />Sold out</span>}
              {!product.usInventory && activeStock > 0 && <span className="text-luxe-gray flex items-center gap-1.5"><CheckCircle strokeWidth={1.5} size={14} aria-hidden="true" />Availability confirmed at checkout</span>}
            </div>

            {uniqueColors.length > 0 && (
              <div className="mt-8">
                <p className="field-label">Colour — <span className="normal-case tracking-normal text-luxe-black">{selColor}</span></p>
                <div className="flex flex-wrap gap-2.5">
                  {uniqueColors.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelColor(c)}
                      className="swatch"
                      data-active={selColor === c || undefined}
                      style={{ backgroundColor: SWATCH_HEX[c] || '#C6BFB2' }}
                      aria-label={`Colour ${c}`}
                      aria-pressed={selColor === c}
                    />
                  ))}
                </div>
              </div>
            )}

            {uniqueSizes.length > 0 && uniqueSizes[0] !== 'One Size' && (
              <div className="mt-7">
                <p className="field-label">Size — <span className="normal-case tracking-normal text-luxe-black">{selSize}</span></p>
                <div className="flex flex-wrap gap-2">
                  {uniqueSizes.map(s => (
                    <button key={s} type="button" onClick={() => setSelSize(s)} className="size-chip" data-active={selSize === s || undefined} aria-pressed={selSize === s}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={ctaRef} className="flex flex-wrap items-stretch gap-3 mt-8">
              <div className="qty">
                <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1} aria-label="Decrease quantity">
                  <Minus strokeWidth={1.5} size={14} aria-hidden="true" />
                </button>
                <span className="num" aria-live="polite">{qty}</span>
                <button type="button" onClick={() => setQty(qty + 1)} aria-label="Increase quantity">
                  <Plus strokeWidth={1.5} size={14} aria-hidden="true" />
                </button>
              </div>
              <button type="button" onClick={handleAddToCart} disabled={soldOut} className="btn btn-primary flex-1 min-w-[12rem]">
                {justAdded
                  ? <><CheckCircle strokeWidth={1.5} size={15} aria-hidden="true" /> Added to cart</>
                  : <><ShoppingBag01 strokeWidth={1.5} size={15} aria-hidden="true" /> {soldOut ? 'Sold out' : 'Add to cart'}</>}
              </button>
              <button type="button" onClick={handleBuyNow} disabled={soldOut} className="btn btn-outline flex-1 min-w-[10rem]">
                Buy it now
              </button>
            </div>

            <div className="trust-row mt-7">
              {[
                { icon: Truck01, t: product.freeShipping ? 'Free shipping on this item' : 'Shipping at checkout' },
                { icon: RefreshCcw01, t: '30-day returns' },
                { icon: ShieldTick, t: 'Verified before listing' },
                { icon: Lock01, t: 'Secure Stripe checkout' },
              ].map((b, i) => (
                <div key={i} className="trust-cell">
                  <b.icon strokeWidth={1.5} size={15} aria-hidden="true" />
                  <span>{b.t}</span>
                </div>
              ))}
            </div>

            {/* ── Content accordions ────────────────────────────────── */}
            <div className="mt-10">
              <Accordion title="Description" defaultOpen>
                <p className="whitespace-pre-line">{product.description || product.shortDesc || 'Full details are being written up.'}</p>
                {product.tags.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-5 pt-5 border-t border-luxe-silver">
                    {product.tags.map(t => (
                      <Link key={t} to={`/shop?q=${encodeURIComponent(t)}`} className="text-[12px] text-luxe-gold hover:text-luxe-gold-dark transition-colors">#{t}</Link>
                    ))}
                  </div>
                )}
              </Accordion>

              {specs.length > 0 && (
                <Accordion title="Specifications">
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-4">
                    {specs.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="py-2 border-b border-luxe-silver/70 text-luxe-black font-medium text-[13px]">{k}</dt>
                        <dd className="py-2 border-b border-luxe-silver/70 text-[13px]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Accordion>
              )}

              <Accordion title="Shipping & returns">
                <p>Orders are processed in 1–3 business days and ship within the United States. Returns and replacements are accepted within 30 days of the order date — see the <Link to="/returns" className="text-luxe-gold underline underline-offset-2">return policy</Link> for the full terms.</p>
              </Accordion>

              <Accordion title={`Reviews (${reviews.length})`}>
                {reviews.length > 0 && (
                  <div className="flex items-center gap-3 mb-5">
                    <span className="font-serif text-3xl text-luxe-black num">{avgRating.toFixed(1)}</span>
                    <span className="flex gap-0.5" aria-hidden="true">
                      {[...Array(5)].map((_, i) => (
                        <Star01 key={i} strokeWidth={1.5} size={15} fill={i < Math.round(avgRating) ? 'currentColor' : 'none'} className={i < Math.round(avgRating) ? 'text-star' : 'text-luxe-silver'} />
                      ))}
                    </span>
                    <span className="text-[13px]">{reviews.length} verified review{reviews.length === 1 ? '' : 's'}</span>
                  </div>
                )}

                {user ? (
                  <button type="button" onClick={() => setShowRevForm(!showRevForm)} className="link-arrow text-luxe-gold mb-5">
                    {showRevForm ? 'Cancel' : 'Write a review'}
                  </button>
                ) : (
                  <p className="text-[13px] mb-5"><Link to="/login" className="text-luxe-gold underline underline-offset-2">Sign in</Link> to write a review.</p>
                )}

                {showRevForm && (
                  <form onSubmit={submitReview} className="p-5 mb-6 rounded-[10px] bg-luxe-cream space-y-4">
                    <div className="flex gap-1" role="group" aria-label="Rating">
                      {[1, 2, 3, 4, 5].map(s => (
                        <button key={s} type="button" onClick={() => setRevForm({ ...revForm, rating: s })} aria-label={`${s} star${s === 1 ? '' : 's'}`} aria-pressed={s === revForm.rating}>
                          <Star01 strokeWidth={1.5} size={20} fill={s <= revForm.rating ? 'currentColor' : 'none'} className={s <= revForm.rating ? 'text-star' : 'text-luxe-silver'} />
                        </button>
                      ))}
                    </div>
                    <textarea
                      required
                      rows={3}
                      value={revForm.comment}
                      onChange={e => setRevForm({ ...revForm, comment: e.target.value })}
                      className="field resize-none"
                      placeholder="How did it hold up?"
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Submit review</button>
                  </form>
                )}

                <div className="space-y-5">
                  {reviews.length > 0 ? reviews.map(r => (
                    <div key={r.id} className="pb-5 border-b border-luxe-silver/70 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2.5 mb-2">
                        <span className="text-[13px] font-semibold text-luxe-black">{r.userName}</span>
                        <span className="flex gap-0.5" aria-hidden="true">
                          {[...Array(5)].map((_, i) => (
                            <Star01 key={i} strokeWidth={1.5} size={11} fill={i < r.rating ? 'currentColor' : 'none'} className={i < r.rating ? 'text-star' : 'text-luxe-silver'} />
                          ))}
                        </span>
                        <span className="text-[11px] text-luxe-gray">{new Date(r.date).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[14px]">{r.comment}</p>
                    </div>
                  )) : <p className="text-[13px]">No reviews yet — be the first once you've put it to work.</p>}
                </div>
              </Accordion>
            </div>

            <AdSenseAd placement="product_below_info" />
          </div>
        </div>
      </div>

      {/* ── Related ──────────────────────────────────────────────────── */}
      {related.length > 0 && (
        <section className="section-tight bg-luxe-cream">
          <div className="shell">
            <SectionHead
              eyebrow="Also consider"
              title={collection ? `More from ${collection.label}` : 'More from the collection'}
              to={collection ? `/category/${collection.slug}` : '/shop'}
            />
            <ProductGrid products={related} />
          </div>
        </section>
      )}

      {/* ── Sticky mobile buy bar ────────────────────────────────────── */}
      <div className="buybar lg:hidden luxe-safe-bottom" data-show={!ctaVisible || undefined} aria-hidden={ctaVisible} inert={ctaVisible}>
        <div className="shell flex items-center gap-3 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-luxe-black num leading-tight">{money(activePrice)}</p>
            {discount > 0 && <p className="text-[11px] text-luxe-gray line-through num">{money(activeOriginal)}</p>}
          </div>
          <button type="button" onClick={handleAddToCart} disabled={soldOut} className="btn btn-primary flex-1">
            <ShoppingBag01 strokeWidth={1.5} size={15} aria-hidden="true" />
            {soldOut ? 'Sold out' : 'Add to cart'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STORE PAGES
// ============================================================================

/**
 * Homepage.
 *
 * Sequence: pinned hero → shop by animal (Horse and Cattle first) → need-based
 * collection spread → curated product rails → editorial block → value strip →
 * newsletter. Every product row is real catalog data; a collection with no
 * stock keeps its navigation slot but never borrows another row's products.
 */
function HomePage() {
  const { products, freeShippingEnabled, freeShippingThreshold } = useApp();
  const [nlEmail, setNlEmail] = useState('');
  const [nlDone, setNlDone] = useState(false);

  const live = useMemo(() => products.filter((p) => p.isActive), [products]);

  // Editorial slots are art-directed: supplier packshots that are collage-heavy
  // or badly cropped stay browsable in Shop but are not promoted into the hero
  // or the story block.
  const presentable = useMemo(
    () => live.filter((p) => !/(collar|leash|shoes|apparel|shirt|flying disc)/i.test(p.name) && firstUsableImage(p)),
    [live]
  );

  const topPicks = useMemo(() => live.filter((p) => p.featured), [live]);
  const newArrivals = useMemo(() => live.filter((p) => p.newArrival), [live]);
  const deals = useMemo(
    () => live
      .filter((p) => p.originalPrice > p.price)
      .sort((a, b) => (1 - b.price / b.originalPrice) - (1 - a.price / a.originalPrice)),
    [live]
  );

  const heroProduct = topPicks.find(firstUsableImage) || presentable[0] || live.find(firstUsableImage);
  const storyProduct = presentable.find((p) => p.id !== heroProduct?.id) || heroProduct;

  // Rails are only built for NAVIGABLE collections that actually have stock, so
  // the homepage never renders an empty row to fill space — and never
  // merchandises a legacy collection the navigation deliberately hides.
  const collectionRails = useMemo(() => {
    return NAV_COLLECTIONS
      .map((c) => ({ collection: c, items: live.filter((p) => matchesCollection(p, c)) }))
      .filter((row) => row.items.length >= 2)
      .sort((a, b) => b.items.length - a.items.length)
      .slice(0, 2);
  }, [live]);

  const shipNote = freeShippingEnabled ? `Free shipping over ${money(freeShippingThreshold)}` : 'Shipping calculated at checkout';

  return (
    <div className="bg-white">
      <Hero featured={heroProduct} shippingNote={shipNote} />

      <div className="shell"><AdSenseAd placement="home_after_hero" /></div>

      {/* ── Shop by animal — the primary discovery module ────────────── */}
      <section className="section">
        <div className="shell">
          <SectionHead
            eyebrow="Shop by animal"
            title="Horse and cattle, first."
            intro="Gear that has to survive a stall, a paddock and a winter — held to the same sourcing bar as everything else we list."
            to="/shop"
            linkLabel="All products"
          />
          <Reveal variant="fade">
            <AnimalPanels products={live} />
          </Reveal>
        </div>
      </section>

      {/* ── Collections ──────────────────────────────────────────────── */}
      <section className="section bg-luxe-cream">
        <div className="shell">
          <SectionHead
            eyebrow="Collections"
            title="Sorted by the job, not the species."
            intro="Feed, rest, groom, travel and turn out — start with what you need to solve."
          />
          <CollectionGrid products={live} />
        </div>
      </section>

      <div className="shell"><AdSenseAd placement="home_after_categories" /></div>

      {/* ── Products ─────────────────────────────────────────────────── */}
      {live.length === 0 ? (
        <section className="section bg-white">
          <div className="shell max-w-2xl mx-auto empty-state">
            <span className="empty-mark"><Stars01 strokeWidth={1.5} size={22} aria-hidden="true" /></span>
            <h2 className="section-title mx-auto">The first collection is being sourced.</h2>
            <p className="section-intro mx-auto mt-4">
              Every product is verified — supplier, cost basis and delivery path — before it
              reaches this page. Nothing is listed to fill a shelf.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mt-10 pt-8 border-t border-luxe-silver w-full">
              <span className="flex items-center gap-2 text-[13px] text-luxe-gray"><Truck01 strokeWidth={1.5} size={15} className="text-luxe-gold" aria-hidden="true" /> {shipNote}</span>
              <span className="flex items-center gap-2 text-[13px] text-luxe-gray"><RefreshCcw01 strokeWidth={1.5} size={15} className="text-luxe-gold" aria-hidden="true" /> 30-day returns</span>
              <span className="flex items-center gap-2 text-[13px] text-luxe-gray"><ShieldTick strokeWidth={1.5} size={15} className="text-luxe-gold" aria-hidden="true" /> Verified before listing</span>
            </div>
          </div>
        </section>
      ) : (
        <>
          {newArrivals.length > 0 && (
            <section className="section-tight bg-white">
              <div className="shell">
                <SectionHead eyebrow="Just in" title="New arrivals" to="/shop?sort=newest" />
                <ProductRail products={newArrivals.slice(0, 12)} label="New arrivals" />
              </div>
            </section>
          )}

          {topPicks.length > 0 && (
            <section className="section-tight bg-white">
              <div className="shell">
                <SectionHead eyebrow="Curated" title="This season's picks" to="/shop" />
                <ProductGrid products={topPicks.slice(0, 8)} />
              </div>
            </section>
          )}

          <div className="shell"><AdSenseAd placement="home_between_sections" /></div>

          {collectionRails.map((row) => (
            <section key={row.collection.slug} className="section-tight bg-white">
              <div className="shell">
                <SectionHead
                  eyebrow={row.collection.kind === 'animal' ? 'For the herd' : 'Collection'}
                  title={row.collection.label}
                  intro={row.collection.blurb}
                  to={`/category/${row.collection.slug}`}
                />
                <ProductRail products={row.items.slice(0, 12)} label={row.collection.label} />
              </div>
            </section>
          ))}
        </>
      )}

      {/* ── Editorial block ──────────────────────────────────────────── */}
      {storyProduct && (
        <section className="section bg-luxe-cream">
          <div className="shell">
            <Reveal variant="fade">
              <div className="story">
                <div className="story-media">
                  <img
                    src={firstUsableImage(storyProduct) || LUXEDGE_IMAGE_FALLBACK}
                    alt={storyProduct.name}
                    loading="lazy"
                    decoding="async"
                    onError={onImageError}
                    className="object-contain p-[8%]"
                  />
                </div>
                <div className="story-copy">
                  <p className="eyebrow mb-4">Our standard</p>
                  <h2 className="section-title">Listed only when we can stand behind it.</h2>
                  <p className="section-intro mt-5">
                    A product reaches this store after its supplier, cost basis and delivery
                    path are all verified. If we cannot prove how it gets to your door, it
                    does not get listed — however good the margin looks.
                  </p>
                  <div className="flex flex-wrap gap-3 mt-8">
                    <Link to="/shop" className="btn btn-primary">
                      Shop the collection <ArrowRight strokeWidth={1.5} size={14} aria-hidden="true" />
                    </Link>
                    <Link to="/about" className="btn btn-outline">Our story</Link>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {deals.length > 0 && (
        <section className="section-tight bg-white">
          <div className="shell">
            <SectionHead eyebrow="Offers" title="On sale now" to="/shop?q=deal" />
            <ProductRail products={deals.slice(0, 12)} label="On sale" />
          </div>
        </section>
      )}

      {/* ── Value strip ──────────────────────────────────────────────── */}
      <section className="value-strip" aria-label="Store information">
        <div className="shell grid sm:grid-cols-4">
          {[
            { icon: Truck01, title: freeShippingEnabled ? `Free ship ${money(freeShippingThreshold)}+` : 'Fair shipping', desc: freeShippingEnabled ? 'On qualifying orders' : 'Calculated at checkout' },
            { icon: RefreshCcw01, title: '30-day returns', desc: 'Returns & replacements' },
            { icon: ShieldTick, title: 'Verified sourcing', desc: 'Checked before listing' },
            { icon: Headphones01, title: 'Real support', desc: 'Answered by people' },
          ].map((item) => (
            <div key={item.title} className="value-item">
              <item.icon strokeWidth={1.5} size={16} className="value-item-icon" aria-hidden="true" />
              <div>
                <p className="value-item-title">{item.title}</p>
                <p className="value-item-copy">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Newsletter ───────────────────────────────────────────────── */}
      <section className="relative bg-luxe-black text-white overflow-hidden grain">
        <div className="shell py-16 sm:py-24 text-center relative">
          <Reveal>
            <p className="eyebrow eyebrow-plain text-luxe-gold-light mb-4">Letters from the barn</p>
            <h2 className="display text-white text-[clamp(1.9rem,4.4vw,3.25rem)] max-w-[18ch] mx-auto">
              Field notes, new arrivals, nothing else.
            </h2>
            <p className="text-white/55 text-sm mt-5 max-w-md mx-auto">
              A short letter when something genuinely new lands. Unsubscribe in one click.
            </p>
          </Reveal>

          {nlDone ? (
            <p className="flex items-center justify-center gap-2 mt-9 text-luxe-gold-light text-sm">
              <CheckCircle strokeWidth={1.5} size={16} aria-hidden="true" />
              You're on the list — we saved {nlEmail}.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!nlEmail.trim()) return;
                try {
                  const list = JSON.parse(localStorage.getItem('luxedge_newsletter') || '[]');
                  list.push({ email: nlEmail.trim(), at: new Date().toISOString() });
                  localStorage.setItem('luxedge_newsletter', JSON.stringify(list));
                } catch { /* storage unavailable */ }
                setNlDone(true);
              }}
              className="mt-9 max-w-md mx-auto footer-newsletter"
            >
              <input
                type="email"
                required
                value={nlEmail}
                onChange={(e) => setNlEmail(e.target.value)}
                placeholder="Email address"
                aria-label="Email address"
              />
              <button type="submit" aria-label="Subscribe">
                <ArrowRight strokeWidth={1.5} size={18} aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Shop / collection page.
 *
 * Filtering runs through the taxonomy rather than exact category equality, so
 * `/category/horse` and `/category/stable-farm` work against the same catalog
 * rows that `/category/dog-supplies` always did — every previously indexed URL
 * still resolves, and the new merchandising vocabulary sits on top.
 */
function ShopPage() {
  const { slug } = useParams<{ slug?: string }>();
  const { products, reviews, categories } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const [q, setQ] = useState(params.get('q') || '');
  const [sort, setSort] = useState(params.get('sort') || 'featured');
  const [maxPrice, setMaxPrice] = useState(() => { const m = params.get('max'); return m ? +m : 0; });
  const [minRating, setMinRating] = useState(0);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [onlyFreeShipping, setOnlyFreeShipping] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isDeals = q.toLowerCase() === 'deal';

  // A slug may be a taxonomy collection, a legacy alias, or an admin-created
  // DB category that predates the taxonomy — all three resolve to something.
  const collection: Collection | null = useMemo(() => {
    if (!slug) return null;
    const known = resolveCollection(slug);
    if (known) return known;
    const dbCategory = categories.find((c) => toSlug(c.name) === slug);
    return dbCategory ? collectionForCategoryName(dbCategory.name) : null;
  }, [slug, categories]);

  useEffect(() => { const qp = params.get('q'); if (qp) trackEvent('search', { search_term: qp, ...utmParams() }); setQ(qp || ''); }, [params]);
  useEffect(() => { const m = params.get('max'); if (m !== null) setMaxPrice(+m); }, [params]);

  useScrollLock(drawerOpen);
  useEscape(drawerOpen, () => setDrawerOpen(false));

  const live = useMemo(() => products.filter((p) => p.isActive), [products]);
  const inCollection = useMemo(() => filterByCollection(live, collection), [live, collection]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return inCollection
      .filter((p) => (isDeals
        ? p.originalPrice > p.price
        : !term || p.name.toLowerCase().includes(term) || p.tags.some((t) => t.toLowerCase().includes(term))))
      .filter((p) => maxPrice === 0 || p.price <= maxPrice)
      .filter((p) => minRating === 0 || verifiedRating(reviews, p.id).average >= minRating)
      .filter((p) => !onlyInStock || p.stock > 0)
      .filter((p) => !onlyFreeShipping || p.freeShipping)
      .filter((p) => !onlyNew || p.newArrival)
      .sort((a, b) => {
        if (sort === 'price-low') return a.price - b.price;
        if (sort === 'price-high') return b.price - a.price;
        if (sort === 'newest') return (b.newArrival ? 1 : 0) - (a.newArrival ? 1 : 0);
        if (sort === 'featured') return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
        return 0;
      });
  }, [inCollection, q, isDeals, maxPrice, minRating, onlyInStock, onlyFreeShipping, onlyNew, sort, reviews]);

  const activeFilters =
    (collection ? 1 : 0) + (maxPrice > 0 ? 1 : 0) + (minRating > 0 ? 1 : 0) +
    (onlyInStock ? 1 : 0) + (onlyFreeShipping ? 1 : 0) + (onlyNew ? 1 : 0);

  const clearAll = () => {
    setQ(''); setMaxPrice(0); setMinRating(0);
    setOnlyInStock(false); setOnlyFreeShipping(false); setOnlyNew(false);
    nav('/shop');
  };

  const heading = isDeals ? 'On sale' : (collection ? collection.label : 'The collection');
  const lede = isDeals
    ? 'Products with a real compare-at price, updated as new offers land.'
    : (collection ? collection.blurb : 'Everything Luxedge currently carries, across every animal and every job.');

  const Filters = () => (
    <>
      <div className="filter-group">
        <p className="filter-title">Shop by animal</p>
        {PRIMARY_ANIMAL_COLLECTIONS.map((c) => (
          <button
            key={c.slug}
            type="button"
            className="filter-option"
            data-active={collection?.slug === c.slug || undefined}
            onClick={() => nav(`/category/${c.slug}`)}
          >
            <span>{c.label}</span>
            <span className="filter-count">{countIn(live, c)}</span>
          </button>
        ))}
      </div>

      <div className="filter-group">
        <p className="filter-title">Collections</p>
        <button type="button" className="filter-option" data-active={!collection || undefined} onClick={() => nav('/shop')}>
          <span>All products</span>
          <span className="filter-count">{live.length}</span>
        </button>
        {NEED_COLLECTIONS.map((c) => (
          <button
            key={c.slug}
            type="button"
            className="filter-option"
            data-active={collection?.slug === c.slug || undefined}
            onClick={() => nav(`/category/${c.slug}`)}
          >
            <span>{c.label}</span>
            <span className="filter-count">{countIn(live, c)}</span>
          </button>
        ))}
      </div>

      <div className="filter-group">
        <p className="filter-title">Price</p>
        {[[0, 'Any price'], [25, 'Under $25'], [50, 'Under $50'], [100, 'Under $100'], [200, 'Under $200']].map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            className="filter-option"
            data-active={maxPrice === v || undefined}
            onClick={() => setMaxPrice(v as number)}
          >
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="filter-group">
        <p className="filter-title">Availability</p>
        {([
          ['in-stock', 'In stock', onlyInStock, setOnlyInStock],
          ['free-shipping', 'Free shipping', onlyFreeShipping, setOnlyFreeShipping],
          ['new', 'New arrivals', onlyNew, setOnlyNew],
        ] as const).map(([id, label, active, setter]) => (
          <button key={id} type="button" className="filter-option" data-active={active || undefined} onClick={() => setter(!active)} aria-pressed={active}>
            <span>{label}</span>
            {active && <CheckCircle strokeWidth={1.5} size={13} className="text-luxe-gold" aria-hidden="true" />}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <p className="filter-title">Verified rating</p>
        {[0, 4, 4.5].map((r) => (
          <button key={r} type="button" className="filter-option" data-active={minRating === r || undefined} onClick={() => setMinRating(r)}>
            <span className="flex items-center gap-1.5">
              {r === 0 ? 'Any rating' : <>
                <Star01 strokeWidth={1.5} size={12} fill="currentColor" className="text-star" aria-hidden="true" /> {r}+ and up
              </>}
            </span>
          </button>
        ))}
      </div>

      {activeFilters > 0 && (
        <button type="button" onClick={clearAll} className="link-arrow mt-7 text-luxe-gold">
          Clear all ({activeFilters})
        </button>
      )}
    </>
  );

  return (
    <div>
      {/* ── Page head ────────────────────────────────────────────────── */}
      <section className="page-head">
        <div className="shell py-12 sm:py-16">
          <nav className="crumbs mb-5" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <ChevronRight strokeWidth={1.5} size={11} aria-hidden="true" />
            <Link to="/shop">Shop</Link>
            {collection && <>
              <ChevronRight strokeWidth={1.5} size={11} aria-hidden="true" />
              <span className="text-luxe-black">{collection.label}</span>
            </>}
          </nav>
          <h1 className="page-head-title">{heading}</h1>
          <p className="section-intro mt-4">{lede}</p>
        </div>
      </section>

      {/* Collection chips — lateral movement without opening the filters. */}
      <div className="border-b border-luxe-silver bg-white">
        <div className="shell flex gap-2 overflow-x-auto py-3 scrollbar-hide">
          <Link to="/shop" className="chip" data-active={!collection || undefined}>All</Link>
          {NAV_COLLECTIONS.map((c) => (
            <Link key={c.slug} to={`/category/${c.slug}`} className="chip" data-active={collection?.slug === c.slug || undefined}>
              {c.label}
            </Link>
          ))}
          {/* A legacy collection is never advertised, but when the customer is
              standing in one (an old link, a bookmark, a search result) it gets
              a chip so the active state is honest rather than looking broken. */}
          {isLegacyCollection(collection) && collection && (
            <span className="chip" data-active>{collection.label}</span>
          )}
        </div>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="toolbar">
        <div className="shell flex items-center gap-3 py-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="chip lg:hidden shrink-0"
            aria-label="Open filters"
          >
            <Sliders01 strokeWidth={1.5} size={13} aria-hidden="true" /> Filter
            {activeFilters > 0 && <span className="num">({activeFilters})</span>}
          </button>

          <div className="relative flex-1 min-w-0 max-w-md">
            <SearchMd strokeWidth={1.5} size={15} className="absolute left-0 top-1/2 -translate-y-1/2 text-luxe-gray" aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search this collection"
              aria-label="Search products"
              className="w-full pl-6 pr-2 py-2 bg-transparent border-0 border-b border-luxe-silver text-sm focus:outline-none focus:border-luxe-black transition-colors"
            />
          </div>

          <p className="hidden sm:block text-[12px] text-luxe-gray num ml-auto shrink-0">
            {results.length} product{results.length === 1 ? '' : 's'}
          </p>

          <select value={sort} onChange={(e) => setSort(e.target.value)} className="select-bare shrink-0" aria-label="Sort products">
            <option value="featured">Featured</option>
            <option value="newest">Newest</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
          </select>
        </div>
      </div>

      {/* ── Mobile filter drawer ─────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[130] lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 bg-luxe-black/45 backdrop-blur-sm animate-fade-in" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-[19rem] max-w-[86vw] bg-white shadow-[0_44px_90px_-40px_rgba(23,21,18,0.4)] overflow-y-auto animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-4 border-b border-luxe-silver sticky top-0 bg-white z-10">
              <h2 className="font-serif text-xl">Filters</h2>
              <button type="button" onClick={() => setDrawerOpen(false)} className="icon-btn -mr-2" aria-label="Close filters">
                <X strokeWidth={1.5} size={19} aria-hidden="true" />
              </button>
            </div>
            <div className="px-5 pb-8 pt-2">
              <Filters />
              <button type="button" onClick={() => setDrawerOpen(false)} className="btn btn-primary w-full mt-8">
                Show {results.length} product{results.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────── */}
      <div className="shell py-10 sm:py-14">
        <div className="flex gap-12">
          <aside className="hidden lg:block w-56 shrink-0 self-start sticky" style={{ top: 'calc(var(--header-h) + 5rem)' }}>
            <Filters />
          </aside>

          <div className="flex-1 min-w-0">
            {results.length > 0 ? (
              <Stagger className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-9 sm:gap-x-6 sm:gap-y-12" step={45}>
                {results.map((p, i) => (
                  <div key={p.id} style={staggerStyle(Math.min(i, 11))}>
                    <ProductCard product={p} priority={i < 4} />
                  </div>
                ))}
              </Stagger>
            ) : products.length === 0 ? (
              <div className="empty-state">
                <span className="empty-mark"><Stars01 strokeWidth={1.5} size={22} aria-hidden="true" /></span>
                <h2 className="section-title mx-auto">The first collection is being sourced.</h2>
                <p className="section-intro mx-auto mt-3">Every product is verified before it reaches this page.</p>
                <Link to="/" className="btn btn-primary mt-7">Back to home</Link>
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-mark"><SearchMd strokeWidth={1.5} size={22} aria-hidden="true" /></span>
                <h2 className="section-title mx-auto">
                  {collection && inCollection.length === 0 ? `${collection.label} is being sourced.` : 'Nothing matched.'}
                </h2>
                <p className="section-intro mx-auto mt-3">
                  {collection && inCollection.length === 0
                    ? 'This collection is part of the range — the first products are still going through sourcing and verification.'
                    : 'Try a different search or clear the filters.'}
                </p>
                <div className="flex flex-wrap justify-center gap-3 mt-7">
                  {activeFilters > 0 && <button type="button" onClick={clearAll} className="btn btn-primary">Clear filters</button>}
                  <Link to="/shop" className="btn btn-outline">Browse all products</Link>
                </div>
              </div>
            )}
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

  useEffect(() => { closeCart(); }, [loc.pathname, closeCart]);
  useScrollLock(cartOpen);
  useEscape(cartOpen, closeCart);

  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const sh = freeShippingEnabled && sub >= freeShippingThreshold ? 0 : 4.99;
  const discount = coupon ? (coupon.discountType === 'percent' ? Math.round(sub * (coupon.discountValue / 100) * 100) / 100 : Math.min(sub, coupon.discountValue)) : 0;
  const tot = Math.max(0, sub - discount) + sh;
  const remaining = freeShippingEnabled ? freeShippingThreshold - sub : 0;

  const applyCode = () => {
    const err = applyCoupon(codeInput);
    if (err) notify(err, 'error'); else { notify('Coupon applied'); setCodeInput(''); }
  };

  return (
    <>
      <div className="drawer-scrim" data-open={cartOpen || undefined} onClick={closeCart} aria-hidden="true" />

      <aside
        role="dialog"
        aria-label="Shopping cart"
        aria-hidden={!cartOpen}
        inert={!cartOpen}
        className="drawer"
        data-open={cartOpen || undefined}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-luxe-silver">
          <h2 className="font-serif text-2xl">Your cart <span className="text-luxe-gray text-lg num">({cart.length})</span></h2>
          <button type="button" onClick={closeCart} className="icon-btn -mr-2" aria-label="Close cart">
            <X strokeWidth={1.5} size={19} aria-hidden="true" />
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <span className="empty-mark"><ShoppingBag01 strokeWidth={1.5} size={24} aria-hidden="true" /></span>
            <p className="font-serif text-2xl text-luxe-black">Nothing here yet</p>
            <p className="text-[13px] text-luxe-gray mt-2 max-w-[24ch]">Start with the collection — every product has been verified before listing.</p>
            <button type="button" onClick={() => { closeCart(); nav('/shop'); }} className="btn btn-primary mt-7">
              Browse the collection <ArrowRight strokeWidth={1.5} size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {freeShippingEnabled && (
                sub < freeShippingThreshold ? (
                  <div>
                    <p className="text-[12px] text-luxe-gray mb-2">
                      <span className="text-luxe-black font-semibold num">{money(remaining)}</span> from free shipping
                    </p>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${Math.min(100, (sub / freeShippingThreshold) * 100)}%` }} />
                    </div>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-[12px] text-luxe-success">
                    <CheckCircle strokeWidth={1.5} size={14} aria-hidden="true" /> Free shipping unlocked
                  </p>
                )
              )}

              {cart.map(item => {
                // Defensive rendering: a malformed stored item may never crash
                // the drawer — fall back to brand imagery and safe values.
                const img = (Array.isArray(item.product.images) && item.product.images[0]) || LUXEDGE_IMAGE_FALLBACK;
                const nm = item.product.name || 'Product';
                const cat = item.product.category || '';
                const pr = typeof item.product.price === 'number' && Number.isFinite(item.product.price) ? item.product.price : 0;
                return (
                  <div key={item.product.id} className="flex gap-4">
                    <Link to={`/product/${item.product.id}`} className="w-20 h-24 shrink-0 rounded-[8px] bg-luxe-cream overflow-hidden">
                      <img src={img} alt="" aria-hidden="true" onError={onImageError} className="w-full h-full object-contain p-2" />
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link to={`/product/${item.product.id}`} className="text-[14px] font-medium text-luxe-black hover:text-luxe-gold-dark transition-colors line-clamp-2">{nm}</Link>
                      <p className="pcard-eyebrow mt-1">{cat}</p>
                      <div className="flex items-center justify-between mt-3">
                        <div className="qty scale-[0.82] origin-left">
                          <button type="button" onClick={() => updateQty(item.product.id, item.quantity - 1)} aria-label={`Decrease quantity of ${nm}`}>
                            <Minus strokeWidth={1.5} size={13} aria-hidden="true" />
                          </button>
                          <span className="num">{item.quantity}</span>
                          <button type="button" onClick={() => updateQty(item.product.id, item.quantity + 1)} aria-label={`Increase quantity of ${nm}`}>
                            <Plus strokeWidth={1.5} size={13} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[14px] font-semibold text-luxe-black num">{money(pr * item.quantity)}</span>
                          <button type="button" onClick={() => removeFromCart(item.product.id)} className="text-luxe-gray hover:text-luxe-red transition-colors" aria-label={`Remove ${nm}`}>
                            <Trash01 strokeWidth={1.5} size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-luxe-silver px-6 py-5 space-y-4">
              {coupon ? (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 text-luxe-success">
                    <CheckCircle strokeWidth={1.5} size={13} aria-hidden="true" /> {coupon.code} applied (−{money(discount)})
                  </span>
                  <button type="button" onClick={removeCoupon} className="text-luxe-gray hover:text-luxe-red transition-colors">Remove</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } }}
                    placeholder="Coupon code"
                    aria-label="Coupon code"
                    className="flex-1 min-w-0 px-0 py-2 bg-transparent border-0 border-b border-luxe-silver text-[13px] focus:outline-none focus:border-luxe-black transition-colors"
                  />
                  <button type="button" onClick={applyCode} className="btn btn-outline btn-sm shrink-0">Apply</button>
                </div>
              )}

              <div className="space-y-1.5 text-[13px]">
                <div className="flex justify-between"><span className="text-luxe-gray">Subtotal</span><span className="num">{money(sub)}</span></div>
                {discount > 0 && <div className="flex justify-between"><span className="text-luxe-gray">Coupon</span><span className="num text-luxe-success">−{money(discount)}</span></div>}
                <div className="flex justify-between"><span className="text-luxe-gray">Shipping</span><span className={`num ${sh === 0 ? 'text-luxe-success' : ''}`}>{sh === 0 ? 'Free' : money(sh)}</span></div>
                <div className="flex justify-between pt-3 mt-1 border-t border-luxe-silver text-[15px] font-semibold">
                  <span>Total</span><span className="num">{money(tot)}</span>
                </div>
              </div>

              <button type="button" onClick={() => { closeCart(); nav('/checkout'); }} className="btn btn-primary w-full">
                <Lock01 strokeWidth={1.5} size={14} aria-hidden="true" /> Checkout
              </button>
              <button type="button" onClick={() => { closeCart(); nav('/cart'); }} className="w-full text-[12px] text-luxe-gray hover:text-luxe-black transition-colors">
                View full cart
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function CartPage() {
  const { cart, updateQty, removeFromCart, freeShippingEnabled, freeShippingThreshold } = useApp();
  const nav = useNavigate();
  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const sh = freeShippingEnabled && sub >= freeShippingThreshold ? 0 : 4.99;
  const tot = sub + sh;
  const remaining = freeShippingEnabled ? freeShippingThreshold - sub : 0;

  if (cart.length === 0) return (
    <div className="shell empty-state min-h-[60vh] justify-center">
      <span className="empty-mark"><ShoppingBag01 strokeWidth={1.5} size={24} aria-hidden="true" /></span>
      <h1 className="section-title mx-auto">Your cart is empty</h1>
      <p className="section-intro mx-auto mt-3">Everything Luxedge lists has been verified first — start with the collection.</p>
      <Link to="/shop" className="btn btn-primary mt-7">Browse the collection <ArrowRight strokeWidth={1.5} size={14} aria-hidden="true" /></Link>
    </div>
  );

  return (
    <div className="shell py-12 sm:py-16">
      <p className="eyebrow mb-4">Your selection</p>
      <h1 className="page-head-title mb-10">Cart</h1>

      <div className="grid lg:grid-cols-[1fr_20rem] gap-10 lg:gap-16">
        <div className="divide-y divide-luxe-silver border-y border-luxe-silver">
          {cart.map(i => {
            const img = (Array.isArray(i.product.images) && i.product.images[0]) || LUXEDGE_IMAGE_FALLBACK;
            return (
              <div key={i.product.id} className="flex gap-5 py-6">
                <Link to={`/product/${i.product.id}`} className="w-24 h-28 sm:w-28 sm:h-32 shrink-0 rounded-[8px] bg-luxe-cream overflow-hidden">
                  <img src={img} alt="" aria-hidden="true" onError={onImageError} className="w-full h-full object-contain p-3" />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link to={`/product/${i.product.id}`} className="text-[15px] font-medium text-luxe-black hover:text-luxe-gold-dark transition-colors line-clamp-2">{i.product.name}</Link>
                  <p className="pcard-eyebrow mt-1">{i.product.category}</p>
                  <div className="flex items-center gap-4 mt-4">
                    <div className="qty scale-[0.85] origin-left">
                      <button type="button" onClick={() => updateQty(i.product.id, i.quantity - 1)} aria-label="Decrease quantity"><Minus strokeWidth={1.5} size={13} aria-hidden="true" /></button>
                      <span className="num">{i.quantity}</span>
                      <button type="button" onClick={() => updateQty(i.product.id, i.quantity + 1)} aria-label="Increase quantity"><Plus strokeWidth={1.5} size={13} aria-hidden="true" /></button>
                    </div>
                    <button type="button" onClick={() => removeFromCart(i.product.id)} className="text-luxe-gray hover:text-luxe-red transition-colors" aria-label="Remove item">
                      <Trash01 strokeWidth={1.5} size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-luxe-black num">{money((i.product.price || 0) * i.quantity)}</p>
                  <p className="text-[12px] text-luxe-gray num mt-0.5">{money(i.product.price || 0)} each</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="h-fit lg:sticky" style={{ top: 'calc(var(--header-h) + 1.5rem)' }}>
          <h2 className="font-serif text-2xl mb-6">Summary</h2>
          {freeShippingEnabled && sub < freeShippingThreshold && (
            <div className="mb-6">
              <p className="text-[12px] text-luxe-gray mb-2">
                <span className="text-luxe-black font-semibold num">{money(remaining)}</span> from free shipping
              </p>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.min(100, (sub / freeShippingThreshold) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="space-y-2 text-[14px] pb-4 border-b border-luxe-silver">
            <div className="flex justify-between"><span className="text-luxe-gray">Subtotal</span><span className="num">{money(sub)}</span></div>
            <div className="flex justify-between"><span className="text-luxe-gray">Shipping</span><span className={`num ${sh === 0 ? 'text-luxe-success' : ''}`}>{sh === 0 ? 'Free' : money(sh)}</span></div>
          </div>
          <div className="flex justify-between py-4 text-lg font-semibold"><span>Total</span><span className="num">{money(tot)}</span></div>
          <button type="button" onClick={() => nav('/checkout')} className="btn btn-primary w-full">
            <Lock01 strokeWidth={1.5} size={14} aria-hidden="true" /> Checkout
          </button>
          <Link to="/shop" className="block text-center mt-4 text-[12px] text-luxe-gray hover:text-luxe-black transition-colors">Continue shopping</Link>
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

  const handleCheckout = async () => {
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

  const I = 'w-full px-4 py-3 border border-luxe-silver rounded-[6px] text-sm focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10 transition-all';
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
        <p className="eyebrow mb-2">Secure Checkout</p>
        <h1 className="page-head-title mb-8">Checkout</h1>
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
            <div className="bg-white rounded-[10px] border border-luxe-silver p-6">
              <h2 className="font-bold text-lg mb-5 flex items-center gap-2"><UserIcon strokeWidth={1.5} size={18} className="text-luxe-gold" /> Contact Information</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className={L}>First Name *</label><input value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} className={I} placeholder="John" />{ER('firstName')}</div>
                <div><label className={L}>Last Name *</label><input value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} className={I} placeholder="Doe" />{ER('lastName')}</div>
                <div><label className={L}>Email *</label><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={I} placeholder="john@example.com" />{ER('email')}</div>
                <div><label className={L}>Phone *</label><input type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={I} placeholder="(555) 123-4567" />{ER('phone')}</div>
              </div>
            </div>
            <div className="bg-white rounded-[10px] border border-luxe-silver p-6">
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
            <div className="bg-white rounded-[10px] border border-luxe-silver p-6 sticky top-20">
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
              <button onClick={handleCheckout} disabled={submitting}
                className="btn btn-primary w-full mt-6">
                {submitting ? <Loading01 strokeWidth={1.5} size={16} className="animate-spin" /> : <Lock01 strokeWidth={1.5} size={16} />}
                {submitting ? 'Starting secure checkout…' : 'Continue to Secure Checkout'}
              </button>
              <p className="mt-3 text-center text-[10px] text-gray-400 flex items-center justify-center gap-1"><ShieldTick strokeWidth={1.5} size={12} className="text-luxe-gold" />You'll complete payment securely on Stripe's checkout page — Luxedge never sees your card details.</p>
              <div className="mt-4 pt-4 border-t space-y-2.5">
                {[
                  { i: Truck01, t: freeShippingEnabled && shipCost === 0 ? 'Free shipping on this order' : 'Standard shipping 7–14 days' },
                  { i: RefreshCcw01, t: '30-day hassle-free returns' },
                  { i: ShieldTick, t: 'Secure SSL checkout' },
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
            <Link to="/cart" className="btn btn-primary">Back to Cart</Link>
            <Link to="/shop" className="btn btn-outline">Continue Shopping</Link>
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
          <Link to="/orders" className="btn btn-primary">View Orders</Link>
          <Link to="/shop" className="btn btn-outline">Continue Shopping</Link>
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

  const empty = <div className="min-h-[60vh] flex items-center justify-center px-4"><div className="text-center"><div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Package strokeWidth={1.5} size={28} className="text-luxe-gold" /></div><h2 className="font-serif text-2xl font-bold text-luxe-black mb-2">No Orders Yet</h2><p className="text-sm text-luxe-gray mb-6">When you place an order, it will appear here.</p><Link to="/shop" className="btn btn-primary">Shop Now</Link></div></div>;
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
    nav('/');
  };

  const asGuest = () => { guestLogin(); nav(cart.length ? '/checkout' : '/'); };

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-12 overflow-hidden bg-luxe-cream">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: 'radial-gradient(70% 55% at 50% 0%, rgba(167,91,46,0.10), transparent 70%)' }}
      />

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Logo — perfectly centered above card */}
        <div className="flex justify-center mb-7">
          <Link to="/" className="inline-flex items-center justify-center group" aria-label="Luxedge home">
            <img src="/luxedge-lockup.svg" alt="Luxedge" className="h-14 sm:h-16 w-auto transition-transform group-hover:scale-105" />
          </Link>
        </div>

        {/* Card — light glass */}
        <div className="bg-white rounded-[14px] border border-luxe-silver p-8 shadow-[0_28px_70px_-34px_rgba(23,21,18,0.35)]">
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
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-[6px] text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10 transition-all" />
            </div>
            <div className="relative">
              <Lock01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPw ? 'text' : 'password'} required value={p} onChange={ev => setP(ev.target.value)} placeholder="Password"
                className="w-full pl-12 pr-12 py-3.5 bg-white border border-luxe-silver rounded-[6px] text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10 transition-all" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-luxe-gold transition-colors">
                {showPw ? <EyeOff strokeWidth={1.5} size={18} /> : <Eye strokeWidth={1.5} size={18} />}
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
              className="btn btn-primary w-full">
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
          <span className="flex items-center gap-1.5"><ShieldTick strokeWidth={1.5} size={13} className="text-luxe-gold" /> Verified sourcing</span>
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
    <div className="min-h-screen relative flex items-center justify-center px-4 py-12 overflow-hidden bg-luxe-cream">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: 'radial-gradient(70% 55% at 50% 0%, rgba(167,91,46,0.10), transparent 70%)' }}
      />

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Logo — perfectly centered above card */}
        <div className="flex justify-center mb-7">
          <Link to="/" className="inline-flex items-center justify-center group" aria-label="Luxedge home">
            <img src="/luxedge-lockup.svg" alt="Luxedge" className="h-14 sm:h-16 w-auto transition-transform group-hover:scale-105" />
          </Link>
        </div>

        {/* Card — light glass */}
        <div className="bg-white rounded-[14px] border border-luxe-silver p-8 shadow-[0_28px_70px_-34px_rgba(23,21,18,0.35)]">
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
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-[6px] text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10 transition-all" />
            </div>
            <div className="relative">
              <Mail01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={e} onChange={ev => setE(ev.target.value)} placeholder="Email address"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-[6px] text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10 transition-all" />
            </div>
            <div className="relative">
              <Lock01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPw ? 'text' : 'password'} required value={p} onChange={ev => setP(ev.target.value)} placeholder="Password (6+ characters)" minLength={6}
                className="w-full pl-12 pr-12 py-3.5 bg-white border border-luxe-silver rounded-[6px] text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10 transition-all" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-luxe-gold transition-colors">
                {showPw ? <EyeOff strokeWidth={1.5} size={18} /> : <Eye strokeWidth={1.5} size={18} />}
              </button>
            </div>

            <button type="submit" disabled={loading}
              className="btn btn-primary w-full">
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
          <span className="flex items-center gap-1.5"><ShieldTick strokeWidth={1.5} size={13} className="text-luxe-gold" /> Verified sourcing</span>
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
    <div className="min-h-screen bg-luxe-black flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[14px] shadow-[0_28px_70px_-34px_rgba(0,0,0,0.6)] p-8">
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
            <input type="email" placeholder="Enter admin email" value={e} onChange={ev => setE(ev.target.value)} className="w-full px-4 py-3 border border-luxe-silver rounded-[6px] text-sm focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10" required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Password</label>
            <input type="password" placeholder="Enter password" value={p} onChange={ev => setP(ev.target.value)} className="w-full px-4 py-3 border border-luxe-silver rounded-[6px] text-sm focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10" required />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary w-full">
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
    <div className="min-h-screen bg-white">
      <section className="page-head">
        <div className="shell py-14 sm:py-20">
          <p className="eyebrow mb-4">Legal</p>
          <h1 className="page-head-title">{title}</h1>
          <p className="text-[12px] text-luxe-gray mt-5 font-brand uppercase tracking-[0.14em]">Last updated {updated}</p>
        </div>
      </section>
      <div className="shell py-14"><div className="measure">
        <div className="space-y-10 text-[15px] text-luxe-gray leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
function LS({ t, children }: { t: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-2xl text-luxe-black mb-3">{t}</h2>
      {children}
    </section>
  );
}

function AboutPage() {
  return (
    <div>
      <section className="page-head">
        <div className="shell py-16 sm:py-24"><div className="measure">
          <p className="eyebrow mb-5">Our story</p>
          <h1 className="page-head-title">A store that has to earn the listing.</h1>
          <p className="section-intro mt-6 max-w-xl">
            Luxedge is a curated animal-goods store based in Irving, Texas — horses,
            cattle, dogs and cats, held to one standard.
          </p>
        </div></div>
      </section>

      <section className="section">
        <div className="shell"><div className="measure space-y-6 text-[16px] leading-relaxed text-luxe-gray">
          <p className="text-[19px] leading-relaxed text-luxe-black">
            Buying gear for animals online is mostly guesswork. Listings are recycled,
            photography is borrowed, and nobody will tell you where a thing actually
            ships from. Luxedge exists because that is a solvable problem.
          </p>
          <p>
            Every product goes through a verification pass before it is published: a real
            supplier, a real cost basis, and a delivery path we can trace. Anything that
            cannot clear that bar stays unlisted — however good the margin looks. It is
            the reason a collection here can be small, and the reason we would rather
            show you an empty category than a padded one.
          </p>

          <h2 className="font-serif text-3xl text-luxe-black pt-8">Working animals count</h2>
          <p>
            Most pet retailers treat horses and cattle as an afterthought — a stray
            category behind three screens of dog toys. We build the other way round.
            Stable, paddock and pasture gear sits at the same level as the dog bed and
            the cat tree, because the people buying it are the same people, on the same
            afternoon.
          </p>

          <h2 className="font-serif text-3xl text-luxe-black pt-8">What we stand behind</h2>
          <p>
            Returns and replacements within 30 days of your order date. Payments handled
            by Stripe, so card details never touch our systems. Support answered by
            people, Monday to Friday, 9am to 6pm Central. If something is wrong with an
            order, we make it right without a maze.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mt-14 pt-10 border-t border-luxe-silver">
            {[
              { v: 'Verified', l: 'Before any listing' },
              { v: '30-Day', l: 'Returns & replacements' },
              { v: '1–3 days', l: 'Order processing' },
              { v: 'Mon–Fri', l: 'Support 9am–6pm CT' },
            ].map((stat) => (
              <div key={stat.l}>
                <p className="font-serif text-2xl sm:text-[1.75rem] text-luxe-black leading-none">{stat.v}</p>
                <p className="text-[12px] text-luxe-gray mt-2 leading-snug">{stat.l}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-12">
            <Link to="/shop" className="btn btn-primary">
              Shop the collection <ArrowRight strokeWidth={1.5} size={14} aria-hidden="true" />
            </Link>
            <Link to="/contact" className="btn btn-outline">Talk to us</Link>
          </div>
          </div>
        </div>
      </section>
    </div>
  );
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
      <LS t="Advertising & Google AdSense"><p>We display advertising on our website through <strong>Google AdSense</strong>, a service provided by Google LLC ("Google"). Google and its advertising partners may use cookies — such as the DoubleClick cookie — to serve and personalize ads based on your visits to this site and other websites across the Internet.</p><p className="mt-2">You can learn more about how Google uses data when you visit sites that partner with it by reading Google's page on <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" className="text-luxe-gold underline underline-offset-2 hover:text-luxe-gold-dark">how Google uses data when you use our partners' sites or apps</a>.</p><p className="mt-2">You can opt out of personalized advertising by visiting <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer" className="text-luxe-gold underline underline-offset-2 hover:text-luxe-gold-dark">Google Ads Settings</a>. Third-party vendors, including Google, use cookies to serve ads based on a user's prior visits to this website.</p></LS>
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
  // NOTE: two answers were factually stale — payments are live through Stripe
  // (not "demo mode"), and guest checkout means an account is optional. Both
  // are corrected here; a storefront must never describe itself wrongly.
  const faqs = [
    { c: 'Orders & shipping', qs: [
      { q: 'How long does shipping take?', a: 'Orders are processed in 1–3 business days. Standard shipping then takes 7–12 business days; express takes 2–4.' },
      { q: 'Do you offer free shipping?', a: 'Free shipping runs as a store promotion. When it is active, the qualifying order total is shown in your cart and applied automatically at checkout — no code needed.' },
      { q: 'How can I track my order?', a: 'You receive an email with a tracking number once the order ships. If you have an account, the same information appears under My Orders.' },
      { q: 'Do you ship internationally?', a: 'Not yet. We currently ship within the United States, including all 50 states and APO/FPO/DPO addresses.' },
      { q: 'Can I change my shipping address after ordering?', a: 'If the order has not shipped, email hello@luxedge.us immediately and we will do our best to update it. Once it ships, the address cannot be changed.' },
    ]},
    { c: 'Returns & replacements', qs: [
      { q: 'What is your return policy?', a: 'Return requests are accepted within 30 days of the order date. Products must be unused, unopened and in original packaging, and returns need approval before you ship them back.' },
      { q: 'How does the replacement process work?', a: 'Once an approved return is received and inspected, we ship a replacement of the same product. We do not offer refunds, exchanges for different products, or store credit.' },
      { q: 'Who pays for return shipping?', a: 'Return shipping and packaging are the customer’s responsibility. We recommend a trackable service — we cannot be responsible for returns lost in transit.' },
      { q: 'What if I receive a damaged or incorrect item?', a: 'Contact us within 30 days of delivery with your order number and photos of the product and packaging, and we will arrange a replacement.' },
    ]},
    { c: 'Payment & security', qs: [
      { q: 'What payment methods do you accept?', a: 'Checkout is handled by Stripe, which accepts Visa, Mastercard, American Express, Discover and the wallets your device supports, such as Apple Pay and Google Pay.' },
      { q: 'Is my payment information secure?', a: 'Yes. Payment is completed on Stripe’s hosted checkout — a PCI-compliant provider. Card details are never seen, transmitted or stored by Luxedge.' },
      { q: 'Can I cancel an order?', a: 'Orders can be cancelled within 2 hours of being placed. After that the order enters processing. Email hello@luxedge.us as soon as possible.' },
    ]},
    { c: 'Products & sourcing', qs: [
      { q: 'How do you select your products?', a: 'Every product must clear a verification pass before it is published: a real supplier, a real cost basis and a traceable delivery path. Anything that cannot be verified stays unlisted.' },
      { q: 'Why is a category sometimes empty?', a: 'Because we would rather show an empty collection than pad it. Horse, Cattle and Stable & Farm are part of the range even while the first products are still going through sourcing.' },
      { q: 'Do you offer warranties?', a: 'Warranty coverage varies by product and manufacturer — check the product description. Our 30-day return and replacement policy applies regardless.' },
    ]},
    { c: 'Account & support', qs: [
      { q: 'Do I need an account to shop?', a: 'No. You can check out as a guest. An account is optional and lets you track orders, keep your details for next time and submit product reviews.' },
      { q: 'How do I contact customer support?', a: 'Email hello@luxedge.us or call (440) 941-8002, Monday to Friday, 9am–6pm Central. Email is typically answered within one business day.' },
      { q: 'I forgot my password. What do I do?', a: 'Use the password reset option on the sign-in page. If you are still locked out, contact support and we will help you back in.' },
    ]},
  ];

  return (
    <div className="bg-white">
      <section className="page-head">
        <div className="shell py-14 sm:py-20">
          <p className="eyebrow mb-4">Support</p>
          <h1 className="page-head-title">Frequently asked questions</h1>
          <p className="section-intro mt-5">Straight answers on shipping, returns, payment and sourcing.</p>
        </div>
      </section>

      <div className="shell py-14"><div className="measure space-y-14">
        {faqs.map(section => (
          <section key={section.c}>
            <p className="eyebrow mb-5">{section.c}</p>
            <div>
              {section.qs.map(faq => (
                <Accordion key={faq.q} title={faq.q} plain>{faq.a}</Accordion>
              ))}
            </div>
          </section>
        ))}

        <div className="pt-4">
          <p className="section-intro mb-5">Still have a question? We answer within one business day.</p>
          <Link to="/contact" className="btn btn-primary">
            <Mail01 strokeWidth={1.5} size={15} aria-hidden="true" /> Contact support
          </Link>
        </div>
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
      <section className="page-head">
        <div className="shell py-14 sm:py-20">
          <p className="eyebrow mb-4">Get in touch</p>
          <h1 className="page-head-title">Contact us</h1>
          <p className="section-intro mt-5">Questions about an order, a product or sourcing — we answer within one business day.</p>
        </div>
      </section>
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
            <form onSubmit={e => { e.preventDefault(); setOk(true); notify('Message sent!'); }} className="bg-white rounded-[10px] border border-luxe-silver p-6 sm:p-8 space-y-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Send01 strokeWidth={1.5} size={18} className="text-luxe-gold" /> Send Us a Message</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Name *</label><input required placeholder="Your full name" className="w-full px-4 py-3 border border-luxe-silver rounded-[6px] text-sm focus:outline-none focus:border-luxe-black" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email *</label><input required type="email" placeholder="you@example.com" className="w-full px-4 py-3 border border-luxe-silver rounded-[6px] text-sm focus:outline-none focus:border-luxe-black" /></div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Subject *</label>
                <select required className="w-full px-4 py-3 border border-luxe-silver rounded-[6px] text-sm focus:outline-none focus:border-luxe-black"><option value="">Select a topic</option><option>Order Question</option><option>Shipping & Tracking</option><option>Returns & Refunds</option><option>Product Inquiry</option><option>Technical Support</option><option>Other</option></select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Message *</label><textarea required placeholder="Tell us how we can help..." rows={5} className="w-full px-4 py-3 border border-luxe-silver rounded-[6px] text-sm focus:outline-none focus:border-luxe-gold resize-none" /></div>
              <button type="submit" className="btn btn-primary w-full"><Send01 strokeWidth={1.5} size={16} />Send Message</button>
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
      <section className="page-head">
        <div className="shell py-14 sm:py-20">
          <p className="eyebrow mb-4">Careers</p>
          <h1 className="page-head-title">Work at Luxedge</h1>
          <p className="section-intro mt-5">A small team building a store that has to earn every listing.</p>
        </div>
      </section>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <div className="bg-white rounded-[10px] border border-luxe-silver p-6 sm:p-10">
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
          <Link to="/contact" className="btn btn-primary">
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
      <section className="page-head">
        <div className="shell py-14 sm:py-20">
          <p className="eyebrow mb-4">The journal</p>
          <h1 className="page-head-title">Field notes</h1>
          <p className="section-intro mt-5">Practical guidance on feeding, bedding, grooming and turnout — written by the people who choose the products.</p>
        </div>
      </section>

      <section className="section-tight bg-white">
        <div className="shell">
          {user && (
            <div className="flex justify-end mb-6">
              <Link to="/blog/write" className="btn btn-primary btn-sm">
                <PencilLine strokeWidth={1.5} size={16} /> Write a Post
              </Link>
            </div>
          )}

          {published.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {published.map(post => (
                <Link key={post.id} to={`/blog/${post.slug}`} className="group block card-lift bg-white rounded-[10px] border border-luxe-silver overflow-hidden">
                  <div className="aspect-[16/10] overflow-hidden">
                    <img src={post.image} alt={post.title} onError={onImageError} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" decoding="async" />
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400"><Calendar strokeWidth={1.5} size={12} />{new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <span className="text-gray-200">·</span>
                      <span className="text-xs text-gray-400">{post.authorName}</span>
                    </div>
                    <h2 className="font-sans text-base font-semibold text-luxe-black mb-2 group-hover:text-luxe-gold-dark transition-colors leading-snug">{post.title}</h2>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-4">{post.excerpt}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1.5">{post.tags.slice(0, 3).map(t => <span key={t} className="px-2 py-0.5 bg-luxe-cream text-luxe-gray rounded-full text-[10px] font-medium">#{t}</span>)}</div>
                      <span className="link-arrow text-luxe-gold">Read <ArrowRight strokeWidth={1.5} size={14} /></span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state border border-luxe-silver rounded-[10px]">
              <BookOpen01 strokeWidth={1.5} size={48} className="mx-auto text-gray-200 mb-4" />
              <p className="font-serif text-2xl text-luxe-black mb-2">No posts yet</p>
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
        <img src={post.image} alt={post.title} onError={onImageError} fetchPriority="high" decoding="async" className="w-full h-full object-cover" />
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
              {post.images.map((img, i) => <img key={i} src={img} alt="" onError={onImageError} loading="lazy" decoding="async" className="rounded-xl w-full object-cover" />)}
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
                    <img src={r.image} alt="" onError={onImageError} loading="lazy" decoding="async" className="w-16 h-16 rounded-lg object-cover shrink-0" />
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

  const I = 'w-full px-4 py-3 border border-luxe-silver rounded-[6px] text-sm focus:outline-none focus:border-luxe-black focus:ring-2 focus:ring-luxe-black/10';

  return (
    <div className="py-10 bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto px-4">
        <Link to="/blog" className="text-sm text-gray-500 hover:text-luxe-gold flex items-center gap-1 mb-6"><ArrowLeft strokeWidth={1.5} size={14} />Back to Blog</Link>
        <h1 className="text-2xl font-bold mb-8 flex items-center gap-2"><PencilLine strokeWidth={1.5} size={22} className="text-luxe-gold" />Write a Blog Post</h1>

        <form onSubmit={submit} className="space-y-6">
          {/* Cover Image */}
          <div className="bg-white rounded-[10px] border border-luxe-silver p-6">
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
          <div className="bg-white rounded-[10px] border border-luxe-silver p-6 space-y-4">
            <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Title *</label><input value={title} onChange={e => setTitle(e.target.value)} className={I} placeholder="Your blog post title" required /></div>
            <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Excerpt</label><input value={excerpt} onChange={e => setExcerpt(e.target.value)} className={I} placeholder="Short preview text (optional)" maxLength={200} /></div>
          </div>

          {/* Content */}
          <div className="bg-white rounded-[10px] border border-luxe-silver p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Content * <span className="normal-case text-gray-400 font-normal">Use ## for headings</span></label>
            <textarea value={content} onChange={e => setContent(e.target.value)} className={I + ' resize-none'} rows={12} placeholder="Write your article here...&#10;&#10;## Section Heading&#10;Your paragraph text..." required />
          </div>

          {/* Inline Images */}
          <div className="bg-white rounded-[10px] border border-luxe-silver p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Article Images ({images.length}/5)</label>
            {images.length > 0 && <div className="flex gap-3 mb-3 overflow-x-auto">{images.map((img, i) => <div key={i} className="relative shrink-0"><img src={img} alt="" className="w-20 h-20 rounded-lg object-cover" /><button type="button" onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center">✕</button></div>)}</div>}
            {images.length < 5 && <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-luxe-gold text-sm text-gray-500 hover:text-luxe-gold w-fit"><Upload01 strokeWidth={1.5} size={16} />Add images<input type="file" accept="image/*" multiple onChange={handleImages} className="hidden" /></label>}
          </div>

          {/* Tags */}
          <div className="bg-white rounded-[10px] border border-luxe-silver p-6">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Tags</label>
            <div className="flex flex-wrap gap-2 mb-3">{tags.map(t => <span key={t} className="flex items-center gap-1 px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-sm"><Tag01 strokeWidth={1.5} size={12} />{t}<button type="button" onClick={() => setTags(prev => prev.filter(x => x !== t))} className="text-luxe-gold hover:text-red-500 ml-1">×</button></span>)}</div>
            <div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className={I} placeholder="Add tag & press Enter" /><button type="button" onClick={addTag} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium shrink-0">Add</button></div>
          </div>

          {user?.role !== 'admin' && <div className="p-4 bg-luxe-gold-soft border border-luxe-gold/30 rounded-xl text-sm text-luxe-gold-dark flex items-center gap-2"><Eye strokeWidth={1.5} size={16} />Your post will be reviewed by admin before publishing.</div>}

          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary flex-1"><Send01 strokeWidth={1.5} size={16} />{user?.role === 'admin' ? 'Publish Now' : 'Submit for Review'}</button>
            <button type="button" onClick={() => nav('/blog')} className="btn btn-outline">Cancel</button>
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
