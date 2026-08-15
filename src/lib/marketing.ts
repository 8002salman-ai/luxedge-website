// ============================================================================
// MARKETING & TRAFFIC — shared config, script loading, GA4 events
//
// Global config source of truth: /site-config.json (committed, deployed with
// the site, fetched by every visitor). Admin edits are saved to localStorage
// (luxedge_mkt_config) as a PREVIEW override for the admin's own browser only —
// the admin page exports the updated site-config.json for deployment so the
// change becomes global for all visitors.
// ============================================================================

export type Density = 'low' | 'balanced' | 'high';
export type MobileDensity = 'low' | 'balanced';

export interface AdPlacement {
  enabled: boolean;
  slot: string;
}

export type PlacementKey =
  | 'home_after_hero'
  | 'home_after_categories'
  | 'home_between_sections'
  | 'shop_after_row'
  | 'product_below_info'
  | 'blog_in_article'
  | 'blog_after_article';

export const PLACEMENT_KEYS: PlacementKey[] = [
  'home_after_hero',
  'home_after_categories',
  'home_between_sections',
  'shop_after_row',
  'product_below_info',
  'blog_in_article',
  'blog_after_article',
];

export const PLACEMENT_LABELS: Record<PlacementKey, string> = {
  home_after_hero: 'Homepage — After Hero',
  home_after_categories: 'Homepage — After Categories',
  home_between_sections: 'Homepage — Between Product Sections',
  shop_after_row: 'Shop — After Product Row',
  product_below_info: 'Product Detail — Below Product Information',
  blog_in_article: 'Blog — In Article',
  blog_after_article: 'Blog — After Article',
};

export interface MarketingConfig {
  version: number;
  adsenseEnabled: boolean;
  adsenseClientId: string;
  publisherId: string;
  autoAdsEnabled: boolean;
  manualAdsEnabled: boolean;
  density: Density;
  showAdsOnMobile: boolean;
  mobileDensity: MobileDensity;
  exclusions: {
    cart: boolean;
    checkout: boolean;
    login: boolean;
    signup: boolean;
    admin: boolean;
    account: boolean;
  };
  placements: Record<PlacementKey, AdPlacement>;
  gaEnabled: boolean;
  ga4Id: string;
  adsTxtRecord: string;
}

export const DEFAULT_CONFIG: MarketingConfig = {
  version: 1,
  adsenseEnabled: true,
  adsenseClientId: 'ca-pub-5473713135927706',
  publisherId: 'pub-5473713135927706',
  autoAdsEnabled: true,
  manualAdsEnabled: false,
  density: 'balanced',
  showAdsOnMobile: true,
  mobileDensity: 'balanced',
  exclusions: {
    cart: true,
    checkout: true,
    login: true,
    signup: true,
    admin: true,
    account: true,
  },
  placements: {
    home_after_hero: { enabled: false, slot: '' },
    home_after_categories: { enabled: false, slot: '' },
    home_between_sections: { enabled: false, slot: '' },
    shop_after_row: { enabled: false, slot: '' },
    product_below_info: { enabled: false, slot: '' },
    blog_in_article: { enabled: false, slot: '' },
    blog_after_article: { enabled: false, slot: '' },
  },
  gaEnabled: false,
  ga4Id: '',
  adsTxtRecord: 'google.com, pub-5473713135927706, DIRECT, f08c47fec0942fa0',
};

export const CLIENT_ID_RE = /^ca-pub-[0-9]+$/;
export const GA4_ID_RE = /^G-[A-Z0-9]{6,}$/;
export const AD_SLOT_RE = /^[0-9]{5,}$/;

const LS_KEY = 'luxedge_mkt_config';
const UTM_KEY = 'luxedge_utm';
const SCRIPT_ID = 'adsbygoogle-script';
const GA_SCRIPT_ID = 'gtag-script';

// ---------------------------------------------------------------------------
// Config load / merge
// ---------------------------------------------------------------------------

function normalize(raw: Partial<MarketingConfig> | null | undefined): MarketingConfig {
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as MarketingConfig;
  if (!raw || typeof raw !== 'object') return base;
  const c = { ...base, ...raw } as MarketingConfig;
  c.exclusions = { ...base.exclusions, ...(raw.exclusions || {}) };
  c.placements = { ...base.placements };
  for (const k of PLACEMENT_KEYS) {
    const p = raw.placements?.[k];
    if (p) c.placements[k] = { ...base.placements[k], ...p };
  }
  return c;
}

let globalConfig: MarketingConfig | null = null;
let globalConfigPromise: Promise<MarketingConfig> | null = null;

function readPreview(): MarketingConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Fetch the deployed global config (site-config.json). */
export function fetchGlobalConfig(): Promise<MarketingConfig> {
  if (globalConfigPromise) return globalConfigPromise;
  globalConfigPromise = fetch('/site-config.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => normalize(j))
    .catch(() => normalize(null))
    .then(c => {
      globalConfig = c;
      return c;
    });
  return globalConfigPromise;
}

/**
 * Effective config for this browser: deployed global config, overridden by the
 * admin's localStorage preview when present.
 */
export async function getEffectiveConfig(): Promise<MarketingConfig> {
  const g = await fetchGlobalConfig();
  const preview = readPreview();
  return preview || g;
}

export function getCachedEffectiveConfig(): MarketingConfig {
  const preview = readPreview();
  if (preview) return preview;
  return globalConfig || DEFAULT_CONFIG;
}

/** Read the admin's localStorage preview config directly (null when absent). */
export function getCachedPreview(): MarketingConfig | null {
  return readPreview();
}

/** Admin preview: persists to localStorage (this browser only). */
export function savePreviewConfig(cfg: MarketingConfig): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable */
  }
}

export function clearPreviewConfig(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export function hasPreviewConfig(): boolean {
  try {
    return !!localStorage.getItem(LS_KEY);
  } catch {
    return false;
  }
}

/** Validate a config and return error messages keyed by field. */
export function validateConfig(c: MarketingConfig): Record<string, string> {
  const errs: Record<string, string> = {};
  if (c.adsenseEnabled && !CLIENT_ID_RE.test(c.adsenseClientId.trim())) {
    errs.adsenseClientId = 'Client ID must look like ca-pub-1234567890123456';
  }
  if (c.adsenseEnabled && c.adsenseClientId.trim() && c.publisherId.trim() !== c.adsenseClientId.trim().replace('ca-', '')) {
    errs.publisherId = 'Publisher ID should match the Client ID (ca-pub-… → pub-…)';
  }
  if (c.gaEnabled && !GA4_ID_RE.test(c.ga4Id.trim())) {
    errs.ga4Id = 'GA4 Measurement ID must look like G-XXXXXXXXXX';
  }
  for (const k of PLACEMENT_KEYS) {
    const p = c.placements[k];
    if (p.enabled && !p.slot.trim()) {
      errs[`slot_${k}`] = 'Paste a data-ad-slot ID to enable this placement';
    } else if (p.enabled && !AD_SLOT_RE.test(p.slot.trim())) {
      errs[`slot_${k}`] = 'Slot ID must be numeric (from your AdSense ad unit)';
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Script loaders — load exactly once
// ---------------------------------------------------------------------------

export function loadAdSenseScript(clientId: string): void {
  if (!clientId || typeof document === 'undefined') return;
  if (document.getElementById(SCRIPT_ID)) return;
  const s = document.createElement('script');
  s.id = SCRIPT_ID;
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId.trim())}`;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
}

export function removeAdSenseScript(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(SCRIPT_ID)?.remove();
}

export function loadGtag(ga4Id: string): void {
  if (!ga4Id || typeof document === 'undefined') return;
  if (document.getElementById(GA_SCRIPT_ID)) return;
  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() { w.dataLayer.push(arguments); };
  const s = document.createElement('script');
  s.id = GA_SCRIPT_ID;
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id.trim())}`;
  document.head.appendChild(s);
  w.gtag('js', new Date());
  w.gtag('config', ga4Id.trim());
}

export function removeGtag(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(GA_SCRIPT_ID)?.remove();
  const w = window as any;
  if (w.gtag) w.gtag = undefined;
}

// ---------------------------------------------------------------------------
// GA4 events
// ---------------------------------------------------------------------------

export function isGAEnabled(): boolean {
  const c = getCachedEffectiveConfig();
  return c.gaEnabled && GA4_ID_RE.test(c.ga4Id.trim());
}

export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (!isGAEnabled()) return;
  const w = window as any;
  if (typeof w.gtag !== 'function') return;
  try {
    w.gtag('event', name, params);
  } catch {
    /* never break the storefront on analytics errors */
  }
}

// ---------------------------------------------------------------------------
// UTM capture — kept for the session, attached to events
// ---------------------------------------------------------------------------

export function captureUtm(): Record<string, string> {
  try {
    const sp = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const v = sp.get(k);
      if (v) utm[k] = v;
    }
    if (Object.keys(utm).length > 0) sessionStorage.setItem(UTM_KEY, JSON.stringify(utm));
    return utm;
  } catch {
    return {};
  }
}

export function getSessionUtm(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(UTM_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function utmParams(): Record<string, unknown> {
  const utm = getSessionUtm();
  return {
    campaign_source: utm.utm_source || undefined,
    campaign_medium: utm.utm_medium || undefined,
    campaign_name: utm.utm_campaign || undefined,
    campaign_content: utm.utm_content || undefined,
    campaign_term: utm.utm_term || undefined,
  };
}

// ---------------------------------------------------------------------------
// Manual ad density — per-route counter shared by every AdSenseAd instance
// ---------------------------------------------------------------------------

export const densityCap: Record<Density, number> = { low: 2, balanced: 4, high: 8 };
export const mobileDensityCap: Record<MobileDensity, number> = { low: 1, balanced: 2 };

let placementCount = 0;

export function resetPlacementCount(): void {
  placementCount = 0;
}

/** Pure check: is this placement configured and eligible at all? */
export function placementConfigured(c: MarketingConfig, key: PlacementKey): boolean {
  if (!c.manualAdsEnabled) return false;
  if (!c.adsenseEnabled || !CLIENT_ID_RE.test(c.adsenseClientId.trim())) return false;
  const p = c.placements[key];
  if (!p || !p.enabled || !AD_SLOT_RE.test(p.slot.trim())) return false;
  return true;
}

/**
 * Idempotent per-instance-per-route consumption of the density budget.
 * `countedKey` is a ref the caller keeps (e.g. `${pathname}:${key}`), so a
 * StrictMode double render never double-counts.
 */
export function consumePlacement(c: MarketingConfig, key: PlacementKey, _countedKey: string, countedRef: { current: boolean }): boolean {
  if (!placementConfigured(c, key)) return false;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  if (isMobile && !c.showAdsOnMobile) return false;

  if (!countedRef.current) {
    countedRef.current = true;
    placementCount += 1;
  }

  const cap = isMobile ? mobileDensityCap[c.mobileDensity] : densityCap[c.density];
  return placementCount <= cap;
}

export function shouldRenderPlacement(c: MarketingConfig, key: PlacementKey, countedKey: string, countedRef: { current: boolean }): boolean {
  return consumePlacement(c, key, countedKey, countedRef);
}

// ---------------------------------------------------------------------------
// Route / page-exclusion helpers
// ---------------------------------------------------------------------------

/** True when the current path is excluded from manual ads by config. */
export function isExcludedPath(pathname: string, c: MarketingConfig): boolean {
  if (pathname.startsWith('/admin')) return true; // ads NEVER in admin
  if (c.exclusions.login && (pathname === '/login' || pathname === '/signup')) return true;
  if (c.exclusions.cart && pathname === '/cart') return true;
  if (c.exclusions.checkout && pathname === '/checkout') return true;
  if (c.exclusions.account && (pathname === '/orders' || pathname === '/profile')) return true;
  return false;
}

export function activeModeLabel(c: MarketingConfig): string {
  const auto = c.adsenseEnabled && c.autoAdsEnabled;
  const manual = c.adsenseEnabled && c.manualAdsEnabled && PLACEMENT_KEYS.some(k => c.placements[k].enabled && AD_SLOT_RE.test(c.placements[k].slot.trim()));
  if (auto && manual) return 'Mode C — Auto Ads + Manual placements';
  if (auto) return 'Mode A — Auto Ads only';
  if (manual) return 'Mode B — Manual ad units only';
  return 'Disabled — no ads configured';
}
