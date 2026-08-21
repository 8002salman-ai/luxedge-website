// ============================================================================
// LUXEDGE — POST /api/upload-image
//
// Uploads ONE base64-encoded image (from the admin's PC, e.g. product photos)
// into the Luxedge Supabase Storage bucket (product-media) and returns the
// durable public URL. Mirrors the security model of /api/import-images:
//
// SECURITY:
//  - Admin-only (valid Supabase admin JWT required) + rate limited.
//  - Base64 is decoded and size/content-type checked before upload.
//  - SUPABASE_SERVICE_ROLE_KEY is read from server env ONLY — never returned,
//    never logged, never shipped to the browser.
//  - Fail-closed: missing env config returns 503, never a fake success.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, rateLimited, clientIp, readJsonBody } from './_lib/providers.js';
import { requireAdmin } from './_lib/auth.js';

const DEFAULT_BUCKET = 'product-media';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB decoded
const UPLOAD_TIMEOUT_MS = 30_000;

function supabaseConfig(): { url: string; serviceRole: string; bucket: string } | null {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim();
  if (!url || !serviceRole || !bucket) return null;
  return { url, serviceRole, bucket };
}

function sanitizeFilename(name: string): string {
  const base = String(name || 'image').split(/[?#]/)[0].split('/').pop() || 'image';
  const extMatch = /\.(jpe?g|png|webp|gif)$/i.exec(base);
  const stem = extMatch ? base.slice(0, -extMatch[0].length) : base;
  const clean = (stem || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'png';
  return `${clean}.${ext}`;
}

async function uploadImage(cfg: { url: string; serviceRole: string; bucket: string }, path: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: cfg.serviceRole,
      Authorization: `Bearer ${cfg.serviceRole}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    // Wrap in a fresh Uint8Array (ArrayBuffer) so it is assignable to BodyInit
    // across TS versions (like the import-images route does).
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

  const productId = String(body.productId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'new';
  const filename = sanitizeFilename(String(body.filename || 'image.png'));
  const base64 = String(body.base64 || '');
  const contentType = String(body.contentType || 'image/png').toLowerCase().trim();

  if (!base64) {
    sendJson(res, 400, { error: 'A base64 image payload is required' });
    return;
  }
  const mime = /^image\/(png|jpe?g|webp|gif)$/.test(contentType) ? contentType : 'image/png';

  // Decode base64 (accepts optional data-URL prefix).
  const cleaned = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  } catch {
    sendJson(res, 400, { error: 'Invalid base64 image payload' });
    return;
  }
  if (bytes.length === 0) {
    sendJson(res, 400, { error: 'Empty image payload' });
    return;
  }
  if (bytes.length > MAX_BYTES) {
    sendJson(res, 400, { error: `Image too large (${(bytes.length / 1024 / 1024).toFixed(1)} MB > 8 MB)` });
    return;
  }

  try {
    const path = `catalog/${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}`;
    const publicUrl = await uploadImage(cfg, path, bytes, mime);
    sendJson(res, 200, { ok: true, productId, publicUrl });
  } catch (e) {
    sendJson(res, 502, { error: `Could not store image: ${(e as Error).message}` });
  }
}
