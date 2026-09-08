// ============================================================================
// LUXEDGE — LISTING PLAYBOOK ADMIN (/admin/settings/listing-playbook)
//
// Database-backed listing rules governing product creation and imports.
// Every field persists to Supabase (store_settings key), NOT localStorage.
// Includes per-category presets (Dog, Cat, Horse, Cattle, Feeding & Water,
// Other), the automation preset, and JSON export/import for backups.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FloppyDisk, ArrowSquareIn, Plus, Warning } from '@phosphor-icons/react';
import { useApp } from '../App';
import {
  defaultListingPlaybook, getListingPlaybook, saveListingPlaybook,
  listingPlaybookToJson, parseListingPlaybookJson,
  DEFAULT_CATEGORY_KEYS,
  type ListingPlaybook, type CategoryListingRules,
} from '../features/catalog/listingPlaybook';

const I = 'w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const L = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1';

function NumField({ label, value, onChange, min = 0, max = 10 }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number;
}) {
  return (
    <div className="min-w-[90px]">
      <label className={L}>{label}</label>
      <input type="number" min={min} max={max} value={Number.isFinite(value) ? value : 0}
        onChange={(e) => { const n = parseInt(e.target.value, 10); onChange(Number.isNaN(n) ? min : Math.min(max, Math.max(min, n))); }}
        className={I} />
    </div>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (b: boolean) => void; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-2 text-sm text-gray-700" aria-pressed={value}>
      <span className={`w-9 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-300'}`}>
        <span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mt-0.5 ${value ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
      <span>{label}</span>
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </button>
  );
}

function Card({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        {accent && <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />}
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function ListingPlaybookAdmin() {
  const { notify } = useApp();
  const nav = useNavigate();
  const [pb, setPb] = useState<ListingPlaybook | null>(null);
  const [saving, setSaving] = useState(false);
  const [json, setJson] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void getListingPlaybook().then((p) => { setPb(p); setJson(listingPlaybookToJson(p)); });
  }, []);

  const updateRules = useCallback((key: keyof ListingPlaybook, patch: Partial<CategoryListingRules>) => {
    setPb((prev) => {
      if (!prev) return prev;
      const section = prev[key];
      if (!section || typeof section !== 'object') return prev;
      return { ...prev, [key]: { ...(section as object), ...patch } as never };
    });
    setDirty(true);
  }, []);

  const updateCategory = useCallback((cat: string, patch: Partial<CategoryListingRules>) => {
    setPb((prev) => {
      if (!prev) return prev;
      const current = prev.categories[cat] || {};
      return { ...prev, categories: { ...prev.categories, [cat]: { ...current, ...patch } } };
    });
    setDirty(true);
  }, []);

  const updateAutomation = useCallback((patch: Partial<ListingPlaybook['automation']>) => {
    setPb((prev) => (prev ? { ...prev, automation: { ...prev.automation, ...patch } } : prev));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!pb) return;
    setSaving(true);
    try {
      const saved = await saveListingPlaybook(pb);
      setPb(saved);
      setJson(listingPlaybookToJson(saved));
      setDirty(false);
      notify('Listing Playbook saved to the database.');
    } catch (e) {
      notify(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const exportJson = () => {
    if (!pb) return;
    const blob = new Blob([listingPlaybookToJson(pb)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `luxedge-listing-playbook-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const applyJson = () => {
    try {
      const parsed = parseListingPlaybookJson(json);
      setPb(parsed);
      setJson(listingPlaybookToJson(parsed));
      setDirty(true);
      setShowImport(false);
      notify('Playbook JSON imported — review and save.');
    } catch (e) {
      notify(`Invalid playbook JSON: ${(e as Error).message}`, 'error');
    }
  };

  const resetDefaults = () => {
    const d = defaultListingPlaybook();
    setPb(d);
    setJson(listingPlaybookToJson(d));
    setDirty(true);
    notify('Defaults loaded — press Save to persist.');
  };

  if (!pb) {
    return (
      <div className="max-w-4xl mx-auto py-10 text-center text-sm text-gray-400">
        <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin align-middle mr-2" />
        Loading Listing Playbook…
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => nav('/admin/settings')} className="p-2 hover:bg-gray-200/70 rounded-lg"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Listing Playbook</h1>
          <p className="text-xs text-gray-500">Database-backed listing rules that govern product creation and imports.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${dirty ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {dirty ? 'UNSAVED CHANGES' : 'SAVED'}
          </span>
          <button onClick={resetDefaults} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">Reset defaults</button>
          <button onClick={() => setShowImport((v) => !v)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-1"><ArrowSquareIn size={13} />Import JSON</button>
          <button onClick={exportJson} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-1"><Download size={13} />Export JSON</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <FloppyDisk size={14} />{saving ? 'Saving…' : 'Save to database'}
          </button>
        </div>
      </div>

      {showImport && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Paste playbook JSON (from a previous export) and press Apply.</p>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={6} className={I + ' font-mono text-xs'} spellCheck={false} />
          <div className="flex gap-2">
            <button onClick={applyJson} className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-xs font-semibold">Apply JSON</button>
            <button onClick={() => setShowImport(false)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        {/* Global rules */}
        <Card title="Global listing rules" accent="#3b82f6">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <NumField label="Min images" value={pb.global.minImages ?? 3} onChange={(n) => updateRules('global', { minImages: n })} min={0} max={10} />
              <NumField label="Max images" value={pb.global.maxImages ?? 5} onChange={(n) => updateRules('global', { maxImages: n })} min={0} max={10} />
            </div>
            <div className="flex flex-wrap gap-4">
              <Toggle label="Require supplier data (URL, name, SKU)" value={pb.global.requiredSupplierData ?? true} onChange={(b) => updateRules('global', { requiredSupplierData: b })} />
              <Toggle label="Never placeholder / inline images" value={pb.global.neverPlaceholder ?? true} onChange={(b) => updateRules('global', { neverPlaceholder: b } as unknown as Partial<CategoryListingRules>)} hint="(recommended)" />
            </div>
            <div className="min-w-[140px] max-w-[200px]">
              <label className={L}>Default status for new imports</label>
              <select value={pb.global.defaultStatus ?? 'draft'} onChange={(e) => updateRules('global', { defaultStatus: e.target.value as 'draft' | 'active' })} className={I}>
                <option value="draft">Draft (safe)</option>
                <option value="active">Active (only if fully verified)</option>
              </select>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Active products require at least the minimum images, all verified (real HTTP URLs, no placeholders), plus supplier URL / name / SKU.
              Anything missing → the product stays Draft.
            </p>
          </div>
        </Card>

        {/* Automation preset */}
        <Card title="Import automation preset" accent="#f59e0b">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className={L}>Source site</label><input value={pb.automation.sourceSite} onChange={(e) => updateAutomation({ sourceSite: e.target.value })} className={I} placeholder="AliExpress" /></div>
              <div><label className={L}>Source / category URL</label><input value={pb.automation.sourceUrl} onChange={(e) => updateAutomation({ sourceUrl: e.target.value })} className={I} placeholder="https://…" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={L}>Products to import</label><input type="number" min={1} max={500} value={pb.automation.productCount} onChange={(e) => updateAutomation({ productCount: parseInt(e.target.value, 10) || 1 })} className={I} /></div>
              <div><label className={L}>Default category</label>
                <select value={pb.automation.defaultCategory} onChange={(e) => updateAutomation({ defaultCategory: e.target.value })} className={I}>
                  {DEFAULT_CATEGORY_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={L}>Price mode</label>
                <select value={pb.automation.priceMode} onChange={(e) => updateAutomation({ priceMode: e.target.value as 'markup' | 'fixed' })} className={I}>
                  <option value="markup">Markup %</option>
                  <option value="fixed">Fixed price</option>
                </select>
              </div>
              <div><label className={L}>Markup %</label><input type="number" min={0} max={1000} value={pb.automation.markupPct} onChange={(e) => updateAutomation({ markupPct: parseInt(e.target.value, 10) || 0 })} className={I} /></div>
              <div><label className={L}>Fixed price</label><input type="number" min={0} value={pb.automation.fixedPrice} onChange={(e) => updateAutomation({ fixedPrice: parseFloat(e.target.value) || 0 })} className={I} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={L}>Min margin %</label><input type="number" min={0} max={100} value={pb.automation.minMarginPct} onChange={(e) => updateAutomation({ minMarginPct: parseInt(e.target.value, 10) || 0 })} className={I} /></div>
              <div><label className={L}>Min images</label><input type="number" min={0} max={10} value={pb.automation.minImages} onChange={(e) => updateAutomation({ minImages: parseInt(e.target.value, 10) || 0 })} className={I} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Toggle label="Free shipping" value={pb.automation.freeShipping} onChange={(b) => updateAutomation({ freeShipping: b })} />
              <div><label className={L}>Shipping cost</label><input type="number" min={0} value={pb.automation.shippingCost} onChange={(e) => updateAutomation({ shippingCost: parseFloat(e.target.value) || 0 })} className={I} /></div>
            </div>
            <div><label className={L}>Special instructions</label><textarea value={pb.automation.instructions} onChange={(e) => updateAutomation({ instructions: e.target.value })} rows={2} className={I} placeholder="e.g. skip products without 3 verified images, keep duplicates skipped…" /></div>
          </div>
        </Card>
      </div>

      {/* Category presets */}
      <div>
        <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
          <Plus size={15} className="text-blue-500" /> Category presets
          <span className="text-[11px] font-normal text-gray-400">Rules apply automatically when an import is categorized.</span>
        </h2>
        <div className="grid md:grid-cols-2 gap-5">
          {DEFAULT_CATEGORY_KEYS.map((key) => {
            const r = pb.categories[key] || {};
            return (
              <div key={key} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">{key}</span>
                  <span className="text-[10px] text-gray-400 font-medium">{r.defaultStatus === 'active' ? 'Active default' : 'Draft default'}</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={L}>Brand (supplier rule)</label><input value={r.brand || ''} onChange={(e) => updateCategory(key, { brand: e.target.value })} className={I} placeholder="e.g. HimalayanKoh" /></div>
                    <div><label className={L}>Default status</label>
                      <select value={r.defaultStatus || 'draft'} onChange={(e) => updateCategory(key, { defaultStatus: e.target.value as 'draft' | 'active' })} className={I}>
                        <option value="draft">Draft</option><option value="active">Active</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <NumField label="Min images" value={r.minImages ?? 3} onChange={(n) => updateCategory(key, { minImages: n })} />
                    <NumField label="Max images" value={r.maxImages ?? 5} onChange={(n) => updateCategory(key, { maxImages: n })} />
                    <div className="min-w-[120px]"><label className={L}>Markup %</label><input type="number" value={r.markupPct ?? ''} onChange={(e) => updateCategory(key, { markupPct: e.target.value === '' ? null : parseFloat(e.target.value) })} className={I} placeholder="inherit" /></div>
                    <div className="min-w-[120px]"><label className={L}>Min margin %</label><input type="number" value={r.minMarginPct ?? ''} onChange={(e) => updateCategory(key, { minMarginPct: e.target.value === '' ? null : parseFloat(e.target.value) })} className={I} placeholder="inherit" /></div>
                  </div>
                  <div><label className={L}>Default tags (comma separated)</label>
                    <input value={(r.defaultTags || []).join(', ')} onChange={(e) => updateCategory(key, { defaultTags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} className={I} placeholder="collar, dog, premium" />
                  </div>
                  <div><label className={L}>Shipping note</label><input value={r.shippingNote || ''} onChange={(e) => updateCategory(key, { shippingNote: e.target.value })} className={I} /></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-[11px] text-blue-700">
        <Warning size={14} className="mt-0.5 shrink-0" />
        <p>These rules are enforced by the product editor and the AI import pipeline (min images, verified image URLs, supplier data, brand rule, duplicate protection).
          They persist in the Supabase database — they are not browser settings.</p>
      </div>
    </div>
  );
}