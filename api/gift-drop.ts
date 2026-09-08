// ============================================================================
// LUXEDGE — Pet Gift Drop public endpoints
//
//   GET  /api/gift-drop/state  → real campaign state (live inventory count)
//   POST /api/gift-drop/claim  → validate → reserve → create $0 gift order
//
// The claim flow NEVER touches Stripe or any payment method: the order is
// inserted with total $0 and no Stripe session/intent, so the customer never
// sees a card step. Email uniqueness is enforced atomically by the
// order_number unique constraint (deterministic per email). A confirmation
// email is sent best-effort afterwards via the worker send_email binding.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, clientIp, InMemoryRateLimiter } from './_lib/providers.js';
import {
  GIFT_MARKER,
  validateGiftClaim,
  buildGiftOrderRow,
  normalizeHouse,
  giftGiftData,
  loadCampaign,
  liveRemaining,
  supabaseEnv,
  supabaseHeadersFor,
  type GiftClaimInput,
  type GiftClaimRow,
} from './_lib/gift-drop.js';
// Gift Drop uses basic local address validation — Shippo is NOT required.
// Shippo is only needed for paid-shipping rate calculations.
import { normalizeShippingAddress, type ShippingAddressInput } from './_lib/shippo.js';
import { autoForwardGiftClaim } from './admin/erp.js';

/** Basic local address validation for free gift — no external API calls. */
function basicAddressValidate(addr: ShippingAddressInput): { isValid: boolean; messages: string[] } {
  const messages: string[] = [];
  if (!addr.fullName?.trim()) messages.push('Full name is required.');
  if (!addr.addressLine1?.trim()) messages.push('Street address is required.');
  if (!addr.city?.trim()) messages.push('City is required.');
  if (!addr.state?.trim()) messages.push('State is required.');
  if (!addr.postalCode?.trim()) messages.push('ZIP / postal code is required.');
  if (addr.country === 'US') {
    if (!/^\d{5}(-\d{4})?$/.test(addr.postalCode?.trim() || '')) messages.push('US ZIP code must be 5 digits (e.g. 75038).');
    if (addr.state?.trim() && addr.state.trim().length !== 2) messages.push('US state should be 2 letters (e.g. TX).');
  }
  return { isValid: messages.length === 0, messages };
}

// Independent per-IP limiter for claim submissions (soft anti-bot layer).
const claimLimiter = new InMemoryRateLimiter();

function toCampaignState(cfg: Record<string, unknown>) {
  const total = Math.max(Number(cfg.totalQuantity) || 0, 0);
  return {
    ok: true,
    active: !!cfg.active,
    title: String(cfg.title || 'Luxedge Pet Gift Drop'),
    message: String(cfg.message || ''),
    giftName: String(cfg.giftName || ''),
    giftValueCents: Math.max(Number(cfg.giftValueCents) || 0, 0),
    total,
    startsAt: cfg.startsAt || null,
    endsAt: cfg.endsAt || null,
    shippingNote: 'Complimentary standard shipping included',
    remaining: -1, // filled after liveRemaining
  };
}

// ---------------------------------------------------------------------------
// GET /api/gift-drop/state
// ---------------------------------------------------------------------------
export async function stateHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const cfg = await loadCampaign();
  if (!cfg) {
    sendJson(res, 200, { ok: true, active: false, title: 'Luxedge Pet Gift Drop', message: '', remaining: 0, total: 0 });
    return;
  }
  const state = toCampaignState(cfg);
  state.remaining = await liveRemaining(state.total);
  sendJson(res, 200, state);
}

// ---------------------------------------------------------------------------
// POST /api/gift-drop/claim
// ---------------------------------------------------------------------------
export async function claimHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) {
    sendJson(res, 503, { error: 'Campaign is temporarily unavailable. Please try again shortly.' });
    return;
  }
  const H = supabaseHeadersFor(serviceRole);

  const ip = clientIp(req);
  if (claimLimiter.isLimited(`gift:${ip}`)) {
    sendJson(res, 429, { error: 'Too many attempts from this device. Please wait a minute and try again.' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid request body.' });
    return;
  }
  const err = validateGiftClaim(body);
  if (err) {
    sendJson(res, 400, { error: err });
    return;
  }
  const input = body as GiftClaimInput;

  const cfg = await loadCampaign();
  if (!cfg || !cfg.active) {
    sendJson(res, 409, { error: 'This Pet Gift Drop is not open right now.', closed: true });
    return;
  }
  const total = Math.max(Number(cfg.totalQuantity) || 0, 0);
  if (total <= 0) {
    sendJson(res, 409, { error: 'This Pet Gift Drop is not open right now.', closed: true });
    return;
  }

  // Dev-only test marker (GIFT_TEST_KEY only exists in local .dev.vars, never
  // in production → public claims can never self-mark as tests).
  let isTest = false;
  const tKey = String((input as { testKey?: unknown }).testKey || '');
  if (tKey) {
    if (!process.env.GIFT_TEST_KEY || tKey !== process.env.GIFT_TEST_KEY) {
      sendJson(res, 403, { error: 'Test claims are not enabled on this deployment.' });
      return;
    }
    isTest = true;
  }

  // Inventory gate (real live count, re-checked immediately before insert).
  const remaining = await liveRemaining(total);
  if (remaining === 0) {
    sendJson(res, 409, { error: 'This Pet Gift Drop has been fully claimed.', full: true });
    return;
  }
  if (remaining < 0 && !isTest) {
    // Count unavailable → fail closed rather than oversell.
    sendJson(res, 503, { error: 'Could not check gift availability — please try again.' });
    return;
  }

  // -------------------------------------------------------------------------
  // Address validation — basic local validation only.
  // Free Gift does NOT require Shippo. Basic format checks ensure the address
  // is complete enough to deliver. Shippo is only used for paid-shipping rates.
  // -------------------------------------------------------------------------
  const addrInput: ShippingAddressInput = {
    fullName: input.firstName,
    addressLine1: input.address.line1 || '',
    addressLine2: input.address.line2,
    city: input.address.city || '',
    state: input.address.state || '',
    postalCode: input.address.zip || '',
    country: input.address.country || 'US',
  };
  // Basic local validation — no external API calls.
  const addrCheck = basicAddressValidate(addrInput);
  if (!addrCheck.isValid) {
    sendJson(res, 400, { error: addrCheck.messages[0] || 'Please check your shipping address.' });
    return;
  }
  // Normalize address formatting (state abbreviation, ZIP format).
  const normalized = normalizeShippingAddress(addrInput);
  input.address.line1 = normalized.addressLine1;
  input.address.line2 = normalized.addressLine2 || undefined;
  input.address.city = normalized.city;
  input.address.state = normalized.state;
  input.address.zip = normalized.postalCode;
  input.address.country = normalized.country;

  const giftName = String(cfg.giftName || 'Complimentary Luxedge pet gift');
  const giftValueCents = Math.max(Number(cfg.giftValueCents) || 0, 0);

  // Atomic one-per-email via deterministic order_number (unique constraint).
  const orderRow = buildGiftOrderRow(input, { ...(cfg as object), giftName, giftValueCents } as never, isTest);
  let insertRes: Response;
  try {
    // Prefer return=representation: this Supabase/PostgREST is configured with
    // return=minimal as default (empty 201 body), so without the header we
    // cannot read the created claim back from the response.
    insertRes = await fetch(`${url}/rest/v1/luxedge_orders`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify(orderRow),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    sendJson(res, 502, { error: 'Could not complete your claim just now — please try again.' });
    return;
  }
  if (insertRes.status === 409 || insertRes.status === 400) {
    const text = (await insertRes.text()).slice(0, 400);
    if (/duplicate|unique|already exists/i.test(text)) {
      sendJson(res, 409, { error: 'A gift was already claimed with this email. One complimentary gift per household.' });
      return;
    }
    sendJson(res, 502, { error: 'Could not complete your claim just now — please try again.' });
    return;
  }
  if (!insertRes.ok) {
    sendJson(res, 502, { error: 'Could not complete your claim just now — please try again.' });
    return;
  }
  let claim: GiftClaimRow | null = null;
  try {
    const inserted = (await insertRes.json()) as GiftClaimRow[];
    claim = Array.isArray(inserted) ? inserted[0] : null;
  } catch {
    claim = null;
  }
  if (!claim || !claim.id) {
    // Fallback: read the row back by its deterministic order number.
    try {
      const back = await fetch(
        `${url}/rest/v1/luxedge_orders?order_number=eq.${encodeURIComponent(orderRow.order_number)}&select=*&limit=1`,
        { headers: H, signal: AbortSignal.timeout(10_000) },
      );
      if (back.ok) {
        const rows = (await back.json()) as GiftClaimRow[];
        claim = Array.isArray(rows) && rows.length ? rows[0] : null;
      }
    } catch {
      claim = null;
    }
  }
  if (!claim || !claim.id) {
    sendJson(res, 502, { error: 'Could not complete your claim just now — please try again.' });
    return;
  }

  // One gift per household: scan live claims; if our street+ZIP already has a
  // live claim by a different household member, cancel our own insert and
  // report honestly. (Soft check — never fails a legitimate claim on a scan
  // error.)
  try {
    const house = normalizeHouse(input.address.line1, input.address.zip);
    const listRes = await fetch(
      `${url}/rest/v1/luxedge_orders?select=id,order_number,customer_email,shipping_address&coupon_code=eq.${encodeURIComponent(GIFT_MARKER)}&status=not.in.(cancelled,failed)&limit=200`,
      { headers: H, signal: AbortSignal.timeout(10_000) },
    );
    if (listRes.ok) {
      const rows = (await listRes.json()) as Array<{
        id: string;
        shipping_address?: { line1?: string; zip?: string; _gift?: { isTest?: boolean } };
      }>;
      const mine = rows.find((r) => r.id === claim.id);
      const conflict = rows.find(
        (r) =>
          r.id !== claim.id &&
          (r.shipping_address?._gift?.isTest ? isTest : true) &&
          normalizeHouse(r.shipping_address?.line1 || '', r.shipping_address?.zip || '') === house,
      );
      if (!mine) {
        sendJson(res, 502, { error: 'Could not verify your claim — please try again.' });
        return;
      }
      if (conflict) {
        await fetch(`${url}/rest/v1/luxedge_orders?id=eq.${claim.id}`, {
          method: 'PATCH',
          headers: H,
          body: JSON.stringify({ status: 'cancelled' }),
          signal: AbortSignal.timeout(10_000),
        });
        sendJson(res, 409, {
          error: 'A complimentary gift was already claimed for this address. One gift per household.',
          conflict: true,
        });
        return;
      }
    }
  } catch {
    /* soft check */
  }

  // Forward the confirmed claim to the Embani ERP (best-effort, bounded).
  // The claim is ALREADY durably stored — ERP downtime must never revoke a
  // legitimate claim. On failure the row's erp_sync_status is marked failed
  // (or left untouched) and Admin → Orders can re-push it, because the ERP
  // push path includes gift claims. Test claims are never forwarded. The
  // call never throws, so the claim response is never affected.
  if (!isTest && claim && claim.order_number) {
    try {
      await autoForwardGiftClaim(claim as never, { timeoutMs: 4_000 });
    } catch {
      /* never break the claim response */
    }
  }

  // Confirmation email (best-effort; a send failure never revokes the gift).
  let emailSent = false;
  if (!isTest) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mail = (req as any).env?.SEND_MAIL as
        | { send: (m: { from: string; to: string; subject: string; html?: string; text?: string }) => Promise<void> }
        | undefined;
      if (mail) {
        const firstName = String(input.firstName || '').trim();
        await mail.send({
          from: 'sales@luxedge.us',
          to: String(input.email || '').trim().toLowerCase(),
          subject: `Your Luxedge Pet Gift Drop claim is confirmed 🎁 (${claim.order_number})`,
          text:
            `Hi ${firstName},\n\n` +
            `Your complimentary Luxedge Pet Gift Drop claim is confirmed — reference ${claim.order_number}.\n\n` +
            `Product and standard shipping are free. There is nothing to pay and no payment details were collected.\n` +
            `We will email you once your gift ships.\n\n` +
            `— The Luxedge Team\nhttps://luxedge.us/free-pet-gift`,
        });
        emailSent = true;
      }
    } catch (e) {
      emailSent = false;
      try {
        const g = giftGiftData(claim);
        await fetch(`${url}/rest/v1/luxedge_orders?id=eq.${claim.id}`, {
          method: 'PATCH',
          headers: H,
          body: JSON.stringify({
            shipping_address: {
              ...(claim.shipping_address || {}),
              _gift: { ...g, emailSent: false, emailNote: (e as Error).message?.slice(0, 120) || 'send failed' },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        /* ignore */
      }
    }
  }

  sendJson(res, 200, {
    ok: true,
    claimId: claim.id,
    orderNumber: claim.order_number,
    giftName,
    payment: 'NOT_REQUIRED',
    totalCents: 0,
    test: isTest,
    emailSent: isTest ? true : emailSent,
    message:
      'Your complimentary gift is reserved. Product and standard shipping are free — no payment details were collected.',
  });
}
