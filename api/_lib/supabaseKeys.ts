/** Build server-only Supabase headers for modern secrets and legacy JWTs. */
export function supabaseServerHeaders(
  key: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const value = key.trim();
  const headers: Record<string, string> = { apikey: value, ...extra };
  // Modern sb_secret keys are not JWTs and authenticate through apikey only.
  if (value && !value.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${value}`;
  }
  return headers;
}
