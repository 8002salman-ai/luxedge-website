import { getCurrentUser } from "@/lib/auth";
import { getVerifiedGuestSessionHash } from "@/lib/commerce/guest-session";
import { loadAuthoritativeCart, parcelForWeight, parseRequestedCart } from "@/lib/commerce/server-cart";
import { getShipFromAddress, shippoRequest } from "@/lib/shippo/server";

type Rate = { object_id: string; amount: string; currency: string; provider: string; estimated_days?: number; servicelevel?: { name?: string; token?: string } };
type Shipment = { rates?: Rate[]; messages?: { text?: string }[] };
const text = (value: unknown, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  if (!process.env.SHIPPO_API_TOKEN) return Response.json({ error: "Shipping rates are not configured." }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const [user, guestHash] = await Promise.all([getCurrentUser(), getVerifiedGuestSessionHash()]);
  if (!user && !guestHash) return Response.json({ error: "A verified customer or guest session is required." }, { status: 401 });
  const items = parseRequestedCart(body.items);
  const to = body.addressTo && typeof body.addressTo === "object" ? body.addressTo as Record<string, unknown> : {};
  const addressTo = { name: text(to.name), street1: text(to.street1), street2: text(to.street2), city: text(to.city), state: text(to.state, 3).toUpperCase(), zip: text(to.zip, 12), country: text(to.country || "US", 2).toUpperCase(), phone: text(to.phone, 30), email: text(to.email, 200) };
  if (!items || !addressTo.name || !addressTo.street1 || !addressTo.city || !addressTo.state || !addressTo.zip || addressTo.country !== "US") return Response.json({ error: "A complete US address and valid bag are required." }, { status: 400 });
  try {
    const cart = await loadAuthoritativeCart(items);
    const shipment = await shippoRequest<Shipment>("/shipments/", { method: "POST", body: JSON.stringify({ address_from: getShipFromAddress(), address_to: addressTo, parcels: [parcelForWeight(cart.weightOz)], async: false }) });
    const rates = (shipment.rates || []).map((rate) => ({ id: rate.object_id, amount: rate.amount, currency: rate.currency, carrier: rate.provider, service: rate.servicelevel?.name, serviceToken: rate.servicelevel?.token, estimatedDays: rate.estimated_days })).filter((rate) => rate.id && rate.amount && rate.currency);
    return Response.json({ rates, messages: shipment.messages || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Shipping rates could not be retrieved for this bag." }, { status: 502 }); }
}
