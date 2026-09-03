import { useMediaQuery } from "./use-media-query";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/**
 * Below Tailwind's `lg` (1024px): the width under which a page cannot afford a
 * second column beside its main one, and a rail or a detail column becomes a
 * sheet. Callers pairing this with `lg:` classes read the same number.
 */
const NARROW_BREAKPOINT = 1024;

export function useIsNarrow() {
  return useMediaQuery(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
}
