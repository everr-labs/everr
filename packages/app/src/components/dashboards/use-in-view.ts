import { type RefObject, useEffect, useState } from "react";

/**
 * Tracks whether the referenced element is currently near the viewport. Used to
 * gate expensive work — panel queries, preview embeds — to what's on screen:
 * `enabled: inView` defers it until visible and, with `staleTime: Infinity` on
 * the gated query, an off-screen element goes idle (keeping its cached data)
 * without ever refetching on scroll-back. A refresh (`invalidateQueries`) then
 * only re-runs what's currently visible; off-screen content revalidates when it
 * scrolls back in. The effect only sets up the observer on mount; it does not
 * react to a prop to set state.
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = "200px"): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setInView(entry.isIntersecting);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
}
