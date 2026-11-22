import { cn } from "./utils";

/**
 * Dims content showing the previous query's result while the next one loads.
 * Waits 150ms like the Button's loading state, so a quick reload shows nothing.
 */
export function staleClass(stale: boolean) {
  return cn(
    "transition-opacity duration-0",
    stale && "opacity-50 delay-150 duration-150 motion-reduce:duration-0",
  );
}

/** `staleClass` on `className`, and tells assistive tech the region is updating. */
export function staleProps(stale: boolean, className?: string) {
  return { "aria-busy": stale, className: cn(className, staleClass(stale)) };
}
