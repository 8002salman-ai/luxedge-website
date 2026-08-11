import "server-only";
import type { AuthoritativeCartLine } from "./server-cart";
import { getStripe } from "@/lib/stripe/server";
import { shippoRequest } from "@/lib/shippo/server";

export type CheckoutAddress = { fullName: string; street1: string; street2: string; city: string; state: string; postalCode: string; country: string };
type ShippoRate = { object_id: string; object_created?: string; amount: string; currency: string; provider: string; test?: boolean; servicelevel?: { name?: string; token?: string }; estimated_days?: number };

function decimalToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("invalid_shipping_rate");
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("invalid_shipping_rate");
  return cents;
}

export async function retrieveVerifiedShippoRate(rateId: string, expectedCurrency: string) {
  if (!/^[a-f0-9]{32}$/i.test(rateId)) throw new Error("invalid_shipping_rate");
  const rate = await shippoRequest<ShippoRate>(`/rates/${rateId}`, { method: "GET" });
  if (!rate.object_id || rate.object_id !== rateId || rate.currency.toLowerCase() !== expectedCurrency.toLowerCase()) throw new Error("invalid_shipping_rate");
  if (rate.object_created && Date.now() - Date.parse(rate.object_created) > 24 * 60 * 60 * 1000) throw new Error("expired_shipping_rate");
  return { id: rate.object_id, amount: decimalToCents(rate.amount), currency: rate.currency.toLowerCase(), carrier: rate.provider, service: rate.servicelevel?.name || rate.servicelevel?.token || "Standard", estimatedDays: rate.estimated_days ?? null };
}

export async function calculateCheckoutTax(lines: AuthoritativeCartLine[], shippingAmount: number, address: CheckoutAddress, currency: string) {
  const mode = process.env.TAX_MODE;
  if (mode === "none") return { taxAmount: 0, calculationId: null as string | null };
  if (mode !== "stripe" || !process.env.STRIPE_SECRET_KEY) throw new Error("tax_not_configured");
  const calculation = await getStripe().tax.calculations.create({
    currency,
    customer_details: { address_source: "shipping", address: { line1: address.street1, line2: address.street2 || undefined, city: address.city, state: address.state, postal_code: address.postalCode, country: address.country } },
    line_items: lines.map((line) => ({ amount: line.lineAmount, quantity: line.quantity, reference: line.variantId, tax_behavior: "exclusive", tax_code: line.taxCode })),
    shipping_cost: { amount: shippingAmount, tax_behavior: "exclusive", tax_code: "txcd_92010001" },
  });
  if (!calculation.id || calculation.currency !== currency || !Number.isSafeInteger(calculation.tax_amount_exclusive) || calculation.tax_amount_exclusive < 0) throw new Error("invalid_tax_calculation");
  return { taxAmount: calculation.tax_amount_exclusive, calculationId: calculation.id };
}
