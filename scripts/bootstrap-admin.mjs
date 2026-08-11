import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!url || !secret || !email || !password) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_BOOTSTRAP_EMAIL, or ADMIN_BOOTSTRAP_PASSWORD.");
  process.exit(1);
}
if (password.length < 12) {
  console.error("ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const supabase = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listError) throw listError;
const existing = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

const result = existing
  ? await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true, app_metadata: { ...existing.app_metadata, role: "admin" } })
  : await supabase.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "admin" } });

if (result.error) throw result.error;
console.log(`Admin bootstrap complete for ${result.data.user.email}. Remove ADMIN_BOOTSTRAP_PASSWORD from the environment now.`);
