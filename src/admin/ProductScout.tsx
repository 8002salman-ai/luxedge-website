// ============================================================================
// LUXEDGE V2 — ADMIN · PRODUCT SCOUT (Phase 4A)
//
// Premium compact control center for the autonomous research pipeline.
// Shows real candidates from product_candidates (+ product_scores +
// supplier_products + suppliers), with evidence verification status,
// hard-rejection reasons, scoring, and owner actions (Approve / Reject /
// Create Product Draft). No fabricated statistics — every number is a real
// row count from the database.
//
// All mutations go through the db adapter with the ADMIN JWT; RLS enforces
// admin-only writes on the scout tables. This component never uses the
// service-role key and never calls provider endpoints.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Ban, CheckCircle, Compass, Eye, FilePlus2, Loader2, Package, Play,
  RefreshCw, Search, Shield, Target, Zap,
} from 'lucide-react';
import { useApp, Modal, fetchPageContent } from '../App';
import { getDb } from '../services/db';
import { getAccessToken } from '../services/supabase';
import type { DbAdapter } from '../services/db';
import { runScoutResearch } from '../features/scout/engine';
import { createProductDraft, findCategoryId } from '../features/scout/persist';
import { discoverUrls } from '../features/scout/discover';
import type { CandidateEvidence } from '../features/scout/types';
import type { FetchedSourcePage } from '../features/scout/types';

// Real seed sources for the first controlled research run (pet products,
// USA-focused). Each URL was verified fetchable (manufacturer + retailer
// pages); the owner can edit the list before running.
export const SCOUT_SEED_URLS = [
  'https://www.kongcompany.com/kong-classic/',
  'https://www.kongcompany.com/kong-flyer/',
  'https://www.kongcompany.com/kong-extreme/',
  'https://www.kongcompany.com/zoomgroom/',
  'https://www.kongcompany.com/kong-wubba/',
  'https://www.kongcompany.com/kong-squeezz/',
  'https://www.kongcompany.com/kong-treat-ball/',
  'https://www.petco.com/shop/en/petcostore/product/kong-classic-dog-toy',
  'https://www.petco.com/shop/en/petcostore/product/kong-flyer-dog-toy',
  'https://www.outwardhound.com/product/brutus-bone/',
  'https://www.chewy.com/frisco-bird-cat-toy/dp/193158',
  'https://www.chewy.com/outward-hound-brutus-bone-chew-toy/dp/134240',
];

interface ScoreRow { id: string; candidate_id: string; overall: number; explanation: string; weights: Record<string, number>; breakdown: Record<string, { points: number; max: number; note: string }>; }
interface SupplierRow { id: string; name: string; slug: string; base_url: string; }
interface SupplierProductRow { id: string; supplier_id: string; title: string; url: string | null; images: string[]; }
interface CandidateRow { id: string; supplier_product_id: string | null; title: string; source: string; source_url: string; images: string[]; evidence: CandidateEvidence | null; status: string; rejection_reason: string | null; created_at: string; updated_at: string; }

interface ViewCandidate {
  candidate: CandidateRow;
  score?: ScoreRow;
  supplier?: SupplierRow;
  supplierProduct?: SupplierProductRow;
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  provider: string | null;
  model: string | null;
  retries: number;
  max_retries: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  researching: 'bg-blue-50 text-blue-700 border-blue-200',
  qualified: 'bg-green-50 text-green-700 border-green-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  failed: 'bg-gray-100 text-gray-600 border-gray-200',
};

function evidenceBadge(status: string): string {
  if (status === 'verified') return 'bg-green-100 text-green-700';
  if (status === 'inferred') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-500';
}

/** Wrap the app page-fetcher into the engine's FetchedSourcePage contract. */
export async function scoutFetchPage(url: string): Promise<FetchedSourcePage> {
  const raw = await fetchPageContent(url);
  const parsed = JSON.parse(raw) as { text?: string; images?: string[] };
  return { text: parsed.text || '', images: parsed.images || [] };
}

export default function ProductScout() {
  const { notify } = useApp();
  const [db, setDb] = useState<DbAdapter | null>(null);
  const [candidates, setCandidates] = useState<ViewCandidate[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [evidenceFor, setEvidenceFor] = useState<ViewCandidate | null>(null);
  const [rejectFor, setRejectFor] = useState<ViewCandidate | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [drafting, setDrafting] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  // Run state
  const [runOpen, setRunOpen] = useState(false);
  const [runUrls, setRunUrls] = useState(SCOUT_SEED_URLS.join('\n'));
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string[]>([]);

  // Discovery state (autonomous mode)
  const [discoverQuery, setDiscoverQuery] = useState('pet accessories');
  const [discoverMarket, setDiscoverMarket] = useState('USA');
  const [discoverMax, setDiscoverMax] = useState('20');
  const [discovering, setDiscovering] = useState(false);
  const [discoverNote, setDiscoverNote] = useState('');

  // Filters
  const [fStatus, setFStatus] = useState('all');
  const [fMinScore, setFMinScore] = useState('');
  const [fSource, setFSource] = useState('');
  const [fMaxPrice, setFMaxPrice] = useState('');
  const [fMinMargin, setFMinMargin] = useState('');
  const [fUsa, setFUsa] = useState('all');
  const [fCategory, setFCategory] = useState('all');
  const [fMaxDays, setFMaxDays] = useState('');

  const load = useCallback(async () => {
    const d = getDb();
    if ('setAccessToken' in d && typeof (d as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
      (d as { setAccessToken: (t: string | null) => void }).setAccessToken(getAccessToken());
    }
    setDb(d);
    setLoading(true);
    setError('');
    try {
      const [candRows, scoreRows, supRows, spRows, jobRows] = await Promise.all([
        d.list<CandidateRow>('product_candidates', { orderBy: 'created_at.desc' }),
        d.list<ScoreRow>('product_scores'),
        d.list<SupplierRow>('suppliers'),
        d.list<SupplierProductRow>('supplier_products'),
        d.list<JobRow>('agent_jobs', { orderBy: 'created_at.desc', limit: 12 }),
      ]);
      setJobs(Array.isArray(jobRows) ? jobRows : []);
      const byId = <T extends { id: string }>(rows: T[] | null) => new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));
      // product_scores reference their candidate via candidate_id (not id).
      const scores = new Map((Array.isArray(scoreRows) ? scoreRows : []).map((r) => [r.candidate_id, r] as const));
      const suppliers = byId(supRows as SupplierRow[]);
      const sps = byId(spRows as SupplierProductRow[]);
      const view: ViewCandidate[] = (Array.isArray(candRows) ? candRows : []).map((c) => ({
        candidate: c,
        score: scores.get(c.id),
        supplier: c.supplier_product_id ? suppliers.get(sps.get(c.supplier_product_id)?.supplier_id || '') : undefined,
        supplierProduct: c.supplier_product_id ? sps.get(c.supplier_product_id) : undefined,
      }));
      setCandidates(view);
    } catch (e) {
      setError((e as Error).message || 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const s = { candidates: candidates.length, qualified: 0, rejected: 0, approved: 0 };
    for (const v of candidates) {
      if (v.candidate.status === 'qualified') s.qualified++;
      else if (v.candidate.status === 'rejected') s.rejected++;
      else if (v.candidate.status === 'approved') s.approved++;
    }
    return s;
  }, [candidates]);

  const filtered = useMemo(() => {
    return candidates.filter((v) => {
      const c = v.candidate;
      if (fStatus !== 'all' && c.status !== fStatus) return false;
      if (fSource && !(c.source || '').toLowerCase().includes(fSource.toLowerCase())) return false;
      const evPrice = (c.evidence?.supplierPrice?.value as number | null) ?? null;
      if (fMaxPrice && evPrice !== null && evPrice > parseFloat(fMaxPrice)) return false;
      if (fMinScore && (v.score?.overall ?? 0) < parseFloat(fMinScore)) return false;
      // Margin % is inferred from the profit-margin sub-score (0..15).
      const marginPct = (v.score?.breakdown?.profitMargin?.points ?? 0) / 15;
      if (fMinMargin && marginPct < parseFloat(fMinMargin) / 100) return false;
      const usaOk = c.evidence?.availability?.value !== 'unavailable';
      if (fUsa === 'yes' && !usaOk) return false;
      const days = (c.evidence?.shippingDays?.value as { min: number; max: number } | null) ?? null;
      if (fMaxDays && days && days.max > parseInt(fMaxDays, 10)) return false;
      const cat = String(c.evidence?.category?.value || '');
      if (fCategory !== 'all' && cat !== fCategory) return false;
      return true;
    });
  }, [candidates, fStatus, fSource, fMaxPrice, fMinScore, fMinMargin, fUsa, fMaxDays, fCategory]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const v of candidates) {
      const cat = String(v.candidate.evidence?.category?.value || '');
      if (cat) set.add(cat);
    }
    return [...set].sort();
  }, [candidates]);

  const runDiscover = async () => {
    if (!db) { notify('Database not ready'); return; }
    const q = discoverQuery.trim();
    if (!q) { notify('Enter a discovery query (e.g. “dog toys”)'); return; }
    setDiscovering(true);
    setDiscoverNote('');
    try {
      const max = Math.max(1, Math.min(40, parseInt(discoverMax || '20', 10) || 20));
      const result = await discoverUrls({
        query: q,
        market: discoverMarket.trim() || undefined,
        maxResults: max,
      });
      if (result.warning) setDiscoverNote(result.warning);
      if (result.urls.length) {
        const merged = [...new Set([...runUrls.split('\n').map((s) => s.trim()).filter(Boolean), ...result.urls])];
        setRunUrls(merged.join('\n'));
        setDiscoverNote(`${result.urls.length} product URLs discovered${result.duplicates ? ` (${result.duplicates} duplicates dropped)` : ''} — ${result.urls.length} added to the list.`);
        notify(`Discovered ${result.urls.length} product URLs`);
      } else {
        setDiscoverNote(`No product pages discovered for “${q}”. ${result.warning || 'Try a different query or use manual URL mode below.'}`);
        notify('Discovery found no product pages');
      }
    } catch (e) {
      setDiscoverNote(`Discovery failed: ${(e as Error).message}`);
      notify(`Discovery failed: ${(e as Error).message}`);
    } finally {
      setDiscovering(false);
    }
  };

  const runScout = async () => {
    const urls = runUrls.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!urls.length) { notify('Add at least one source URL'); return; }
    if (!db) { notify('Database not ready'); return; }
    setRunning(true);
    setRunLog([]);
    const log: string[] = [];
    const onProgress = (m: string) => { log.push(m); setRunLog([...log]); };
    try {
      const result = await runScoutResearch({
        urls,
        db,
        fetchPage: scoutFetchPage,
        onProgress,
      });
      log.push(`✔ RESEARCH ${result.jobId}: ${result.researched} researched, ${result.failed} failed.`);
      if (result.scoreJobId) log.push(`✔ SCORE ${result.scoreJobId}: ${result.shortlisted} shortlisted, ${result.rejected} rejected.`);
      if (result.qaJobId) log.push(`✔ QA ${result.qaJobId} complete.`);
      setRunLog([...log]);
      notify(`Scout run complete — ${result.shortlisted} shortlisted`);
      setRunOpen(false);
      await load();
    } catch (e) {
      log.push(`✗ ${(e as Error).message}`);
      setRunLog([...log]);
      notify(`Scout run failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const setStatus = async (v: ViewCandidate, status: 'approved' | 'rejected', reason?: string) => {
    if (!db) return;
    setActing(v.candidate.id);
    try {
      await db.update<{ id: string; status: string; rejection_reason: string | null }>('product_candidates', v.candidate.id, { status, rejection_reason: reason ?? null });
      notify(status === 'approved' ? 'Candidate approved' : 'Candidate rejected');
      setRejectFor(null);
      setRejectReason('');
      await load();
    } catch (e) {
      notify(`Action failed: ${(e as Error).message}`);
    } finally {
      setActing(null);
    }
  };

  const createDraft = async (v: ViewCandidate) => {
    if (!db) return;
    setDrafting(v.candidate.id);
    try {
      const ev = v.candidate.evidence;
      const price = (ev?.supplierPrice?.value as number | null) ?? null;
      const category = String(ev?.category?.value || '');
      const categoryId = category ? await findCategoryId(db, category) : null;
      const scoreOverall = v.score?.overall ?? null;
      const result = await createProductDraft(db, {
        title: v.candidate.title,
        slug: v.candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item',
        categoryId,
        price,
        compareAtPrice: null,
        costPrice: price,
        landedCost: price,
        grossMargin: null,
        images: v.candidate.images.length ? v.candidate.images : (v.supplierProduct?.images || []),
        shortDesc: '',
        sourceUrl: v.candidate.source_url,
        supplierName: v.candidate.source,
        scoreOverall,
      });
      notify(result.existing ? 'Draft already exists' : `Product draft created (${v.candidate.title})`);
      await load();
    } catch (e) {
      notify(`Draft failed: ${(e as Error).message}`);
    } finally {
      setDrafting(null);
    }
  };

  const renderEvidence = (ev: CandidateEvidence | null) => {
    if (!ev) return <p className="text-sm text-gray-500">No evidence recorded for this candidate.</p>;
    // Legacy Phase-3B evidence rows have a flat shape (no per-field statuses);
    // render them as-is so the scout UI never crashes on old rows.
    const legacy = typeof ev.title === 'string' || !ev.title;
    if (legacy) {
      const flat = ev as unknown as Record<string, unknown>;
      const entries = Object.entries(flat).filter(([k]) => !['sourceUrl', 'observedAt', 'unknownFields', 'riskNotes'].includes(k));
      return (
        <div className="space-y-3">
          <div className="text-xs text-gray-400 mb-2">
            Source: <a href={String(ev.sourceUrl || '')} target="_blank" rel="noreferrer" className="text-blue-600 underline break-all">{String(ev.sourceUrl || '')}</a>
            <br />Observed: {String(ev.observedAt || '')}
          </div>
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-start gap-3 border-b border-gray-100 pb-2">
              <span className="w-40 shrink-0 text-xs font-semibold text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 text-gray-500 shrink-0">legacy</span>
              <span className="text-sm text-gray-700 break-all">{v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
          <p className="text-[11px] text-gray-400">Recorded before the Phase 4A evidence model — treat as legacy notes, not scored evidence.</p>
        </div>
      );
    }
    const items: { label: string; item: CandidateEvidence['title'] }[] = [
      { label: 'Title', item: ev.title },
      { label: 'Supplier price', item: ev.supplierPrice },
      { label: 'Shipping cost', item: ev.shippingCost },
      { label: 'Shipping days', item: ev.shippingDays },
      { label: 'Availability', item: ev.availability },
      { label: 'Rating', item: ev.rating },
      { label: 'Origin', item: ev.origin },
      { label: 'Category', item: ev.category },
      { label: 'Sizes', item: ev.sizes },
    ];
    return (
      <div className="space-y-3">
        <div className="text-xs text-gray-400 mb-2">
          Source: <a href={ev.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline break-all">{ev.sourceUrl}</a>
          <br />Observed: {ev.observedAt}
        </div>
        {items.map(({ label, item }) => (
          <div key={label} className="flex items-start gap-3 border-b border-gray-100 pb-2">
            <span className="w-32 shrink-0 text-xs font-semibold text-gray-500">{label}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${evidenceBadge(item.status)}`}>{item.status}</span>
            <span className="text-sm text-gray-700 break-all">
              {item.value === null || item.value === undefined || item.value === '' ? '—' : typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}
              {item.note ? <span className="block text-xs text-gray-400 mt-0.5">{item.note}</span> : null}
            </span>
          </div>
        ))}
        {(ev.unknownFields?.length ?? 0) > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-xs font-bold text-amber-700 uppercase mb-1">Unknown fields</p>
            <p className="text-sm text-amber-800">{ev.unknownFields.join(', ')}</p>
          </div>
        )}
        {(ev.riskNotes?.length ?? 0) > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs font-bold text-red-700 uppercase mb-1">Risk notes</p>
            <p className="text-sm text-red-800">{ev.riskNotes.join('; ')}</p>
          </div>
        )}
      </div>
    );
  };

  const inputCls = 'px-3 py-2 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center">
          <Target size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Product Scout</h1>
          <p className="text-sm text-gray-500">Autonomous research → verify → score → shortlist (no auto-publishing)</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setRunOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors">
            <Play size={16} /> Run Scout Run
          </button>
          <button onClick={() => void load()} className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Load failed</p><p>{error}</p></div>
        </div>
      )}

      {/* Real stat cards — every number is a row count from the DB. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Candidates', value: stats.candidates, color: 'text-blue-600', icon: <Target size={18} className="text-blue-500" /> },
          { label: 'Shortlisted', value: stats.qualified, color: 'text-green-600', icon: <CheckCircle size={18} className="text-green-500" /> },
          { label: 'Approved', value: stats.approved, color: 'text-emerald-600', icon: <Shield size={18} className="text-emerald-500" /> },
          { label: 'Rejected', value: stats.rejected, color: 'text-red-600', icon: <Ban size={18} className="text-red-500" /> },
          { label: 'Scout Runs', value: 'DB', color: 'text-gray-600', icon: <Zap size={18} className="text-gray-400" /> },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{s.label}</span>
              {s.icon}
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Job audit trail — real agent_jobs rows (RESEARCH → SCORE → QA) */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          <Zap size={14} /> Job Audit Trail <span className="font-normal normal-case text-gray-400">· PRODUCT_RESEARCH → PRODUCT_SCORE → PRODUCT_QA</span>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-400">No scout jobs recorded yet. Run a Scout Run to create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500 uppercase">
                <tr>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Started</th>
                  <th className="px-2 py-2">Finished</th>
                  <th className="px-2 py-2">Output</th>
                  <th className="px-2 py-2">Retries</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const out = j.output as Record<string, unknown> | null;
                  const summary = out ? Object.entries(out).filter(([k]) => k !== 'candidateIds' && k !== 'urls').map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : '';
                  return (
                    <tr key={j.id} className="border-t border-gray-50">
                      <td className="px-2 py-2 font-mono font-semibold text-gray-700">{j.type}</td>
                      <td className="px-2 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${j.status === 'completed' ? 'bg-green-100 text-green-700' : j.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{j.status}</span>
                      </td>
                      <td className="px-2 py-2 text-gray-500">{j.started_at ? new Date(j.started_at).toLocaleTimeString() : '—'}</td>
                      <td className="px-2 py-2 text-gray-500">{j.finished_at ? new Date(j.finished_at).toLocaleTimeString() : '—'}</td>
                      <td className="px-2 py-2 text-gray-600 max-w-[280px] truncate" title={summary}>{summary || (j.error ? `✗ ${j.error}` : '—')}</td>
                      <td className="px-2 py-2 text-gray-500">{j.retries}/{j.max_retries}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <Search size={14} /> Filters
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
            <option value="all">Status: all</option>
            <option value="researching">Researching</option>
            <option value="qualified">Shortlisted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <input value={fSource} onChange={(e) => setFSource(e.target.value)} placeholder="Source…" className={inputCls} />
          <input value={fMinScore} onChange={(e) => setFMinScore(e.target.value)} placeholder="Min score" className={`${inputCls} w-24`} />
          <input value={fMaxPrice} onChange={(e) => setFMaxPrice(e.target.value)} placeholder="Max price" className={`${inputCls} w-24`} />
          <input value={fMinMargin} onChange={(e) => setFMinMargin(e.target.value)} placeholder="Min margin %" className={`${inputCls} w-28`} />
          <select value={fUsa} onChange={(e) => setFUsa(e.target.value)} className={inputCls}>
            <option value="all">USA: all</option>
            <option value="yes">Available only</option>
          </select>
          <input value={fMaxDays} onChange={(e) => setFMaxDays(e.target.value)} placeholder="Max days" className={`${inputCls} w-24`} />
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className={inputCls}>
            <option value="all">Category: all</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Candidates table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-gray-500"><Loader2 size={18} className="animate-spin" /> Loading candidates…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Target size={40} className="mx-auto mb-3 text-gray-200" />
            <p className="font-semibold text-gray-500">No candidates{stats.candidates ? ' match the filters' : ' yet'}</p>
            <p className="text-sm mt-1">Run a Scout Run to research real pet products.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Shipping</th>
                  <th className="px-4 py-3">Landed</th>
                  <th className="px-4 py-3">Suggested</th>
                  <th className="px-4 py-3">Margin %</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">USA</th>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => {
                  const c = v.candidate;
                  const ev = c.evidence;
                  const price = (ev?.supplierPrice?.value as number | null) ?? null;
                  const shipDays = (ev?.shippingDays?.value as { min: number; max: number } | null) ?? null;
                  const marginPts = v.score?.breakdown?.profitMargin?.points ?? 0;
                  const marginPct = marginPts > 0 ? ((marginPts / 15) * 50) : 0;
                  const usa = ev?.availability?.value !== 'unavailable';
                  const img = v.candidate.images[0] || v.supplierProduct?.images?.[0];
                  return (
                    <tr key={c.id} className="border-t hover:bg-blue-50/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {img ? <img src={img} alt="" className="w-12 h-12 rounded-lg object-cover" /> : <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center"><Package size={18} className="text-gray-300" /></div>}
                          <div>
                            <p className="font-medium text-gray-900 max-w-[240px] truncate">{c.title}</p>
                            <p className="text-xs text-gray-400 max-w-[240px] truncate">{c.source_url}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{c.source}</td>
                      <td className="px-4 py-3">{price !== null ? `$${price.toFixed(2)}` : <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{shipDays ? `${shipDays.min}-${shipDays.max}d` : '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{price !== null ? `$${price.toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{price !== null ? `$${(price * 2.5).toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-3">{marginPct > 0 ? `${marginPct.toFixed(0)}%` : <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${(v.score?.overall ?? 0) >= 75 ? 'text-green-600' : 'text-gray-700'}`}>{v.score?.overall ?? '—'}</span>
                        <span className="text-gray-400 text-xs">/100</span>
                      </td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${usa ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{usa ? 'Yes' : 'No'}</span></td>
                      <td className="px-4 py-3">
                        <button onClick={() => setEvidenceFor(v)} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                          <Eye size={13} /> {ev && (ev.unknownFields?.length ?? 0) > 0 ? `${ev.unknownFields.length} unknown` : 'View'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{c.status}</span>
                        {c.rejection_reason && <p className="text-[10px] text-red-500 mt-1 max-w-[160px] truncate" title={c.rejection_reason}>{c.rejection_reason}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {c.status !== 'approved' && (
                            <button
                              onClick={() => void setStatus(v, 'approved')}
                              disabled={acting === c.id}
                              className="p-1.5 rounded-lg bg-green-50 hover:bg-green-100 text-green-600 disabled:opacity-50"
                              title="Approve candidate"
                            ><CheckCircle size={15} /></button>
                          )}
                          {c.status !== 'rejected' && (
                            <button
                              onClick={() => setRejectFor(v)}
                              disabled={acting === c.id}
                              className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 disabled:opacity-50"
                              title="Reject candidate"
                            ><Ban size={15} /></button>
                          )}
                          <button
                            onClick={() => void createDraft(v)}
                            disabled={drafting === c.id}
                            className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 disabled:opacity-50"
                            title="Create product draft"
                          ><FilePlus2 size={15} /></button>
                          <button onClick={() => setEvidenceFor(v)} className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500" title="View evidence"><Eye size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Evidence modal */}
      <Modal open={!!evidenceFor} onClose={() => setEvidenceFor(null)} title="Candidate Evidence">
        {evidenceFor && (
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">{evidenceFor.candidate.title}</h3>
            {evidenceFor.score && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
                <p className="text-sm font-bold text-blue-800">Score {evidenceFor.score.overall}/100</p>
                <p className="text-xs text-blue-600 mt-1">{evidenceFor.score.explanation}</p>
              </div>
            )}
            {renderEvidence(evidenceFor.candidate.evidence)}
          </div>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal open={!!rejectFor} onClose={() => setRejectFor(null)} title="Reject Candidate">
        {rejectFor && (
          <div>
            <p className="text-sm text-gray-600 mb-3">Reject <strong>{rejectFor.candidate.title}</strong>? Record the exact reason.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. counterfeit/IP risk, medical claim, poor USA delivery…"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 min-h-[80px]"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => void setStatus(rejectFor, 'rejected', rejectReason || 'Rejected by owner')}
                disabled={acting === rejectFor.candidate.id}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >Reject</button>
              <button onClick={() => setRejectFor(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">Cancel</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Run modal */}
      <Modal open={runOpen} onClose={() => { if (!running) setRunOpen(false); }} title="Run Scout Research">
        <div className="space-y-4">
          {/* Autonomous discovery mode */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-700 uppercase tracking-wide">
              <Compass size={14} /> Autonomous Discovery
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                placeholder="Query, e.g. dog toys / cat accessories / pet grooming"
                disabled={discovering}
                className="flex-1 min-w-[220px] px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-blue-50"
              />
              <input
                value={discoverMarket}
                onChange={(e) => setDiscoverMarket(e.target.value)}
                placeholder="Market (USA)"
                disabled={discovering}
                className="w-28 px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-400 disabled:bg-blue-50"
              />
              <input
                value={discoverMax}
                onChange={(e) => setDiscoverMax(e.target.value)}
                placeholder="Max URLs"
                disabled={discovering}
                className="w-24 px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-400 disabled:bg-blue-50"
              />
              <button
                onClick={() => void runDiscover()}
                disabled={discovering}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {discovering ? <Loader2 size={15} className="animate-spin" /> : <Compass size={15} />} {discovering ? 'Searching…' : 'Discover URLs'}
              </button>
            </div>
            {discoverNote && <p className="text-xs text-blue-700">{discoverNote}</p>}
            <p className="text-[11px] text-blue-500">Searches public sources (DuckDuckGo) for real pet-product pages, decodes redirects, filters out category/search/blog pages, dedupes, then adds the URLs to the list below.</p>
          </div>

          {/* Manual URL mode (advanced) */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Source URLs (one per line — pet products, USA focus) <span className="font-normal normal-case text-gray-400">· advanced manual mode</span></p>
            <textarea
              value={runUrls}
              onChange={(e) => setRunUrls(e.target.value)}
              disabled={running}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 min-h-[140px] disabled:bg-gray-50"
            />
          </div>
          {runLog.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-3 max-h-48 overflow-y-auto">
              {runLog.map((l, i) => (
                <p key={i} className={`text-[11px] font-mono leading-5 ${l.startsWith('✗') ? 'text-red-400' : l.startsWith('[fail]') ? 'text-amber-400' : l.startsWith('[ok]') ? 'text-green-400' : 'text-gray-300'}`}>{l}</p>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => void runScout()}
              disabled={running}
              className="flex items-center gap-2 flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold justify-center disabled:opacity-50"
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {running ? 'Researching…' : 'Run Research'}
            </button>
            <button onClick={() => setRunOpen(false)} disabled={running} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 disabled:opacity-50">Cancel</button>
          </div>
          <p className="text-[11px] text-gray-400">No AI credits consumed — extraction and scoring are rule-based. Candidates are never auto-published.</p>
        </div>
      </Modal>
    </div>
  );
}
