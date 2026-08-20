// ============================================================================
// LUXEDGE — POST /api/import-images
//
// Downloads supplier product images server-side and uploads them into the
// Luxedge Supabase Storage bucket (product-media) so product_images rows hold
// durable Supabase public URLs instead of hotlinked supplier URLs.
//
// SECURITY:
//  - Admin-only (valid Supabase admin JWT required) + rate limited.
//  - Each image URL is SSRF-guarded before download; every redirect hop is
//    re-validated (reuses the same guard as /api/fetch-page).
//  - Image bytes are content-type and size checked before upload.
//  - SUPABASE_SERVICE_ROLE_KEY is read from server env ONLY — never returned,
//    never logged, never shipped to the browser.
//  - Fail-closed: missing env config returns 503, never a fake success.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { sendJson, rateLimited, clientIp, readJsonBody } from './_lib/providers.js';
import { validateFetchTarget } from './_lib/ssrf.js';
import { requireAdmin } from './_lib/auth.js';
import { supabaseServerHeaders } from './_lib/supabaseKeys.js';

const DEFAULT_BUCKET = 'product-media';
const MAX_IMAGES = 10;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per image
const DOWNLOAD_TIMEOUT_MS = 25_000;
const UPLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

interface ImportedImage {
  publicUrl: string;
  sourceUrl: string;
  sortOrder: number;
  sha256: string;
}

function supabaseConfig(): { url: string; serviceRole: string; bucket: string } | null {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim();
  if (!url || !serviceRole || !bucket) return null;
  return { url, serviceRole, bucket };
}

function sanitizeFilename(url: string, order: number): string {
  const base = String(url).split(/[?#]/)[0].split('/').pop() || 'image';
  // Strip a real image extension once, then re-append the canonical one so
  // filenames never end up doubled (e.g. `Cat-Toy.png.png`).
  const extMatch = /\.(jpe?g|png|webp|gif)$/i.exec(base);
  const stem = extMatch ? base.slice(0, -extMatch[0].length) : base;
  const clean = (stem || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  return `${order}-${clean}.${ext}`;
}

/** Download one image with redirect validation + content-type + size checks. */
async function downloadImage(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const guardErr = await validateFetchTarget(current);
    if (guardErr) throw new Error(`URL rejected: ${guardErr}`);
    const r = await fetch(current, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: 'manual',
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) throw new Error('Redirect without location');
      current = new URL(loc, current).toString();
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const contentType = (r.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) throw new Error(`Not an image (${contentType || 'unknown content-type'})`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length === 0) throw new Error('Empty image');
    if (bytes.length > MAX_BYTES) throw new Error(`Image too large (${(bytes.length / 1024 / 1024).toFixed(1)} MB > 8 MB)`);
    return { bytes, contentType };
  }
  throw new Error('Too many redirects');
}

/** Upload bytes to Supabase Storage. Returns the public URL. */
async function uploadImage(cfg: { url: string; serviceRole: string; bucket: string }, path: string, bytes: Buffer, contentType: string): Promise<string> {
  const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
    method: 'POST',
    headers: supabaseServerHeaders(cfg.serviceRole, {
      'Content-Type': contentType,
      'x-upsert': 'true',
    }),
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Storage upload failed (HTTP ${res.status})${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${path}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  const cfg = supabaseConfig();
  if (!cfg) {
    sendJson(res, 503, { error: 'Image storage is not configured on this deployment (missing SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_URL). See .env.example.' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }

  const productId = String(body.productId || '').trim();
  const urlsRaw = Array.isArray(body.urls) ? body.urls : [];
  const urls = urlsRaw.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u.trim())).map((u) => u.trim());
  if (!productId || !/^[a-zA-Z0-9-]+$/.test(productId)) {
    sendJson(res, 400, { error: 'A valid productId is required' });
    return;
  }
  if (!urls.length || urls.length > MAX_IMAGES) {
    sendJson(res, 400, { error: `Provide between 1 and ${MAX_IMAGES} image URLs` });
    return;
  }

  // Deduplicate by exact URL first (order preserved), then by content hash.
  const uniqueByUrl = [...new Set(urls)];
  const uploaded: ImportedImage[] = [];
  const failed: { sourceUrl: string; reason: string }[] = [];
  let order = 0;

  for (const url of uniqueByUrl) {
    try {
      const { bytes, contentType } = await downloadImage(url);
      const sha = createHash('sha256').update(bytes).digest('hex');
      const duplicate = uploaded.some((u) => u.sha256 === sha);
      if (duplicate) continue;
      const path = `catalog/${productId}/${sanitizeFilename(url, order)}`;
      const publicUrl = await uploadImage(cfg, path, bytes, contentType);
      uploaded.push({ publicUrl, sourceUrl: url, sortOrder: order, sha256: sha });
      order += 1;
    } catch (e) {
      failed.push({ sourceUrl: url, reason: (e as Error).message });
    }
  }

  const warning =
    failed.length === uniqueByUrl.length
      ? 'All images failed storage import — supplier URLs are still saved (durable CDN links), but Supabase storage upload did not complete. Check the failed list and retry.'
      : failed.length > 0
        ? `${failed.length} image(s) could not be stored — see failed list.`
        : '';

  sendJson(res, 200, {
    ok: uploaded.length > 0,
    productId,
    bucket: cfg.bucket,
    uploaded: uploaded.map(({ publicUrl, sourceUrl, sortOrder }) => ({ publicUrl, sourceUrl, sortOrder })),
    failed,
    warnings: warning ? [warning] : [],
  });
}
