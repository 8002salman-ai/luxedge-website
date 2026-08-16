import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getConsent } from '../lib/consent';
import {
  captureUtm,
  getEffectiveConfig,
  loadAdSenseScript,
  loadGtag,
  MarketingConfig,
  removeAdSenseScript,
  removeGtag,
  resetPlacementCount,
  trackEvent,
  utmParams,
} from '../lib/marketing';

/**
 * Mounted once inside the router. Loads the AdSense / GA4 scripts according to
 * the effective (global) marketing config, exactly once, and emits page_view
 * on every SPA route change. Never renders anything.
 */
export default function MarketingManager() {
  const loc = useLocation();

  // Apply script load state from the effective config. The AdSense script is
  // shipped statically in index.html (so Google's review bot always sees it)
  // and only removed here if the ads are turned off in the admin — it is NOT
  // consent-gated. GA4 analytics respects the visitor's cookie-consent choice.
  // Runs on mount, on every route change, and whenever the consent banner
  // records a decision. Loaders are idempotent — scripts are never duplicated.
  useEffect(() => {
    let alive = true;
    const apply = () => {
      getEffectiveConfig().then((c: MarketingConfig) => {
        if (!alive) return;
        if (c.adsenseEnabled && (c.autoAdsEnabled || c.manualAdsEnabled)) {
          loadAdSenseScript(c.adsenseClientId);
        } else {
          removeAdSenseScript();
        }
        const okToLoad = getConsent() === 'accepted';
        if (okToLoad && c.gaEnabled && c.ga4Id.trim()) {
          loadGtag(c.ga4Id.trim());
        } else {
          removeGtag();
        }
      });
    };
    apply();
    window.addEventListener('luxedge-consent', apply);
    return () => {
      alive = false;
      window.removeEventListener('luxedge-consent', apply);
    };
  }, [loc.pathname]);

  useEffect(() => {
    captureUtm();
    resetPlacementCount();
    // page_view fires for every route (GA4 auto-collects page_view, but this
    // keeps it explicit and works with HashRouter SPA navigation).
    trackEvent('page_view', { page_location: window.location.href, ...utmParams() });
  }, [loc.pathname, loc.search]);

  return null;
}
