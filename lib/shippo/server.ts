import "server-only";

const endpoint = "https://api.goshippo.com";

export async function shippoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.SHIPPO_API_TOKEN;
  if (!token) throw new Error("Shippo is not configured.");
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: { Authorization: `ShippoToken ${token}`, "Content-Type": "application/json", "SHIPPO-API-VERSION": "2018-02-08", ...init.headers },
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Shippo request failed (${response.status}).`);
  return payload as T;
}

export function getShipFromAddress() {
  const fields = {
    name: process.env.SHIPPO_FROM_NAME,
    street1: process.env.SHIPPO_FROM_STREET,
    city: process.env.SHIPPO_FROM_CITY,
    state: process.env.SHIPPO_FROM_STATE,
    zip: process.env.SHIPPO_FROM_ZIP,
    country: process.env.SHIPPO_FROM_COUNTRY || "US",
    phone: process.env.SHIPPO_FROM_PHONE,
    email: process.env.SHIPPO_FROM_EMAIL,
  };
  if (!fields.name || !fields.street1 || !fields.city || !fields.state || !fields.zip) throw new Error("Shippo ship-from address is incomplete.");
  return fields;
}
