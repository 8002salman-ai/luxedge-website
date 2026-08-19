// GET/POST /api/salman-os/jobs
//
// Server-side job proxy for Salman OS AI modules (Phase I):
//   GET            → list jobs
//   POST {action:'run', kind}     → run a job (PRODUCT_RESEARCH | SEO | …)
//   POST {action:'pause', id}     → pause a job (only if the contract supports it)
//   POST {action:'resume', id}    → resume a job (only if the contract supports it)
//
// Fail-closed: when WAITING (contract pending) returns a safe error and does
// NOT call Salman OS. Never returns credentials.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { getJobs, runJob, pauseJob, resumeJob, salmanOsStatus } from '../../src/services/salmanOs/contract.js';
import type { SalmanOsJobKind } from '../../src/services/salmanOs/types.js';

const KINDS = new Set(['PRODUCT_RESEARCH', 'SEO', 'FREE_MARKETING', 'FREE_LISTINGS', 'MARKET_RESEARCH', 'MARKETING_IDEAS', 'ADS_INTELLIGENCE', 'CATALOG_QA']);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const jobs = await getJobs();
    sendJson(res, 200, { jobs });
    return;
  }

  if (req.method === 'POST') {
    const status = salmanOsStatus();
    if (status.state === 'WAITING') {
      sendJson(res, 503, { error: status.reason });
      return;
    }
    const body = await readJsonBody(req);
    const action = String(body.action || '');
    if (action === 'run') {
      const kind = String(body.kind || '').toUpperCase() as SalmanOsJobKind;
      if (!KINDS.has(kind)) {
        sendJson(res, 400, { error: `Unknown job kind: ${String(body.kind || '')}` });
        return;
      }
      const result = await runJob(kind);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }
    if (action === 'pause') {
      const id = String(body.id || '');
      if (!id) {
        sendJson(res, 400, { error: 'job id required' });
        return;
      }
      const result = await pauseJob(id);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }
    if (action === 'resume') {
      const id = String(body.id || '');
      if (!id) {
        sendJson(res, 400, { error: 'job id required' });
        return;
      }
      const result = await resumeJob(id);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }
    sendJson(res, 400, { error: "action must be 'run', 'pause' or 'resume'" });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}
