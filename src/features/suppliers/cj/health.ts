// ============================================================================
// LUXEDGE V2 — CJ HEALTH MAPPING (Phase 4C)
//
// Maps raw health strings from the server proxy into the typed union so the
// UI can render CONFIGURED / ONLINE / RATE LIMITED / OFFLINE / NOT CONFIGURED
// without trusting arbitrary server text.
// ============================================================================

import type { SupplierHealth } from '../types';

const KNOWN: SupplierHealth[] = ['configured', 'online', 'rate_limited', 'offline', 'not_configured'];

export function cjSafeStatusFromHealth(raw: string | undefined | null): SupplierHealth {
  const v = (raw || '').trim().toLowerCase();
  return KNOWN.includes(v as SupplierHealth) ? (v as SupplierHealth) : 'offline';
}
