import { getShipFromAddress, shippoRequest } from "@/lib/shippo/server";

type Rate = { object_id: string; amount: string; currency: string; provider: string; estimated_days?: number; servicelevel?: { name?: string; token?: string } };
type Shipment = { rates?: Rate[]; messages?: { text?: string }[] };

const text = (value: unknown, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : "";
const positive = (value: unknown, max: number) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed.toFixed(2) : null; };

export async function POST(request: Request) {
  if (!process.env.SHIPPO_API_TOKEN) return Response.json({ error: "Shipping rates are not configured." }, { status: 503 });
  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const to = body?.addressTo || {};
  const parcel = body?.parcel || {};
  const addressTo = { name: text(to.name), street1: text(to.street1), street2: text(to.street2), city: text(to.city), state: text(to.state, 3).toUpperCase(), zip: text(to.zip, 12), country: text(to.country || "US", 2).toUpperCase(), phone: text(to.phone, 30), email: text(to.email, 200) };
  const normalizedParcel = { length: positive(parcel.length, 100), width: positive(parcel.width, 100), height: positive(parcel.height, 100), distance_unit: "in", weight: positive(parcel.weight, 2400), mass_unit: "oz" };
  if (!addressTo.name || !addressTo.street1 || !addressTo.city || !addressTo.state || !addressTo.zip || !normalizedParcel.length || !normalizedParcel.width || !normalizedParcel.height || !normalizedParcel.weight) return Response.json({ error: "A complete US address and valid parcel are required." }, { status: 400 });
  try {
    const shipment = await shippoRequest<Shipment>("/shipments/", { method: "POST", body: JSON.stringify({ address_from: getShipFromAddress(), address_to: addressTo, parcels: [normalizedParcel], async: false }) });
    const rates = (shipment.rates || []).map((rate) => ({ id: rate.object_id, amount: rate.amount, currency: rate.currency, carrier: rate.provider, service: rate.servicelevel?.name, serviceToken: rate.servicelevel?.token, estimatedDays: rate.estimated_days }));
    return Response.json({ rates, messages: shipment.messages || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Shipping rates could not be retrieved." }, { status: 502 }); }
}
