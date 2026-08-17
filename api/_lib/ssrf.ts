// ============================================================================
// LUXEDGE V2 — SSRF PROTECTION for server-side URL fetching
//
// /api/fetch-page fetches arbitrary URLs on behalf of the admin AI importer.
// Without protection an attacker could point it at private/internal networks
// (cloud metadata 169.254.169.254, localhost services, RFC1918 ranges).
//
// This module implements the guard as pure functions so it can be unit-tested.
// ============================================================================

import { lookup } from 'node:dns/promises';

const PRIVATE_RANGES: { name: string; test: (ip: string) => boolean }[] = [
  { name: 'loopback', test: (ip) => ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.') },
  { name: 'link-local (incl. cloud metadata)', test: (ip) => /^169\.254\./.test(ip) || /^fe80:/i.test(ip) },
  { name: 'RFC1918 10/8', test: (ip) => /^10\./.test(ip) },
  { name: 'RFC1918 172.16/12', test: (ip) => { const m = ip.match(/^172\.(\d+)\./); return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31; } },
  { name: 'RFC1918 192.168/16', test: (ip) => /^192\.168\./.test(ip) },
  { name: 'CGNAT 100.64/10', test: (ip) => { const m = ip.match(/^100\.(\d+)\./); return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127; } },
  { name: 'benchmark 198.18/15', test: (ip) => { const m = ip.match(/^198\.(\d+)\./); return !!m && (Number(m[1]) === 18 || Number(m[1]) === 19); } },
  { name: 'reserved 0.0.0.0', test: (ip) => ip === '0.0.0.0' },
  { name: 'ULA fc00::/7', test: (ip) => /^fc[0-9a-f]{2}:/i.test(ip) || /^fd[0-9a-f]{2}:/i.test(ip) },
];

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain',
  'metadata.google.internal', 'metadata',
]);

/** True when the given IP literal must never be fetched by the server. */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  return PRIVATE_RANGES.some((r) => r.test(clean));
}

/** True when the hostname is obviously private/local. */
export function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTS.has(hostname.trim().toLowerCase());
}

/**
 * Validate a candidate URL. Returns an error string, or null when safe to try.
 * Does DNS resolution for hostnames and blocks any address that resolves
 * to a private/reserved range.
 */
export async function validateFetchTarget(rawUrl: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http(s) URLs are allowed';
  if (u.username || u.password) return 'URLs with embedded credentials are not allowed';
  if (u.port && u.port !== '80' && u.port !== '443') return 'Non-standard ports are not allowed';

  const host = u.hostname.toLowerCase();
  if (isBlockedHostname(host)) return `Host is blocked (${host})`;

  // Resolve and check every address.
  let addresses: string[];
  try {
    const res = await lookup(host, { all: true });
    addresses = res.map((a) => a.address);
  } catch {
    return 'Could not resolve host';
  }
  if (!addresses.length) return 'Could not resolve host';
  const blocked = addresses.find((a) => isBlockedIp(a));
  if (blocked) return `Blocked address (${blocked})`;
  return null;
}
