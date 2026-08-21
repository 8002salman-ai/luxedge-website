// ============================================================================
// LUXEDGE — MOTION PRIMITIVES
//
// One coherent motion layer for the whole storefront, built on CSS transitions
// + IntersectionObserver. No animation library: the vocabulary is small enough
// that a runtime would be dead weight, and every effect stays on the compositor
// (opacity / transform only).
//
// Accessibility and performance are not opt-in here:
//   • `prefers-reduced-motion` short-circuits every hook — elements mount in
//     their final state rather than animating to it.
//   • Scroll progress is written to a CSS custom property inside one rAF
//     callback, so a pinned hero costs zero React re-renders per frame.
// ============================================================================

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

/** Live `prefers-reduced-motion` preference (re-reads if the user changes it). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface InViewOptions {
  /** Fraction of the element that must be visible. */
  threshold?: number;
  /** Bottom inset so content reveals slightly before it hits the fold. */
  rootMargin?: string;
  /** Reveal once and disconnect (the default — re-triggering reads as noise). */
  once?: boolean;
}

/** Attach to any element to learn when it enters the viewport. */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  { threshold = 0.14, rootMargin = '0px 0px -8% 0px', once = true }: InViewOptions = {}
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No observer (very old browser / jsdom): show content rather than hide it.
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, inView };
}

export type RevealVariant = 'up' | 'fade' | 'blur' | 'mask' | 'left' | 'right';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Milliseconds of delay, for hand-tuned sequencing within a section. */
  delay?: number;
  variant?: RevealVariant;
  as?: ElementType;
  threshold?: number;
}

/** Scroll-reveal wrapper — the site's default entrance. */
export function Reveal({ children, className = '', delay = 0, variant = 'up', as, threshold }: RevealProps) {
  const Tag = (as || 'div') as ElementType;
  const { ref, inView } = useInView<HTMLDivElement>(threshold != null ? { threshold } : undefined);
  return (
    <Tag
      ref={ref}
      className={`reveal reveal-${variant}${inView ? ' is-in' : ''}${className ? ' ' + className : ''}`}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Per-item delay step. */
  step?: number;
  as?: ElementType;
}

/**
 * Staggers direct children by index. The index is applied by CSS via `--i`,
 * which the caller sets on each child (see `staggerStyle`).
 */
export function Stagger({ children, className = '', step = 70, as }: StaggerProps) {
  const Tag = (as || 'div') as ElementType;
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <Tag
      ref={ref}
      className={`stagger${inView ? ' is-in' : ''}${className ? ' ' + className : ''}`}
      style={{ '--step': `${step}ms` } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** Per-child index style for `Stagger` and `.hero-line`. */
export function staggerStyle(index: number): React.CSSProperties {
  return { '--i': index } as React.CSSProperties;
}

/**
 * Writes 0→1 scroll progress of `ref`'s scroll range into the `--p` custom
 * property on that same element. Used by the pinned hero: one property, many
 * layers, no re-render.
 */
export function useScrollProgressVar<T extends HTMLElement = HTMLDivElement>(enabled = true) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) { el.style.setProperty('--p', '0'); return; }

    let frame = 0;
    let last = -1;

    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      // Distance scrolled through the element's own height, minus one viewport.
      const range = Math.max(1, rect.height - window.innerHeight);
      const scrolled = Math.min(Math.max(-rect.top, 0), range);
      const p = Math.round((scrolled / range) * 1000) / 1000;
      if (p !== last) {
        last = p;
        el.style.setProperty('--p', String(p));
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [enabled]);

  return ref;
}

export interface ScrollState {
  /** Page has moved off the very top. */
  scrolled: boolean;
  /** Reading downward past the threshold — used to retract the header. */
  hidden: boolean;
}

/**
 * Direction-aware scroll state for the masthead. Retracts on sustained
 * downward reading and returns immediately on any upward intent.
 */
export function useHeaderScroll(disabled = false): ScrollState {
  const [state, setState] = useState<ScrollState>({ scrolled: false, hidden: false });

  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;

    const measure = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      // Ignore sub-pixel jitter and iOS rubber-banding past the top.
      if (Math.abs(delta) > 4) {
        const shouldHide = !disabled && delta > 0 && y > 220;
        setState((prev) => {
          const scrolled = y > 6;
          const hidden = delta < 0 ? false : shouldHide;
          return prev.scrolled === scrolled && prev.hidden === hidden ? prev : { scrolled, hidden };
        });
        lastY = y;
      } else {
        setState((prev) => (prev.scrolled === y > 6 ? prev : { ...prev, scrolled: y > 6 }));
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [disabled]);

  return state;
}

/** Locks body scroll while an overlay owns the screen. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [active]);
}

/** Closes an overlay on Escape. */
export function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}
