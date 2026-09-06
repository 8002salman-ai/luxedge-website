import { useEffect, useRef } from 'react';
import { adsterraConfigured, loadAdsterraScript } from '../lib/marketing';
import { useAdGate } from './useAdGate';

/**
 * Adsterra native-banner ad unit (invoke.js + container div). All gating
 * (consent, route exclusions, the density cap it shares with AdSense) lives
 * in useAdGate; this component only renders the container and loads the
 * zone's invoke.js exactly once per mounted unit (deduped by src).
 *
 * FRAME HEIGHT — 250px everywhere. The zone's native banner needs ~250px to
 * render its image+text cards; shorter frames crop the cards down to
 * text-only fragments (observed on the category header). 250px is also the
 * cap for every other placement, so one constant governs all units.
 *
 * CLAMP GUARANTEE: the zone script injects its own markup/iframe that can
 * exceed any max-height we put on the container it targets, so the visible
 * box is wrapped in a hard-clipped frame (fixed height + overflow-hidden +
 * box-content isolation) that the ad script never touches. Whatever Adsterra
 * renders, it is physically cropped to the frame — the unit can never push
 * the page or dwarf the content beside it.
 *
 * Mounted on ONE spot per route (the zone script fills a single container
 * per page): end of blog articles, product detail below info, shop/category
 * header right. The homepage stays light (AdSense Auto Ads only).
 */
const FRAME_H = 250;

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
        {/* Hard clip frame: fixed height the ad script cannot change. */}
        <div
          className="w-full mx-auto bg-gray-50 border border-gray-200 rounded-xl overflow-hidden"
          style={{ height: FRAME_H, maxHeight: FRAME_H, overflow: 'hidden', position: 'relative' }}
        >
          <div
            id={cfg.adsterraContainerId.trim()}
            className="w-full flex items-center justify-center"
            style={{ maxHeight: FRAME_H, overflow: 'hidden' }}
          />
        </div>
      </div>
    </div>
  );
}
