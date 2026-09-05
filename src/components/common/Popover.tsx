// ============================================================================
// LUXEDGE — ANCHORED POPOVER
//
// Viewport-anchored popover (position: fixed) used by admin row menus and
// quick-action popovers. Unlike an `absolute` popover inside a table cell it
// is NOT clipped by the table card's overflow-hidden / overflow-x-auto
// ancestors, so real clicks inside it always land on the popover rather than
// the closing backdrop.
//
// Behavior:
//   * anchored to the trigger element's viewport rect (right-aligned by
//     default; `align="left"` anchors the left edge)
//   * flips above the trigger when there is not enough room below
//   * clamps to the viewport edges
//   * closes on backdrop click; Escape closes too
// ============================================================================
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface PopoverProps {
  /** The trigger element the popover anchors to. null renders nothing. */
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Width in px. Defaults to 240. */
  width?: number;
  align?: 'left' | 'right';
}

export default function Popover({ anchor, open, onClose, children, width = 240, align = 'right' }: PopoverProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null);
      return;
    }
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - 16);
    const h = contentRef.current?.offsetHeight ?? 0;
    const left = align === 'right'
      ? Math.max(8, Math.min(r.right - w, vw - w - 8))
      : Math.max(8, Math.min(r.left, vw - w - 8));
    const below = r.bottom + 4 + h <= vh;
    const top = below ? r.bottom + 4 : Math.max(8, r.top - h - 4);
    setPos({ left, top });
  }, [open, anchor, width, align]);

  // Escape closes the popover.
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !anchor) return null;

  return (
    <>
      {/* Backdrop closes on outside click. The popover carries a higher
          z-index, so it never intercepts clicks inside the popover. */}
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />
      <div
        ref={contentRef}
        role="menu"
        className="fixed z-30 rounded-xl border border-gray-200 bg-white shadow-xl"
        style={{ width, left: pos ? pos.left : -9999, top: pos ? pos.top : 0 }}
      >
        {children}
      </div>
    </>
  );
}