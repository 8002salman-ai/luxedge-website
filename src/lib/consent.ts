export type ConsentChoice = 'accepted' | 'declined' | null;

const CONSENT_KEY = 'luxedge_consent_v1';

/**
 * Reads the visitor's stored consent decision.
 * Returns null when no decision has been made yet (banner should show).
 */
export function getConsent(): ConsentChoice {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'accepted' || v === 'declined' ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(c: ConsentChoice): void {
  try {
    if (c === null) localStorage.removeItem(CONSENT_KEY);
    else localStorage.setItem(CONSENT_KEY, c);
  } catch {
    /* never break the storefront on storage errors */
  }
}
