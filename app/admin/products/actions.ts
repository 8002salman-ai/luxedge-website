"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export async function createProduct(formData: FormData) {
  const { supabase } = await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  const price = Number(formData.get("price"));
  const inventory = Number(formData.get("inventory"));
  if (title.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || sku.length < 2 || !Number.isFinite(price) || price < 0 || !Number.isInteger(inventory) || inventory < 0) redirect("/admin/products?error=validation#new");
  const { error } = await supabase.rpc("admin_create_product", { product_title: title, product_slug: slug, product_sku: sku, product_price_amount: Math.round(price * 100), product_inventory: inventory, product_description: String(formData.get("description") ?? "").trim(), product_image_url: String(formData.get("imageUrl") ?? "").trim() || null });
  if (error) redirect(`/admin/products?error=${encodeURIComponent(error.code || "create")}#new`);
  revalidatePath("/admin/products");
  redirect("/admin/products?created=1");
}

const catalogStatuses = new Set(["draft", "review", "published", "archived"]);

export async function updateProduct(productId: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const status = String(formData.get("status") ?? "");
  const price = Number(formData.get("price"));
  const inventory = Number(formData.get("inventory"));
  if (!/^[0-9a-f-]{36}$/i.test(productId) || !catalogStatuses.has(status) || !Number.isFinite(price) || price < 0 || !Number.isInteger(inventory) || inventory < 0) redirect("/admin/products?error=validation");
  const { error } = await supabase.rpc("admin_update_product", { target_product_id: productId, next_status: status, next_price_amount: Math.round(price * 100), next_inventory: inventory });
  if (error) redirect(`/admin/products?error=${encodeURIComponent(error.code || "update")}`);
  revalidatePath("/admin/products");
  revalidatePath("/shop");
  redirect("/admin/products?updated=1");
}
