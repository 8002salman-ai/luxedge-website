import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getConsent } from '../lib/consent';
import {
  consumeAdBudget,
  getEffectiveConfig,
  isExcludedPath,
  MarketingConfig,
  resetPlacementCount,
} from '../lib/marketing';

/**
 * Shared gate for Luxedge-managed manual ad units (AdSenseAd, AdsterraAd).
 *
 * Owns the config load plus the three gates every manual unit shares:
 * consent accepted, route not excluded (admin/cart/checkout/auth/account),
 * and the per-page density budget — consumed idempotently via a ref so
 * React StrictMode double renders never double-count. The budget is shared
 * across ALL manual units, so AdSense + Adsterra together never exceed the
 * configured cap on one page.
 *
 * `eligible(configured)` also requires the caller's unit to be configured
 * (its own AdSense slot / Adsterra zone present). Network mechanics stay in
 * the components — this hook never loads a script or renders a unit.
 */
export function useAdGate(): { cfg: MarketingConfig | null; eligible: (configured: boolean) => boolean } {
  const loc = useLocation();
  const [cfg, setCfg] = useState<MarketingConfig | null>(null);
  const countedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    getEffectiveConfig().then(c => { if (alive) setCfg(c); });
    return () => { alive = false; };
  }, []);

  // Reset the shared density counter whenever the route changes.
  useEffect(() => { resetPlacementCount(); countedRef.current = false; }, [loc.pathname]);

  const eligible = (configured: boolean): boolean => {
    if (!cfg || !configured) return false;
    if (getConsent() !== 'accepted') return false;
    if (isExcludedPath(loc.pathname, cfg)) return false;
    return consumeAdBudget(cfg, countedRef);
  };

  return { cfg, eligible };
}
