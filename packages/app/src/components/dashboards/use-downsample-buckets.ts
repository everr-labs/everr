import { type RefObject, useEffect, useState } from "react";
import { m4BucketsForWidth } from "#app/data/dashboards/m4.ts";

/** A resize must hold still this long before the bucket count follows it. */
const RESIZE_SETTLE_MS = 200;

/**
 * The downsampling bucket count that fits the referenced element's width, or
 * undefined until it is measured. It holds the snapped count, not the width,
 * so a resize re-renders and refetches only when it crosses a snap point, and
 * only once the resize settles: a window drag or a sidebar animation would
 * otherwise start a query at every snap point it passes.
 *
 * The observer's first report is the first measurement, not a read at mount.
 * The dashboard grid mounts its panels at a placeholder width and corrects it
 * in an effect, so a read at mount sees the placeholder and costs every panel
 * a second query at the real width.
 *
 * The effect subscribes to the element's size on mount; it does not react to a
 * prop to set state.
 */
export function useDownsampleBuckets(ref: RefObject<Element | null>): number | undefined {
  const [buckets, setBuckets] = useState<number>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBuckets(m4BucketsForWidth(el.clientWidth));
    let measured = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (!measured) {
        measured = true;
        measure();
        return;
      }
      clearTimeout(settle);
      settle = setTimeout(measure, RESIZE_SETTLE_MS);
    });
    observer.observe(el);
    return () => {
      clearTimeout(settle);
      observer.disconnect();
    };
  }, [ref]);
  return buckets;
}
