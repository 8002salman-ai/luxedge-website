import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getConsent } from '../lib/consent';
import {
  adsterraConfigured,
  consumeAdBudget,
  getEffectiveConfig,
  isExcludedPath,
  loadAdsterraScript,
  resetPlacementCount,
  MarketingConfig,
} from '../lib/marketing';

/**
 * Adsterra native-banner ad unit (invoke.js + container div).
 *
 * Renders nothing when Adsterra is disabled/unconfigured, the route is
 * excluded (cart/checkout/auth/account — admin always excluded), consent is
 * not accepted, or the shared per-page density budget is spent — so Adsterra
 * and AdSense together never exceed the configured cap.
 *
 * Loads the zone's invoke.js exactly once per page (deduped by src). The
 * zone is mounted on ONE spot per route (homepage after hero, product detail
 * below info) — never twice on the same page.
 */
export default function AdsterraAd({ className = '' }: { className?: string }) {
  const loc = useLocation();
  const [cfg, setCfg] = useState<MarketingConfig | null>(null);
  const countedRef = useRef(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    getEffectiveConfig().then(c => { if (alive) setCfg(c); });
    return () => { alive = false; };
  }, []);

  // Shared manual-ad density counter resets on route change (like AdSenseAd).
  useEffect(() => { resetPlacementCount(); countedRef.current = false; }, [loc.pathname]);

  // Inject the zone script once consent is accepted and this unit survived the
  // gates below. Runs on every render; refs keep it to a single load + push.
  useEffect(() => {
    if (!cfg) return;
    if (!adsterraConfigured(cfg)) return;
    if (getConsent() !== 'accepted') return;
    if (isExcludedPath(loc.pathname, cfg)) return;
    if (!consumeAdBudget(cfg, countedRef)) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadAdsterraScript(cfg.adsterraZoneUrl.trim());
  }, [cfg, loc.pathname]);

  if (!cfg) return null;
  if (!adsterraConfigured(cfg)) return null;
  if (getConsent() !== 'accepted') return null;
  if (isExcludedPath(loc.pathname, cfg)) return null;
  if (!consumeAdBudget(cfg, countedRef)) return null;

  return (
    <div className={`my-6 ${className}`}>
      <div className="text-center">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Advertisement</p>
        <div
          id={cfg.adsterraContainerId.trim()}
          className="bg-gray-50 border border-gray-200 rounded-xl min-h-[90px] flex items-center justify-center overflow-hidden"
        />
      </div>
    </div>
  );
}
