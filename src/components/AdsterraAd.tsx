import { useEffect, useRef } from 'react';
import { adsterraConfigured, loadAdsterraScript } from '../lib/marketing';
import { useAdGate } from './useAdGate';

/**
 * Adsterra native-banner ad unit (invoke.js + container div). All gating
 * (consent, route exclusions, the density cap it shares with AdSense) lives
 * in useAdGate; this component only renders the container and loads the
 * zone's invoke.js exactly once per mounted unit (deduped by src).
 *
 * Mounted on ONE spot per route (end of blog articles, product detail below
 * info) — never twice on the same page. The homepage stays light (AdSense
 * Auto Ads only, no Adsterra there).
 */
export default function AdsterraAd({ className = '' }: { className?: string }) {
  const { cfg, eligible } = useAdGate();
  const loadedRef = useRef(false);
  const zoneUrl = cfg?.adsterraZoneUrl.trim() || '';
  const show = eligible(cfg ? adsterraConfigured(cfg) : false);

  // Load the zone script once the unit survived the gates.
  useEffect(() => {
    if (!show || loadedRef.current) return;
    loadedRef.current = true;
    loadAdsterraScript(zoneUrl);
  }, [show, zoneUrl]);

  if (!cfg || !show) return null;

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
