export async function GET() {
  return Response.json({ service: "luxedge-commerce", status: "ok", databaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), paymentsEnabled: false }, { headers: { "Cache-Control": "no-store" } });
}
