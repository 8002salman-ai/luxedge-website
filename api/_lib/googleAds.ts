// ============================================================================
// LUXEDGE V2 — GOOGLE ADS SERVER LIB (Phase 4G §E)
//
// SERVER-SIDE CONFIGURATION ONLY. Phase 4G adds the env-var contract and the
// configured/not_configured probe — NO live Google Ads calls are made in
// Phase 4G (no credentials are supplied; tests use fixtures).
//
// Required env (server-side only, never VITE_*, never browser, never DB,
// never state docs):
//   GOOGLE_ADS_DEVELOPER_TOKEN
//   GOOGLE_ADS_CLIENT_ID
//   GOOGLE_ADS_CLIENT_SECRET
//   GOOGLE_ADS_REFRESH_TOKEN
//   GOOGLE_ADS_CUSTOMER_ID
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID (optional)
//
// This module never reads or exposes secret VALUES — only presence.
// ============================================================================

export const GOOGLE_ADS_ENV_NAMES = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
] as const;

/** True when the minimum credential set is present (presence only — never values). */
export function googleAdsConfiguredServer(): boolean {
  const e = (n: string): string | undefined => {
    try {
      return typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[n] : undefined;
    } catch {
      return undefined;
    }
  };
  return Boolean(
    e('GOOGLE_ADS_DEVELOPER_TOKEN') &&
    e('GOOGLE_ADS_CLIENT_ID') &&
    e('GOOGLE_ADS_CLIENT_SECRET') &&
    e('GOOGLE_ADS_REFRESH_TOKEN') &&
    e('GOOGLE_ADS_CUSTOMER_ID')
  );
}

/** Scrub anything that could look like a credential from an error message. */
export function googleAdsSafeError(e: unknown): string {
  const msg = String((e instanceof Error ? e.message : e) || 'unknown error');
  return msg
    .replace(/(GOOGLE_ADS_[A-Z_]+|Bearer [A-Za-z0-9._-]+|Authorization[^\s,;]{0,80})/gi, '***')
    .slice(0, 200);
}
