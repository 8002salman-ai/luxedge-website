// ============================================================================
// LUXEDGE — STOREFRONT SHARED CONTRACT
//
// Types, the app context and the tiny helpers that both App.tsx and every
// storefront component need. It lives here (rather than in App.tsx) purely so
// presentation components can be extracted without an import cycle; App.tsx
// re-exports everything, so existing consumers — including the admin bundle —
// keep importing from '../App' unchanged.
// ============================================================================

import { createContext, useContext } from 'react';
import type { StoreCoupon } from '../../services/catalog';

// ── Domain types ───────────────────────────────────────────────────────────

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
  // Real merchandising data from the DB (never fabricated).
  featured?: boolean; newArrival?: boolean; saleEnabled?: boolean;
  stockStatus?: string; usInventory?: boolean;
  seoTitle?: string; seoDescription?: string; seoKeywords?: string[];
  supplierSource?: string;
  commerceReadiness?: string; sourceType?: string; inventorySource?: string;
}

export interface CartItem { product: Product; quantity: number; }

export interface AppUser {
  id: string; email: string; name: string; role: 'admin' | 'buyer';
  password?: string; isBlocked?: boolean; joined?: string;
}

export interface Order {
  id: string; userId: string; userName: string; items: CartItem[];
  total: number; status: string; date: string; address?: string;
}

export interface Review {
  id: string; productId: string; productName: string; userName: string;
  rating: number; comment: string; status: 'pending' | 'approved' | 'rejected';
  date: string;
}

export interface AdminCategory {
  id: string; name: string; isActive: boolean;
  subs: { id: string; name: string; isActive: boolean }[];
}

export interface BlogPost {
  id: string; slug: string; title: string; excerpt: string; content: string;
  image: string; images: string[]; tags: string[];
  authorId: string; authorName: string;
  status: 'published' | 'draft' | 'pending';
  date: string;
}

// ── App context ────────────────────────────────────────────────────────────

export interface Ctx {
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
  coupon: StoreCoupon | null;
  applyCoupon: (code: string) => string | null;
  removeCoupon: () => void;
  freeShippingEnabled: boolean;
  freeShippingThreshold: number;
}

export const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('no ctx');
  return c;
}

// ── Shared presentation helpers ────────────────────────────────────────────

/**
 * Branded image fallback — bone ground + Luxedge wordmark — so a dead image
 * URL degrades into brand rather than a browser's broken-image glyph.
 */
export const LUXEDGE_IMAGE_FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'><rect width='100%' height='100%' fill='#F7F4EE'/><text x='50%' y='50%' font-family='Georgia, serif' font-size='58' letter-spacing='10' fill='#171512' text-anchor='middle' dominant-baseline='middle'>LUXEDGE</text></svg>"
);

/** Swap a broken image to the branded fallback exactly once (never loops). */
export function onImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.onerror = null;
  if (img.src !== LUXEDGE_IMAGE_FALLBACK) img.src = LUXEDGE_IMAGE_FALLBACK;
}

/**
 * Failure handler for images that sit BEHIND white text (animal cards,
 * collection tiles). The branded fallback is a light bone plate, so swapping
 * it in here would leave white type on cream. Hiding the image instead lets
 * the card's own ink plate show through and the composition still reads.
 */
export function onDarkImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none';
}

export function firstUsableImage(product: Product | undefined): string | undefined {
  return product?.images.find((image) => Boolean(image));
}

export const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function money(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
}

/** Average of approved reviews for a product — 0 when there are none. */
export function verifiedRating(reviews: Review[], productId: string): { count: number; average: number } {
  const approved = reviews.filter((r) => r.productId === productId && r.status === 'approved');
  if (!approved.length) return { count: 0, average: 0 };
  return { count: approved.length, average: approved.reduce((s, r) => s + r.rating, 0) / approved.length };
}
