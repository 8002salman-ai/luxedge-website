// GET /api/salman-os/status
//
// Safe server-side status proxy for the Salman OS / SoSAi AI backend.
// Returns ONLY the safe status payload — never credentials, never tokens.
//
// Gating (Phase F): live calls happen only when the contract file
// (SALMAN_OS_LUXEDGE_AI_CONTRACT.md) is present AND server env has
// SALMAN_OS_BASE_URL + SALMAN_OS_TOKEN. Until then the route answers
// state=WAITING with a safe reason; the UI shows "AI BACKEND — WAITING
// FOR SALMAN OS". Commerce never depends on this endpoint.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { getProjectStatus } from '../../src/services/salmanOs/contract.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  // The contract-gated status is synchronous and always safe; a live probe
  // only happens when the contract + credentials exist (otherwise it returns
  // WAITING without any network call).
  const status = await getProjectStatus();
  sendJson(res, 200, { status });
}
