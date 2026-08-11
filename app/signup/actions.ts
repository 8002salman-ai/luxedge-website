"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/supabase/config";

export async function signup(formData: FormData) {
  if (!hasSupabaseConfig()) redirect("/signup?setup=required");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || displayName.length < 2 || password.length < 12) redirect("/signup?error=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback` },
  });
  if (error) redirect(`/signup?error=${encodeURIComponent(error.code || "signup")}`);
  redirect(data.session ? "/account" : "/login?message=verify");
}
