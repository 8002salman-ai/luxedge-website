"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export async function createCategory(formData: FormData) {
  const { supabase } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const description = String(formData.get("description") ?? "").trim();
  if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) redirect("/admin/categories?error=validation#new");
  const { error } = await supabase.from("categories").insert({ name, slug, description });
  if (error) redirect(`/admin/categories?error=${encodeURIComponent(error.code || "create")}#new`);
  revalidatePath("/admin/categories");
  revalidatePath("/shop");
  redirect("/admin/categories?created=1");
}

export async function toggleCategory(categoryId: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(categoryId)) redirect("/admin/categories?error=validation");
  const isActive = formData.get("isActive") === "true";
  const { error } = await supabase.from("categories").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", categoryId);
  if (error) redirect(`/admin/categories?error=${encodeURIComponent(error.code || "update")}`);
  revalidatePath("/admin/categories");
  revalidatePath("/shop");
  redirect("/admin/categories?updated=1");
}
