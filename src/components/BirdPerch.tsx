// ============================================================================
// BIRD PERCH — playful decorative layer for the storefront
//
// Small, gently-animated parrots (a scarlet macaw and a green parrot) perch
// here and there across the page — on section edges, near banners, beside
// headings. They are:
//   - small and subtle (never covering content or blocking clicks)
//   - pointer-events: none
//   - calm: slow bob + occasional tail sway / head tilt, no jumping
//   - prefers-reduced-motion aware (no birds at all)
// ============================================================================
import { useEffect, useRef, useState } from 'react';

interface Perch {
  id: number;
  species: 'macaw' | 'green';
  /** Viewport % position. */
  left: number;
  top: number;
  /** Size multiplier. */
  scale: number;
  /** Flip horizontally (facing left). */
  flip: boolean;
  /** Pause animation for a while after spawning (sits still). */
  restUntil: number;
}

const MAX_BIRDS = 4;

/** Anchor spots across the page: [left%, top%] — chosen near section edges,
 *  banners and headings so the parrots look like they're perching on the
 *  layout, not floating randomly. */
const SPOTS: Array<[number, number]> = [
  [8, 34],   // hero left column edge
  [86, 30],  // hero visual right
  [4, 58],   // shop-by-pet section left
  [92, 52],  // section divider right
  [6, 76],   // lower banner left
  [88, 78],  // lower banner right
  [14, 88],  // footer-ish far left
  [82, 90],  // footer-ish far right
];

function makeBird(id: number): Perch {
  const spot = SPOTS[Math.floor(Math.random() * SPOTS.length)];
  const flip = Math.random() < 0.5;
  return {
    id,
    species: Math.random() < 0.5 ? 'macaw' : 'green',
    left: spot[0] + (Math.random() * 6 - 3),
    top: spot[1] + (Math.random() * 4 - 2),
    scale: 0.55 + Math.random() * 0.35,
    flip,
    restUntil: Date.now() + 6000 + Math.random() * 9000,
  };
}

export default function BirdPerch() {
  const [birds, setBirds] = useState<Perch[]>([]);
  const idRef = useRef(1);

  useEffect(() => {
    // prefers-reduced-motion: keep the page calm — no birds.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let alive = true;

    const spawn = () => {
      if (!alive) return;
      setBirds(prev => (prev.length >= MAX_BIRDS ? prev : [...prev, makeBird(idRef.current++)]));
      window.setTimeout(spawn, 5500 + Math.random() * 7500);
    };
    const spawnT = window.setTimeout(spawn, 1800 + Math.random() * 2400);

    // Birds relocate occasionally (rest → fade out → respawn elsewhere).
    const loop = window.setInterval(() => {
      if (!alive) return;
      setBirds(prev => prev.map(b => (Date.now() >= b.restUntil ? makeBird(b.id) : b)));
    }, 8000);

    return () => {
      alive = false;
      window.clearTimeout(spawnT);
      window.clearInterval(loop);
    };
  }, []);

  if (birds.length === 0) return null;

  return (
    <div aria-hidden="true" className="birdperch-layer">
      {birds.map(b => (
        <div
          key={b.id}
          className={`birdperch-bird birdperch-${b.species}`}
          style={{
            left: `${b.left}%`,
            top: `${b.top}%`,
            transform: `translate(-50%, -50%) scaleX(${b.flip ? -1 : 1}) scale(${b.scale})`,
          }}
        >
          <svg viewBox="0 0 64 58" width="40" height="36" fill="none">
            {/* tail feathers */}
            <g className="birdperch-tail">
              <path d="M8 38 Q0 46 4 54" stroke="#0e5f8a" strokeWidth="3.2" strokeLinecap="round" />
              <path d="M12 40 Q6 50 11 56" stroke="#e85d3f" strokeWidth="3" strokeLinecap="round" />
              <path d="M16 41 Q12 51 18 55" stroke="#f4c95d" strokeWidth="2.8" strokeLinecap="round" />
            </g>
            {/* body */}
            <ellipse cx="30" cy="32" rx="17" ry="13" fill={b.species === 'macaw' ? '#d94a34' : '#3e8e5a'} />
            {/* belly */}
            <ellipse cx="34" cy="36" rx="9" ry="8" fill={b.species === 'macaw' ? '#f6d99a' : '#cfe6c4'} />
            {/* wing */}
            <path d="M18 28 Q26 20 40 26 Q34 34 24 34 Z" fill={b.species === 'macaw' ? '#2e6fa8' : '#2f6e4a'} className="birdperch-wing" />
            {/* head */}
            <circle cx="45" cy="19" r="10" fill={b.species === 'macaw' ? '#d94a34' : '#3e8e5a'} />
            {/* face patch */}
            <path d="M49 14 Q55 15 53 20 Q50 21 48 18 Z" fill="#fdf4e0" opacity="0.9" />
            {/* beak */}
            <path d="M54 16 Q60 17 58 21 Q55 20 54 19 Z" fill="#d8b45a" />
            <path d="M54 19 Q57 21 58 21 Q55 22 53 20 Z" fill="#7a5426" />
            {/* eye */}
            <circle cx="48" cy="16.5" r="1.7" fill="#241f1a" />
            <circle cx="48.6" cy="16" r="0.6" fill="#fff" />
            {/* perch feet */}
            <path d="M26 44 L24 48 M30 45 L30 49 M34 44 L36 48" stroke="#8a6b3a" strokeWidth="1.6" strokeLinecap="round" className="birdperch-feet" />
            {/* little perch branch */}
            <path d="M14 48 Q32 46 50 48" stroke="#7c5c3a" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </div>
      ))}
    </div>
  );
}
