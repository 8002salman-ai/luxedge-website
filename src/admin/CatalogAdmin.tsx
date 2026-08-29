// ============================================================================
// LUXEDGE V2 — CATALOG ADMIN (Catalog Launch Phase)
//
// DB-backed product management + promotions for the admin. Replaces the old
// in-memory demo products panel. Everything persists through the catalog
// repository (admin JWT → Supabase RLS). No fake facts: UNKNOWN stays
// UNKNOWN, merchandising flags are admin decisions, delete prefers archive.
// ============================================================================
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, PencilSimple, Trash, ArrowLeft, Copy, Eye, ToggleRight, ToggleLeft,
  MagnifyingGlass, FloppyDisk, Image as ImageIcon, Stack, Tag, Globe, Truck, Package, CurrencyDollar,
  GearSix, X, Download, List, Megaphone, Warning, Brain, UploadSimple, Sparkle, CaretDown, ArrowSquareOut,
} from '@phosphor-icons/react';
import Modal from '../components/common/Modal';
import { useApp } from '../App';
import { getAccessToken, getFreshAccessToken } from '../services/supabase';
import {
  setDbToken, listProducts, getProduct, createProduct, updateProduct, setProductStatus,
  archiveProduct, hardDeleteProduct, duplicateProduct, saveProductImages, saveProductVariants,
  createCategory,
  listCategories, listCoupons, createCoupon, updateCoupon, deleteCoupon,
  listOffers, createOffer, updateOffer, deleteOffer, getStoreSettings, saveStoreSettings,
  uid,
  type ProductInput,
} from '../features/catalog/repository';
import { listRecommendations } from '../features/hermes/repository';
import type { HermesRecommendationRow } from '../features/hermes/types';
import {
  type CatalogProduct, type CatalogCategory, type CatalogImage, type CatalogVariant, type Coupon, type StoreOffer, type StoreSettings,
  speciesOf,
} from '../features/catalog/types';
import { buildFeedCsv, buildProductJsonLd, buildProductMeta } from '../features/catalog/seo';
import {
  COMMERCE_READINESS_LABELS, SOURCE_TYPE_LABELS, INVENTORY_SOURCE_LABELS,
  type CommerceReadiness,
} from '../features/catalog/commerceReadiness';
import { callAIProvider } from '../features/ai/client';
import { loadAIProviders, loadProviderSettings, resolveProviderChain } from '../features/ai/providers';
import { parseHtmlPage } from '../features/ai/importer';
import { AIImportPanel } from './AIImportPanel';
import {
  parseCsvImport, classifyDuplicates,
  type CsvImportRow, type DuplicateMatch, type DupCandidate,
} from '../features/catalog/csvImport';

const I = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
const BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  ready: 'bg-blue-100 text-blue-700',
  draft: 'bg-gray-100 text-gray-600',
  inactive: 'bg-amber-100 text-amber-700',
  archived: 'bg-red-100 text-red-600',
};

const READINESS_BADGE: Record<CommerceReadiness, string> = {
  COMMERCE_READY: 'bg-green-100 text-green-700',
  SOURCE_PENDING: 'bg-red-100 text-red-600',
  ECONOMICS_PENDING: 'bg-orange-100 text-orange-700',
  FULFILLMENT_PENDING: 'bg-amber-100 text-amber-700',
  RISK_REVIEW: 'bg-purple-100 text-purple-700',
  DRAFT: 'bg-gray-100 text-gray-600',
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${BADGE[status] || BADGE.draft}`}>{status}</span>;
}

function ReadinessBadge({ readiness }: { readiness?: CommerceReadiness | null }) {
  if (!readiness) return <span className="text-xs text-gray-300">—</span>;
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${READINESS_BADGE[readiness] || BADGE.draft}`}>{COMMERCE_READINESS_LABELS[readiness] || readiness}</span>;
}

function useDbToken() {
  useEffect(() => {
    // Refresh first so a long-open admin session never writes with a stale
    // (expired) JWT — getFreshAccessToken refreshes when near/at expiry.
    void getFreshAccessToken().then((t) => setDbToken(t));
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
  const [fReady, setFReady] = useState('all');
  const [fSource, setFSource] = useState('all');
  const [fSpecies, setFSpecies] = useState('all');
  const [fImage, setFImage] = useState('all');
  const [delId, setDelId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);

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

  // "All statuses" hides archived rows — archive is a folder, not a status
  // you keep scrolling past. Archived products are only visible when the
  // user explicitly picks the "Archived" filter (or clicks the chip).
  const filtered = useMemo(() => products.filter((p) => {
    if (fStatus === 'all' && p.status === 'archived') return false;
    if (fStatus !== 'all' && p.status !== fStatus) return false;
    if (fCat !== 'all' && p.categoryId !== fCat) return false;
    if (fReady !== 'all' && (p.commerceReadiness ?? null) !== (fReady === 'none' ? null : fReady)) return false;
    if (fSource !== 'all') {
      const src = (p.supplierSource || '').toLowerCase();
      const st = p.sourceType || null;
      if (fSource === 'kong' && !(/kong/.test(src) || st === 'RETAIL_REFERENCE_ONLY')) return false;
      if (fSource === 'cj' && !(/cj/.test(src) || st === 'CJ_DROPSHIPPING')) return false;
      if (fSource === 'other' && (/kong/.test(src) || /cj/.test(src))) return false;
      if (fSource === 'unknown' && (src || st)) return false;
      if (fSource === 'cost-unknown' && (p.costPrice > 0 || p.landedCost > 0)) return false;
      if (fSource === 'shipping-unknown' && !(p.shippingCost > 0 || p.freeShipping)) return false;
      if (fSource === 'low-margin' && !(p.costPrice > 0 && p.marginPercent != null && p.marginPercent < 40)) return false;
      if (fSource === 'stock-unknown' && !(p.stockStatus === 'unknown' || p.stockStatus == null)) return false;
    }
    if (fFlag === 'featured' && !p.featured) return false;
    if (fFlag === 'new' && !p.newArrival) return false;
    if (fFlag === 'sale' && !(p.compareAtPrice > p.price)) return false;
    if (fFlag === 'free-shipping' && !p.freeShipping) return false;
    if (fFlag === 'low-stock' && !(p.inventoryQty <= p.lowStockThreshold)) return false;
    if (fSpecies !== 'all' && speciesOf(p) !== fSpecies) return false;
    if (fImage === 'no-image' && p.images.length > 0) return false;
    if (fImage === 'has-image' && p.images.length === 0) return false;
    if (fImage === 'single-image' && p.images.length <= 1) return false;
    if (q) {
      const needle = q.toLowerCase();
      return [p.name, p.brand, p.sku, p.categoryName, ...p.tags].join(' ').toLowerCase().includes(needle);
    }
    return true;
  }), [products, fStatus, fCat, fFlag, fReady, fSource, fSpecies, fImage, q]);

  const toggleActive = async (p: CatalogProduct) => {
    try {
      const next = p.status === 'active' ? 'inactive' : 'active';
      await setProductStatus(p.id, next);
      notify(next === 'active' ? 'Product is now LIVE on the storefront' : 'Product set to Draft');
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

  const onRestore = async (id: string) => {
    try {
      await setProductStatus(id, 'draft');
      notify('Product restored to Draft');
      await load();
    } catch (e) {
      notify(`Could not restore: ${(e as Error).message}`, 'error');
    }
  };

  const nonActive = useMemo(() => filtered.filter((p) => p.status !== 'active'), [filtered]);
  const archivedCount = useMemo(() => products.filter((p) => p.status === 'archived').length, [products]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllNonActive = () => setSelectedIds(new Set(nonActive.map((p) => p.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const onBulkHardDelete = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      for (const id of ids) {
        await hardDeleteProduct(id);
      }
      notify(`${ids.length} product${ids.length === 1 ? '' : 's'} permanently deleted`);
      setSelectedIds(new Set());
      setBulkOpen(false);
      await load();
    } catch (e) {
      notify(`Bulk delete stopped: ${(e as Error).message}`, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const onBulkArchive = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      for (const id of ids) {
        await archiveProduct(id);
      }
      notify(`${ids.length} product${ids.length === 1 ? '' : 's'} archived`);
      setSelectedIds(new Set());
      setBulkOpen(false);
      await load();
    } catch (e) {
      notify(`Bulk archive stopped: ${(e as Error).message}`, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) return <div className="text-center py-20 text-gray-400">Loading catalog…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-gray-500">{products.length} products · {products.filter((p) => p.status === 'active' && p.commerceReadiness === 'COMMERCE_READY').length} commerce-ready on storefront · {products.filter((p) => p.status === 'active' && p.commerceReadiness !== 'COMMERCE_READY').length} active but not commerce-ready · {archivedCount} archived</p>
          {archivedCount > 0 && (
            <button
              onClick={() => setFStatus(fStatus === 'archived' ? 'all' : 'archived')}
              className={`mt-1 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${fStatus === 'archived' ? 'bg-red-50 text-red-700 border-red-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}
              title="Show or hide the archived folder"
            >
              {fStatus === 'archived' ? '← Back to all products' : `View archived folder (${archivedCount})`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-xs text-gray-500">{selectedIds.size} selected</span>
              <button onClick={clearSelection} className="px-3 py-2 border text-sm rounded-lg">Clear</button>
              <button onClick={() => setBulkOpen(true)} className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg flex items-center gap-2">
                <Trash size={16} />Delete Selected
              </button>
            </>
          ) : nonActive.length > 0 ? (
            <button onClick={selectAllNonActive} title="Select every Draft / Inactive / Archived product currently in view" className="px-3 py-2 border text-sm rounded-lg text-gray-600 hover:bg-gray-50">
              Select all Draft/Inactive ({nonActive.length})
            </button>
          ) : null}
          <button onClick={() => setCsvOpen(true)} title="Import products from a Zeedrop / supplier CSV — saved as drafts" className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm rounded-lg flex items-center gap-2">
            <UploadSimple size={16} />CSV Import
          </button>
          <button onClick={() => nav('/admin/products/new')} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2">
            <Plus size={16} />Add Product
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
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
        <select value={fReady} onChange={(e) => setFReady(e.target.value)} className={I} aria-label="Filter by commerce readiness">
          <option value="all">All readiness</option>
          <option value="COMMERCE_READY">Commerce Ready</option>
          <option value="SOURCE_PENDING">Source Pending</option>
          <option value="ECONOMICS_PENDING">Economics Pending</option>
          <option value="FULFILLMENT_PENDING">Fulfillment Pending</option>
          <option value="RISK_REVIEW">Risk Review</option>
          <option value="DRAFT">Draft</option>
          <option value="none">Unclassified</option>
        </select>
        <select value={fSource} onChange={(e) => setFSource(e.target.value)} className={I} aria-label="Filter by source / economics">
          <option value="all">All sources</option>
          <option value="kong">KONG</option>
          <option value="cj">CJ</option>
          <option value="other">Other source</option>
          <option value="unknown">Source unknown</option>
          <option value="cost-unknown">Cost unknown</option>
          <option value="shipping-unknown">Shipping unknown</option>
          <option value="low-margin">Low margin (&lt;40%)</option>
          <option value="stock-unknown">Stock unknown</option>
        </select>
        <select value={fSpecies} onChange={(e) => setFSpecies(e.target.value)} className={I} aria-label="Filter by species">
          <option value="all">All species</option>
          <option value="DOG">Dog</option>
          <option value="CAT">Cat</option>
          <option value="BOTH">Both</option>
        </select>
        <select value={fImage} onChange={(e) => setFImage(e.target.value)} className={I} aria-label="Filter by image status">
          <option value="all">All images</option>
          <option value="no-image">No images</option>
          <option value="has-image">Has image</option>
          <option value="single-image">Single image only</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px]">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 whitespace-nowrap">Product</th>
                <th className="px-4 py-3 whitespace-nowrap">Species / Category</th>
                <th className="px-4 py-3 whitespace-nowrap">Visible</th>
                <th className="px-4 py-3 whitespace-nowrap">Price</th>
                <th className="px-4 py-3 whitespace-nowrap">Cost</th>
                <th className="px-4 py-3 whitespace-nowrap">Margin</th>
                <th className="px-4 py-3 whitespace-nowrap">Stock</th>
                <th className="px-4 py-3 whitespace-nowrap">Readiness</th>
                <th className="px-4 py-3 whitespace-nowrap">Source</th>
                <th className="px-4 py-3 whitespace-nowrap">Flags</th>
                <th className="px-4 py-3 whitespace-nowrap">Status</th>
                <th className="px-4 py-3 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Select ${p.name}`} />
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <div className="flex items-center gap-3">
                      {p.images[0]
                        ? <img src={p.images[0].url} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 shrink-0" />
                        : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-300 shrink-0"><Package size={18} /></div>}
                      <button
                        type="button"
                        onClick={() => nav(`/admin/products/edit/${p.id}`)}
                        title={`Edit ${p.name}`}
                        className="min-w-0 text-left cursor-pointer group"
                      >
                        <p className="font-medium text-sm truncate group-hover:text-blue-600 group-hover:underline" title={p.name}>{p.name}</p>
                        <p className="text-xs text-gray-400 truncate">{p.brand}{p.sku ? ` · ${p.sku}` : ''}</p>
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <span className="font-semibold text-gray-600">{speciesOf(p) ?? '—'}</span>
                    <span className="text-gray-400"> · {p.categoryName || '—'}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {p.status === 'active' && p.commerceReadiness === 'COMMERCE_READY'
                      ? <a href={`/product/${p.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-600 hover:underline"><Eye size={12} /> LIVE</a>
                      : <span className="text-[10px] text-gray-400" title={p.status !== 'active' ? 'Not active' : p.commerceReadiness === 'COMMERCE_READY' ? '' : 'Active but not commerce-ready'}>{p.status !== 'active' ? `not active` : `active · ${p.commerceReadiness || 'unclassified'}`}</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="font-semibold text-sm">${p.price.toFixed(2)}</span>
                    {p.compareAtPrice > p.price && <span className="text-xs text-gray-400 line-through ml-1">${p.compareAtPrice.toFixed(2)}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{p.costPrice > 0 ? `$${p.costPrice.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {p.marginPercent != null
                      ? <span className={p.marginPercent < 40 ? 'text-red-600 font-semibold' : 'text-green-700 font-semibold'}>{p.marginPercent.toFixed(0)}%</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <span className={p.inventoryQty <= p.lowStockThreshold && p.lowStockThreshold > 0 ? 'text-red-600 font-semibold' : ''}>{p.inventoryQty}</span>
                    <span className="text-[10px] text-gray-400 ml-1">({INVENTORY_SOURCE_LABELS[p.inventorySource || 'UNKNOWN']})</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-gray-100 text-gray-600" title="Internal commerce readiness — only COMMERCE_READY listings appear on the storefront">{COMMERCE_READINESS_LABELS[p.commerceReadiness || 'DRAFT'] || 'Draft'}</span>
                      <select
                        value={p.status === 'active' ? 'live' : 'draft'}
                        onChange={(e) => void setProductStatus(p.id, e.target.value === 'live' ? 'active' : 'draft').then(() => {
                          notify(e.target.value === 'live' ? 'Product is now LIVE on the storefront' : 'Product set to Draft');
                          return load();
                        }).catch((err) => notify(`Could not update: ${(err as Error).message}`, 'error'))}
                        title={p.status === 'active' ? 'Currently Live — choose Draft to unpublish' : 'Currently Draft — choose Live to publish'}
                        className="text-[11px] font-semibold border rounded-md px-1.5 py-1 cursor-pointer focus:outline-none bg-white"
                        aria-label={`Set ${p.name} status`}
                      >
                        <option value="live">Live</option>
                        <option value="draft">Draft</option>
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[140px]">
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] font-medium text-gray-600 truncate">{p.sourceType ? SOURCE_TYPE_LABELS[p.sourceType] : '—'}</span>
                      {p.supplierSource && <span className="text-[10px] text-gray-400 truncate" title={p.supplierSource}>{p.supplierSource}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[160px]">
                    <div className="flex flex-wrap gap-1">
                      {p.featured && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-semibold whitespace-nowrap">Featured</span>}
                      {p.newArrival && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-semibold whitespace-nowrap">New</span>}
                      {p.compareAtPrice > p.price && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[10px] font-semibold whitespace-nowrap">Sale</span>}
                      {p.freeShipping && <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-semibold whitespace-nowrap">Free ship</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 whitespace-nowrap">
                      {p.status === 'archived' ? (
                        <button onClick={() => onRestore(p.id)} title="Restore to Draft" className="p-2 hover:bg-amber-50 rounded text-amber-600 shrink-0"><Copy size={16} /></button>
                      ) : (
                        <button onClick={() => toggleActive(p)} title={p.status === 'active' ? 'Deactivate' : 'Activate'} className="p-2 hover:bg-gray-100 rounded shrink-0">
                          {p.status === 'active' ? <ToggleRight size={17} className="text-green-500" /> : <ToggleLeft size={17} className="text-gray-400" />}
                        </button>
                      )}
                      <button onClick={() => nav(`/admin/products/edit/${p.id}`)} title="Edit" className="p-2 hover:bg-blue-50 rounded text-blue-600 shrink-0"><PencilSimple size={16} /></button>
                      <button onClick={() => onDuplicate(p.id)} title="Duplicate" className="p-2 hover:bg-purple-50 rounded text-purple-600 shrink-0"><Copy size={16} /></button>
                      <button onClick={() => nav(`/product/${p.id}`)} title="Preview product page" className="p-2 hover:bg-green-50 rounded text-green-600 shrink-0"><Eye size={16} /></button>
                      <a href={`/product/${p.id}`} target="_blank" rel="noreferrer" title="View live on storefront" className="p-2 hover:bg-sky-50 rounded text-sky-600 shrink-0"><ArrowSquareOut size={16} /></a>
                      <button onClick={() => setDelId(p.id)} title="Archive/Delete" className="p-2 hover:bg-red-50 rounded text-red-500 shrink-0"><Trash size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={13} className="px-4 py-14 text-center text-gray-400">No products match your filters.</td></tr>
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

      <Modal isOpen={bulkOpen} onClose={() => !bulkBusy && setBulkOpen(false)} title={`Archive / Delete ${selectedIds.size} Product${selectedIds.size === 1 ? '' : 's'}`}>
        <p className="text-gray-600 mb-3">Archive keeps history and removes them from the storefront. Hard delete permanently removes the rows and their images/variants. This cannot be undone.</p>
        <div className="flex gap-3">
          <button onClick={onBulkArchive} disabled={bulkBusy} className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg font-medium disabled:opacity-50">
            {bulkBusy ? 'Working…' : 'Archive (recommended)'}
          </button>
          <button onClick={onBulkHardDelete} disabled={bulkBusy} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium disabled:opacity-50">
            {bulkBusy ? 'Working…' : 'Hard Delete'}
          </button>
          <button onClick={() => setBulkOpen(false)} disabled={bulkBusy} className="flex-1 py-2.5 border rounded-lg disabled:opacity-50">Cancel</button>
        </div>
      </Modal>

      <CsvImportModal
        open={csvOpen}
        onClose={() => { if (!csvOpen) return; setCsvOpen(false); }}
        existing={products}
        cats={cats}
        notify={notify}
        onImported={load}
      />
    </div>
  );
}

// ============================================================================
// CSV BULK IMPORT MODAL (Zeedrop / supplier CSV → Luxedge drafts)
//
// Paste or upload a CSV, preview parsed rows, flag duplicates (item ID > URL >
// normalized title), then import the selected rows as DRAFT products with
// images + variants. Auto-publish is NEVER allowed here.
// ============================================================================
function CsvImportModal({ open, onClose, existing, cats, notify, onImported }: {
  open: boolean;
  onClose: () => void;
  existing: CatalogProduct[];
  cats: CatalogCategory[];
  notify: (msg: string, kind?: 'success' | 'error') => void;
  onImported: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<{ row: CsvImportRow; duplicate: DuplicateMatch | null }[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setText(''); setFileName(''); setPreview(null); setSelected(new Set()); setErrors([]);
  };

  const parse = () => {
    const res = parseCsvImport(text);
    if (res.rows.length === 0) {
      setErrors(['No product rows found. Make sure the CSV has a title/name column and at least one data row.']);
      setPreview(null);
      return;
    }
    const candidates: DupCandidate[] = existing.map((p) => ({
      id: p.id, name: p.name, supplierUrl: p.supplierUrl, supplierProductRef: p.supplierProductRef,
    }));
    const classified = classifyDuplicates(res.rows, candidates);
    setPreview(classified);
    setErrors([
      ...res.skipped.map((s) => `Row ${s.line}: ${s.reason} (skipped)`),
      ...res.warnings,
      ...(res.rows.length > 50 ? [`Large import (${res.rows.length} rows) — imported as drafts, review before publishing.`] : []),
    ]);
    // Auto-select non-duplicate rows only
    setSelected(new Set(classified.map((_, i) => i).filter((i) => !classified[i].duplicate)));
  };

  const onFile = (f: File | null) => {
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(f);
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(preview ? preview.map((_, i) => i) : []));
  const clearAll = () => setSelected(new Set());

  const importSelected = async () => {
    if (!preview) return;
    setBusy(true);
    let created = 0, dupSkipped = 0, failed = 0;
    const fails: string[] = [];
    for (const i of [...selected]) {
      const { row, duplicate } = preview[i];
      if (duplicate) { dupSkipped++; continue; }
      try {
        const catName = row.category?.trim().toLowerCase();
        const catId = catName ? cats.find((c) => c.name.toLowerCase() === catName)?.id ?? null : null;
        const input: ProductInput = {
          name: row.name,
          shortDescription: row.shortDescription,
          description: row.description,
          price: row.price,
          compareAtPrice: row.compareAtPrice,
          costPrice: row.costPrice,
          sku: row.sku,
          inventoryQty: row.inventoryQty,
          shippingCost: row.shippingCost,
          freeShipping: row.freeShipping,
          brand: row.brand || 'Luxedge',
          categoryId: catId,
          tags: row.tags,
          supplierSource: row.supplierSource || 'Zeedrop',
          supplierUrl: row.supplierUrl,
          supplierProductRef: row.supplierProductRef,
          status: 'draft',
          ogImage: row.images[0] || undefined,
          evidenceNotes: `Imported via CSV${fileName ? ` (${fileName})` : ''}${row.supplierSource ? ` from ${row.supplierSource}` : ''}`,
        };
        const product = await createProduct(input);
        if (row.images.length > 0) {
          await saveProductImages(product.id, row.images.map((url, n) => ({
            url, isPrimary: n === 0, sortOrder: n, kind: 'product' as const,
          })));
        }
        if (row.variants.length > 0) {
          await saveProductVariants(product.id, row.variants.map((v) => ({ attributes: v.attributes })));
        }
        created++;
      } catch (e) {
        failed++;
        fails.push(`${row.name.slice(0, 48)}: ${(e as Error).message}`);
      }
    }
    notify(
      `CSV import: ${created} created as draft${dupSkipped ? ` · ${dupSkipped} duplicates skipped` : ''}${failed ? ` · ${failed} failed` : ''}`,
      failed ? 'error' : 'success',
    );
    if (fails.length) setErrors(fails.slice(0, 6));
    setBusy(false);
    reset();
    await onImported();
  };

  const DUP_LABEL: Record<string, string> = {
    supplierProductRef: 'Duplicate — same supplier item ID',
    supplierUrl: 'Duplicate — same supplier URL',
    title: 'Duplicate — same title',
  };

  return (
    <Modal isOpen={open} onClose={() => { if (!busy) onClose(); }} title="CSV Bulk Import — creates DRAFT products" size="lg">
      <div className="space-y-4">
        <div className="text-xs text-gray-500 leading-relaxed">
          Paste a Zeedrop / supplier CSV or upload a file. Recognized columns: title/name, price, compare/cost price,
          images (URLs separated by comma or newline), description, variants (<code className="bg-gray-100 px-1 rounded">Color:Red; Size:M</code>),
          supplier URL, item ID, source, brand, category, sku, stock, shipping cost, tags.
          Everything imports as <b>DRAFT</b> — nothing publishes automatically.
        </div>

        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <button onClick={() => fileRef.current?.click()} className="px-3 py-2 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-50 flex items-center gap-1.5">
            <UploadSimple size={13} />{fileName || 'Upload .csv'}
          </button>
          <button
            onClick={parse}
            disabled={!text.trim()}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-xs font-semibold"
          >
            Parse CSV
          </button>
          {fileName && (
            <button onClick={() => { setFileName(''); setText(''); setPreview(null); }} className="px-3 py-2 text-xs text-gray-500 hover:text-red-500">Clear file</button>
          )}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'title,price,images,supplier url\nPremium Dog Toy,12.99,https://…/a.jpg | https://…/b.jpg,https://supplier.com/item/123'}
          rows={6}
          className={`${I} font-mono text-xs`}
        />

        {errors.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs space-y-1 max-h-28 overflow-auto">
            {errors.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}

        {preview && (
          <>
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{preview.length} rows parsed · {selected.size} selected</span>
              <span className="flex gap-2">
                <button onClick={selectAll} className="hover:text-indigo-600 font-semibold">Select all</button>
                <button onClick={clearAll} className="hover:text-red-500 font-semibold">Clear</button>
              </span>
            </div>
            <div className="border rounded-lg overflow-auto max-h-72">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-2 text-left"><input type="checkbox" checked={selected.size === preview.length && preview.length > 0} onChange={(e) => (e.target.checked ? selectAll() : clearAll())} /></th>
                    <th className="px-2 py-2 text-left">Title</th>
                    <th className="px-2 py-2 text-left">Price</th>
                    <th className="px-2 py-2 text-left">Images</th>
                    <th className="px-2 py-2 text-left">Supplier ref / URL</th>
                    <th className="px-2 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.map(({ row, duplicate }, i) => (
                    <tr key={i} className={duplicate ? 'bg-red-50/50' : ''}>
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} disabled={!!duplicate} />
                      </td>
                      <td className="px-2 py-1.5 max-w-[220px] truncate" title={row.name}>{row.name}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{row.price != null ? `$${row.price}` : '—'}</td>
                      <td className="px-2 py-1.5">{row.images.length > 0 ? `${row.images.length} img` : <span className="text-amber-600">no images</span>}</td>
                      <td className="px-2 py-1.5 max-w-[160px] truncate">{row.supplierProductRef || row.supplierUrl || '—'}</td>
                      <td className="px-2 py-1.5">
                        {duplicate ? (
                          <span className="text-red-600 font-medium" title={duplicate.product.name}>⚠ {DUP_LABEL[duplicate.field]}</span>
                        ) : (
                          <span className="text-gray-400">draft</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={importSelected}
                disabled={busy || selected.size === 0}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
              >
                {busy ? 'Importing…' : <>Import {selected.size} as Draft <FloppyDisk size={15} /></>}
              </button>
              <button onClick={() => { if (!busy) onClose(); }} className="px-6 py-2.5 border rounded-lg text-sm font-semibold disabled:opacity-40">Cancel</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ============================================================================
// AI INTELLIGENCE PANEL (Phase L — product-level research evidence)
//
// Shows Hermes / Salman OS research evidence that references this product.
// AI can NEVER change commerce readiness: readiness/source/economics stay
// authoritative from the Commerce Truth model. This panel is read-only
// research context (last research, confidence, source URLs, risks, and the
// recorded SEO/marketing opportunities from the suggestion).
// ============================================================================
function AiIntelPanel({ product }: { product: CatalogProduct }) {
  const [rows, setRows] = useState<HermesRecommendationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listRecommendations()
      .then((all) => {
        if (!alive) return;
        const hay = `${product.name} ${product.brand} ${product.sku} ${product.supplierProductRef || ''}`.toLowerCase();
        const matched = all.filter((r) => {
          const n = String(r.product_name || '').toLowerCase();
          return n && (hay.includes(n) || n.includes(product.name.toLowerCase()) || (r.source_ref && hay.includes(String(r.source_ref).toLowerCase())));
        });
        setRows(matched.slice(0, 6));
      })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [product.name, product.brand, product.sku, product.supplierProductRef]);

  return (
    <div className="bg-indigo-50/50 rounded-xl border border-indigo-100 p-4">
      <p className="text-xs font-bold text-indigo-800 mb-2 flex items-center gap-1.5"><Brain size={13} />AI INTELLIGENCE — research evidence only</p>
      {loading ? <p className="text-[11px] text-gray-400">Loading research…</p> : rows.length === 0 ? (
        <p className="text-[11px] text-gray-500">No Hermes / Salman OS research references this product yet. AI can never change COMMERCE_READY / SOURCE_PENDING / ECONOMICS_PENDING / FULFILLMENT_PENDING / RISK_REVIEW — those are Commerce Truth decisions.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-indigo-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-gray-800">{r.product_name}</p>
                <span className="text-[10px] text-gray-400">confidence {r.confidence === null ? '—' : `${Math.round(r.confidence * 100)}%`} · {r.source}</span>
              </div>
              {r.benefits && <p className="text-[11px] text-gray-600 mt-1"><b>SEO/marketing opportunity:</b> {r.benefits}</p>}
              {r.marketing_potential && <p className="text-[11px] text-gray-600 mt-0.5"><b>Marketing:</b> {r.marketing_potential}</p>}
              {r.risks && <p className="text-[11px] text-amber-700 mt-0.5"><b>Risks (research claim):</b> {r.risks}</p>}
              {r.source_url && <p className="text-[10px] mt-1"><a href={r.source_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{r.source_url}</a></p>}
              <p className="text-[9px] text-gray-400 mt-1">Received {new Date(r.created_at).toLocaleString()} · research claims require Luxedge verification before use.</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PRODUCT EDITOR
// ============================================================================
type EditorTab = 'general' | 'pricing' | 'inventory' | 'shipping' | 'images' | 'variants' | 'promotions' | 'commerce' | 'seo';

// SEO is deliberately LAST — the owner asked for it to come at the end.
const TABS: { id: EditorTab; label: string; icon: React.ReactNode; required?: boolean }[] = [
  { id: 'general', label: 'General', icon: <Package size={14} />, required: true },
  { id: 'pricing', label: 'Pricing', icon: <CurrencyDollar size={14} />, required: true },
  { id: 'inventory', label: 'Inventory', icon: <Stack size={14} /> },
  { id: 'shipping', label: 'Shipping', icon: <Truck size={14} /> },
  { id: 'images', label: 'Images', icon: <ImageIcon size={14} />, required: true },
  { id: 'variants', label: 'Variants', icon: <List size={14} /> },
  { id: 'promotions', label: 'Promotions', icon: <Tag size={14} /> },
  { id: 'commerce', label: 'Commerce', icon: <Truck size={14} /> },
  { id: 'seo', label: 'SEO', icon: <Globe size={14} /> },
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
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  // Quick Add = compact one-screen form; Detail Add = full tabbed editor;
  // AI Import = the shared AI product import engine (research → review → draft).
  // The mode can be deep-linked via ?mode=quick|detail|ai (e.g. from the
  // Dashboard Create Product cards).
  const [searchParams] = useSearchParams();
  const urlMode = searchParams.get('mode');
  const [mode, setMode] = useState<'quick' | 'detail' | 'ai'>(
    urlMode === 'detail' || urlMode === 'ai' ? urlMode : 'quick',
  );
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
          categoryId: cs[0]?.id ?? null, categoryName: cs[0]?.name ?? '', brand: '', status: 'active',
          price: 0, compareAtPrice: 0, costPrice: 0, landedCost: 0, marginPercent: null, currency: 'USD',
          sku: '', inventoryQty: 0, stockStatus: 'in_stock', lowStockThreshold: 0, shippingCost: 0,
          freeShipping: false, deliveryMinDays: null, deliveryMaxDays: null, usInventory: false,
          tags: [], featured: false, newArrival: false, trending: false, bestRated: false, bestSeller: false,
          promoted: false, saleEnabled: false, seoTitle: '', seoDescription: '', seoKeywords: [],
          commerceReadiness: null, sourceType: null, inventorySource: null, fulfillmentMethod: null,
          supplierUrl: null, supplierStockStatus: null, riskFlags: [],
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
      // Refresh the session token before writing — a form left open past the
      // 1h JWT expiry must not fail the save with Supabase 401 "JWT expired".
      setDbToken(await getFreshAccessToken());
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
        commerceReadiness: p.commerceReadiness,
        sourceType: p.sourceType,
        inventorySource: p.inventorySource,
        fulfillmentMethod: p.fulfillmentMethod,
        supplierUrl: p.supplierUrl,
        supplierStockStatus: p.supplierStockStatus,
        riskFlags: p.riskFlags,
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

  // Create a category on the fly (persists to Supabase) and select it.
  const addCategory = async (name: string): Promise<CatalogCategory | null> => {
    const n = name.trim();
    if (!n) { notify('Category name is required', 'error'); return null; }
    const existing = cats.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (existing) { set('categoryId', existing.id); notify(`Category "${existing.name}" already exists — selected`, 'error'); return existing; }
    setAddingCat(true);
    try {
      const c = await createCategory({ name: n });
      setCats((prev) => [...prev, c]);
      set('categoryId', c.id);
      notify(`Category "${c.name}" added`);
      setNewCatOpen(false); setNewCatName('');
      return c;
    } catch (e) {
      notify(`Could not save category: ${(e as Error).message}`, 'error');
      return null;
    } finally { setAddingCat(false); }
  };

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;
  if (!p) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <button onClick={() => nav('/admin/products')} className="p-1.5 hover:bg-gray-100 rounded-lg shrink-0"><ArrowLeft size={16} /></button>
        <h1 className="font-bold text-gray-800 whitespace-nowrap">{isNew ? 'Add Product' : 'Edit Product'}</h1>
        <span className="h-4 w-px bg-gray-200 shrink-0" aria-hidden="true" />
        {isNew && (
          <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 shrink-0">
            <button onClick={() => setMode('quick')} className={`btn-glow px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${mode === 'quick' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>⚡ Quick</button>
            <button onClick={() => setMode('detail')} className={`btn-glow px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${mode === 'detail' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>Detail</button>
            <button onClick={() => setMode('ai')} className={`btn-glow px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${mode === 'ai' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`} title="AI Import — research any product URL and save as a draft">✨ AI Import</button>
          </div>
        )}
        <div className="flex-1" />
        {mode !== 'ai' && (
          <>
            <div className="relative shrink-0">
              <select value={p.status} onChange={(e) => set('status', e.target.value as CatalogProduct['status'])} className="appearance-none pl-2 pr-7 py-1.5 border border-gray-200 rounded-lg text-xs font-medium bg-white cursor-pointer" aria-label="Product status">
                <option value="active">Live</option>
                <option value="draft">Draft</option>
                <option value="ready">Ready</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"><CaretDown size={11} /></span>
            </div>
            <button onClick={handleSave} disabled={saving} className="btn-glow px-4 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0">
              <FloppyDisk size={14} />{saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>

      {isNew && mode === 'quick' && <QuickAddForm product={p} cats={cats} onChange={setP} onAddCategory={addCategory} />}

      {isNew && mode === 'ai' && <AIImportPanel />}

      {(!isNew || mode === 'detail') && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 px-3.5 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${tab === t.id ? 'bg-blue-500 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      )}

      {(!isNew || mode === 'detail') && <div className="bg-white rounded-xl border p-5">
        {/* ── GENERAL ── */}
        {tab === 'general' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><label className={L}>Product name <span className="text-red-500">*</span> <span className="normal-case font-normal text-gray-400">required</span></label><input value={p.name} onChange={(e) => set('name', e.target.value)} className={I} placeholder="e.g. Interactive Squeaky Enrichment Toy for Dogs" /></div>
            <div><label className={L}>Short title <span className="normal-case font-normal text-gray-400">(optional)</span></label><input value={p.shortTitle || ''} onChange={(e) => set('shortTitle', e.target.value)} className={I} /></div>
            <div><label className={L}>Subtitle <span className="normal-case font-normal text-gray-400">(optional)</span></label><input value={p.subtitle || ''} onChange={(e) => set('subtitle', e.target.value)} className={I} /></div>
            <div className="sm:col-span-2"><label className={L}>Short description <span className="normal-case font-normal text-gray-400">(optional)</span></label><textarea value={p.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} rows={2} className={I} /></div>
            <div className="sm:col-span-2"><label className={L}>Description <span className="normal-case font-normal text-gray-400">(optional)</span></label><textarea value={p.description} onChange={(e) => set('description', e.target.value)} rows={6} className={I} placeholder="Concise opening benefit, key features, practical use, sizing, care. No fake claims." /></div>
            <div>
              <label className={L}>Category</label>
              <div className="flex gap-1.5">
                <select value={p.categoryId || ''} onChange={(e) => set('categoryId', e.target.value || null)} className={I}>
                  <option value="">— Uncategorized —</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" onClick={() => { setNewCatOpen(!newCatOpen); setNewCatName(''); }} className="shrink-0 px-3 border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-semibold whitespace-nowrap">+ Add</button>
              </div>
              {newCatOpen && (
                <div className="flex gap-1.5 mt-1.5">
                  <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCategory(newCatName); }} placeholder="New category name" className={I} autoFocus />
                  <button type="button" onClick={() => void addCategory(newCatName)} disabled={addingCat || !newCatName.trim()} className="shrink-0 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold whitespace-nowrap">{addingCat ? 'Adding…' : 'Add'}</button>
                </div>
              )}
            </div>
            <div><label className={L}>Brand <span className="normal-case font-normal text-gray-400">(optional)</span></label><input value={p.brand} onChange={(e) => set('brand', e.target.value)} className={I} placeholder="e.g. KONG" /></div>
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
            <div className="sm:col-span-2"><label className={L}>Owner notes <span className="normal-case font-normal text-gray-400">(admin only)</span></label><textarea value={p.ownerNotes || ''} onChange={(e) => set('ownerNotes', e.target.value)} rows={2} className={I} /></div>
          </div>
        )}

        {/* ── PRICING ── */}
        {tab === 'pricing' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className={L}>Supplier cost (USD)</label><input type="number" min="0" step="0.01" value={p.costPrice || ''} onChange={(e) => set('costPrice', +e.target.value)} className={I} /></div>
            <div><label className={L}>Landed cost (USD) — freight verified</label><input type="number" min="0" step="0.01" value={p.landedCost || ''} onChange={(e) => set('landedCost', +e.target.value)} className={I} /></div>
            <div><label className={L}>Retail price (USD) <span className="text-red-500">*</span> <span className="normal-case font-normal text-gray-400">required</span></label><input type="number" min="0" step="0.01" value={p.price || ''} onChange={(e) => set('price', +e.target.value)} className={I} /></div>
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
        {tab === 'seo' && <SeoTab product={p} cats={cats} set={set} />}

        {/* ── COMMERCE / READINESS ── */}
        {tab === 'commerce' && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Final readiness</p>
                <ReadinessBadge readiness={p.commerceReadiness} />
                <p className="text-[11px] text-gray-500 mt-2">COMMERCE_READY is the only state that appears on the storefront.</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Source type</p>
                <p className="text-sm font-medium">{p.sourceType ? SOURCE_TYPE_LABELS[p.sourceType] : 'Unknown'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Inventory source</p>
                <p className="text-sm font-medium">{p.inventorySource ? INVENTORY_SOURCE_LABELS[p.inventorySource] : 'Unknown'}</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className={L}>Supplier / source</label><input value={p.supplierSource || ''} onChange={(e) => set('supplierSource', e.target.value)} className={I} placeholder="e.g. CJ / Authorized wholesaler" /></div>
              <div><label className={L}>Supplier product ref / SKU</label><input value={p.supplierProductRef || ''} onChange={(e) => set('supplierProductRef', e.target.value)} className={I} placeholder="e.g. CJ PID" /></div>
              <div><label className={L}>Supplier URL</label><input value={p.supplierUrl || ''} onChange={(e) => set('supplierUrl', e.target.value)} className={I} placeholder="https://… (verified supplier page)" /></div>
              <div><label className={L}>Fulfillment method</label><input value={p.fulfillmentMethod || ''} onChange={(e) => set('fulfillmentMethod', e.target.value)} className={I} placeholder="e.g. CJ US warehouse dropship" /></div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className={L}>Source type</label>
                <select value={p.sourceType || ''} onChange={(e) => set('sourceType', (e.target.value || null) as CatalogProduct['sourceType'])} className={I}>
                  <option value="">— Auto / unknown —</option>
                  <option value="CJ_DROPSHIPPING">CJ Dropshipping</option>
                  <option value="AUTHORIZED_WHOLESALE">Authorized Wholesale</option>
                  <option value="MANUFACTURER_DIRECT">Manufacturer Direct</option>
                  <option value="RETAIL_REFERENCE_ONLY">Retail Reference Only</option>
                  <option value="OWNER_STOCK">Owner Stock</option>
                  <option value="OTHER_VERIFIED">Other Verified</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
              </div>
              <div><label className={L}>Inventory source</label>
                <select value={p.inventorySource || ''} onChange={(e) => set('inventorySource', (e.target.value || null) as CatalogProduct['inventorySource'])} className={I}>
                  <option value="">— Auto / unknown —</option>
                  <option value="SUPPLIER_VERIFIED">Supplier Verified</option>
                  <option value="INTERNAL_STOCK">Internal Stock</option>
                  <option value="UNTRACKED">Untracked</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Economics</p>
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-gray-500">Sell price</dt><dd className="font-semibold">${p.price.toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Supplier cost</dt><dd>{p.costPrice > 0 ? `$${p.costPrice.toFixed(2)}` : <span className="text-amber-600">UNKNOWN</span>}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Landed cost</dt><dd>{p.landedCost > 0 ? `$${p.landedCost.toFixed(2)}` : <span className="text-amber-600">UNKNOWN</span>}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Gross margin</dt><dd>{p.marginPercent != null ? `${p.marginPercent.toFixed(1)}%` : <span className="text-amber-600">UNKNOWN</span>}</dd></div>
                </dl>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Supply / evidence</p>
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-gray-500">USA inventory</dt><dd>{p.usInventory ? 'Verified' : 'No'}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Supplier stock</dt><dd>{p.supplierStockStatus || (p.stockStatus || 'unknown')}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Shipping</dt><dd>{p.shippingCost > 0 ? `$${p.shippingCost.toFixed(2)}` : p.freeShipping ? 'Free' : <span className="text-amber-600">UNKNOWN</span>}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">Delivery</dt><dd>{p.deliveryMinDays != null && p.deliveryMaxDays != null ? `${p.deliveryMinDays}–${p.deliveryMaxDays} days` : <span className="text-amber-600">UNKNOWN</span>}</dd></div>
                </dl>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Risk flags</p>
                {p.riskFlags && p.riskFlags.length > 0
                  ? <ul className="text-xs space-y-1">{p.riskFlags.map((r) => <li key={r} className="flex items-start gap-1.5"><Warning className="text-amber-500 shrink-0 mt-0.5" size={13} />{r}</li>)}</ul>
                  : <p className="text-xs text-gray-400">No unresolved risk flags recorded.</p>}
                {p.evidenceNotes && <p className="text-[11px] text-gray-500 mt-2 border-t border-gray-200 pt-2">Evidence: {p.evidenceNotes.slice(0, 220)}{p.evidenceNotes.length > 220 ? '…' : ''}</p>}
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg p-4 text-xs text-gray-600">
              <p><strong>Readiness rule:</strong> storefront visibility requires status active AND commerce_readiness = COMMERCE_READY. A manufacturer retail page alone (no wholesale/dropship purchasing path) is <strong>Retail Reference Only → Source Pending</strong>. Do not treat internal quantity as supplier stock.</p>
            </div>

            <AiIntelPanel product={p} />
          </div>
        )}

        {/* ── PROMOTIONS ── */}
        {tab === 'promotions' && <PromoTab product={p} set={set} />}
      </div>}
    </div>
  );
}

// ============================================================================
// SEO TAB (with one-click AI generation)
// ============================================================================
function SeoTab({ product, cats, set }: { product: CatalogProduct; cats: CatalogCategory[]; set: <K extends keyof CatalogProduct>(k: K, v: CatalogProduct[K]) => void }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);

  const addKeyword = (k: string) => { const v = k.trim(); if (v && !product.seoKeywords.includes(v)) set('seoKeywords', [...product.seoKeywords, v]); };
  const removeKeyword = (k: string) => set('seoKeywords', product.seoKeywords.filter((x) => x !== k));

  const generateWithAI = async () => {
    if (!product.name.trim()) { notify('Enter the product name first', 'error'); return; }
    setBusy(true);
    try {
      const providers = loadAIProviders();
      const settings = loadProviderSettings();
      const { primary } = resolveProviderChain(providers, settings);
      if (!primary) throw new Error('No AI provider enabled — enable one in AI Hub.');
      const category = cats.find((c) => c.id === product.categoryId)?.name || product.categoryName || '';
      const prompt = `Write premium, honest SEO for this pet product for Luxedge (a US pet store).
Product name: ${product.name}
Brand: ${product.brand || 'Luxedge'}
Category: ${category || 'unknown'}
Short description: ${product.shortDescription || ''}
Long description: ${product.description || ''}

Return ONLY JSON with EXACTLY these keys:
{"seoTitle": "<=60 chars, factual, no fake claims", "metaDescription": "<=160 chars, factual", "focusKeyword": "one primary keyword", "seoKeywords": ["5-8 keywords"], "slug": "url-friendly-slug"}
No other text.`;
      const text = await callAIProvider(prompt, providers, undefined, 'You write honest, factual ecommerce SEO. Never invent claims, prices or reviews.');
      const obj = text.match(/(\{[\s\S]*\})/);
      const parsed = obj ? JSON.parse(obj[1]) : null;
      if (!parsed) throw new Error('AI returned no usable SEO JSON');
      const kw = Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords.map(String).slice(0, 8) : [];
      const slug = String(parsed.slug || product.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90);
      set('seoTitle', String(parsed.seoTitle || '').trim());
      set('seoDescription', String(parsed.metaDescription || '').trim());
      set('seoKeywords', kw);
      if (slug) set('canonicalSlug', slug);
      if (parsed.focusKeyword) set('seoKeywords', kw.includes(String(parsed.focusKeyword)) ? kw : [String(parsed.focusKeyword), ...kw]);
      notify('SEO generated — review before saving');
    } catch (e) {
      notify(`AI SEO failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const meta = buildProductMeta(product);
  const jsonLd = buildProductJsonLd(product);

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-800 flex items-center gap-1.5"><Sparkle size={15} />SEO & Meta — write nothing, let AI do it</p>
          <p className="text-xs text-indigo-600 mt-0.5">One click generates a factual SEO title, meta description, keywords and slug from your product name (DeepSeek, secure server-side). You can still edit everything.</p>
        </div>
        <button onClick={generateWithAI} disabled={busy || !product.name.trim()} className="btn-glow px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
          <Sparkle size={15} />{busy ? 'Generating…' : 'Generate SEO with AI'}
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><label className={L}>SEO title</label><input value={product.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} className={I} placeholder="Auto-generated or write your own" /></div>
        <div className="sm:col-span-2"><label className={L}>Meta description</label><textarea value={product.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} rows={3} className={I} placeholder="Auto-generated or write your own" /></div>
        <div className="sm:col-span-2">
          <label className={L}>SEO keywords</label>
          <div className="flex flex-wrap gap-1.5 items-center">
            {product.seoKeywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">{k}<button onClick={() => removeKeyword(k)}><X size={11} /></button></span>
            ))}
            <input
              className="flex-1 min-w-[140px] px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none"
              placeholder="Add keyword + Enter"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }}
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
    </div>
  );
}

// ============================================================================
// PROMOTIONS TAB (simpler + AI-assisted suggestions)
// ============================================================================
function PromoTab({ product, set }: { product: CatalogProduct; set: <K extends keyof CatalogProduct>(k: K, v: CatalogProduct[K]) => void }) {
  const { notify } = useApp();

  // Deterministic economics-based suggestion — clearly a suggestion, never a
  // fake claim. Margin math only; merchandising flags stay owner decisions.
  const suggest = () => {
    const margin = product.costPrice > 0 && product.price > 0 ? (1 - product.costPrice / product.price) * 100 : null;
    if (margin == null) { notify('Enter supplier cost + retail price first', 'error'); return; }
    // A 10% discount keeps margin healthy when there is at least 40% gross.
    if (margin >= 45) {
      set('saleEnabled', true);
      set('discountType', 'percent');
      set('discountValue', 10);
      set('compareAtPrice', product.price > 0 ? Math.round(product.price * 100) / 100 : 0);
      notify(`Suggested: 10% off keeps ~${(margin - 10).toFixed(0)}% margin — review before saving.`);
    } else {
      notify(`Margin is ${margin.toFixed(0)}% — a sale is not suggested (would drop below a healthy margin).`, 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-indigo-50 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-800 flex items-center gap-1.5"><Sparkle size={15} />Promotions — simplified</p>
          <p className="text-xs text-indigo-600 mt-0.5">AI checks your economics and suggests a safe discount. Trending / Best rated / Best seller are NEVER auto-suggested — they need real evidence.</p>
        </div>
        <button onClick={suggest} className="btn-glow px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
          <Sparkle size={15} />Suggest a sale (economics)
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className={L}>Sale enabled</label>
          <div className="flex items-center gap-2">
            <input id="sale-on" type="checkbox" checked={product.saleEnabled} onChange={(e) => set('saleEnabled', e.target.checked)} className="w-4 h-4" />
            <label htmlFor="sale-on" className="text-sm text-gray-600">Apply a store discount to this product</label>
          </div>
        </div>
        <div><label className={L}>Discount type</label>
          <select value={product.discountType || 'percent'} onChange={(e) => set('discountType', e.target.value as CatalogProduct['discountType'])} className={I}>
            <option value="percent">Percentage (%)</option>
            <option value="fixed">Fixed amount ($)</option>
          </select>
        </div>
        <div><label className={L}>Discount value</label><input type="number" min="0" step="0.01" value={product.discountValue ?? ''} onChange={(e) => set('discountValue', e.target.value ? +e.target.value : undefined)} className={I} /></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {([
          ['featured', 'Featured', 'Show in featured/top-picks sections'],
          ['newArrival', 'New arrival', 'Show in New Arrivals section'],
          ['promoted', 'Promoted', 'Highlight in promotions'],
        ] as const).map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={Boolean(product[key])} onChange={(e) => set(key, e.target.checked)} className="w-4 h-4 mt-0.5" />
            <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-gray-400">{hint}</span></span>
          </label>
        ))}
        {([
          ['trending', 'Trending', 'Only with real evidence or an explicit owner merchandising decision'],
          ['bestRated', 'Best rated', 'Only with verified customer ratings'],
          ['bestSeller', 'Best seller', 'Only with verified sales evidence'],
        ] as const).map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={Boolean(product[key])} onChange={(e) => set(key, e.target.checked)} className="w-4 h-4 mt-0.5" />
            <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-amber-600">{hint}</span></span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// QUICK ADD FORM (compact one-screen product creation)
// ============================================================================
function QuickAddForm({ product, cats, onChange, onAddCategory }: { product: CatalogProduct; cats: CatalogCategory[]; onChange: (p: CatalogProduct) => void; onAddCategory?: (name: string) => Promise<CatalogCategory | null> }) {
  const set = <K extends keyof CatalogProduct>(k: K, v: CatalogProduct[K]) => onChange({ ...product, [k]: v });
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);

  const addNewCat = async () => {
    if (!onAddCategory) return;
    setAddingCat(true);
    try { const c = await onAddCategory(newCatName); if (c) set('categoryId', c.id); } finally { setAddingCat(false); }
  };

  const removeTag = (t: string) => onChange({ ...product, tags: product.tags.filter((x) => x !== t) });
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, '');
    if (!t || product.tags.includes(t)) return;
    onChange({ ...product, tags: [...product.tags, t] });
  };

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4">
      <p className="text-xs text-gray-500">Quick Add — essentials plus the fields SEO needs. Everything else defaults to safe values and can be refined later in Detail Add. <span className="text-red-500">*</span> = required.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={L}>Product name <span className="text-red-500">*</span></label>
          <input value={product.name} onChange={(e) => set('name', e.target.value)} className={I} placeholder="e.g. Interactive Squeaky Enrichment Toy for Dogs" autoFocus />
        </div>
        <div>
          <label className={L}>Category</label>
          <div className="flex gap-1.5">
            <select value={product.categoryId || ''} onChange={(e) => set('categoryId', e.target.value || null)} className={I}>
              <option value="">— Uncategorized —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" onClick={() => { setNewCatOpen(!newCatOpen); setNewCatName(''); }} className="shrink-0 px-3 border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-semibold whitespace-nowrap">+ Add</button>
          </div>
          {newCatOpen && (
            <div className="flex gap-1.5 mt-1.5">
              <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addNewCat(); }} placeholder="New category name" className={I} autoFocus />
              <button type="button" onClick={() => void addNewCat()} disabled={addingCat || !newCatName.trim()} className="shrink-0 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold whitespace-nowrap">{addingCat ? 'Adding…' : 'Add'}</button>
            </div>
          )}
        </div>
        <div><label className={L}>Brand <span className="normal-case font-normal text-gray-400">(optional)</span></label><input value={product.brand} onChange={(e) => set('brand', e.target.value)} className={I} placeholder="e.g. KONG" /></div>
        <div>
          <label className={L}>Retail price (USD) <span className="text-red-500">*</span></label>
          <input type="number" min="0" step="0.01" value={product.price || ''} onChange={(e) => set('price', +e.target.value)} className={I} placeholder="0.00" />
        </div>
        <div>
          <label className={L}>Compare-at price (USD) <span className="normal-case font-normal text-gray-400">(optional — shows a sale)</span></label>
          <input type="number" min="0" step="0.01" value={product.compareAtPrice || ''} onChange={(e) => set('compareAtPrice', +e.target.value)} className={I} placeholder="0.00" />
        </div>
        <div><label className={L}>Supplier cost (USD) — optional</label><input type="number" min="0" step="0.01" value={product.costPrice || ''} onChange={(e) => set('costPrice', +e.target.value)} className={I} placeholder="Optional" /></div>
        <div>
          <label className={L}>Stock quantity</label>
          <input type="number" min="0" value={product.inventoryQty} onChange={(e) => set('inventoryQty', +e.target.value)} className={I} placeholder="0" />
        </div>
        <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-gray-700 pb-2"><input type="checkbox" checked={product.freeShipping} onChange={(e) => set('freeShipping', e.target.checked)} className="w-4 h-4" />Free shipping on this product</label></div>
          <div>
            <label className={L}>Shipping cost (USD) <span className="normal-case font-normal text-gray-400">— if not free</span></label>
            <input type="number" min="0" step="0.01" value={product.shippingCost || ''} onChange={(e) => set('shippingCost', +e.target.value)} className={I} placeholder="0.00" />
          </div>
          <div className="sm:col-span-2">
            <label className={L}>Estimated delivery <span className="normal-case font-normal text-gray-400">(optional, business days)</span></label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" value={product.deliveryMinDays ?? ''} onChange={(e) => set('deliveryMinDays', e.target.value ? +e.target.value : null)} className={I} placeholder="min" aria-label="Delivery min days" />
              <span className="text-xs text-gray-400">–</span>
              <input type="number" min="0" value={product.deliveryMaxDays ?? ''} onChange={(e) => set('deliveryMaxDays', e.target.value ? +e.target.value : null)} className={I} placeholder="max" aria-label="Delivery max days" />
              <span className="text-xs text-gray-500 whitespace-nowrap">days</span>
            </div>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={L}>Short description <span className="normal-case font-normal text-gray-400">(optional)</span></label>
          <textarea value={product.shortDescription || ''} onChange={(e) => set('shortDescription', e.target.value)} rows={2} className={I} placeholder="One-line customer-facing summary (also used for SEO meta)." />
        </div>
        <div className="sm:col-span-2">
          <label className={L}>Description <span className="normal-case font-normal text-gray-400">(optional)</span></label>
          <textarea value={product.description || ''} onChange={(e) => set('description', e.target.value)} rows={4} className={I} placeholder="Concise opening benefit, key features, practical use, sizing, care. No fake claims." />
        </div>
        <div className="sm:col-span-2">
          <label className={L}>Tags</label>
          <div className="flex flex-wrap gap-1.5 items-center">
            {product.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">{t}<button type="button" onClick={() => removeTag(t)}><X size={11} /></button></span>
            ))}
            <input
              className="flex-1 min-w-[140px] px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none"
              placeholder="Add tag + Enter"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }}
            />
          </div>
        </div>
      </div>

      {/* Images — full editor (upload to storage, URL, fetch-all, main picker, bg removal, alt) */}
      <div>
        <label className={L}>Images (up to 5) — click an image to make it the main thumbnail <span className="text-red-500">*</span></label>
        <ImageManager product={product} onProduct={onChange} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared image upload helper — sends a data URL to the admin-only storage
// endpoint and returns a durable public URL. Falls back to the data URL when
// storage is unavailable (the row then persists only if the URL is kept, so
// callers should surface the warning honestly).
// ---------------------------------------------------------------------------
async function uploadImageToStorage(dataUrl: string, filename: string, contentType: string): Promise<{ url: string; stored: boolean }> {
  try {
    const token = getAccessToken();
    const r = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ productId: 'product', filename, contentType, base64: dataUrl }),
    });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.publicUrl) return { url: String(j.publicUrl), stored: true };
    return { url: dataUrl, stored: false };
  } catch {
    return { url: dataUrl, stored: false };
  }
}

/**
 * Remove a solid/light background from an image using edge flood-fill.
 * Pure client-side canvas — no API key, no external service. Best results on
 * product shots with a plain (white/light) backdrop; not a magic cutout for
 * busy scenes. Returns a PNG data URL.
 */
async function removeImageBackground(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not load image'));
    i.src = dataUrl;
  });
  const maxDim = 1200;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  // Seed color = average of the four corners (the presumed backdrop).
  const corner = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const corners = [corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1)];
  const seed = [
    Math.round(corners.reduce((s, c) => s + c[0], 0) / corners.length),
    Math.round(corners.reduce((s, c) => s + c[1], 0) / corners.length),
    Math.round(corners.reduce((s, c) => s + c[2], 0) / corners.length),
  ];
  const tol = 40;
  const near = (r: number, g: number, b: number) =>
    Math.abs(r - seed[0]) <= tol && Math.abs(g - seed[1]) <= tol && Math.abs(b - seed[2]) <= tol;

  // BFS from every border pixel, clearing connected background regions.
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) { stack.push(x, (height - 1) * width + x); }
  for (let y = 0; y < height; y++) { stack.push(y * width, y * width + width - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    const i = p * 4;
    if (!near(data[i], data[i + 1], data[i + 2])) continue;
    visited[p] = 1;
    data[i + 3] = 0; // transparent
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y < height - 1) stack.push(p + width);
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

// ============================================================================
// IMAGE MANAGER
// ============================================================================
function ImageManager({ product, onProduct }: { product: CatalogProduct; onProduct: (p: CatalogProduct) => void }) {
  const { notify } = useApp();
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addByUrl = () => {
    const u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) { notify('Enter a valid image URL (https://…)', 'error'); return; }
    const isFirst = product.images.length === 0;
    onProduct({ ...product, images: [...product.images, { id: uid(), productId: product.id, url: u, altText: alt.trim(), kind: 'product', isPrimary: isFirst, sortOrder: product.images.length, variantId: null }] });
    setUrl(''); setAlt('');
    notify('Image added — save the product to persist');
  };

  const addByFile = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const room = Math.max(0, 5 - product.images.length);
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, room);
    if (!picked.length) { notify('Max 5 images total', 'error'); return; }
    setUploading(true);
    try {
      const startLen = product.images.length;
      const added: CatalogImage[] = [];
      for (const f of picked) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('read failed'));
          r.readAsDataURL(f);
        });
        const { url: stored, stored: ok } = await uploadImageToStorage(dataUrl, f.name, f.type);
        added.push({ id: uid(), productId: product.id, url: stored, altText: f.name, kind: 'product', isPrimary: startLen === 0 && added.length === 0, sortOrder: startLen + added.length - 1, variantId: null });
        if (!ok) notify(`Storage upload unavailable — image kept locally (${f.name})`, 'error');
      }
      onProduct({ ...product, images: [...product.images, ...added] });
      notify(picked.length === 1 ? 'Image uploaded' : `${picked.length} images uploaded`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Fetch ALL images from a product page URL and add them (deduped, up to 5).
  const importAllFromUrl = async () => {
    const u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) { notify('Enter a valid page/image URL', 'error'); return; }
    setUploading(true);
    try {
      // If it's a direct image URL, just add it.
      if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u)) { addByUrl(); return; }
      const token = getAccessToken();
      const r = await fetch(`/api/fetch-page?url=${encodeURIComponent(u)}`, {
        headers: { Accept: 'text/plain', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        notify(j?.error || `Page fetch failed (HTTP ${r.status})`, 'error');
        return;
      }
      const parsed = parseHtmlPage(await r.text());
      const found = parsed.images.filter((i) => i.startsWith('http'));
      if (!found.length) { notify('No product images found on that page.', 'error'); return; }
      const existing = new Set(product.images.map((i) => i.url));
      const fresh = found.filter((i) => !existing.has(i)).slice(0, 5 - product.images.length);
      if (!fresh.length) { notify('All images from that page are already added (max 5).', 'error'); return; }
      const startLen = product.images.length;
      onProduct({
        ...product,
        images: [...product.images, ...fresh.map((u2, i) => ({ id: uid(), productId: product.id, url: u2, altText: '', kind: 'product' as const, isPrimary: startLen === 0 && i === 0, sortOrder: startLen + i, variantId: null }))],
      });
      notify(`Imported ${fresh.length} image${fresh.length === 1 ? '' : 's'} from the page — delete the ones you do not want.`);
    } finally {
      setUploading(false);
    }
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

  // Remove background client-side, then persist the result to storage.
  const onRemoveBackground = async (idx: number) => {
    const img = product.images[idx];
    if (!img) return;
    setProcessing(idx);
    try {
      const removed = await removeImageBackground(img.url);
      const { url: stored } = await uploadImageToStorage(removed, `bg-removed-${idx}.png`, 'image/png');
      onProduct({ ...product, images: product.images.map((x, i) => (i === idx ? { ...x, url: stored } : x)) });
      notify('Background removed — the new version is saved as the image.');
    } catch (e) {
      notify(`Background removal failed: ${(e as Error).message}`, 'error');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add bar: upload from PC + URL + alt */}
      <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
        <div className="flex flex-wrap gap-2 items-end">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addByFile(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading || product.images.length >= 5} className="btn-glow px-3.5 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-1.5">
            <UploadSimple size={15} />{uploading ? 'Working…' : `Upload from PC (${product.images.length}/5)`}
          </button>
          <div className="flex-1 min-w-[200px]">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={I} placeholder="Image URL — or paste a product page to fetch ALL its images" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); importAllFromUrl(); } }} />
          </div>
          <div className="flex-1 min-w-[140px]"><input value={alt} onChange={(e) => setAlt(e.target.value)} className={I} placeholder="Alt text (optional)" /></div>
          <button onClick={addByUrl} disabled={uploading} className="btn-glow px-3.5 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-1.5"><Plus size={15} />Add URL</button>
          <button onClick={importAllFromUrl} disabled={uploading} className="px-3.5 py-2 border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 rounded-lg text-sm flex items-center gap-1.5" title="Fetch every image found on the pasted page URL and add them all (max 5)">
            <Download size={15} />Fetch all from page
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Up to 5 images. Uploads are stored in Supabase Storage (durable). Paste a product page URL + “Fetch all from page” to pull every image at once, then ✕ the ones you do not want.</p>
      </div>

      {/* Image grid with thumbnail picker */}
      {product.images.length === 0 ? (
        <div className="text-center py-10 text-gray-400 border border-dashed rounded-xl"><ImageIcon size={28} className="mx-auto mb-2 text-gray-300" />No images yet — upload or add at least one.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {product.images.map((img, idx) => (
            <div key={img.id || idx} className={`relative group rounded-xl overflow-hidden border-2 transition-all ${img.isPrimary ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
              <button type="button" onClick={() => setPrimary(idx)} className="block w-full" title="Click to make this the main thumbnail">
                <img src={img.url} alt={img.altText || ''} className="w-full aspect-square object-cover bg-gray-100" onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.25'; }} />
              </button>
              {img.isPrimary && <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded">MAIN</span>}
              <button type="button" onClick={() => remove(idx)} className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 hover:bg-red-600 shadow" title="Remove image">✕</button>
              <div className="p-1.5 space-y-1.5 bg-white">
                <input value={img.altText} onChange={(e) => update(idx, { altText: e.target.value })} className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px]" placeholder="Alt text" />
                <div className="flex gap-1 flex-wrap">
                  <select value={img.kind} onChange={(e) => update(idx, { kind: e.target.value as CatalogImage['kind'] })} className="text-[10px] px-1 py-0.5 border border-gray-200 rounded" aria-label="Image kind">
                    <option value="product">Product</option>
                    <option value="lifestyle">Lifestyle</option>
                    <option value="creative">Creative</option>
                    <option value="video">Video</option>
                  </select>
                  <select value={img.variantId || ''} onChange={(e) => update(idx, { variantId: e.target.value || null })} className="text-[10px] px-1 py-0.5 border border-gray-200 rounded max-w-[110px]" aria-label="Variant image link">
                    <option value="">No variant</option>
                    {product.variants.map((v) => (
                      <option key={v.id} value={v.id}>{Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(' · ') || v.sku || v.id}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => onRemoveBackground(idx)} disabled={processing === idx} className="text-[10px] px-1.5 py-0.5 rounded border border-purple-200 text-purple-700 hover:bg-purple-50 disabled:opacity-50" title="Remove solid background (client-side)">
                    {processing === idx ? 'Removing…' : 'Remove bg'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VARIANT MANAGER
// ============================================================================
function VariantManager({ product, onProduct }: { product: CatalogProduct; onProduct: (p: CatalogProduct) => void }) {
  const { notify } = useApp();
  // Variants are OPTIONAL — collapsed by default, expand only when needed.
  const [open, setOpen] = useState(() => product.variants.length > 0);
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
    <div className="space-y-3">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-3 border rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <List size={16} className="text-gray-500" />
          Variants <span className="text-xs font-normal text-gray-400">— optional, only when the product has options like color/size</span>
        </span>
        <span className={`text-xs font-semibold ${open ? 'text-blue-600' : 'text-gray-500'}`}>
          {product.variants.length > 0 ? `${product.variants.length} added` : 'Click to expand'}
          <span className="ml-1">{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <>
          <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap gap-2 items-end">
            <div><label className={L}>Color</label><input value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} className={I} placeholder="Gray" /></div>
            <div><label className={L}>Size</label><input value={v.size} onChange={(e) => setV({ ...v, size: e.target.value })} className={I} placeholder="Large" /></div>
            <div><label className={L}>SKU</label><input value={v.sku} onChange={(e) => setV({ ...v, sku: e.target.value })} className={I} /></div>
            <div><label className={L}>Price</label><input type="number" step="0.01" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} className={I} placeholder={String(product.price)} /></div>
            <div><label className={L}>Stock</label><input type="number" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} className={I} /></div>
            <button onClick={add} className="btn-glow px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1.5"><Plus size={15} />Add variant</button>
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
        </>
      )}
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
          <button onClick={() => setCouponModal('new')} className="btn-glow px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />Coupon</button>
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
            <button onClick={saveSettings} className="btn-glow px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm">Save rule</button>
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
        <button onClick={download} className="btn-glow px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-sm flex items-center gap-2"><Download size={15} />Download feed CSV</button>
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
          <button onClick={save} disabled={saving} className="btn-glow flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg font-medium">{saving ? 'Saving…' : 'Save coupon'}</button>
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
