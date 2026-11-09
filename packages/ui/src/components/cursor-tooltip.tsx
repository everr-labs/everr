import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const OFFSET = 12;
const MARGIN = 4;

/**
 * Cursor-following tooltip card, portaled to the body. Sits below-right of
 * the pointer and flips to the opposite side of an axis when it would clip
 * the viewport edge.
 *
 * The element stays laid out at 0,0 with max-content width and only moves by
 * transform (in a pre-paint layout effect): if `left` positioned the box, a
 * cursor near the right edge would compress and wrap it, the flip would then
 * measure that squeezed size, and the box would jitter between the two
 * shapes. Untransformed layout keeps the measurement stable.
 */
export function CursorTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x, y });
  pointer.current = { x, y };
  // Measured once, then kept current by a ResizeObserver: reading the size on
  // every move would force a synchronous layout of the page each time.
  const size = useRef<{ width: number; height: number } | null>(null);

  const place = useCallback(() => {
    const el = ref.current;
    const box = size.current;
    if (!el || !box) return;
    const { x, y } = pointer.current;
    const left =
      x + OFFSET + box.width > window.innerWidth - MARGIN
        ? Math.max(MARGIN, x - OFFSET - box.width)
        : x + OFFSET;
    const top =
      y + OFFSET + box.height > window.innerHeight - MARGIN
        ? Math.max(MARGIN, y - OFFSET - box.height)
        : y + OFFSET;
    el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !size.current) size.current = { width: el.offsetWidth, height: el.offsetHeight };
    place();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize[0];
      if (!box) return;
      size.current = { width: box.inlineSize, height: box.blockSize };
      place();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [place]);

  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed top-0 left-0 z-50 w-max rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md will-change-transform"
    >
      {children}
    </div>,
    document.body,
  );
}
