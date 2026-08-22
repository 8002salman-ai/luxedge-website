// ============================================================================
// CAT WALK — playful decorative layer for the storefront
//
// Small smoky-toned cat silhouettes wander across the bottom of the viewport:
// they walk, occasionally pause to sit, and sometimes leap up (jump). They are
// purely decorative — pointer-events: none — so they never block clicks, text
// selection, or accessibility. Respects prefers-reduced-motion (no cats at all).
// ============================================================================
import { useEffect, useRef, useState } from 'react';

interface WalkCat {
  id: number;
  dir: 1 | -1;          // 1 = left→right, -1 = right→left
  bottom: number;       // px from bottom of viewport
  scale: number;        // size multiplier
  tone: string;         // silhouette fill
  state: 'walk' | 'sit' | 'jump';
  progress: number;     // % across the screen (-10 off left → 110 off right)
  speed: number;        // % per tick
  sitUntil: number;     // timestamp to resume walking
  jumpUntil: number;    // timestamp to stop jumping
}

const MAX_CATS = 3;
const CAT_TONES = ['#3d4350', '#4b5563', '#6b7280', '#57534e', '#7c5c3a'];
// Ginger cat every now and then — matches the warm accents on the site.

function makeCat(id: number): WalkCat {
  const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  return {
    id,
    dir,
    bottom: 12 + Math.random() * 30,
    scale: 0.8 + Math.random() * 0.5,
    tone: CAT_TONES[Math.floor(Math.random() * CAT_TONES.length)],
    state: 'walk',
    progress: dir === 1 ? -10 : 110,
    speed: 0.55 + Math.random() * 0.7,
    sitUntil: 0,
    jumpUntil: 0,
  };
}

export default function CatWalk() {
  const [cats, setCats] = useState<WalkCat[]>([]);
  const idRef = useRef(1);

  useEffect(() => {
    // prefers-reduced-motion: keep the page calm — no wandering cats.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let alive = true;

    const spawn = () => {
      if (!alive) return;
      setCats(prev => (prev.length >= MAX_CATS ? prev : [...prev, makeCat(idRef.current++)]));
      window.setTimeout(spawn, 4500 + Math.random() * 6500);
    };
    const spawnT = window.setTimeout(spawn, 2600 + Math.random() * 2400);

    const loop = window.setInterval(() => {
      if (!alive) return;
      const now = Date.now();
      setCats(prev => {
        const next: WalkCat[] = [];
        for (const c of prev) {
          if (c.state === 'walk') {
            const p = c.progress + c.dir * c.speed;
            if (p > 112 || p < -14) continue; // walked off screen
            // Occasionally pause to sit; when resumed, sometimes leap first.
            let state: WalkCat['state'] = 'walk';
            let sitUntil = c.sitUntil;
            let jumpUntil = c.jumpUntil;
            if (now >= sitUntil && Math.random() < 0.004) {
              state = 'sit';
              sitUntil = now + 2200 + Math.random() * 2600;
            }
            next.push({ ...c, progress: p, state, sitUntil, jumpUntil });
          } else if (c.state === 'sit') {
            if (now >= c.sitUntil) {
              // 45% chance to leap up before walking on.
              if (Math.random() < 0.45) {
                next.push({ ...c, state: 'jump', jumpUntil: now + 900 });
              } else {
                next.push({ ...c, state: 'walk' });
              }
            } else {
              next.push(c);
            }
          } else {
            // jumping — hold position, then walk on
            next.push(now >= c.jumpUntil ? { ...c, state: 'walk' } : c);
          }
        }
        return next;
      });
    }, 90);

    return () => {
      alive = false;
      window.clearTimeout(spawnT);
      window.clearInterval(loop);
    };
  }, []);

  if (cats.length === 0) return null;

  return (
    <div aria-hidden="true" className="catwalk-layer">
      {cats.map(c => (
        <div
          key={c.id}
          className={`catwalk-cat catwalk-${c.state}`}
          style={{
            left: `${c.progress}%`,
            bottom: `${c.bottom}px`,
            transform: `translateX(-50%) scaleX(${c.dir}) scale(${c.scale})`,
          }}
        >
          <svg viewBox="0 0 72 44" width="46" height="28" fill="none">
            {/* tail */}
            <path d="M8 27 Q1 20 7 12" stroke={c.tone} strokeWidth="3.4" strokeLinecap="round" className="catwalk-tail" />
            {/* body */}
            <ellipse cx="33" cy="29" rx="19" ry="10" fill={c.tone} />
            {/* head */}
            <circle cx="55" cy="18" r="9" fill={c.tone} />
            {/* ears */}
            <path d="M48 12 L51 2.5 L56 10 Z" fill={c.tone} />
            <path d="M57 11 L61 3.5 L63 12 Z" fill={c.tone} />
            {/* legs (animated while walking) */}
            <rect x="21" y="35" width="4.6" height="8" rx="2.2" fill={c.tone} className="catwalk-leg catwalk-leg-a" />
            <rect x="30" y="35" width="4.6" height="8" rx="2.2" fill={c.tone} className="catwalk-leg catwalk-leg-b" />
            <rect x="39" y="35" width="4.6" height="8" rx="2.2" fill={c.tone} className="catwalk-leg catwalk-leg-a" />
          </svg>
        </div>
      ))}
    </div>
  );
}
