// ============================================================================
// LUXEDGE — OFFICIAL SOCIAL PROFILES (single client-side source)
//
// EMPTY ON PURPOSE (September 2026).
//
// The storefront footer used to render five social buttons whose destinations
// were the platform homepages themselves — https://facebook.com,
// https://instagram.com, https://pinterest.com, https://tiktok.com — and a
// placeholder YouTube URL pointing at the owner's personal channel
// (@TheAIWithSalman), not a Luxedge account. None of those is a Luxedge
// profile, so the buttons advertised accounts the business does not have and
// sent visitors nowhere useful. The owner asked for them to come down until
// the accounts are real.
//
// TO RE-ENABLE: add one entry per account that genuinely exists and is owned
// by Luxedge. Nothing else needs to change — the footer renders itself from
// this list (and renders NOTHING while it is empty), and the admin
// Organization-schema helper emits `sameAs` only from this list. That keeps one
// account in exactly one place, so it can never be half-added (a button with no
// structured data, or structured data naming a profile that does not exist).
//
// Do not add an entry for a profile that is not live and verified. `sameAs`
// that names a non-existent profile is a false claim about the business, and a
// footer button that opens a platform homepage is worse than no button.
// ============================================================================

export interface SocialProfile {
  /** Accessible name and icon key. */
  label: 'Facebook' | 'Instagram' | 'YouTube' | 'Pinterest' | 'TikTok';
  /** The verified account URL — never a platform homepage. */
  href: string;
}

export const SOCIAL_PROFILES: SocialProfile[] = [];
