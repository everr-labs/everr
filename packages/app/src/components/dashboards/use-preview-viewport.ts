import { useEffect, useRef, useState } from "react";

/**
 * Attaches an IntersectionObserver + ResizeObserver to one element. `inView`
 * latches true the first time the element nears the viewport (so a preview
 * mounts once and stays). `width` tracks the element's rendered width, used to
 * scale a fixed-width preview down to the card. The effect only sets up
 * observers on mount — it does NOT react to a prop to set state.
 */
export function usePreviewViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.offsetWidth;
      if (w) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.offsetWidth);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  return { ref, inView, width };
}
