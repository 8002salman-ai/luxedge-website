// ============================================================================
// LUXEDGE V2 — MINIMAL HS256 JWT VERIFICATION (serverless only)
//
// Supabase access tokens are standard JWTs signed with HS256 using the
// project's JWT secret (SUPABASE_JWT_SECRET env var). This module verifies
// signature + expiry + algorithm with node:crypto only — no third-party
// dependency, so the serverless bundle stays tiny.
//
// SECURITY PROPERTIES:
//  - Only HS256 is accepted. alg=none / RS256 / anything else is rejected.
//  - Signature comparison is timing-safe (crypto.timingSafeEqual).
//  - Expiry (exp) is enforced.
//  - The raw secret never leaves the server and is never logged.
// ============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifiedJwt {
  sub: string;
  email?: string;
  role?: string;
  app_metadata?: { role?: string };
  user_metadata?: Record<string, unknown>;
  exp?: number;
  [key: string]: unknown;
}

function base64UrlDecode(input: string): Buffer {
  // Normalize to standard base64 by restoring padding and URL-safe chars.
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64');
}

function safeJsonParse<T>(buf: Buffer): T | null {
  try {
    return JSON.parse(buf.toString('utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Verify a Supabase access token. Throws an Error with a short, non-secret
 * message on any failure. Returns the verified payload on success.
 */
export function verifyJwtHs256(token: string, secret: string): VerifiedJwt {
  if (!secret || secret.length < 16) {
    throw new Error('JWT secret is not configured (missing SUPABASE_JWT_SECRET env var)');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [headerB64, payloadB64, sigB64] = parts;
  const header = safeJsonParse<{ alg?: string; typ?: string }>(base64UrlDecode(headerB64));
  if (!header) throw new Error('Malformed token header');
  // Reject algorithm confusion: only HS256 is allowed.
  if (header.alg !== 'HS256') throw new Error('Unsupported token algorithm');

  const payload = safeJsonParse<VerifiedJwt>(base64UrlDecode(payloadB64));
  if (!payload) throw new Error('Malformed token payload');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Token missing subject');

  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  let provided: Buffer;
  try {
    provided = base64UrlDecode(sigB64);
  } catch {
    throw new Error('Malformed token signature');
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new Error('Invalid token signature');
  }

  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    throw new Error('Token expired');
  }
  return payload;
}

/** True when the verified token carries the admin claim in app_metadata. */
export function isAdminClaim(payload: VerifiedJwt): boolean {
  return payload.app_metadata?.role === 'admin';
}
