import { useEffect, useRef } from 'react';
import { PlacementKey, placementConfigured } from '../lib/marketing';
import { useAdGate } from './useAdGate';

interface AdSenseAdProps {
  placement: PlacementKey;
  className?: string;
}

/**
 * Manual AdSense ad unit. All gating (consent, route exclusions, density
 * cap) lives in useAdGate; this component only renders the <ins> element and
 * pushes to adsbygoogle exactly once per mounted unit. Never renders inside
 * admin routes.
 */
export default function AdSenseAd({ placement, className = '' }: AdSenseAdProps) {
  const { cfg, eligible } = useAdGate();
  const pushed = useRef(false);
  const show = eligible(cfg ? placementConfigured(cfg, placement) : false);

  // Push to adsbygoogle once the <ins> is committed to the DOM.
  useEffect(() => {
    if (!show || pushed.current) return;
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
  }, [show]);

  if (!cfg || !show) return null;
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
