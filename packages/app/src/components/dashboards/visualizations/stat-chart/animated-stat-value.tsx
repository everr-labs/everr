import { useLayoutEffect, useRef } from "react";

const DURATION_MS = 600;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Renders a formatted stat value and, when the value changes after mount,
 * counts from the previous number to the new one. The first render shows the
 * value as is: counting up from zero on every page load would only delay it.
 * The tween writes the text node directly, so React keeps rendering the final
 * string and the animation never touches component state.
 */
export function AnimatedStatValue({
  value,
  format,
}: {
  value: number;
  /** The number and its unit. The tween only runs while the unit stays the
   *  same, so a value crossing a scale (950 ms to 1.2 s) never shows a number
   *  next to the wrong unit. */
  format: (value: number) => { value: string; unit?: string };
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const formatRef = useRef(format);
  formatRef.current = format;

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = value;
    const node = ref.current;
    if (!node || from === value || !Number.isFinite(from) || !Number.isFinite(value)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fmt = (v: number) => formatRef.current(v).value;
    if (formatRef.current(from).unit !== formatRef.current(value).unit) return;

    const target = fmt(value);
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / DURATION_MS);
      node.textContent = t < 1 ? fmt(from + (value - from) * easeOut(t)) : target;
      if (t < 1) frame = requestAnimationFrame(step);
    });
    node.textContent = fmt(from);
    return () => {
      cancelAnimationFrame(frame);
      node.textContent = target;
    };
  }, [value]);

  return <span ref={ref}>{format(value).value}</span>;
}
