import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type RequestedCartItem = { variantId: string; quantity: number };
export type AuthoritativeCartLine = {
  variantId: string; productId: string; sku: string; title: string; quantity: number;
  unitAmount: number; lineAmount: number; currency: string; weightOz: number; taxCode: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseRequestedCart(value: unknown): RequestedCartItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) return null;
  const items: RequestedCartItem[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const item = entry as Record<string, unknown>;
    const variantId = typeof item.variantId === "string" ? item.variantId.trim() : "";
    const quantity = Number(item.quantity);
    if (!uuid.test(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 25 || seen.has(variantId)) return null;
    seen.add(variantId); items.push({ variantId, quantity });
  }
  return items;
}

export async function loadAuthoritativeCart(items: RequestedCartItem[]) {
  const ids = items.map((item) => item.variantId);
  const db = createAdminClient();
  const { data, error } = await db.from("product_variants").select("id,product_id,sku,title,price_amount,status,products(id,title,status,currency,weight_oz,tax_code),inventory(available,reserved)").in("id", ids);
  if (error) throw new Error("catalog_unavailable");
  const rows = (data || []) as any[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const lines: AuthoritativeCartLine[] = [];
  let currency: string | null = null;
  let subtotalAmount = 0;
  let weightOz = 0;
  for (const item of items) {
    const row = byId.get(item.variantId);
    const product = Array.isArray(row?.products) ? row.products[0] : row?.products;
    const inventory = Array.isArray(row?.inventory) ? row.inventory[0] : row?.inventory;
    if (!row || !product || row.status !== "published" || product.status !== "published") throw new Error("product_unavailable");
    if (!inventory || inventory.available - inventory.reserved < item.quantity) throw new Error("insufficient_inventory");
    if (currency && currency !== product.currency) throw new Error("mixed_currency_order");
    currency = product.currency;
    const lineAmount = row.price_amount * item.quantity;
    if (!Number.isSafeInteger(lineAmount) || lineAmount < 0) throw new Error("invalid_catalog_price");
    subtotalAmount += lineAmount;
    weightOz += Number(product.weight_oz || 16) * item.quantity;
    lines.push({ variantId: row.id, productId: product.id, sku: row.sku, title: row.title === "Default" ? product.title : `${product.title} - ${row.title}`, quantity: item.quantity, unitAmount: row.price_amount, lineAmount, currency: product.currency, weightOz: Number(product.weight_oz || 16), taxCode: product.tax_code || "txcd_99999999" });
  }
  if (!currency || !Number.isSafeInteger(subtotalAmount) || subtotalAmount > 2147483647 || !Number.isFinite(weightOz) || weightOz <= 0) throw new Error("invalid_cart");
  return { lines, currency, subtotalAmount, weightOz: Math.min(2400, Math.max(0.1, weightOz)) };
}

export function parcelForWeight(weightOz: number) {
  const dimension = (name: string, fallback: string) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 && value <= 100 ? value.toFixed(2) : fallback;
  };
  return { length: dimension("SHIPPO_PARCEL_LENGTH_IN", "12.00"), width: dimension("SHIPPO_PARCEL_WIDTH_IN", "10.00"), height: dimension("SHIPPO_PARCEL_HEIGHT_IN", "4.00"), distance_unit: "in", weight: weightOz.toFixed(2), mass_unit: "oz" };
}
