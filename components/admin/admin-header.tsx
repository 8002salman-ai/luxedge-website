import { logout } from "@/app/login/actions";

export function AdminHeader({ email }: { email: string }) {
  return <header className="admin-header"><div><p>LuxEdge operations</p><span>{email}</span></div><form action={logout}><button type="submit">Sign out</button></form></header>;
}
