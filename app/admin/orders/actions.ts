"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

const fulfillmentStatuses = new Set(["pending", "processing", "shipped", "delivered", "cancelled"]);

export async function updateFulfillment(orderId: string, formData: FormData) {
  const { supabase } = await requireAdmin();
  const status = String(formData.get("status") ?? "");
  const carrier = String(formData.get("carrier") ?? "").trim();
  const trackingNumber = String(formData.get("trackingNumber") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !fulfillmentStatuses.has(status)) redirect("/admin/orders?error=validation");
  const { error } = await supabase.rpc("admin_update_order_fulfillment", { target_order_id: orderId, next_status: status, next_carrier: carrier || null, next_tracking_number: trackingNumber || null });
  if (error) redirect(`/admin/orders?error=${encodeURIComponent(error.code || "update")}`);
  revalidatePath("/admin/orders");
  redirect("/admin/orders?updated=1");
}
