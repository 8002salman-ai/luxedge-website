// ============================================================================
// LUXEDGE V2 — API AUTH GUARD (serverless)
//
// Protects credit-consuming / sensitive endpoints (/api/ai/*, /api/fetch-page).
//
// Contract:
//   - No Authorization header            -> 401 Unauthorized
//   - Invalid / expired / tampered token -> 401 Unauthorized
//   - Valid token, role != admin         -> 403 Forbidden
//   - SUPABASE_JWT_SECRET not configured -> 503 (fail closed — never open)
//
// The role claim is read from the VERIFIED JWT (app_metadata.role), which is
// the same trusted claim the Supabase RLS policies use. A role sent from the
// browser in a query param / body is NEVER trusted.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyJwtHs256, isAdminClaim, type VerifiedJwt } from './jwt';
import { sendJson } from './providers';

export interface AuthResult {
  ok: true;
  payload: VerifiedJwt;
}
export interface AuthFailure {
  ok: false;
  status: number;
  error: string;
}
export type AuthDecision = AuthResult | AuthFailure;

/** Extract a Bearer token from the Authorization header. */
export function getBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (!header) return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

/** Verify the admin identity from the request. Never trusts client input. */
export async function adminAuth(req: IncomingMessage): Promise<AuthDecision> {
  const secret = (process.env.SUPABASE_JWT_SECRET || '').trim();
  if (!secret) {
    // Fail closed: without a configured JWT secret we cannot prove identity.
    return { ok: false, status: 503, error: 'Authentication is not configured on this deployment. Set SUPABASE_JWT_SECRET (see .env.example).' };
  }
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Unauthorized — sign in to the admin dashboard first.' };
  }
  let payload: VerifiedJwt;
  try {
    payload = verifyJwtHs256(token, secret);
  } catch (e) {
    return { ok: false, status: 401, error: `Unauthorized — ${(e as Error).message}.` };
  }
  if (!isAdminClaim(payload)) {
    return { ok: false, status: 403, error: 'Forbidden — admin role required.' };
  }
  return { ok: true, payload };
}

/** Convenience: enforce admin auth and send the failure response if denied. */
export async function requireAdmin(req: IncomingMessage, res: ServerResponse): Promise<VerifiedJwt | null> {
  const decision = await adminAuth(req);
  if (!decision.ok) {
    sendJson(res, decision.status, { error: decision.error });
    return null;
  }
  return decision.payload;
}
