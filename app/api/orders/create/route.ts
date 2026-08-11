import { getCurrentUser } from "@/lib/auth";
import { getVerifiedGuestSessionHash } from "@/lib/commerce/guest-session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  if (process.env.CHECKOUT_ENABLED !== "true") return Response.json({ error: "Checkout is not enabled yet." }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }

  const email = cleanText(body.email, 254).toLowerCase();
  const phone = cleanText(body.phone, 30);
  const address = body.shippingAddress && typeof body.shippingAddress === "object" ? body.shippingAddress as Record<string, unknown> : {};
  const shippingAddress = {
    fullName: cleanText(address.fullName, 120),
    street1: cleanText(address.street1, 160),
    street2: cleanText(address.street2, 160),
    city: cleanText(address.city, 100),
    state: cleanText(address.state, 80),
    postalCode: cleanText(address.postalCode, 20),
    country: cleanText(address.country || "US", 2).toUpperCase(),
  };
  if (!emailPattern.test(email) || shippingAddress.fullName.length < 2 || shippingAddress.street1.length < 2 || shippingAddress.city.length < 2 || shippingAddress.state.length < 2 || shippingAddress.postalCode.length < 3 || shippingAddress.country !== "US") return Response.json({ error: "Complete contact and US shipping details are required." }, { status: 400 });

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 25) return Response.json({ error: "Your bag must contain 1 to 25 products." }, { status: 400 });
  const items: { variantId: string; quantity: number }[] = [];
  const seen = new Set<string>();
  for (const entry of body.items) {
    if (!entry || typeof entry !== "object") return Response.json({ error: "Invalid bag item." }, { status: 400 });
    const item = entry as Record<string, unknown>;
    const variantId = cleanText(item.variantId, 36);
    const quantity = Number(item.quantity);
    if (!uuid.test(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 25 || seen.has(variantId)) return Response.json({ error: "Invalid or duplicate bag item." }, { status: 400 });
    seen.add(variantId);
    items.push({ variantId, quantity });
  }

  const [user, guestHash] = await Promise.all([getCurrentUser(), getVerifiedGuestSessionHash()]);
  if (!user && !guestHash) return Response.json({ error: "A verified customer or guest session is required." }, { status: 401 });

  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("server_create_order", { p_user_id: user?.id || null, p_guest_session_hash: user ? null : guestHash, p_email: email, p_phone: phone || null, p_shipping_address: shippingAddress, p_items: items });
    if (error) {
      const unavailable = /product_unavailable|insufficient_inventory/i.test(error.message);
      return Response.json({ error: unavailable ? "One or more products are no longer available in the requested quantity." : "The secure order could not be created." }, { status: unavailable ? 409 : 400 });
    }
    const order = Array.isArray(data) ? data[0] : data;
    if (!order?.id) return Response.json({ error: "The secure order could not be created." }, { status: 500 });
    return Response.json({ order: { id: order.id, orderNumber: order.order_number, subtotalAmount: order.subtotal_amount, shippingAmount: order.shipping_amount, taxAmount: order.tax_amount, totalAmount: order.total_amount, currency: order.currency } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Checkout server configuration is incomplete." }, { status: 503 }); }
}
