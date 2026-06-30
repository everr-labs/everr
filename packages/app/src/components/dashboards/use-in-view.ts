import { type RefObject, useEffect, useState } from "react";

/**
 * Latches `true` the first time the referenced element nears the viewport, and
 * stays true (so content loaded once is not torn down on scroll-away). Used to
 * defer expensive work — panel queries, preview embeds — until visible. The
 * effect only sets up the observer on mount; it does not react to a prop to set
 * state.
 */
export function useInView(
  ref: RefObject<Element | null>,
  rootMargin = "200px",
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
}
