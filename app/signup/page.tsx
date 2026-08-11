import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { signup } from "./actions";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; setup?: string }> }) {
  const params = await searchParams;
  const configured = hasSupabaseConfig();
  return <section className="auth-page"><div className="auth-card">
    <UserPlus size={30} strokeWidth={1.4} /><p className="eyebrow"><span /> Customer account</p><h1>Join LuxEdge.</h1>
    <p className="auth-lede">Save addresses, see orders and move through checkout faster. Guest checkout will remain available.</p>
    {!configured || params.setup === "required" ? <div className="notice warning">Supabase must be connected before accounts can be created.</div> : null}
    {params.error ? <div className="notice error">We could not create that account. Check the fields or try a different email.</div> : null}
    <form action={signup} className="auth-form">
      <label>Name<input name="displayName" autoComplete="name" required minLength={2} disabled={!configured} /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required disabled={!configured} /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={12} disabled={!configured} /><small>Use at least 12 characters.</small></label>
      <button className="button button-dark" type="submit" disabled={!configured}>Create account</button>
    </form>
    <p className="auth-switch">Already registered? <Link href="/login">Sign in</Link></p>
  </div></section>;
}
