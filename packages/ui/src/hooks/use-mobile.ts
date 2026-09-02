import { useMediaQuery } from "./use-media-query";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/**
 * Below Tailwind's `lg`. The width under which a page cannot afford a second
 * column beside its main one: the Explore rails move into a sheet here, and so
 * does the alerting detail panel. One number, so the two cannot drift apart.
 */
const NARROW_BREAKPOINT = 1024;

export function useIsNarrow() {
  return useMediaQuery(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
}
