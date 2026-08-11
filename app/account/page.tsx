import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { updatePassword } from "./actions";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ password?: string; welcome?: string; error?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");
  return <section className="account-page section"><p className="eyebrow"><span /> Customer account</p><h1>Your LuxEdge account</h1><p>{user.email}</p>
    {params.welcome ? <div className="notice success">Email verified. Set your LuxEdge password below.</div> : null}
    {params.password === "updated" ? <div className="notice success">Password updated securely.</div> : null}
    {params.password === "invalid" ? <div className="notice error">Passwords must match and contain at least 12 characters.</div> : null}
    {params.password === "failed" ? <div className="notice error">Password could not be updated. Request a fresh invitation and try again.</div> : null}
    <div className="account-actions">{user.app_metadata?.role === "admin" ? <Link className="button button-gold" href="/admin">Open admin</Link> : null}<Link className="button button-cream" href="/shop">Continue shopping</Link><form action={logout}><button className="button button-dark">Sign out</button></form></div>
    <div className="account-password"><h2>Set or change password</h2><p>Your password is sent directly to Supabase Auth and is never stored in LuxEdge tables.</p><form action={updatePassword} className="auth-form"><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label><label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label><button className="button button-dark" type="submit">Update password</button></form></div>
  </section>;
}
