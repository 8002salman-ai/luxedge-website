import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export async function getVerifiedGuestSessionHash() {
  const secret = process.env.GUEST_SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const value = (await cookies()).get("luxedge_guest")?.value;
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const token = value.slice(0, separator);
  const supplied = value.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(token).digest("base64url");
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  return createHash("sha256").update(token).digest("hex");
}
