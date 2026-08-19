// GET /api/salman-os/intelligence[?kind=PRODUCT|SEO|...]
//
// Safe server-side intelligence proxy. Empty when WAITING (contract pending)
// — the UI degrades gracefully. Never returns credentials.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { getIntelligence } from '../../src/services/salmanOs/contract.js';
import type { SalmanOsIntelligenceKind } from '../../src/services/salmanOs/types.js';

const KINDS = new Set(['PRODUCT', 'SEO', 'FREE_MARKETING', 'FREE_LISTINGS', 'MARKET', 'MARKETING', 'ADS', 'CATALOG_QA']);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const url = new URL(req.url || '/', 'http://localhost');
  const rawKind = (url.searchParams.get('kind') || '').toUpperCase();
  const kind = KINDS.has(rawKind) ? (rawKind as SalmanOsIntelligenceKind) : undefined;
  const items = await getIntelligence(kind);
  sendJson(res, 200, { items, kind: kind ?? 'all' });
}
