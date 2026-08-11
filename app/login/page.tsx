import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { login } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; setup?: string }> }) {
  const params = await searchParams;
  const configured = hasSupabaseConfig();
  return <section className="auth-page">
    <div className="auth-card">
      <KeyRound size={30} strokeWidth={1.4} />
      <p className="eyebrow"><span /> Private access</p>
      <h1>Welcome back.</h1>
      <p className="auth-lede">Customers and administrators use the same secure sign-in. Your role determines which workspace opens.</p>
      {!configured || params.setup === "required" ? <div className="notice warning">Supabase is not connected yet. Add the public URL and publishable key to <code>.env.local</code>.</div> : null}
      {params.error === "invalid" ? <div className="notice error">Email or password is incorrect.</div> : null}
      <form action={login} className="auth-form">
        <input type="hidden" name="next" value={params.next || "/account"} />
        <label>Email<input name="email" type="email" autoComplete="email" required disabled={!configured} /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required minLength={8} disabled={!configured} /></label>
        <button className="button button-dark" type="submit" disabled={!configured}>Sign in</button>
      </form>
      <p className="auth-switch">New to LuxEdge? <Link href="/signup">Create an account</Link></p>
    </div>
  </section>;
}
