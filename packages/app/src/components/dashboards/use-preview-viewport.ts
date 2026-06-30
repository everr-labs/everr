import { useEffect, useRef, useState } from "react";
import { useInView } from "./use-in-view";

/**
 * For a lazily-mounted, width-scaled preview: `inView` latches true near the
 * viewport (via the shared useInView), and `width` tracks the element's
 * rendered width to compute the preview scale. The ResizeObserver effect only
 * sets up on mount — it does not react to a prop to set state.
 */
export function usePreviewViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const inView = useInView(ref);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.offsetWidth;
      if (w) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  return { ref, inView, width };
}
