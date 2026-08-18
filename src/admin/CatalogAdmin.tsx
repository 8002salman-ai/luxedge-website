// ============================================================================
// LUXEDGE V2 — CATALOG ADMIN (Catalog Launch Phase)
//
// DB-backed product management + promotions for the admin. Replaces the old
// in-memory demo products panel. Everything persists through the catalog
// repository (admin JWT → Supabase RLS). No fake facts: UNKNOWN stays
// UNKNOWN, merchandising flags are admin decisions, delete prefers archive.
// ============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, PencilSimple, Trash, ArrowLeft, Copy, Eye, ToggleRight, ToggleLeft,
  MagnifyingGlass, FloppyDisk, Image as ImageIcon, Stack, Tag, Globe, Truck, Package, CurrencyDollar,
  GearSix, CaretUp, CaretDown, X, Download, List, Megaphone,
} from '@phosphor-icons/react';
import Modal from '../components/common/Modal';
import { useApp } from '../App';
import { getAccessToken } from '../services/supabase';
import {
  setDbToken, listProducts, getProduct, createProduct, updateProduct, setProductStatus,
  archiveProduct, hardDeleteProduct, duplicateProduct, saveProductImages, saveProductVariants,
  listCategories, listCoupons, createCoupon, updateCoupon, deleteCoupon,
  listOffers, createOffer, updateOffer, deleteOffer, getStoreSettings, saveStoreSettings,
  uid,
} from '../features/catalog/repository';
import type {
  CatalogProduct, CatalogCategory, CatalogImage, CatalogVariant, Coupon, StoreOffer, StoreSettings,
} from '../features/catalog/types';
import { buildFeedCsv, buildProductJsonLd, buildProductMeta } from '../features/catalog/seo';

const I = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
const BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  ready: 'bg-blue-100 text-blue-700',
  draft: 'bg-gray-100 text-gray-600',
  inactive: 'bg-amber-100 text-amber-700',
  archived: 'bg-red-100 text-red-600',
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${BADGE[status] || BADGE.draft}`}>{status}</span>;
}

function useDbToken() {
  useEffect(() => {
    setDbToken(getAccessToken());
  }, []);
}

// ============================================================================
// PRODUCT LIST
// ============================================================================
export function CatalogProductsPage() {
  useDbToken();
  const nav = useNavigate();
  const { notify } = useApp();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [cats, setCats] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('all');
  const [fCat, setFCat] = useState('all');
  const [fFlag, setFFlag] = useState('all');
  const [delId, setDelId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, cs] = await Promise.all([listProducts(), listCategories()]);
      setProducts(ps);
      setCats(cs);
    } catch (e) {
      notify(`Could not load catalog: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => products.filter((p) => {
    if (fStatus !== 'all' && p.status !== fStatus) return false;
    if (fCat !== 'all' && p.categoryId !== fCat) return false;
    if (fFlag === 'featured' && !p.featured) return false;
    if (fFlag === 'new' && !p.newArrival) return false;
    if (fFlag === 'sale' && !(p.compareAtPrice > p.price)) return false;
    if (fFlag === 'free-shipping' && !p.freeShipping) return false;
    if (fFlag === 'low-stock' && !(p.inventoryQty <= p.lowStockThreshold)) return false;
    if (q) {
      const needle = q.toLowerCase();
      return [p.name, p.brand, p.sku, p.categoryName, ...p.tags].join(' ').toLowerCase().includes(needle);
    }
    return true;
  }), [products, fStatus, fCat, fFlag, q]);

  const toggleActive = async (p: CatalogProduct) => {
    try {
      const next = p.status === 'active' ? 'inactive' : 'active';
      await setProductStatus(p.id, next);
      notify(next === 'active' ? 'Product activated' : 'Product deactivated');
      await load();
    } catch (e) {
      notify(`Could not update: ${(e as Error).message}`, 'error');
    }
  };

  const onArchive = async () => {
    if (!delId) return;
    setArchiving(true);
    try {
      await archiveProduct(delId);
      notify('Product archived (history kept)');
      setDelId(null);
      await load();
    } catch (e) {
      notify(`Could not archive: ${(e as Error).message}`, 'error');
    } finally {
      setArchiving(false);
    }
  };

  const onDuplicate = async (id: string) => {
    try {
      await duplicateProduct(id);
      notify('Product duplicated as draft');
      await load();
    } catch (e) {
      notify(`Could not duplicate: ${(e as Error).message}`, 'error');
    }
  };

  const onHardDelete = async () => {
    if (!delId) return;
    try {
      await hardDeleteProduct(delId);
      notify('Product permanently deleted');
      setDelId(null);
      await load();
    } catch (e) {
      notify(`Could not delete: ${(e as Error).message}`, 'error');
    }
  };

  if (loading) return <div className="text-center py-20 text-gray-400">Loading catalog…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-gray-500">{products.length} products · {products.filter((p) => p.status === 'active').length} active on storefront</p>
        </div>
        <button onClick={() => nav('/admin/products/new')} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2">
          <Plus size={16} />Add Product
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        <div className="relative lg:col-span-2">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, brand, SKU, tag…" className={`${I} pl-9`} aria-label="Search products" />
        </div>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={I} aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="ready">Ready</option>
          <option value="draft">Draft</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
        <select value={fCat} onChange={(e) => setFCat(e.target.value)} className={I} aria-label="Filter by category">
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={fFlag} onChange={(e) => setFFlag(e.target.value)} className={I} aria-label="Filter by merchandising flag">
          <option value="all">All flags</option>
          <option value="featured">Featured</option>
          <option value="new">New arrival</option>
          <option value="sale">On sale</option>
          <option value="free-shipping">Free shipping</option>
          <option value="low-stock">Low stock</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Stock</th>
                <th className="px-4 py-3">Flags</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.images[0]
                        ? <img src={p.images[0].url} alt="" className="w-10 h-10 rounded object-cover bg-gray-100" />
                        : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-300"><Package size={18} /></div>}
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-gray-400">{p.brand}{p.sku ? ` · ${p.sku}` : ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.categoryName || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-sm">${p.price.toFixed(2)}</span>
                    {p.compareAtPrice > p.price && <span className="text-xs text-gray-400 line-through ml-1">${p.compareAtPrice.toFixed(2)}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.costPrice > 0 ? `$${p.costPrice.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className={p.inventoryQty <= p.lowStockThreshold && p.lowStockThreshold > 0 ? 'text-red-600 font-semibold' : ''}>{p.inventoryQty}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {p.featured && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-semibold">Featured</span>}
                      {p.newArrival && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-semibold">New</span>}
                      {p.compareAtPrice > p.price && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[10px] font-semibold">Sale</span>}
                      {p.freeShipping && <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-semibold">Free ship</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => toggleActive(p)} title={p.status === 'active' ? 'Deactivate' : 'Activate'} className="p-2 hover:bg-gray-100 rounded">
                        {p.status === 'active' ? <ToggleRight size={17} className="text-green-500" /> : <ToggleLeft size={17} className="text-gray-400" />}
                      </button>
                      <button onClick={() => nav(`/admin/products/edit/${p.id}`)} title="Edit" className="p-2 hover:bg-blue-50 rounded text-blue-600"><PencilSimple size={16} /></button>
                      <button onClick={() => onDuplicate(p.id)} title="Duplicate" className="p-2 hover:bg-purple-50 rounded text-purple-600"><Copy size={16} /></button>
                      <button onClick={() => nav(`/#/product/${p.id}`)} title="Preview" className="p-2 hover:bg-green-50 rounded text-green-600"><Eye size={16} /></button>
                      <button onClick={() => setDelId(p.id)} title="Archive/Delete" className="p-2 hover:bg-red-50 rounded text-red-500"><Trash size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-14 text-center text-gray-400">No products match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={!!delId} onClose={() => setDelId(null)} title="Archive / Delete Product">
        <p className="text-gray-600 mb-3">Archive keeps the product for history and removes it from the storefront. Hard delete permanently removes the row and its images/variants.</p>
        <div className="flex gap-3">
          <button onClick={onArchive} disabled={archiving} className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg font-medium disabled:opacity-50">
            {archiving ? 'Archiving…' : 'Archive (recommended)'}
          </button>
          <button onClick={onHardDelete} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Hard Delete</button>
          <button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// PRODUCT EDITOR
// ============================================================================
type EditorTab = 'general' | 'pricing' | 'inventory' | 'shipping' | 'images' | 'variants' | 'seo' | 'promotions';

const TABS: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Package size={14} /> },
  { id: 'pricing', label: 'Pricing', icon: <CurrencyDollar size={14} /> },
  { id: 'inventory', label: 'Inventory', icon: <Stack size={14} /> },
  { id: 'shipping', label: 'Shipping', icon: <Truck size={14} /> },
  { id: 'images', label: 'Images', icon: <ImageIcon size={14} /> },
  { id: 'variants', label: 'Variants', icon: <List size={14} /> },
  { id: 'seo', label: 'SEO', icon: <Globe size={14} /> },
  { id: 'promotions', label: 'Promotions', icon: <Tag size={14} /> },
];

export function CatalogProductEditor() {
  const { id: paramId } = useParams<{ id: string }>();
  const isNew = !paramId;
  const nav = useNavigate();
  const { notify } = useApp();
  useDbToken();

  const [cats, setCats] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<EditorTab>('general');
  const [p, setP] = useState<CatalogProduct | null>(null);

  const load = useCallback(async () => {
    try {
      const cs = await listCategories();
      setCats(cs);
      if (paramId) {
        const prod = await getProduct(paramId);
        if (!prod) { notify('Product not found', 'error'); nav('/admin/products'); return; }
        setP(prod);
      } else {
        setP({
          id: '', slug: '', name: '', shortDescription: '', description: '', features: [], specifications: {},
          categoryId: cs[0]?.id ?? null, categoryName: cs[0]?.name ?? '', brand: 'Luxedge', status: 'draft',
          price: 0, compareAtPrice: 0, costPrice: 0, landedCost: 0, marginPercent: null, currency: 'USD',
          sku: '', inventoryQty: 0, stockStatus: 'in_stock', lowStockThreshold: 0, shippingCost: 0,
          freeShipping: false, deliveryMinDays: null, deliveryMaxDays: null, usInventory: false,
          tags: [], featured: false, newArrival: false, trending: false, bestRated: false, bestSeller: false,
          promoted: false, saleEnabled: false, seoTitle: '', seoDescription: '', seoKeywords: [],
          images: [], variants: [], createdAt: '', updatedAt: '', publishedAt: null,
        });
      }
    } catch (e) {
      notify(`Could not load: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [paramId, notify, nav]);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof CatalogProduct>(k: K, v: CatalogProduct[K]) => {
    setP((prev) => (prev ? { ...prev, [k]: v } : prev));
  };

  const handleSave = async () => {
    if (!p) return;
    if (!p.name.trim()) { notify('Product name is required', 'error'); return; }
    if (!(p.price > 0)) { notify('Price must be greater than 0', 'error'); return; }
    if (p.images.length === 0) { notify('At least one image is required before activating a premium listing', 'error'); setTab('images'); return; }
    setSaving(true);
    try {
      const input = {
        name: p.name.trim(),
        shortTitle: p.shortTitle,
        subtitle: p.subtitle,
        shortDescription: p.shortDescription,
        description: p.description,
        features: p.features,
        specifications: p.specifications,
        categoryId: p.categoryId,
        brand: p.brand,
        status: p.status,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        costPrice: p.costPrice,
        landedCost: p.landedCost,
        currency: p.currency,
        sku: p.sku,
        inventoryQty: p.inventoryQty,
        stockStatus: p.stockStatus,
        lowStockThreshold: p.lowStockThreshold,
        shippingCost: p.shippingCost,
        freeShipping: p.freeShipping,
        deliveryMinDays: p.deliveryMinDays,
        deliveryMaxDays: p.deliveryMaxDays,
        shippingNote: p.shippingNote,
        usInventory: p.usInventory,
        supplierSource: p.supplierSource,
        supplierProductRef: p.supplierProductRef,
        tags: p.tags,
        featured: p.featured,
        newArrival: p.newArrival,
        trending: p.trending,
        bestRated: p.bestRated,
        bestSeller: p.bestSeller,
        promoted: p.promoted,
        saleEnabled: p.saleEnabled,
        discountType: p.discountType,
        discountValue: p.discountValue,
        seoTitle: p.seoTitle,
        seoDescription: p.seoDescription,
        seoKeywords: p.seoKeywords,
        canonicalSlug: p.canonicalSlug,
        ogImage: p.ogImage,
        ownerNotes: p.ownerNotes,
        evidenceNotes: p.evidenceNotes,
      };
      const saved = isNew ? await createProduct(input) : (await updateProduct(p.id, input))!;
      await saveProductImages(saved.id, p.images.map((img, i) => ({
        id: img.id || undefined,
        url: img.url,
        altText: img.altText,
        kind: img.kind,
        isPrimary: img.isPrimary,
        sortOrder: i,
        variantId: img.variantId || null,
      })));
      await saveProductVariants(saved.id, p.variants.map((v) => ({
        id: v.id || undefined,
        attributes: v.attributes,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        costPrice: v.costPrice,
        inventoryQty: v.inventoryQty,
        status: v.status,
        lowStockThreshold: v.lowStockThreshold,
      })));
      notify(isNew ? 'Product created' : 'Product saved');
      nav('/admin/products');
    } catch (e) {
      notify(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addTag = (t: string) => { const v = t.trim(); if (v && !p?.tags.includes(v)) set('tags', [...(p?.tags || []), v]); };
  const removeTag = (t: string) => set('tags', (p?.tags || []).filter((x) => x !== t));

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;
  if (!p) return null;

  const meta = buildProductMeta(p);
  const jsonLd = buildProductJsonLd(p);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/admin/products')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold">{isNew ? 'Add New Product' : 'Edit Product'}</h1>
            <p className="text-sm text-gray-500">{isNew ? 'Create a new catalog product' : p.name}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <select value={p.status} onChange={(e) => set('status', e.target.value as CatalogProduct['status'])} className={`${I} w-auto`} aria-label="Product status">
            <option value="draft">Draft</option>
            <option value="ready">Ready</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2">
            <FloppyDisk size={16} />{saving ? 'Saving…' : 'Save Product'}
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 px-3.5 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${tab === t.id ? 'bg-blue-500 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-5">
        {/* ── GENERAL ── */}
        {tab === 'general' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><label className={L}>Product name *</label><input value={p.name} onChange={(e) => set('name', e.target.value)} className={I} placeholder="e.g. Interactive Squeaky Enrichment Toy for Dogs" /></div>
            <div><label className={L}>Short title (optional)</label><input value={p.shortTitle || ''} onChange={(e) => set('shortTitle', e.target.value)} className={I} /></div>
            <div><label className={L}>Subtitle (optional)</label><input value={p.subtitle || ''} onChange={(e) => set('subtitle', e.target.value)} className={I} /></div>
            <div className="sm:col-span-2"><label className={L}>Short description</label><textarea value={p.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} rows={2} className={I} /></div>
            <div className="sm:col-span-2"><label className={L}>Description</label><textarea value={p.description} onChange={(e) => set('description', e.target.value)} rows={6} className={I} placeholder="Concise opening benefit, key features, practical use, sizing, care. No fake claims." /></div>
            <div><label className={L}>Category</label>
              <select value={p.categoryId || ''} onChange={(e) => set('categoryId', e.target.value || null)} className={I}>
                <option value="">— Uncategorized —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className={L}>Brand</label><input value={p.brand} onChange={(e) => set('brand', e.target.value)} className={I} /></div>
            <div className="sm:col-span-2">
              <label className={L}>Tags</label>
              <div className="flex flex-wrap gap-1.5 items-center">
                {p.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">{t}<button onClick={() => removeTag(t)}><X size={11} /></button></span>
                ))}
                <input
                  className="flex-1 min-w-[140px] px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none"
                  placeholder="Add tag + Enter"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }}
                />
              </div>
            </div>
            <div className="sm:col-span-2"><label className={L}>Owner notes (admin only)</label><textarea value={p.ownerNotes || ''} onChange={(e) => set('ownerNotes', e.target.value)} rows={2} className={I} /></div>
          </div>
        )}

        {/* ── PRICING ── */}
        {tab === 'pricing' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className={L}>Supplier cost (USD)</label><input type="number" min="0" step="0.01" value={p.costPrice || ''} onChange={(e) => set('costPrice', +e.target.value)} className={I} /></div>
            <div><label className={L}>Landed cost (USD) — freight verified</label><input type="number" min="0" step="0.01" value={p.landedCost || ''} onChange={(e) => set('landedCost', +e.target.value)} className={I} /></div>
            <div><label className={L}>Retail price (USD) *</label><input type="number" min="0" step="0.01" value={p.price || ''} onChange={(e) => set('price', +e.target.value)} className={I} /></div>
            <div><label className={L}>Compare-at price (USD) — genuine promo value only</label><input type="number" min="0" step="0.01" value={p.compareAtPrice || ''} onChange={(e) => set('compareAtPrice', +e.target.value)} className={I} /></div>
            <div className="sm:col-span-2 bg-gray-50 rounded-lg p-4 text-sm">
              <p className="font-semibold mb-1">Margin check</p>
              {p.costPrice > 0 && p.price > 0
                ? <p className="text-gray-600">Est. margin {(100 - (p.costPrice / p.price) * 100).toFixed(1)}% (landed cost {p.landedCost > 0 ? `$${p.landedCost.toFixed(2)}` : 'unknown'}). {p.landedCost <= 0 ? <span className="text-amber-600">Flag: landed cost unknown — verify freight before final publishing.</span> : null}</p>
                : <p className="text-gray-400">Enter a cost and price to see estimated margin.</p>}
            </div>
          </div>
        )}

        {/* ── INVENTORY ── */}
        {tab === 'inventory' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className={L}>SKU</label><input value={p.sku} onChange={(e) => set('sku', e.target.value)} className={I} /></div>
            <div><label className={L}>Stock quantity</label><input type="number" min="0" value={p.inventoryQty} onChange={(e) => set('inventoryQty', +e.target.value)} className={I} /></div>
            <div><label className={L}>Stock status</label>
              <select value={p.stockStatus} onChange={(e) => set('stockStatus', e.target.value as CatalogProduct['stockStatus'])} className={I}>
                <option value="in_stock">In stock</option>
                <option value="low_stock">Low stock</option>
                <option value="out_of_stock">Out of stock</option>
                <option value="on_backorder">On backorder</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div><label className={L}>Low stock threshold</label><input type="number" min="0" value={p.lowStockThreshold} onChange={(e) => set('lowStockThreshold', +e.target.value)} className={I} /></div>
            <div className="sm:col-span-2 flex items-center gap-2 pt-1">
              <input id="us-inv" type="checkbox" checked={p.usInventory} onChange={(e) => set('usInventory', e.target.checked)} className="w-4 h-4" />
              <label htmlFor="us-inv" className="text-sm text-gray-600">USA inventory verified (real warehouse evidence)</label>
            </div>
          </div>
        )}

        {/* ── SHIPPING ── */}
        {tab === 'shipping' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className={L}>Shipping cost (USD)</label><input type="number" min="0" step="0.01" value={p.shippingCost || ''} onChange={(e) => set('shippingCost', +e.target.value)} className={I} /></div>
            <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-gray-600 pb-2"><input type="checkbox" checked={p.freeShipping} onChange={(e) => set('freeShipping', e.target.checked)} className="w-4 h-4" />Free shipping on this product</label></div>
            <div><label className={L}>Delivery min days</label><input type="number" min="0" value={p.deliveryMinDays ?? ''} onChange={(e) => set('deliveryMinDays', e.target.value ? +e.target.value : null)} className={I} /></div>
            <div><label className={L}>Delivery max days</label><input type="number" min="0" value={p.deliveryMaxDays ?? ''} onChange={(e) => set('deliveryMaxDays', e.target.value ? +e.target.value : null)} className={I} /></div>
            <div className="sm:col-span-2"><label className={L}>Shipping note (truthful)</label><input value={p.shippingNote || ''} onChange={(e) => set('shippingNote', e.target.value)} className={I} placeholder="e.g. Ships from a US warehouse via tracked carrier." /></div>
            <div className="sm:col-span-2"><label className={L}>Supplier / source reference</label><input value={p.supplierSource || ''} onChange={(e) => set('supplierSource', e.target.value)} className={I} placeholder="e.g. CJ — product id" /></div>
          </div>
        )}

        {/* ── IMAGES ── */}
        {tab === 'images' && <ImageManager product={p} onProduct={(next) => setP(next)} />}

        {/* ── VARIANTS ── */}
        {tab === 'variants' && <VariantManager product={p} onProduct={(next) => setP(next)} />}

        {/* ── SEO ── */}
        {tab === 'seo' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><label className={L}>SEO title</label><input value={p.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} className={I} /></div>
            <div className="sm:col-span-2"><label className={L}>Meta description</label><textarea value={p.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} rows={3} className={I} /></div>
            <div className="sm:col-span-2">
              <label className={L}>SEO keywords</label>
              <div className="flex flex-wrap gap-1.5 items-center">
                {p.seoKeywords.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">{k}<button onClick={() => set('seoKeywords', p.seoKeywords.filter((x) => x !== k))}><X size={11} /></button></span>
                ))}
                <input
                  className="flex-1 min-w-[140px] px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none"
                  placeholder="Add keyword + Enter"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v) set('seoKeywords', [...p.seoKeywords, v]); (e.target as HTMLInputElement).value = ''; } }}
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-xs font-bold text-blue-800 mb-2 flex items-center gap-1.5"><Globe size={13} />Live SEO preview (deterministic — no fake data)</p>
                <p className="text-sm font-semibold text-blue-900">{meta.title}</p>
                <p className="text-xs text-gray-500">{meta.canonical}</p>
                <p className="text-xs text-gray-600 mt-1">{meta.description}</p>
                <details className="mt-2"><summary className="text-xs text-blue-700 cursor-pointer">Product JSON-LD</summary><pre className="mt-1 text-[10px] bg-white rounded p-2 overflow-auto max-h-40">{JSON.stringify(jsonLd, null, 1)}</pre></details>
              </div>
            </div>
          </div>
        )}

        {/* ── PROMOTIONS ── */}
        {tab === 'promotions' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className={L}>Sale enabled</label>
                <div className="flex items-center gap-2">
                  <input id="sale-on" type="checkbox" checked={p.saleEnabled} onChange={(e) => set('saleEnabled', e.target.checked)} className="w-4 h-4" />
                  <label htmlFor="sale-on" className="text-sm text-gray-600">Apply a store discount to this product</label>
                </div>
              </div>
              <div><label className={L}>Discount type</label>
                <select value={p.discountType || 'percent'} onChange={(e) => set('discountType', e.target.value as CatalogProduct['discountType'])} className={I}>
                  <option value="percent">Percentage (%)</option>
                  <option value="fixed">Fixed amount ($)</option>
                </select>
              </div>
              <div><label className={L}>Discount value</label><input type="number" min="0" step="0.01" value={p.discountValue ?? ''} onChange={(e) => set('discountValue', e.target.value ? +e.target.value : undefined)} className={I} /></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {([
                ['featured', 'Featured', 'Show in featured/top-picks sections'],
                ['newArrival', 'New arrival', 'Show in New Arrivals section'],
                ['promoted', 'Promoted', 'Highlight in promotions'],
              ] as const).map(([key, label, hint]) => (
                <label key={key} className="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={Boolean(p[key])} onChange={(e) => set(key, e.target.checked)} className="w-4 h-4 mt-0.5" />
                  <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-gray-400">{hint}</span></span>
                </label>
              ))}
              {([
                ['trending', 'Trending', 'Only with real evidence or an explicit owner merchandising decision'],
                ['bestRated', 'Best rated', 'Only with verified customer ratings'],
                ['bestSeller', 'Best seller', 'Only with verified sales evidence'],
              ] as const).map(([key, label, hint]) => (
                <label key={key} className="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={Boolean(p[key])} onChange={(e) => set(key, e.target.checked)} className="w-4 h-4 mt-0.5" />
                  <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-amber-600">{hint}</span></span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// IMAGE MANAGER
// ============================================================================
function ImageManager({ product, onProduct }: { product: CatalogProduct; onProduct: (p: CatalogProduct) => void }) {
  const { notify } = useApp();
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');

  const addByUrl = () => {
    const u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) { notify('Enter a valid image URL (https://…)', 'error'); return; }
    const isFirst = product.images.length === 0;
    onProduct({ ...product, images: [...product.images, { id: uid(), productId: product.id, url: u, altText: alt.trim(), kind: 'product', isPrimary: isFirst, sortOrder: product.images.length, variantId: null }] });
    setUrl(''); setAlt('');
    notify('Image added — save the product to persist');
  };

  const move = (idx: number, dir: -1 | 1) => {
    const imgs = [...product.images];
    const to = idx + dir;
    if (to < 0 || to >= imgs.length) return;
    [imgs[idx], imgs[to]] = [imgs[to], imgs[idx]];
    onProduct({ ...product, images: imgs });
  };

  const setPrimary = (idx: number) => {
    onProduct({ ...product, images: product.images.map((img, i) => ({ ...img, isPrimary: i === idx })) });
  };

  const remove = (idx: number) => {
    const removed = product.images[idx];
    let imgs = product.images.filter((_, i) => i !== idx);
    if (removed?.isPrimary && imgs.length > 0 && !imgs.some((i) => i.isPrimary)) {
      imgs = imgs.map((img, i) => ({ ...img, isPrimary: i === 0 }));
    }
    onProduct({ ...product, images: imgs });
  };

  const update = (idx: number, patch: Partial<CatalogImage>) => {
    onProduct({ ...product, images: product.images.map((img, i) => (i === idx ? { ...img, ...patch } : img)) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[220px]"><label className={L}>Image URL (https)</label><input value={url} onChange={(e) => setUrl(e.target.value)} className={I} placeholder="https://…/product.jpg" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addByUrl(); } }} /></div>
        <div className="flex-1 min-w-[160px]"><label className={L}>Alt text</label><input value={alt} onChange={(e) => setAlt(e.target.value)} className={I} /></div>
        <button onClick={addByUrl} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1.5"><Plus size={15} />Add image</button>
      </div>
      <p className="text-xs text-gray-400">Only legitimate supplier/product imagery. Products without acceptable imagery must not be activated as premium listings.</p>

      <div className="space-y-3">
        {product.images.map((img, idx) => (
          <div key={img.id || idx} className="flex gap-3 p-3 border rounded-xl items-start">
            <img src={img.url} alt={img.altText || img.url} className="w-20 h-20 rounded-lg object-cover bg-gray-100" onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.25'; }} />
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <input value={img.altText} onChange={(e) => update(idx, { altText: e.target.value })} className={`${I} flex-1 min-w-[160px]`} placeholder="Alt text" />
                <button onClick={() => setPrimary(idx)} className={`px-2.5 py-1.5 rounded text-xs font-semibold ${img.isPrimary ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {img.isPrimary ? '✓ Primary' : 'Set primary'}
                </button>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"><CaretUp size={15} /></button>
                <button onClick={() => move(idx, 1)} disabled={idx === product.images.length - 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"><CaretDown size={15} /></button>
                <button onClick={() => remove(idx)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash size={15} /></button>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={img.variantId || ''}
                  onChange={(e) => update(idx, { variantId: e.target.value || null })}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-lg"
                  aria-label="Variant image link">
                  <option value="">No variant link</option>
                  {product.variants.map((v) => (
                    <option key={v.id} value={v.id}>{Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(' · ') || v.sku || v.id}</option>
                  ))}
                </select>
                <select
                  value={img.kind}
                  onChange={(e) => update(idx, { kind: e.target.value as CatalogImage['kind'] })}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-lg"
                  aria-label="Image kind">
                  <option value="product">Product</option>
                  <option value="lifestyle">Lifestyle</option>
                  <option value="creative">Creative</option>
                  <option value="video">Video</option>
                </select>
              </div>
            </div>
          </div>
        ))}
        {product.images.length === 0 && (
          <div className="text-center py-10 text-gray-400 border border-dashed rounded-xl"><ImageIcon size={28} className="mx-auto mb-2 text-gray-300" />No images yet — add at least one.</div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// VARIANT MANAGER
// ============================================================================
function VariantManager({ product, onProduct }: { product: CatalogProduct; onProduct: (p: CatalogProduct) => void }) {
  const { notify } = useApp();
  const [v, setV] = useState<{ color: string; size: string; sku: string; price: string; qty: string }>({ color: '', size: '', sku: '', price: '', qty: '' });

  const add = () => {
    if (!v.color && !v.size) { notify('Enter a color or size', 'error'); return; }
    const attributes: Record<string, string> = {};
    if (v.color.trim()) attributes.color = v.color.trim();
    if (v.size.trim()) attributes.size = v.size.trim();
    onProduct({ ...product, variants: [...product.variants, { id: uid(), productId: product.id, attributes, sku: v.sku.trim(), price: v.price ? +v.price : product.price, compareAtPrice: null, costPrice: null, inventoryQty: v.qty ? +v.qty : 0, status: 'active', lowStockThreshold: 0 }] });
    setV({ color: '', size: '', sku: '', price: '', qty: '' });
  };

  const update = (vid: string, patch: Partial<CatalogVariant>) => {
    onProduct({ ...product, variants: product.variants.map((x) => (x.id === vid ? { ...x, ...patch } : x)) });
  };
  const remove = (vid: string) => {
    onProduct({ ...product, variants: product.variants.filter((x) => x.id !== vid) });
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap gap-2 items-end">
        <div><label className={L}>Color</label><input value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} className={I} placeholder="Gray" /></div>
        <div><label className={L}>Size</label><input value={v.size} onChange={(e) => setV({ ...v, size: e.target.value })} className={I} placeholder="Large" /></div>
        <div><label className={L}>SKU</label><input value={v.sku} onChange={(e) => setV({ ...v, sku: e.target.value })} className={I} /></div>
        <div><label className={L}>Price</label><input type="number" step="0.01" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} className={I} placeholder={String(product.price)} /></div>
        <div><label className={L}>Stock</label><input type="number" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} className={I} /></div>
        <button onClick={add} className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1.5"><Plus size={15} />Add variant</button>
      </div>
      <p className="text-xs text-gray-400">Only genuine variant options. Assign a variant image in the Images tab — never guess a variant→image link.</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase"><th className="px-3 py-2">Options</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Compare</th><th className="px-3 py-2">Stock</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {product.variants.map((x) => (
              <tr key={x.id} className="border-t">
                <td className="px-3 py-2">{Object.entries(x.attributes).map(([k, val]) => <span key={k} className="mr-2"><span className="text-gray-400">{k}:</span> {val}</span>)}</td>
                <td className="px-3 py-2"><input value={x.sku} onChange={(e) => update(x.id, { sku: e.target.value })} className="px-2 py-1 border rounded text-xs" /></td>
                <td className="px-3 py-2"><input type="number" step="0.01" value={x.price ?? ''} onChange={(e) => update(x.id, { price: e.target.value ? +e.target.value : null })} className="px-2 py-1 border rounded text-xs w-20" /></td>
                <td className="px-3 py-2"><input type="number" step="0.01" value={x.compareAtPrice ?? ''} onChange={(e) => update(x.id, { compareAtPrice: e.target.value ? +e.target.value : null })} className="px-2 py-1 border rounded text-xs w-20" /></td>
                <td className="px-3 py-2"><input type="number" value={x.inventoryQty} onChange={(e) => update(x.id, { inventoryQty: +e.target.value })} className="px-2 py-1 border rounded text-xs w-20" /></td>
                <td className="px-3 py-2"><button onClick={() => remove(x.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash size={14} /></button></td>
              </tr>
            ))}
            {product.variants.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No variants — sold as one option.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// PROMOTIONS (coupons + offers + free shipping)
// ============================================================================
export function CatalogPromotionsPage() {
  useDbToken();
  const { notify } = useApp();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [offers, setOffers] = useState<StoreOffer[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [couponModal, setCouponModal] = useState<Coupon | 'new' | null>(null);
  const [offerModal, setOfferModal] = useState<StoreOffer | 'new' | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cs, os, ss, ps] = await Promise.all([listCoupons(), listOffers(), getStoreSettings(), listProducts()]);
      setCoupons(cs); setOffers(os); setSettings(ss); setProducts(ps);
    } catch (e) {
      notify(`Could not load promotions: ${(e as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const saveSettings = async () => {
    if (!settings) return;
    try {
      await saveStoreSettings(settings);
      notify('Free-shipping settings saved');
    } catch (e) {
      notify(`Could not save: ${(e as Error).message}`, 'error');
    }
  };

  const onDeleteCoupon = async (id: string) => {
    try { await deleteCoupon(id); notify('Coupon deleted'); await load(); } catch (e) { notify(`Could not delete: ${(e as Error).message}`, 'error'); }
  };
  const onDeleteOffer = async (id: string) => {
    try { await deleteOffer(id); notify('Offer deleted'); await load(); } catch (e) { notify(`Could not delete: ${(e as Error).message}`, 'error'); }
  };

  if (loading) return <div className="text-center py-20 text-gray-400">Loading promotions…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Promotions</h1><p className="text-sm text-gray-500">Coupons, store offers and free-shipping rules — all editable, no fake urgency.</p></div>
        <div className="flex gap-2">
          <button onClick={() => setCouponModal('new')} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />Coupon</button>
          <button onClick={() => setOfferModal('new')} className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded-lg flex items-center gap-2"><Megaphone size={16} />Offer</button>
        </div>
      </div>

      {/* Free shipping strategy */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Truck size={16} className="text-blue-600" />Free Shipping Strategy</h2>
        {settings && (
          <div className="flex flex-wrap gap-4 items-end">
            <label className="flex items-center gap-2 text-sm text-gray-600 pb-2"><input type="checkbox" checked={settings.freeShippingEnabled} onChange={(e) => setSettings({ ...settings, freeShippingEnabled: e.target.checked })} className="w-4 h-4" />Enable free shipping</label>
            <div><label className={L}>Cart minimum ($)</label><input type="number" min="0" step="0.01" value={settings.freeShippingThreshold} onChange={(e) => setSettings({ ...settings, freeShippingThreshold: +e.target.value })} className={`${I} w-32`} /></div>
            <button onClick={saveSettings} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm">Save rule</button>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">Storewide threshold + per-product free-shipping flags (set on each product). This is a business rule, not a supplier shipping claim.</p>
      </div>

      {/* Coupons */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">Coupons</h2>
          <span className="text-xs text-gray-400">{coupons.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 uppercase"><th className="px-5 py-3">Code</th><th className="px-5 py-3">Discount</th><th className="px-5 py-3">Min cart</th><th className="px-5 py-3">Window</th><th className="px-5 py-3">Usage</th><th className="px-5 py-3">Status</th><th className="px-5 py-3"></th></tr></thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id} className="border-t hover:bg-gray-50">
                  <td className="px-5 py-3"><span className="font-mono font-semibold">{c.code}</span><div className="text-xs text-gray-400">{c.description || ''}</div></td>
                  <td className="px-5 py-3">{c.discountType === 'percent' ? `${c.discountValue}%` : `$${c.discountValue.toFixed(2)}`}</td>
                  <td className="px-5 py-3">${c.minCartValue.toFixed(2)}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{c.startAt ? new Date(c.startAt).toLocaleDateString() : '—'} → {c.endAt ? new Date(c.endAt).toLocaleDateString() : 'open'}</td>
                  <td className="px-5 py-3 text-xs">{c.usageLimit != null ? `${c.usedCount}/${c.usageLimit}` : `${c.usedCount}`}</td>
                  <td className="px-5 py-3"><StatusBadge status={c.isActive ? 'active' : 'inactive'} /></td>
                  <td className="px-5 py-3 flex gap-1">
                    <button onClick={() => setCouponModal(c)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><PencilSimple size={15} /></button>
                    <button onClick={() => onDeleteCoupon(c.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash size={15} /></button>
                  </td>
                </tr>
              ))}
              {coupons.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">No coupons yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Offers */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">Store Offers</h2>
          <span className="text-xs text-gray-400">{offers.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 uppercase"><th className="px-5 py-3">Name</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Value</th><th className="px-5 py-3">Scope</th><th className="px-5 py-3">Status</th><th className="px-5 py-3"></th></tr></thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} className="border-t hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">{o.name}</td>
                  <td className="px-5 py-3 text-xs">{o.offerType.replace('_', ' ')}</td>
                  <td className="px-5 py-3">{o.value != null ? (o.offerType === 'percentage' ? `${o.value}%` : `$${o.value.toFixed(2)}`) : '—'}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{o.productIds.length} products · {o.categoryIds.length} categories</td>
                  <td className="px-5 py-3"><StatusBadge status={o.isActive ? 'active' : 'inactive'} /></td>
                  <td className="px-5 py-3 flex gap-1">
                    <button onClick={() => setOfferModal(o)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><PencilSimple size={15} /></button>
                    <button onClick={() => onDeleteOffer(o.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash size={15} /></button>
                  </td>
                </tr>
              ))}
              {offers.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">No store offers yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <FeedPanel products={products} />

      <CouponModal coupon={couponModal} onClose={() => setCouponModal(null)} onSaved={load} />
      <OfferModal offer={offerModal} products={products} onClose={() => setOfferModal(null)} onSaved={load} />
    </div>
  );
}

function FeedPanel({ products }: { products: CatalogProduct[] }) {
  const { notify } = useApp();
  const active = products.filter((p) => p.status === 'active');
  const download = () => {
    const csv = buildFeedCsv(active);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'luxedge-merchant-feed.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    notify('Feed CSV downloaded (data only — nothing submitted externally)');
  };
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><GearSix size={16} className="text-blue-600" />Ads / Feed Readiness</h2>
          <p className="text-xs text-gray-500 mt-1">Merchant Center / Meta / Pinterest-ready rows for {active.length} ACTIVE products. No campaign, no billing, no submission — data only.</p>
        </div>
        <button onClick={download} className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-sm flex items-center gap-2"><Download size={15} />Download feed CSV</button>
      </div>
    </div>
  );
}

function CouponModal({ coupon, onClose, onSaved }: { coupon: Coupon | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useApp();
  const [f, setF] = useState(() => ({
    code: coupon !== 'new' && coupon ? coupon.code : '',
    description: coupon !== 'new' && coupon ? coupon.description || '' : '',
    discountType: coupon !== 'new' && coupon ? coupon.discountType : 'percent' as 'percent' | 'fixed',
    discountValue: coupon !== 'new' && coupon ? coupon.discountValue : 10,
    minCartValue: coupon !== 'new' && coupon ? coupon.minCartValue : 0,
    usageLimit: coupon !== 'new' && coupon && coupon.usageLimit != null ? coupon.usageLimit : null,
    isActive: coupon !== 'new' && coupon ? coupon.isActive : true,
  }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setF({
      code: coupon !== 'new' && coupon ? coupon.code : '',
      description: coupon !== 'new' && coupon ? coupon.description || '' : '',
      discountType: coupon !== 'new' && coupon ? coupon.discountType : 'percent',
      discountValue: coupon !== 'new' && coupon ? coupon.discountValue : 10,
      minCartValue: coupon !== 'new' && coupon ? coupon.minCartValue : 0,
      usageLimit: coupon !== 'new' && coupon && coupon.usageLimit != null ? coupon.usageLimit : null,
      isActive: coupon !== 'new' && coupon ? coupon.isActive : true,
    });
  }, [coupon]);

  const save = async () => {
    if (!f.code.trim()) { notify('Code required', 'error'); return; }
    if (!(f.discountValue > 0)) { notify('Discount value must be > 0', 'error'); return; }
    setSaving(true);
    try {
      const input = { code: f.code, description: f.description, discountType: f.discountType, discountValue: f.discountValue, minCartValue: f.minCartValue, usageLimit: f.usageLimit, isActive: f.isActive };
      if (coupon === 'new') await createCoupon(input); else if (coupon) await updateCoupon(coupon.id, input);
      notify('Coupon saved');
      onClose(); onSaved();
    } catch (e) {
      notify(`Could not save coupon: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!coupon} onClose={onClose} title={coupon === 'new' ? 'New Coupon' : 'Edit Coupon'}>
      <div className="space-y-4 px-6 pb-6">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={L}>Code</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} className={I} placeholder="WELCOME10" /></div>
          <div><label className={L}>Description</label><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={I} placeholder="10% first-order promotion" /></div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className={L}>Type</label>
            <select value={f.discountType} onChange={(e) => setF({ ...f, discountType: e.target.value as 'percent' | 'fixed' })} className={I}>
              <option value="percent">Percentage</option><option value="fixed">Fixed ($)</option>
            </select>
          </div>
          <div><label className={L}>Value</label><input type="number" min="0" step="0.01" value={f.discountValue} onChange={(e) => setF({ ...f, discountValue: +e.target.value })} className={I} /></div>
          <div><label className={L}>Min cart ($)</label><input type="number" min="0" step="0.01" value={f.minCartValue} onChange={(e) => setF({ ...f, minCartValue: +e.target.value })} className={I} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={L}>Usage limit (blank = unlimited)</label><input type="number" min="0" value={f.usageLimit ?? ''} onChange={(e) => setF({ ...f, usageLimit: e.target.value ? +e.target.value : null })} className={I} /></div>
          <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-gray-600 pb-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="w-4 h-4" />Active</label></div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg font-medium">{saving ? 'Saving…' : 'Save coupon'}</button>
          <button onClick={onClose} className="flex-1 py-2.5 border rounded-lg">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function OfferModal({ offer, products, onClose, onSaved }: { offer: StoreOffer | 'new' | null; products: CatalogProduct[]; onClose: () => void; onSaved: () => void }) {
  const { notify } = useApp();
  const [f, setF] = useState(() => ({
    name: offer !== 'new' && offer ? offer.name : '',
    offerType: offer !== 'new' && offer ? offer.offerType : 'percentage' as StoreOffer['offerType'],
    value: offer !== 'new' && offer && offer.value != null ? String(offer.value) : '',
    productIds: offer !== 'new' && offer ? offer.productIds : [] as string[],
    categoryIds: offer !== 'new' && offer ? offer.categoryIds : [] as string[],
    isActive: offer !== 'new' && offer ? offer.isActive : true,
  }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setF({
      name: offer !== 'new' && offer ? offer.name : '',
      offerType: offer !== 'new' && offer ? offer.offerType : 'percentage',
      value: offer !== 'new' && offer && offer.value != null ? String(offer.value) : '',
      productIds: offer !== 'new' && offer ? offer.productIds : [],
      categoryIds: offer !== 'new' && offer ? offer.categoryIds : [],
      isActive: offer !== 'new' && offer ? offer.isActive : true,
    });
  }, [offer]);

  const toggle = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = async () => {
    if (!f.name.trim()) { notify('Offer name required', 'error'); return; }
    setSaving(true);
    try {
      const input = {
        name: f.name, offerType: f.offerType, value: f.value ? +f.value : null,
        productIds: f.productIds, categoryIds: f.categoryIds, isActive: f.isActive,
      };
      if (offer === 'new') await createOffer(input); else if (offer) await updateOffer(offer.id, input);
      notify('Offer saved');
      onClose(); onSaved();
    } catch (e) {
      notify(`Could not save offer: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!offer} onClose={onClose} title={offer === 'new' ? 'New Offer' : 'Edit Offer'} size="lg">
      <div className="space-y-4 px-6 pb-6">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={L}>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={I} placeholder="Free Shipping Week" /></div>
          <div><label className={L}>Type</label>
            <select value={f.offerType} onChange={(e) => setF({ ...f, offerType: e.target.value as StoreOffer['offerType'] })} className={I}>
              <option value="percentage">Percentage sale</option>
              <option value="product_sale">Product sale</option>
              <option value="category_sale">Category sale</option>
              <option value="free_shipping">Free shipping</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={L}>Value ({f.offerType === 'percentage' ? '%' : '$'})</label><input type="number" min="0" step="0.01" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} className={I} /></div>
          <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-gray-600 pb-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="w-4 h-4" />Active</label></div>
        </div>
        {(f.offerType === 'product_sale' || f.offerType === 'category_sale') && (
          <div>
            <label className={L}>Scope</label>
            <div className="border rounded-lg max-h-40 overflow-y-auto p-2 grid sm:grid-cols-2 gap-1">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded px-2 py-1">
                  <input type="checkbox" checked={f.productIds.includes(p.id)} onChange={() => setF({ ...f, productIds: toggle(f.productIds, p.id) })} className="w-3.5 h-3.5" />
                  {p.name}
                </label>
              ))}
              {products.length === 0 && <span className="text-xs text-gray-400 p-2">No products yet.</span>}
            </div>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg font-medium">{saving ? 'Saving…' : 'Save offer'}</button>
          <button onClick={onClose} className="flex-1 py-2.5 border rounded-lg">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
