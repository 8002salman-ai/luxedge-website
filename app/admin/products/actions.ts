"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

const uuid = /^[0-9a-f-]{36}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const statuses = new Set(["draft", "review", "published", "archived"]);
const text = (form: FormData, name: string, max = 5000) => String(form.get(name) ?? "").trim().slice(0, max);
const nullableUuid = (value: string) => value && uuid.test(value) ? value : null;
function cents(value: string): number;
function cents(value: string, optional: true): number | null;
function cents(value: string, optional = false): number | null {
  if (optional && !value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return Number.NaN;
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : Number.NaN;
}
const variantValues = (form: FormData) => ({ color: text(form, "color", 80), size: text(form, "size", 80) });
const supplierValues = (form: FormData) => ({ supplier_code: text(form, "supplierCode", 80), supplier_sku: text(form, "supplierSku", 160), supplier_landed_cost_amount: cents(text(form, "landedCost", 20), true), supplier_channel_approved: form.get("channelApproved") === "on" });

export async function createProduct(formData: FormData) {
  const { supabase } = await requireAdmin();
  const title = text(formData, "title", 160);
  const slug = text(formData, "slug", 160).toLowerCase();
  const sku = text(formData, "sku", 120).toUpperCase();
  const price = cents(text(formData, "price", 20));
  const compareAt = cents(text(formData, "compareAt", 20), true);
  const inventory = Number(text(formData, "inventory", 8));
  const weightOz = Number(text(formData, "weightOz", 12));
  const supplier = supplierValues(formData);
  if (title.length < 2 || !slugPattern.test(slug) || sku.length < 2 || !Number.isInteger(price) || price < 0 || (compareAt !== null && (!Number.isInteger(compareAt) || compareAt < price)) || !Number.isInteger(inventory) || inventory < 0 || !Number.isFinite(weightOz) || weightOz <= 0 || (supplier.supplier_landed_cost_amount !== null && !Number.isInteger(supplier.supplier_landed_cost_amount))) redirect("/admin/products?error=validation#new");
  const { data, error } = await supabase.rpc("admin_create_product_v2", {
    product_title: title, product_slug: slug, product_description: text(formData, "description"), product_short_description: text(formData, "shortDescription", 300), product_category_id: nullableUuid(text(formData, "categoryId", 36)), product_seo_title: text(formData, "seoTitle", 70), product_seo_description: text(formData, "seoDescription", 170), product_weight_oz: weightOz, product_tax_code: text(formData, "taxCode", 20) || "txcd_99999999",
    variant_sku: sku, variant_title: text(formData, "variantTitle", 120) || "Default", variant_price_amount: price, variant_compare_at_amount: compareAt, variant_inventory: inventory, variant_option_values: variantValues(formData), ...supplier,
  });
  if (error || !data) redirect(`/admin/products?error=${encodeURIComponent(error?.code || "create")}#new`);
  revalidatePath("/admin/products");
  redirect(`/admin/products/${data}?created=1`);
}

export async function updateProductDetails(productId: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const title = text(formData, "title", 160); const slug = text(formData, "slug", 160).toLowerCase();
  const weightOz = Number(text(formData, "weightOz", 12)); const status = text(formData, "status", 20);
  if (!uuid.test(productId) || title.length < 2 || !slugPattern.test(slug) || !Number.isFinite(weightOz) || weightOz <= 0 || !statuses.has(status)) redirect(`/admin/products/${productId}?error=validation`);
  const { error } = await supabase.rpc("admin_update_product_details", { target_product_id: productId, product_title: title, product_slug: slug, product_description: text(formData, "description"), product_short_description: text(formData, "shortDescription", 300), product_category_id: nullableUuid(text(formData, "categoryId", 36)), product_seo_title: text(formData, "seoTitle", 70), product_seo_description: text(formData, "seoDescription", 170), product_weight_oz: weightOz, product_tax_code: text(formData, "taxCode", 20) || "txcd_99999999", product_status: status, product_featured: formData.get("featured") === "on" });
  if (error) redirect(`/admin/products/${productId}?error=${encodeURIComponent(error.code || "update")}`);
  revalidatePath("/admin/products"); revalidatePath(`/admin/products/${productId}`); revalidatePath("/shop");
  redirect(`/admin/products/${productId}?updated=product`);
}

export async function addVariant(productId: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const price = cents(text(formData, "price", 20)); const compareAt = cents(text(formData, "compareAt", 20), true); const inventory = Number(text(formData, "inventory", 8)); const supplier = supplierValues(formData);
  if (!uuid.test(productId) || text(formData, "sku", 120).length < 2 || !Number.isInteger(price) || price < 0 || (compareAt !== null && (!Number.isInteger(compareAt) || compareAt < price)) || !Number.isInteger(inventory) || inventory < 0 || (supplier.supplier_landed_cost_amount !== null && !Number.isInteger(supplier.supplier_landed_cost_amount))) redirect(`/admin/products/${productId}?error=variant#variants`);
  const { error } = await supabase.rpc("admin_add_variant", { target_product_id: productId, variant_sku: text(formData, "sku", 120), variant_title: text(formData, "variantTitle", 120) || "Default", variant_price_amount: price, variant_compare_at_amount: compareAt, variant_inventory: inventory, variant_option_values: variantValues(formData), ...supplier });
  if (error) redirect(`/admin/products/${productId}?error=${encodeURIComponent(error.code || "variant")}#variants`);
  revalidatePath(`/admin/products/${productId}`); revalidatePath("/shop"); redirect(`/admin/products/${productId}?updated=variant#variants`);
}

export async function updateVariant(productId: string, variantId: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const price = cents(text(formData, "price", 20)); const compareAt = cents(text(formData, "compareAt", 20), true); const inventory = Number(text(formData, "inventory", 8)); const status = text(formData, "status", 20); const supplier = supplierValues(formData);
  if (!uuid.test(productId) || !uuid.test(variantId) || !statuses.has(status) || !Number.isInteger(price) || price < 0 || (compareAt !== null && (!Number.isInteger(compareAt) || compareAt < price)) || !Number.isInteger(inventory) || inventory < 0 || (supplier.supplier_landed_cost_amount !== null && !Number.isInteger(supplier.supplier_landed_cost_amount))) redirect(`/admin/products/${productId}?error=variant#variants`);
  const { error } = await supabase.rpc("admin_update_variant", { target_variant_id: variantId, variant_sku: text(formData, "sku", 120), variant_title: text(formData, "variantTitle", 120) || "Default", variant_price_amount: price, variant_compare_at_amount: compareAt, variant_inventory: inventory, variant_option_values: variantValues(formData), variant_status: status, ...supplier });
  if (error) redirect(`/admin/products/${productId}?error=${encodeURIComponent(error.code || "variant")}#variants`);
  revalidatePath(`/admin/products/${productId}`); revalidatePath("/shop"); redirect(`/admin/products/${productId}?updated=variant#variants`);
}

export async function uploadProductImage(productId: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const file = formData.get("image");
  if (!uuid.test(productId) || !(file instanceof File) || file.size < 1 || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)) redirect(`/admin/products/${productId}?error=image#media`);
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" } as Record<string, string>)[file.type];
  const storagePath = `${productId}/${randomUUID()}.${extension}`;
  const upload = await supabase.storage.from("product-media").upload(storagePath, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (upload.error) redirect(`/admin/products/${productId}?error=image-upload#media`);
  const publicUrl = supabase.storage.from("product-media").getPublicUrl(storagePath).data.publicUrl;
  const { count } = await supabase.from("product_images").select("id", { count: "exact", head: true }).eq("product_id", productId);
  const inserted = await supabase.from("product_images").insert({ product_id: productId, storage_path: storagePath, public_url: publicUrl, alt_text: text(formData, "altText", 180), sort_order: count || 0 });
  if (inserted.error) { await supabase.storage.from("product-media").remove([storagePath]); redirect(`/admin/products/${productId}?error=image-save#media`); }
  if (!count) await supabase.from("products").update({ image_url: publicUrl }).eq("id", productId);
  revalidatePath(`/admin/products/${productId}`); revalidatePath("/shop"); redirect(`/admin/products/${productId}?updated=image#media`);
}

export async function setPrimaryImage(productId: string, imageId: string) {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("product_images").select("public_url").eq("id", imageId).eq("product_id", productId).single();
  if (!data) redirect(`/admin/products/${productId}?error=image#media`);
  await supabase.from("products").update({ image_url: data.public_url }).eq("id", productId);
  revalidatePath(`/admin/products/${productId}`); revalidatePath("/shop"); redirect(`/admin/products/${productId}?updated=primary#media`);
}

export async function deleteProductImage(productId: string, imageId: string) {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("product_images").select("storage_path,public_url").eq("id", imageId).eq("product_id", productId).single();
  if (!data) redirect(`/admin/products/${productId}?error=image#media`);
  const { data: product } = await supabase.from("products").select("image_url").eq("id", productId).single();
  await supabase.storage.from("product-media").remove([data.storage_path]);
  await supabase.from("product_images").delete().eq("id", imageId).eq("product_id", productId);
  if (product?.image_url === data.public_url) {
    const { data: next } = await supabase.from("product_images").select("public_url").eq("product_id", productId).order("sort_order").limit(1).maybeSingle();
    await supabase.from("products").update({ image_url: next?.public_url || null }).eq("id", productId);
  }
  revalidatePath(`/admin/products/${productId}`); revalidatePath("/shop"); redirect(`/admin/products/${productId}?updated=image-removed#media`);
}
