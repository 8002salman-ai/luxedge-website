// ============================================================================
// LUXEDGE — PRODUCT RESEARCH (Product Market Intelligence Engine)
//
// PET-ONLY. Input a product/keyword → honest multi-source research:
// Google Trends | Amazon demand | eBay demand | Competition | Supplier cost
// Target price | Net profit | ROI | Data confidence | Final score.
// Every source shows its real status — never faked, never a required paid
// dependency (no Jungle Scout / Helium10 / Keepa API subscriptions).
// ============================================================================

import { useEffect, useState } from 'react';
import { useApp } from '../App';
import {
  TrendUp, MagnifyingGlass, ShieldCheck, Flask,
} from '@phosphor-icons/react';
import type { ProductOpportunityResult, TrendingPetProduct, SourceStatus } from '../features/marketIntel/types';
import { OPPORTUNITY_WEIGHTS } from '../features/marketIntel/score';
import { mergeTrending } from '../features/marketIntel/trending';
import { researchKeyword } from '../features/marketIntel/research';
import { listTrendsJobs, latestTrendsEvidence, type TrendsJobView } from '../features/marketIntel/trendsJobs';
import { fetchPageContent } from '../features/ai/importer';
import { queueHermesFallback } from '../features/scout/persist';
import { getDb } from '../services/db';
import { getAccessToken } from '../services/supabase';

const STATUS_BADGE: Record<SourceStatus, string> = {
  AVAILABLE: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-600',
  NOT_CONFIGURED: 'bg-gray-100 text-gray-500',
  LOGIN_REQUIRED: 'bg-amber-100 text-amber-700',
  LIMIT_REACHED: 'bg-amber-100 text-amber-700',
  PAID_FEATURE: 'bg-gray-100 text-gray-500',
  DISABLED: 'bg-gray-100 text-gray-400',
  SKIPPED: 'bg-gray-100 text-gray-400',
};

const STATUS_LABEL: Record<SourceStatus, string> = {
  AVAILABLE: 'AVAILABLE',
  FAILED: 'FAILED',
  NOT_CONFIGURED: 'NOT CONFIGURED',
  LOGIN_REQUIRED: 'LOGIN REQUIRED',
  LIMIT_REACHED: 'LIMIT REACHED',
  PAID_FEATURE: 'PAID FEATURE',
  DISABLED: 'DISABLED',
  SKIPPED: 'SKIPPED',
};

export default function ProductResearch() {
  const { notify } = useApp();
  const [keyword, setKeyword] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProductOpportunityResult | null>(null);
  const [trending, setTrending] = useState<TrendingPetProduct[]>([]);
  const [queuedForHermes, setQueuedForHermes] = useState(false);
  const [cached, setCached] = useState(false);
  const [trendsJobs, setTrendsJobs] = useState<TrendsJobView[]>([]);

  /** Load the Hermes trends job queue (provider=hermes, intent=google_trends_browser). */
  const refreshTrendsJobs = async () => {
    try {
      const d = getDb();
      if ('setAccessToken' in d && typeof (d as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
        (d as { setAccessToken: (t: string | null) => void }).setAccessToken(getAccessToken());
      }
      setTrendsJobs(await listTrendsJobs(d));
    } catch {
      /* status display is best-effort — never blocks the page */
    }
  };
  useEffect(() => { void refreshTrendsJobs(); }, []);

  /**
   * Run one research pass via the injectable pipeline — every provider
   * failure degrades to PARTIAL (never stops the job), live fetches are
   * paced + short-cached, and Google Trends queues a Hermes browser task
   * instead of faking data.
   */
  const research = async () => {
    const q = keyword.trim();
    if (!q) { notify('Enter a product or keyword (e.g. “dog poop scooper”)'); return; }
    setRunning(true);
    setResult(null);
    setQueuedForHermes(false);
    setCached(false);
    try {
      // The Hermes queue write goes through the db adapter with the admin
      // JWT (same pattern as Product Scout) so RLS accepts the agent_jobs row.
      const d = getDb();
      if ('setAccessToken' in d && typeof (d as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
        (d as { setAccessToken: (t: string | null) => void }).setAccessToken(getAccessToken());
      }
      const outcome = await researchKeyword(q, {
        fetchPage: fetchPageContent,
        queueHermes: (payload) => queueHermesFallback(d, 'search', payload),
        // §2 loop feedback: fresh, keyword-matching ingested Hermes trends
        // evidence feeds this run's TREND_SCORE and skips a redundant queue.
        readTrends: async (kw) => {
          const r = await latestTrendsEvidence(d, kw);
          if (!r.trend || !r.ingestedAt) return null;
          return { trend: r.trend, coverage: r.coverage, ingestedAt: r.ingestedAt };
        },
      });
      const res = outcome.result;
      setQueuedForHermes(outcome.hermesQueued);
      setCached(outcome.cached);
      setResult(res);
      void refreshTrendsJobs();

      // ---- Trending families (deterministic merge of researched keyword) ----
      setTrending(mergeTrending([
        {
          keyword: res.keyword,
          source: 'manual',
          trendDirection: res.provenance.trend.direction,
          trendScore: res.provenance.trend.score,
          opportunityScore: res.opportunityScore,
          confidence: res.confidence,
        },
      ]));
      notify('Research complete');
    } catch (e) {
      notify(`Research failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  // -- Hermes trends job visibility on the GOOGLE TREND card -----------------
  // A completed provider=hermes job for the researched keyword feeds the card
  // with verified data; otherwise it stays honest (NOT_CONFIGURED, no score).
  const consumedTrend = result
    ? trendsJobs.find((j) => j.status === 'completed' && j.keyword.trim().toLowerCase() === result.keyword.trim().toLowerCase())
    : null;
  const trendCardScore = consumedTrend?.output?.trend?.score ?? (result?.provenance.trend.score ?? null);
  const trendCardStatus: SourceStatus = consumedTrend ? 'AVAILABLE' : (result?.provenance.trend.status ?? 'NOT_CONFIGURED');
  const trendJobCounts = {
    queued: trendsJobs.filter((j) => j.status === 'queued').length,
    running: trendsJobs.filter((j) => j.status === 'running').length,
    completed: trendsJobs.filter((j) => j.status === 'completed').length,
  };
  const trendsSummary =
    trendsJobs.length > 0
      ? [
          `${trendJobCounts.queued} queued`,
          `${trendJobCounts.running} in progress`,
          `${trendJobCounts.completed} completed`,
          ...(consumedTrend?.output?.trend?.score != null ? [`latest ${consumedTrend.output.trend.score}/100`] : []),
        ].join(' · ')
      : undefined;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendUp className="text-blue-600" size={22} /> Product Market Intelligence
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          PET-ONLY validation engine. No required paid tools — Google Trends, Amazon public, eBay, supplier database + honest AI. Unavailable sources are reported, never faked.
        </p>
      </div>

      {/* Research input */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <label className="text-sm font-semibold text-gray-700">PRODUCT / KEYWORD</label>
        <div className="flex gap-2 mt-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void research(); }}
            placeholder="e.g. dog poop scooper"
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => void research()}
            disabled={running}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2"
          >
            {running ? 'Researching…' : <><MagnifyingGlass size={16} /> RESEARCH PRODUCT</>}
          </button>
          {cached && (
            <span className="self-center text-xs text-gray-400">cached result · refetches within 15 min are skipped</span>
          )}
        </div>
      </div>

      {/* Result cards */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <ScoreCard label="GOOGLE TREND" value={trendCardScore !== null ? `${trendCardScore}/100` : '—'} status={trendCardStatus} />
            <ScoreCard label="AMAZON DEMAND" value={result.provenance.amazonPublic.status === 'AVAILABLE' ? 'PASS' : '—'} status={result.provenance.amazonPublic.status} />
            <ScoreCard label="EBAY DEMAND" value={result.provenance.ebay.activeListings !== null ? `${result.provenance.ebay.activeListings} listings` : '—'} status={result.provenance.ebay.status} />
            <ScoreCard label="SUPPLIER COST" value={result.economics.landedCost !== null ? `$${result.economics.landedCost.toFixed(2)}` : '—'} status={result.provenance.supplier.status} />
            <ScoreCard label="TARGET PRICE" value={result.economics.targetSellingPrice !== null ? `$${result.economics.targetSellingPrice.toFixed(2)}` : '—'} status="AVAILABLE" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <ScoreCard label="NET PROFIT" value={result.economics.expectedNetProfit !== null ? `$${result.economics.expectedNetProfit.toFixed(2)}` : '—'} status={result.economics.expectedNetProfit !== null ? 'AVAILABLE' : 'SKIPPED'} />
            <ScoreCard label="ROI" value={result.economics.roiPct !== null ? `${result.economics.roiPct.toFixed(0)}%` : '—'} status={result.economics.roiPct !== null ? 'AVAILABLE' : 'SKIPPED'} />
            <ScoreCard label="DATA CONFIDENCE" value={`${result.confidence}%`} status={result.confidence >= 60 ? 'AVAILABLE' : result.confidence >= 30 ? 'LIMIT_REACHED' : 'NOT_CONFIGURED'} />
            <div className="bg-blue-600 text-white rounded-2xl p-4 flex flex-col justify-center">
              <span className="text-[11px] uppercase tracking-wide opacity-80">Final Score</span>
              <span className="text-3xl font-bold">{result.opportunityScore}<span className="text-base font-medium opacity-70">/100</span></span>
              <span className="text-xs opacity-80 mt-1">{result.partial ? 'PARTIAL — some sources unavailable' : 'Full source coverage'}</span>
            </div>
            <div className={`rounded-2xl p-4 flex flex-col justify-center border ${verdictColor(result.verdict.verdict)}`}>
              <span className="text-[11px] uppercase tracking-wide opacity-70">Verdict</span>
              <span className="text-xl font-bold">{result.verdict.verdict}</span>
              {result.verdict.recommendedTestQuantity !== null && (
                <span className="text-xs mt-1 opacity-80">
                  Test {result.verdict.recommendedTestQuantity} units · ~${result.verdict.expectedInvestment?.toFixed(2)}
                </span>
              )}
            </div>
          </div>

          {/* Verdict note + score breakdown */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-sm text-gray-600">{result.verdict.note}</p>
            <div className="mt-4 space-y-2">
              {Object.entries(OPPORTUNITY_WEIGHTS).map(([k, w]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-40 text-xs font-medium text-gray-600 capitalize">{k}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(result.breakdown[k as keyof typeof result.breakdown] / w) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500">{result.breakdown[k as keyof typeof result.breakdown]}/{w}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Source breakdown */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><ShieldCheck size={16} className="text-green-600" /> Source Breakdown</h3>
            <div className="grid md:grid-cols-2 gap-2 text-sm">
              <SourceRow label="GOOGLE TRENDS" status={trendCardStatus} detail={trendsSummary || (queuedForHermes ? 'queued for Hermes browser' : undefined)} />
              <SourceRow label="AMAZON OPPORTUNITY EXPLORER" status={result.provenance.amazonOpportunity.status} />
              <SourceRow label="AMAZON PUBLIC" status={result.provenance.amazonPublic.status} />
              <SourceRow label="EBAY" status={result.provenance.ebay.status} />
              <SourceRow label="SUPPLIER DATABASE" status={result.provenance.supplier.status} />
              <SourceRow label="HELIUM 10 FREE" status="DISABLED" />
              <SourceRow label="KEEPA" status="NOT_CONFIGURED" />
              <SourceRow label="AI" status={result.provenance.aiProvider ? 'AVAILABLE' : 'NOT_CONFIGURED'} detail={result.provenance.aiProvider || 'deterministic only'} />
            </div>
          </div>

          {/* Trending */}
          {trending.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Trending Pet Products</h3>
              {trending.map((t) => (
                <div key={t.keyword} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-gray-800">{t.keyword}</p>
                    <p className="text-xs text-gray-400">{t.sources.join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{t.trendDirection}</span>
                    <span className="text-sm font-bold text-gray-700">{t.opportunityScore !== null ? `${t.opportunityScore}/100` : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !running && (
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-10 text-center">
          <Flask size={32} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            Enter a pet product or keyword to run the market intelligence engine.<br />
            Example: <button onClick={() => setKeyword('dog grooming vacuum')} className="text-blue-600 hover:underline font-medium">dog grooming vacuum</button>,{' '}
            <button onClick={() => setKeyword('cat water fountain')} className="text-blue-600 hover:underline font-medium">cat water fountain</button>,{' '}
            <button onClick={() => setKeyword('dog poop scooper')} className="text-blue-600 hover:underline font-medium">dog poop scooper</button>
          </p>
        </div>
      )}
    </div>
  );
}

function ScoreCard({ label, value, status }: { label: string; value: string; status: SourceStatus }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[status] || 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[status] || status}</span>
    </div>
  );
}

function SourceRow({ label, status, detail }: { label: string; status: SourceStatus; detail?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
      <span className="text-gray-700 font-medium">{label}</span>
      <span className="flex items-center gap-2">
        {detail && <span className="text-xs text-gray-400">{detail}</span>}
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[status] || 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[status] || status}</span>
      </span>
    </div>
  );
}

function verdictColor(v: string): string {
  switch (v) {
    case 'STRONG BUY': return 'bg-green-50 border-green-200 text-green-800';
    case 'BUY TEST': return 'bg-emerald-50 border-emerald-200 text-emerald-800';
    case 'TEST SMALL': return 'bg-blue-50 border-blue-200 text-blue-800';
    case 'WATCH': return 'bg-amber-50 border-amber-200 text-amber-800';
    case 'HIGH RISK': return 'bg-red-50 border-red-200 text-red-700';
    default: return 'bg-gray-50 border-gray-200 text-gray-700';
  }
}
