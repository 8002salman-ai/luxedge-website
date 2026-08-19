// ============================================================================
// LUXEDGE V2 — ADMIN · SALMAN OS / HERMES PANEL (Phases F, H, I, N)
//
// One compact panel showing the Salman OS / SoSAi AI-backend status and the
// AI owner module cards. Salman OS is authoritative for its model routing —
// this UI NEVER fabricates model state locally; it displays exactly what the
// server proxy reports (CONNECTED / OFFLINE / WAITING).
//
// WAITING = "AI BACKEND — WAITING FOR SALMAN OS" (contract/credentials not
// yet in place). Commerce never depends on this panel.
// ============================================================================

import { useEffect, useState } from 'react';
import {
  Robot, Warning, CheckCircle, XCircle, ArrowClockwise, Play, Eye, Hourglass,
} from '@phosphor-icons/react';
import { useApp } from '../App';
import {
  fetchSalmanOsStatus, fetchSalmanOsJobs, runSalmanOsJob,
} from '../services/salmanOs/browserClient';
import type { SalmanOsStatus, SalmanOsJob, SalmanOsJobKind } from '../services/salmanOs/types';

const MODULES: { kind: SalmanOsJobKind; label: string; hint: string }[] = [
  { kind: 'PRODUCT_RESEARCH', label: 'Product Research', hint: 'Find and rank product opportunities' },
  { kind: 'SEO', label: 'SEO', hint: 'Search-optimize titles, descriptions and pages' },
  { kind: 'FREE_MARKETING', label: 'Free Marketing', hint: 'Free channels and content angles' },
  { kind: 'FREE_LISTINGS', label: 'Free Listings', hint: 'Directories and free product listings' },
  { kind: 'MARKET_RESEARCH', label: 'Market Research', hint: 'Market evidence and positioning' },
  { kind: 'MARKETING_IDEAS', label: 'Marketing Ideas', hint: 'Campaign and content concepts' },
  { kind: 'ADS_INTELLIGENCE', label: 'Ads Intelligence', hint: 'Paid-channel readiness (deferred)' },
  { kind: 'CATALOG_QA', label: 'Catalog QA', hint: 'Catalog quality and commerce-truth checks' },
];

const JOB_STATUS_STYLE: Record<string, string> = {
  QUEUED: 'bg-blue-100 text-blue-700',
  RUNNING: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-600',
  PAUSED: 'bg-gray-100 text-gray-600',
};

function stateBadge(s: SalmanOsStatus) {
  if (s.state === 'CONNECTED') {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-green-100 text-green-700"><CheckCircle size={13} />CONNECTED</span>;
  }
  if (s.state === 'OFFLINE') {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-600"><XCircle size={13} />OFFLINE</span>;
  }
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700"><Hourglass size={13} />WAITING</span>;
}

export default function SalmanOsPanel() {
  const { notify } = useApp();
  const [status, setStatus] = useState<SalmanOsStatus | null>(null);
  const [jobs, setJobs] = useState<SalmanOsJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<SalmanOsJobKind | null>(null);

  const refresh = async () => {
    setLoading(true);
    const [s, j] = await Promise.all([fetchSalmanOsStatus(), fetchSalmanOsJobs()]);
    setStatus(s);
    setJobs(j);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const run = async (kind: SalmanOsJobKind) => {
    setRunning(kind);
    const r = await runSalmanOsJob(kind);
    setRunning(null);
    if (r.ok) {
      notify(`${MODULES.find((m) => m.kind === kind)?.label} queued on Salman OS`);
      await refresh();
    } else {
      notify(r.error || 'Could not run job — AI backend unavailable', 'error');
    }
  };

  const waiting = !status || status.state === 'WAITING';

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className={`rounded-xl border p-4 ${waiting ? 'bg-amber-50/60 border-amber-200' : status?.state === 'CONNECTED' ? 'bg-green-50/60 border-green-200' : 'bg-red-50/60 border-red-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Robot size={18} className={waiting ? 'text-amber-600 mt-0.5' : 'text-blue-600 mt-0.5'} />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-sm text-gray-900">SALMAN OS / HERMES</h2>
                {status ? stateBadge(status) : <span className="text-[10px] text-gray-400">loading…</span>}
              </div>
              <p className="text-[11px] text-gray-600 mt-1.5">
                Project: <b>luxedge</b> · Environment: <b>{status?.project.environment ?? 'PREVIEW'}</b> · Free-first: <b>{status?.project.freeFirst ? 'ON' : 'OFF'}</b>
              </p>
              <p className="text-[11px] text-gray-500 mt-1">{status?.reason ?? 'Checking…'}</p>

              {status?.live && (
                <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-gray-700">
                  {status.live.bridge !== undefined && <p>Bridge: <b>{status.live.bridge || '—'}</b></p>}
                  {status.live.scheduler !== undefined && <p>Scheduler: <b>{status.live.scheduler || '—'}</b></p>}
                  {status.live.freeModel !== undefined && <p>Free model: <b>{status.live.freeModel || '—'}</b></p>}
                  {status.live.defaultModel !== undefined && <p>Default model: <b>{status.live.defaultModel || '—'}</b></p>}
                  {status.live.currentTaskModel !== undefined && <p>Current task model: <b>{status.live.currentTaskModel || '—'}</b></p>}
                  {status.live.lastTaskModel !== undefined && <p>Last task model: <b>{status.live.lastTaskModel || '—'}</b></p>}
                  {status.live.costClass !== undefined && <p>Cost class: <b>{status.live.costClass}</b></p>}
                  {status.live.fallbackUsed !== undefined && <p>Fallback used: <b>{status.live.fallbackUsed ? 'YES' : 'NO'}</b></p>}
                  {status.live.lastSync !== undefined && <p>Last sync: <b>{status.live.lastSync || '—'}</b></p>}
                  {status.live.latestError !== undefined && <p className="text-red-600">Latest error: <b>{status.live.latestError || '—'}</b></p>}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => void refresh()} disabled={loading} className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50">
            <ArrowClockwise size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        {waiting && (
          <p className="mt-3 text-[11px] font-semibold text-amber-700 flex items-center gap-1.5">
            <Warning size={12} /> AI BACKEND — WAITING FOR SALMAN OS. Commerce continues normally; this is an optional intelligence enhancement.
          </p>
        )}
      </div>

      {/* AI owner modules */}
      <div>
        <h3 className="font-bold text-xs text-gray-800 mb-2">AI Owner Modules</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {MODULES.map((m) => {
            const job = jobs.find((j) => j.kind === m.kind);
            return (
              <div key={m.kind} className="bg-white rounded-xl border border-gray-100 p-3.5 card-lift flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-[12px] text-gray-900">{m.label}</p>
                  {job && <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${JOB_STATUS_STYLE[job.status] || 'bg-gray-100 text-gray-600'}`}>{job.status}</span>}
                </div>
                <p className="text-[10px] text-gray-500 leading-snug flex-1">{m.hint}</p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => void run(m.kind)}
                    disabled={waiting || running === m.kind}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={waiting ? 'AI backend not ready yet' : `Run ${m.label}`}
                  >
                    <Play size={10} /> {running === m.kind ? 'Queuing…' : 'RUN NOW'}
                  </button>
                  <button
                    onClick={() => notify(`${m.label} results open in AI Intelligence (Admin → AI Intelligence)`)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50"
                  >
                    <Eye size={10} /> VIEW RESULTS
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          Pause/Resume appear per-job only when the finalized Salman OS contract supports them. Job statuses are authoritative from Salman OS — never fabricated locally.
        </p>
      </div>
    </div>
  );
}
