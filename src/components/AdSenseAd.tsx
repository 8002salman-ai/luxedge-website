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
 * 
 * Empty placeholder protection: When unapproved or unfilled, consumes zero
 * visible layout space and renders zero empty gray placeholder boxes to prevent CLS.
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
  const slot = cfg.placements[placement]?.slot?.trim();
  if (!slot) return null;

  return (
    <div className={`my-4 text-center adsense-unit-wrapper ${className}`}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={cfg.adsenseClientId.trim()}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
