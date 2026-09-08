// ============================================================================
// LUXEDGE — LISTING TASK (/admin/listing-task)
//
// Compose a batch import command (source platform + URL + count + category +
// pricing + status + instructions) and run it. The runner discovers product
// links from the source page and imports each one as a Draft (or Active when
// the Listing Playbook verification passes) with storage-backed images,
// supplier fields, SEO and SKU — never overwriting existing products.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { ArrowClockwise, ArrowLeft, BookBookmark, CheckCircle, ClockCounterClockwise, Package, Play, Warning } from '@phosphor-icons/react';
import { useApp } from '../App';
import { runBatchImport, type BatchItemResult } from '../features/catalog/batchImport';
import {
  normalizeListingTask, validateListingTask, parseListingTaskText, LISTING_TASK_CATEGORIES,
  applyPricingRule, type ListingTask, type SourcePlatform, type PricingMode,
} from '../features/catalog/listingTask';
import {
  getListingPlaybook, rulesForCategory, supplierBrandForUrl, effectiveStatusForImport,
  appendImportHistory,
} from '../features/catalog/listingPlaybook';
import {
  createProduct, updateProduct, getProduct, saveProductImages, saveProductVariants,
  listProducts, listCategories, setDbToken,
} from '../features/catalog/repository';
import {
  parseHtmlPage, buildScrapedEvidenceProduct, findDuplicateProduct, extractAliExpressItemId,
  buildImportImages, buildStorageImageInputs, buildImportVariants, importProductImagesToStorage,
} from '../features/ai/importer';
import { getAccessToken, getFreshAccessToken } from '../services/supabase';

const I = 'w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const L = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1';

const PLATFORMS: SourcePlatform[] = ['AliExpress', 'Amazon', 'eBay', 'Shopify', 'CJ', 'Other'];

export function ListingTaskAdmin() {
  const { notify } = useApp();
  const [task, setTask] = useState<ListingTask>(() => normalizeListingTask({
    sourcePlatform: 'AliExpress',
    sourceUrl: '',
    productCount: 10,
    category: 'Dog',
    pricing: { mode: 'markup', markupPct: 35 },
    status: 'draft',
    specialInstructions: '',
  }));
  const [cmdText, setCmdText] = useState('');
  const [showCmd, setShowCmd] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<BatchItemResult[]>([]);
  const [summary, setSummary] = useState<{ imported: number; duplicates: number; failed: number } | null>(null);

  useEffect(() => {
    void getListingPlaybook(); // warm the cache — used inside the runner
  }, []);

  const set = useCallback(<K extends keyof ListingTask>(k: K, v: ListingTask[K]) => {
    setTask((prev) => normalizeListingTask({ ...prev, [k]: v }));
  }, []);

  const setPricing = useCallback((patch: Partial<ListingTask['pricing']>) => {
    setTask((prev) => normalizeListingTask({ ...prev, pricing: { ...prev.pricing, ...patch } }));
  }, []);

  const applyCommand = () => {
    try {
      const parsed = parseListingTaskText(cmdText, task);
      setTask(parsed);
      setCmdText('');
      setShowCmd(false);
      notify('Command parsed — review the fields and press Run.');
    } catch {
      notify('Could not parse the command text.', 'error');
    }
  };

  const run = async () => {
    const v = validateListingTask(task);
    if (!v.ok) { notify(`Task invalid: ${v.errors.join(' ')}`, 'error'); return; }
    setRunning(true);
    setResults([]);
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    try {
      setDbToken(await getFreshAccessToken());
      const pb = await getListingPlaybook();
      const rules = rulesForCategory(pb, task.category);
      const cats = await listCategories();

      const result = await runBatchImport(task, {
        fetchPage: async (u) => {
          const token = getAccessToken();
          const r = await fetch(`/api/fetch-page?url=${encodeURIComponent(u)}`, {
            headers: { Accept: 'text/plain', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            signal: AbortSignal.timeout(60_000),
          });
          if (!r.ok) {
            const j = await r.json().catch(() => null);
            throw new Error(j?.error || `fetch-page HTTP ${r.status}`);
          }
          return r.text();
        },
        importOne: async (u, pageHtml, t) => {
          try {
            const page = parseHtmlPage(pageHtml);
            const scraped = buildScrapedEvidenceProduct(page, u);
            const title = scraped.title.trim();
            if (!title) return { status: 'failed', url: u, reason: 'No product title found on the page.' };

            // Duplicate protection: URL / item ID / SKU / slug / normalized title.
            const all = await listProducts();
            const dup = findDuplicateProduct(all, { url: u, itemId: extractAliExpressItemId(u), title, sku: scraped.sku });
            if (dup) return { status: 'duplicate', title };

            const categoryId = cats.find((c) => c.name.toLowerCase() === t.category.toLowerCase())?.id || null;
            const brand = supplierBrandForUrl(u, rules.brand) || scraped.brand || 'Luxedge';
            const sellingPrice = applyPricingRule(scraped.costPrice || 0, t.pricing);
            if (sellingPrice <= 0) return { status: 'failed', url: u, reason: 'Could not determine a selling price (no supplier cost and no fixed price configured).' };

            const maxImages = rules.maxImages ?? 5;
            const images = buildImportImages(scraped.images, scraped.images[0] || undefined).slice(0, maxImages);

            const created = await createProduct({
              name: title,
              shortTitle: title.slice(0, 60),
              shortDescription: scraped.shortDescription || undefined,
              description: scraped.longDescription || scraped.shortDescription || undefined,
              brand,
              categoryId,
              status: 'draft',
              price: sellingPrice,
              costPrice: (scraped.costPrice || 0) > 0 ? scraped.costPrice : undefined,
              inventoryQty: 0,
              freeShipping: false,
              sku: scraped.sku || undefined,
              supplierSource: t.sourcePlatform,
              supplierProductRef: extractAliExpressItemId(u) || undefined,
              supplierUrl: u,
              sourceType: 'OTHER_VERIFIED',
              inventorySource: 'UNKNOWN',
              tags: (scraped.tags || []).slice(0, 12),
              seoTitle: scraped.metaTitle || title,
              seoDescription: scraped.metaDescription || scraped.shortDescription || '',
              seoKeywords: (scraped.seoKeywords || []).slice(0, 20),
              ownerNotes: t.specialInstructions ? `Listing Task: ${t.specialInstructions}` : undefined,
              evidenceNotes: `Batch import via Listing Task (${t.sourcePlatform}). Source: ${u}. Supplier list price evidence: ${(scraped.sellingPrice || 0) > 0 ? `$${Number(scraped.sellingPrice).toFixed(2)}` : 'UNKNOWN'}.`,
            });

            // Images — storage-first (download + upload), supplier URLs as fallback.
            let imageRows = images;
            if (images.length) {
              try {
                const sr = await importProductImagesToStorage(created.id, images.map((im) => im.url));
                if (sr.ok && sr.uploaded.length) imageRows = buildStorageImageInputs(sr.uploaded, images[0]?.url);
              } catch {
                // supplier URLs stay — surfaced below via imageCount
              }
            }
            await saveProductImages(created.id, imageRows);

            const variants = buildImportVariants((scraped as { variants?: { attributes?: Record<string, string>; sku?: string; price?: number }[] }).variants || []);
            if (variants.length) await saveProductVariants(created.id, variants);

            // Playbook status: Active only with verified images >= min, else Draft.
            const verifiedCount = imageRows.length;
            let finalStatus = 'draft';
            const wanted = effectiveStatusForImport(pb, t.category, verifiedCount, t.status);
            if (wanted === 'active' && verifiedCount >= (rules.minImages ?? 3)) {
              const updated = await updateProduct(created.id, { status: 'active' });
              const check = updated ? await getProduct(created.id) : null;
              if (check && check.status === 'active') finalStatus = 'active';
            }
            return { status: 'imported', productId: created.id, title, finalStatus, imageCount: verifiedCount };
          } catch (e) {
            return { status: 'failed', url: u, reason: (e as Error).message };
          }
        },
        delayMs: 1500,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      setResults(result.results);
      setSummary({ imported: result.imported, duplicates: result.duplicates, failed: result.failed });
      await appendImportHistory({
        id: `batch-${Date.now()}`,
        source: task.sourceUrl,
        sourceType: 'url',
        date: new Date().toISOString(),
        provider: 'Listing Task',
        model: `${task.productCount} products · ${task.sourcePlatform}`,
        productTitle: `${result.imported} imported / ${result.duplicates} dup / ${result.failed} failed`,
        status: result.failed === 0 && result.imported > 0 ? 'success' : result.imported > 0 ? 'partial' : 'failed',
        importTime: 0,
      });
      notify(`Batch done: ${result.imported} imported, ${result.duplicates} duplicates skipped, ${result.failed} failed.`);
    } catch (e) {
      notify(`Batch run failed: ${(e as Error).message}`, 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-10">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => window.history.back()} className="p-2 hover:bg-gray-200/70 rounded-lg"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Listing Task</h1>
          <p className="text-xs text-gray-500">Batch-import products from a source page following the Listing Playbook.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowCmd((s) => !s)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">Paste command</button>
          <button onClick={() => window.open('/admin/settings/listing-playbook', '_self')} className="px-3 py-1.5 border border-blue-200 bg-blue-50 rounded-lg text-xs text-blue-700 hover:bg-blue-100 flex items-center gap-1"><BookBookmark size={13} /> Playbook</button>
          <button onClick={run} disabled={running} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <Play size={14} />{running ? 'Running…' : 'Run Listing Task'}
          </button>
        </div>
      </div>

      {showCmd && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Paste a natural-language command, e.g.:</p>
          <p className="text-[11px] text-gray-400 italic">“Import 8 products from AliExpress for Cattle category with 40% markup, keep Draft, skip livestock claims”</p>
          <textarea value={cmdText} onChange={(e) => setCmdText(e.target.value)} rows={3} className={I} placeholder="Paste your listing command here…" />
          <div className="flex gap-2">
            <button onClick={applyCommand} className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-xs font-semibold">Apply command</button>
            <button onClick={() => setShowCmd(false)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Package size={15} className="text-blue-500" />
          <h2 className="text-sm font-semibold text-gray-800">Task setup</h2>
        </div>
        <div className="p-4 grid md:grid-cols-3 gap-3">
          <div><label className={L}>Source platform</label>
            <select value={task.sourcePlatform} onChange={(e) => set('sourcePlatform', e.target.value as SourcePlatform)} className={I}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="md:col-span-2"><label className={L}>Source URL (product / category / search page)</label>
            <input value={task.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} className={I} placeholder="https://www.aliexpress.com/… or any product/category page" />
          </div>
          <div><label className={L}>Number of products</label>
            <input type="number" min={1} max={500} value={task.productCount} onChange={(e) => set('productCount', parseInt(e.target.value, 10) || 1)} className={I} />
          </div>
          <div><label className={L}>LuxEdge category</label>
            <select value={task.category} onChange={(e) => set('category', e.target.value)} className={I}>
              {LISTING_TASK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className={L}>Product status</label>
            <select value={task.status} onChange={(e) => set('status', e.target.value as ListingTask['status'])} className={I}>
              <option value="draft">Draft (safe default)</option>
              <option value="active">Active (only if fully verified)</option>
            </select>
          </div>
          <div><label className={L}>Pricing rule</label>
            <select value={task.pricing.mode} onChange={(e) => setPricing({ mode: e.target.value as PricingMode })} className={I}>
              <option value="markup">Markup %</option>
              <option value="fixed">Fixed price</option>
              <option value="min-margin">Minimum margin %</option>
            </select>
          </div>
          {task.pricing.mode === 'markup' && (
            <div><label className={L}>Markup %</label><input type="number" min={0} value={task.pricing.markupPct ?? 35} onChange={(e) => setPricing({ markupPct: parseInt(e.target.value, 10) || 0 })} className={I} /></div>
          )}
          {task.pricing.mode === 'fixed' && (
            <div><label className={L}>Fixed price ($)</label><input type="number" min={0} value={task.pricing.fixedPrice ?? 0} onChange={(e) => setPricing({ fixedPrice: parseFloat(e.target.value) || 0 })} className={I} /></div>
          )}
          {task.pricing.mode === 'min-margin' && (
            <div><label className={L}>Min margin %</label><input type="number" min={1} max={90} value={task.pricing.minMarginPct ?? 25} onChange={(e) => setPricing({ minMarginPct: parseInt(e.target.value, 10) || 0 })} className={I} /></div>
          )}
          <div className="md:col-span-3"><label className={L}>Special instructions</label>
            <input value={task.specialInstructions} onChange={(e) => set('specialInstructions', e.target.value)} className={I} placeholder="e.g. avoid livestock claims, only horse products, price under $30…" />
          </div>
        </div>
      </div>

      {running && (
        <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <ArrowClockwise size={16} className="animate-spin" />
          Processing {progress.done}/{progress.total || '…'} products…
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center"><p className="text-2xl font-bold text-emerald-700">{summary.imported}</p><p className="text-[11px] text-emerald-600 font-semibold">IMPORTED</p></div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center"><p className="text-2xl font-bold text-amber-700">{summary.duplicates}</p><p className="text-[11px] text-amber-600 font-semibold">DUPLICATES SKIPPED</p></div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center"><p className="text-2xl font-bold text-red-600">{summary.failed}</p><p className="text-[11px] text-red-500 font-semibold">FAILED</p></div>
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <ClockCounterClockwise size={15} className="text-blue-500" />
            <h2 className="text-sm font-semibold text-gray-800">Results</h2>
            <span className="text-[10px] text-gray-400 ml-auto">{results.length} products</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                <tr><th className="px-4 py-2 font-semibold">#</th><th className="px-4 py-2 font-semibold">Product</th><th className="px-4 py-2 font-semibold">Status</th><th className="px-4 py-2 font-semibold">Images</th><th className="px-4 py-2 font-semibold">Detail</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((r, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2 max-w-[260px]">
                      <p className="font-medium text-gray-800 truncate" title={r.url}>{r.status === 'imported' || r.status === 'duplicate' ? r.title : r.url}</p>
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 truncate block">{r.url}</a>
                    </td>
                    <td className="px-4 py-2">
                      {r.status === 'imported' && <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${r.finalStatus === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}><CheckCircle size={11} />{r.finalStatus === 'active' ? 'ACTIVE' : 'DRAFT'}</span>}
                      {r.status === 'duplicate' && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"><Warning size={11} />DUPLICATE</span>}
                      {r.status === 'failed' && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600"><Warning size={11} />FAILED</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{r.status === 'imported' ? r.imageCount : '—'}</td>
                    <td className="px-4 py-2 text-gray-500 max-w-[280px]">{r.status === 'failed' ? r.reason : r.status === 'imported' ? `slug verified, supplier data saved` : 'existing product kept untouched'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-[11px] text-blue-700">
        <Warning size={14} className="mt-0.5 shrink-0" />
        <p>Imports never overwrite or delete existing products. Products with fewer than the playbook minimum verified images stay Draft.
          Variants/stock that load only via JavaScript are not captured by page scraping — use the single-product AI Import for those.</p>
      </div>
    </div>
  );
}