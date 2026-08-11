"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/supabase/config";

export async function login(formData: FormData) {
  if (!hasSupabaseConfig()) redirect("/login?setup=required");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const requested = String(formData.get("next") ?? "/account");
  const destination = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/account";
  if (!email || password.length < 8) redirect(`/login?error=invalid&next=${encodeURIComponent(destination)}`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect(`/login?error=invalid&next=${encodeURIComponent(destination)}`);
  const isAdmin = data.user.app_metadata?.role === "admin";
  redirect(isAdmin ? "/admin" : destination === "/admin" ? "/account" : destination);
}

export async function logout() {
  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
