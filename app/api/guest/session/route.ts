import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getVerifiedGuestSessionHash } from "@/lib/commerce/guest-session";

export const runtime = "nodejs";

export async function POST() {
  const secret = process.env.GUEST_SESSION_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "Guest checkout is not configured." }, { status: 503 });
  if (await getVerifiedGuestSessionHash()) return Response.json({ created: false, reused: true }, { headers: { "Cache-Control": "no-store" } });
  const token = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", secret).update(token).digest("base64url");
  const cookieStore = await cookies();
  cookieStore.set("luxedge_guest", `${token}.${signature}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
  return Response.json({ created: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
