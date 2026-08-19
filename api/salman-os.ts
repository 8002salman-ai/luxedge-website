// ============================================================================
// /api/salman-os — ONE consolidated Vercel Serverless Function
//
// Single dispatch point for the Salman OS AI backend (replaces the previous
// /api/salman-os/{status,intelligence,jobs} routes — this keeps the Vercel
// Hobby deployment under the 12-serverless-function limit).
//
//   GET  ?action=status                 → { status }
//   GET  ?action=intelligence[&kind=..] → { items, kind }
//   GET  ?action=jobs                   → { jobs }
//   POST { action: "run_job", kind }    → dispatch an AI module job
//   POST { action: "pause_job", module }  → pause a module (contract §5)
//   POST { action: "resume_job", module } → resume a module (contract §5)
//
// Security: admin Supabase JWT required (401/403 otherwise); fail-closed —
// when SALMAN_OS_BASE_URL / SALMAN_OS_TOKEN are not configured, WAITING is
// returned and Salman OS is never called. Credentials never leave the server.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './_lib/providers.js';
import { requireAdmin } from './_lib/auth.js';
import {
  getProjectStatus, getIntelligence, getJobs, runJob, pauseJob, resumeJob, salmanOsStatus,
} from '../src/services/salmanOs/contract.js';
import { SALMAN_OS_MODULE_IDS } from '../src/services/salmanOs/types.js';
import type { SalmanOsIntelligenceKind, SalmanOsJobKind } from '../src/services/salmanOs/types.js';

const INTELLIGENCE_KINDS = new Set(['PRODUCT', 'SEO', 'FREE_MARKETING', 'FREE_LISTINGS', 'MARKET', 'MARKETING', 'ADS', 'CATALOG_QA']);
const JOB_KINDS = new Set(Object.keys(SALMAN_OS_MODULE_IDS) as SalmanOsJobKind[]);
const MODULE_IDS = new Set(Object.values(SALMAN_OS_MODULE_IDS));

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET') {
    const action = url.searchParams.get('action') || 'status';
    if (action === 'status') {
      const status = await getProjectStatus();
      sendJson(res, 200, { status });
      return;
    }
    if (action === 'intelligence') {
      const rawKind = (url.searchParams.get('kind') || '').toUpperCase();
      const kind = INTELLIGENCE_KINDS.has(rawKind) ? (rawKind as SalmanOsIntelligenceKind) : undefined;
      const items = await getIntelligence(kind);
      sendJson(res, 200, { items, kind: kind ?? 'all' });
      return;
    }
    if (action === 'jobs') {
      const jobs = await getJobs();
      sendJson(res, 200, { jobs });
      return;
    }
    sendJson(res, 400, { error: "action must be 'status', 'intelligence' or 'jobs'" });
    return;
  }

  if (req.method === 'POST') {
    const status = salmanOsStatus();
    if (status.state === 'WAITING') {
      sendJson(res, 503, { error: status.reason });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, 400, { error: (e as Error).message });
      return;
    }
    const action = String(body.action || '');
    if (action === 'run_job') {
      const kind = String(body.kind || '').toUpperCase() as SalmanOsJobKind;
      if (!JOB_KINDS.has(kind)) {
        sendJson(res, 400, { error: `Unknown job kind: ${String(body.kind || '')}` });
        return;
      }
      const result = await runJob(kind);
      sendJson(res, result.ok || result.paused ? 200 : 502, result);
      return;
    }
    if (action === 'pause_job' || action === 'resume_job') {
      const moduleId = String(body.module || '');
      if (!MODULE_IDS.has(moduleId)) {
        sendJson(res, 400, { error: `Unknown Salman OS module: ${String(body.module || '')}` });
        return;
      }
      const result = action === 'pause_job' ? await pauseJob(moduleId) : await resumeJob(moduleId);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }
    sendJson(res, 400, { error: "action must be 'run_job', 'pause_job' or 'resume_job'" });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
