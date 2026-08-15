import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  getEffectiveConfig,
  isExcludedPath,
  MarketingConfig,
  PlacementKey,
  resetPlacementCount,
  shouldRenderPlacement,
} from '../lib/marketing';

interface AdSenseAdProps {
  placement: PlacementKey;
  className?: string;
}

/**
 * Reusable manual AdSense ad unit.
 * - Renders nothing when AdSense/manual ads are disabled, the slot is missing,
 *   the route is excluded (cart/checkout/auth/account — admin always excluded),
 *   or the per-page density cap is reached.
 * - Initializes adsbygoogle exactly once per mounted unit.
 * - Never renders inside admin routes.
 */
export default function AdSenseAd({ placement, className = '' }: AdSenseAdProps) {
  const loc = useLocation();
  const [cfg, setCfg] = useState<MarketingConfig | null>(null);
  const pushed = useRef(false);
  const shouldPush = useRef(false);
  const countedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    getEffectiveConfig().then(c => { if (alive) setCfg(c); });
    return () => { alive = false; };
  }, []);

  // Reset the shared density counter whenever the route changes
  useEffect(() => { resetPlacementCount(); countedRef.current = false; }, [loc.pathname]);

  // Push to adsbygoogle once the <ins> element is committed to the DOM.
  // Runs unconditionally; the ref gates it to a single real push.
  useEffect(() => {
    if (!shouldPush.current) return;
    if (pushed.current) return;
    pushed.current = true;
    const t = setTimeout(() => {
      try {
        const w = window as any;
        w.adsbygoogle = w.adsbygoogle || [];
        w.adsbygoogle.push({});
      } catch {
        /* never crash the storefront */
      }
    }, 50);
    return () => clearTimeout(t);
  }, [cfg?.adsenseClientId, cfg?.placements?.[placement]?.slot]);

  if (!cfg) return null;
  if (isExcludedPath(loc.pathname, cfg)) return null;
  if (!shouldRenderPlacement(cfg, placement, loc.pathname, countedRef)) return null;
  shouldPush.current = true;
  const slot = cfg.placements[placement].slot.trim();

  return (
    <div className={`my-6 ${className}`}>
      <div className="text-center">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Advertisement</p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl min-h-[90px] flex items-center justify-center overflow-hidden">
          <ins
            className="adsbygoogle"
            style={{ display: 'block' }}
            data-ad-client={cfg.adsenseClientId.trim()}
            data-ad-slot={slot}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        </div>
      </div>
    </div>
  );
}
