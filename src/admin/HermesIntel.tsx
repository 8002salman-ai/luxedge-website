// ============================================================================
// LUXEDGE — ADMIN AI INTELLIGENCE (Hermes research feeds)
//
// Displays research evidence ingested from Hermes / Salman OS. This is a
// REVIEW surface, not an execution surface:
//   - Opportunities, SEO suggestions and marketing intel arrive as research
//     evidence (status 'new').
//   - Luxedge's own scoring (score.ts) pre-screens product suggestions; the
//     real qualification still happens in Product Scout / the product
//     pipeline with supplier verification and owner authorization.
//   - Status changes (accepted/rejected/implemented/...) are Luxedge's OWN
//     review decisions. Nothing here can create or publish a product.
//   - Ads readiness is computed from Luxedge economics only (adsReadiness.ts);
//     it never launches a campaign and never spends money.
// ============================================================================
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useApp, Modal } from '../App';
import { getAccessToken } from '../services/supabase';
import {
  setDbToken, listRecommendations, listSeoSuggestions, listMarketingIntel, listAdsReadiness,
  updateRecommendation, updateSeoSuggestion, updateMarketingIntel,
  deleteRecommendation, deleteSeoSuggestion, deleteMarketingIntel,
  insertAdsReadiness, RECOMMENDATION_STATUSES, SEO_STATUSES,
} from '../features/hermes/repository';
import { scoreHermesRecommendation, recommendationRowToInput, scoreBand } from '../features/hermes/score';
import { computeAdsReadiness } from '../features/hermes/adsReadiness';
import { adsReadinessToRow } from '../features/hermes/rows';
import type { HermesRecommendationRow, HermesSeoSuggestionRow, HermesMarketingIntelRow, AdsReadinessRow } from '../features/hermes/types';
import {
  Brain, Target, MagnifyingGlass, Lightbulb, TrendUp, Trash,
  CaretDown, CaretRight, ShieldCheck, NotePencil,
} from '@phosphor-icons/react';

const BADGE: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-amber-100 text-amber-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  imported: 'bg-purple-100 text-purple-700',
  implemented: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-gray-100 text-gray-600',
};

function useDbToken() {
  useEffect(() => {
    setDbToken(getAccessToken());
  }, []);
}

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(2)}`);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');

function StatusSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border-0 cursor-pointer ${BADGE[value] || BADGE.new}`}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ============================================================================
// OPPORTUNITIES (product suggestions)
// ============================================================================
function OpportunitiesTab() {
  const { notify } = useApp();
  const [rows, setRows] = useState<HermesRecommendationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [delId, setDelId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await listRecommendations());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    await updateRecommendation(id, { status: status as HermesRecommendationRow['status'] });
    notify(`Recommendation marked ${status}`);
    await load();
  };

  const saveNote = async () => {
    if (!noteId) return;
    await updateRecommendation(noteId, { review_note: note.trim() || null });
    notify('Review note saved');
    setNoteId(null);
    setNote('');
    await load();
  };

  const scoreRecommendation = async (row: HermesRecommendationRow) => {
    const s = scoreHermesRecommendation(recommendationRowToInput(row));
    await updateRecommendation(row.id, { luxedge_score: s.total });
    notify(`Luxedge Opportunity Score: ${s.total}/100 (${scoreBand(s.total)})`);
    await load();
  };

  const assessAds = async (row: HermesRecommendationRow) => {
    const a = computeAdsReadiness({
      sellingPrice: row.expected_selling_price,
      landedCost: row.landed_cost,
      estimatedVariableCosts: null,
    });
    await insertAdsReadiness(adsReadinessToRow({
      product_id: null, recommendation_id: row.id,
      selling_price: row.expected_selling_price, landed_cost: row.landed_cost,
      gross_margin: a.grossMargin, estimated_variable_costs: null,
      contribution_margin: a.contributionMargin, break_even_cac: a.breakEvenCac,
      allowable_cac: a.allowableCac, assessment: a.assessment, readiness: a.readiness,
    }));
    notify(`Ads readiness: ${a.readiness}`);
    await load();
  };

  if (loading) return <div className="py-16 text-center text-sm text-gray-500">Loading opportunities…</div>;

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed p-12 text-center text-gray-500">
        <Brain size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="font-medium text-gray-600">No Hermes product suggestions yet</p>
        <p className="text-xs mt-1">Suggestions arrive through /api/hermes/ingest from Salman OS / Hermes. They are research evidence only — Luxedge validates, scores and decides.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Product</th>
              <th className="px-3 py-2.5 font-semibold">Supplier / Price</th>
              <th className="px-3 py-2.5 font-semibold">Score</th>
              <th className="px-3 py-2.5 font-semibold">Source</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = scoreHermesRecommendation(recommendationRowToInput(r));
              const band = scoreBand(s.total);
              const bandColor = band === 'strong' ? 'bg-green-100 text-green-700' : band === 'promising' ? 'bg-emerald-100 text-emerald-700' : band === 'moderate' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500';
              return (
                <Fragment key={r.id}>
                  <tr className="border-t hover:bg-gray-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <button className="flex items-center gap-2 text-left" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? <CaretDown size={13} className="text-gray-400 shrink-0" /> : <CaretRight size={13} className="text-gray-400 shrink-0" />}
                        <div>
                          <p className="font-medium text-[13px] text-gray-900">{r.product_name}</p>
                          <p className="text-[11px] text-gray-400">{[r.category, r.brand].filter(Boolean).join(' · ') || 'uncategorized'}</p>
                        </div>
                      </button>
                      {expanded === r.id && (
                        <div className="mt-3 pl-7 space-y-2 text-xs text-gray-600">
                          {r.source_url && <p><span className="text-gray-400">Source:</span> <a href={r.source_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{r.source_url}</a></p>}
                          {r.benefits && <p><span className="text-gray-400">Benefits:</span> {r.benefits}</p>}
                          {r.risks && <p><span className="text-gray-400">Risks:</span> {r.risks}</p>}
                          {r.demand_evidence && <p><span className="text-gray-400">Demand evidence (research claim):</span> {r.demand_evidence}</p>}
                          {r.recommendation && <p><span className="text-gray-400">Hermes recommendation:</span> {r.recommendation}</p>}
                          <p className="text-[10px] text-gray-400">
                            Validation: all fields <span className="font-semibold">unknown</span> at ingest — research claims require Luxedge verification before use. · Confidence: {r.confidence === null ? '—' : `${Math.round(r.confidence * 100)}%`}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600">
                      <p>{r.supplier || '—'}</p>
                      <p className="text-[11px] text-gray-400">
                        cost {money(r.supplier_price)}{r.landed_cost !== null && r.landed_cost !== undefined ? ` · landed ${money(r.landed_cost)}` : ''} · sell {money(r.expected_selling_price)}
                      </p>
                      {s.marginPercent !== null && <p className="text-[11px] font-medium text-emerald-600">margin {pct(s.marginPercent)} ({s.marginSource === 'landed_cost' ? 'landed' : 'supplier+ship'})</p>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${bandColor}`}>{r.luxedge_score ?? s.total}</span>
                      <button onClick={() => void scoreRecommendation(r)} className="ml-1.5 text-[10px] text-blue-600 hover:underline align-middle">recompute</button>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-gray-500">{r.source}<span className="text-gray-300"> · </span>{r.received_via}</td>
                    <td className="px-3 py-3">
                      <StatusSelect value={r.status} onChange={(v) => void setStatus(r.id, v)} options={RECOMMENDATION_STATUSES} />
                      {r.review_note && <p className="text-[10px] text-gray-400 mt-1 max-w-[160px] truncate" title={r.review_note}>✎ {r.review_note}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {r.expected_selling_price !== null && r.landed_cost !== null && (
                          <button onClick={() => void assessAds(r)} className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600" title="Compute Luxedge ads readiness"><TrendUp size={14} /></button>
                        )}
                        <button onClick={() => { setNoteId(r.id); setNote(r.review_note ?? ''); }} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Review note"><NotePencil size={14} /></button>
                        <button onClick={() => setDelId(r.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="Delete suggestion"><Trash size={14} /></button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete suggestion?">
        <p className="text-gray-600 mb-6">This removes the research suggestion. It never affects any Luxedge product.</p>
        <div className="flex gap-3">
          <button onClick={async () => { if (delId) { await deleteRecommendation(delId); notify('Suggestion deleted'); setDelId(null); await load(); } }} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button>
          <button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button>
        </div>
      </Modal>

      <Modal open={!!noteId} onClose={() => setNoteId(null)} title="Review note">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" placeholder="Luxedge review decision / verification notes…" />
        <div className="flex gap-3 mt-4">
          <button onClick={saveNote} className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium">Save note</button>
          <button onClick={() => setNoteId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// SEO SUGGESTIONS
// ============================================================================
function SeoTab() {
  const { notify } = useApp();
  const [rows, setRows] = useState<HermesSeoSuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [delId, setDelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await listSeoSuggestions());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    await updateSeoSuggestion(id, { status: status as HermesSeoSuggestionRow['status'] });
    notify(`SEO suggestion marked ${status}`);
    await load();
  };

  if (loading) return <div className="py-16 text-center text-sm text-gray-500">Loading SEO suggestions…</div>;

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed p-12 text-center text-gray-500">
        <MagnifyingGlass size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="font-medium text-gray-600">No Hermes SEO suggestions yet</p>
        <p className="text-xs mt-1">SEO research arrives here and is NEVER auto-applied — Luxedge's own SEO engine evaluates and implements accepted suggestions.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Recommendation</th>
              <th className="px-3 py-2.5 font-semibold">Type</th>
              <th className="px-3 py-2.5 font-semibold">Keyword / URL</th>
              <th className="px-3 py-2.5 font-semibold">Priority</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-gray-50/70 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-[13px] text-gray-900">{r.recommendation}</p>
                  {r.evidence && <p className="text-[11px] text-gray-400 mt-0.5 max-w-[420px] truncate" title={r.evidence}>Evidence: {r.evidence}</p>}
                  {r.review_note && <p className="text-[10px] text-amber-600 mt-0.5">✎ {r.review_note}</p>}
                </td>
                <td className="px-3 py-3"><span className="px-2 py-0.5 bg-gray-100 rounded-full text-[10px] font-semibold text-gray-600">{r.suggestion_type}</span></td>
                <td className="px-3 py-3 text-[11px] text-gray-500">
                  {r.keyword && <p><span className="text-gray-400">kw:</span> {r.keyword}{r.intent ? ` · ${r.intent}` : ''}</p>}
                  {r.url && <p className="max-w-[200px] truncate" title={r.url}>{r.url}</p>}
                  {!r.keyword && !r.url && '—'}
                </td>
                <td className="px-3 py-3">
                  <span className={`text-[11px] font-semibold ${r.priority === 'high' ? 'text-red-600' : r.priority === 'medium' ? 'text-amber-600' : 'text-gray-400'}`}>{r.priority}</span>
                </td>
                <td className="px-3 py-3">
                  <StatusSelect value={r.status} onChange={(v) => void setStatus(r.id, v)} options={SEO_STATUSES} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setDelId(r.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="Delete suggestion"><Trash size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete suggestion?">
        <p className="text-gray-600 mb-6">Removes this SEO research suggestion. Nothing is changed on the live site.</p>
        <div className="flex gap-3">
          <button onClick={async () => { if (delId) { await deleteSeoSuggestion(delId); notify('Suggestion deleted'); setDelId(null); await load(); } }} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button>
          <button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// MARKETING INTEL
// ============================================================================
function MarketingTab() {
  const { notify } = useApp();
  const [rows, setRows] = useState<HermesMarketingIntelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [delId, setDelId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await listMarketingIntel());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dismiss = async (id: string, status: string) => {
    await updateMarketingIntel(id, { status: status as HermesMarketingIntelRow['status'] });
    notify(`Intel marked ${status}`);
    await load();
  };

  if (loading) return <div className="py-16 text-center text-sm text-gray-500">Loading marketing intelligence…</div>;

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed p-12 text-center text-gray-500">
        <Lightbulb size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="font-medium text-gray-600">No marketing intelligence yet</p>
        <p className="text-xs mt-1">Market findings, positioning, seasonal and audience research arrive here as planning inputs.</p>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {rows.map((r) => (
        <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4 card-lift">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-semibold">{r.intel_type}</span>
              {r.confidence !== null && <span className="text-[10px] text-gray-400">confidence {Math.round(r.confidence * 100)}%</span>}
            </div>
            <StatusSelect value={r.status} onChange={(v) => void dismiss(r.id, v)} options={['new', 'reviewed', 'dismissed']} />
          </div>
          <button className="mt-2 text-left w-full" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
            <p className="font-semibold text-[13px] text-gray-900 flex items-center gap-1">
              {expanded === r.id ? <CaretDown size={13} className="text-gray-400" /> : <CaretRight size={13} className="text-gray-400" />}
              {r.title}
            </p>
            <p className={`text-xs text-gray-500 mt-1 ${expanded === r.id ? '' : 'line-clamp-3'}`}>{r.summary}</p>
          </button>
          {expanded === r.id && Object.keys(r.details ?? {}).length > 0 && (
            <pre className="mt-2 text-[10px] bg-gray-50 rounded-lg p-2 overflow-x-auto text-gray-600">{JSON.stringify(r.details, null, 2)}</pre>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-gray-400">{date(r.created_at)}</span>
            <button onClick={() => setDelId(r.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash size={13} /></button>
          </div>
        </div>
      ))}
      <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete intel?">
        <p className="text-gray-600 mb-6">Removes this research finding.</p>
        <div className="flex gap-3">
          <button onClick={async () => { if (delId) { await deleteMarketingIntel(delId); notify('Intel deleted'); setDelId(null); await load(); } }} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button>
          <button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// ADS READINESS (Luxedge economics only)
// ============================================================================
function AdsTab() {
  const [rows, setRows] = useState<AdsReadinessRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await listAdsReadiness());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const LEVEL: Record<string, { label: string; cls: string }> = {
    insufficient_data: { label: 'Insufficient data', cls: 'bg-gray-100 text-gray-500' },
    possible: { label: 'Possible', cls: 'bg-amber-100 text-amber-700' },
    promising: { label: 'Promising', cls: 'bg-emerald-100 text-emerald-700' },
    strong: { label: 'Strong', cls: 'bg-green-100 text-green-700' },
  };

  if (loading) return <div className="py-16 text-center text-sm text-gray-500">Loading ads readiness…</div>;

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed p-12 text-center text-gray-500">
        <TrendUp size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="font-medium text-gray-600">No ads-readiness assessments yet</p>
        <p className="text-xs mt-1">Use the TrendUp action on an accepted product suggestion to compute Luxedge economics. Assessments never launch campaigns or spend money.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Ref</th>
              <th className="px-3 py-2.5 font-semibold">Economics</th>
              <th className="px-3 py-2.5 font-semibold">Margin</th>
              <th className="px-3 py-2.5 font-semibold">Contribution</th>
              <th className="px-3 py-2.5 font-semibold">Break-even CAC</th>
              <th className="px-3 py-2.5 font-semibold">Readiness</th>
              <th className="px-4 py-2.5 font-semibold">Assessment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-gray-50/70 transition-colors">
                <td className="px-4 py-3 text-[11px] text-gray-500">#{r.recommendation_id ? r.recommendation_id.slice(0, 8) : r.product_id ? r.product_id.slice(0, 8) : '—'}</td>
                <td className="px-3 py-3 text-xs text-gray-600">sell {money(r.selling_price)} · landed {money(r.landed_cost)}</td>
                <td className="px-3 py-3 text-xs font-semibold text-emerald-600">{pct(r.gross_margin)}</td>
                <td className="px-3 py-3 text-xs text-gray-600">{money(r.contribution_margin)}</td>
                <td className="px-3 py-3 text-xs text-gray-600">{money(r.break_even_cac)}</td>
                <td className="px-3 py-3">
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${LEVEL[r.readiness]?.cls || LEVEL.insufficient_data.cls}`}>{LEVEL[r.readiness]?.label || r.readiness}</span>
                </td>
                <td className="px-4 py-3 text-[11px] text-gray-500 max-w-[300px]">{r.assessment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// PAGE
// ============================================================================
export default function HermesIntel() {
  useDbToken();
  const [tab, setTab] = useState<'opportunities' | 'seo' | 'marketing' | 'ads'>('opportunities');

  const tabs = [
    { id: 'opportunities' as const, label: 'Product Suggestions', icon: Target },
    { id: 'seo' as const, label: 'SEO Suggestions', icon: MagnifyingGlass },
    { id: 'marketing' as const, label: 'Marketing Intel', icon: Lightbulb },
    { id: 'ads' as const, label: 'Ads Readiness', icon: TrendUp },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 tracking-tight flex items-center gap-2"><Brain size={18} className="text-indigo-500" />AI Intelligence</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">Research evidence from Hermes / Salman OS — Luxedge validates, scores and decides. Hermes has no write access to products, code, or settings.</p>
        </div>
        <div className="hidden lg:flex items-center gap-1.5 bg-white rounded-lg border border-gray-100 px-2.5 py-1.5 text-[10px] text-gray-500">
          <ShieldCheck size={12} className="text-emerald-500" />
          <span>Research-only ingestion · <span className="font-semibold text-gray-700">POST /api/hermes/ingest</span></span>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[12px] font-semibold border-b-2 transition-colors ${tab === t.id ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'opportunities' && <OpportunitiesTab />}
      {tab === 'seo' && <SeoTab />}
      {tab === 'marketing' && <MarketingTab />}
      {tab === 'ads' && <AdsTab />}
    </div>
  );
}
