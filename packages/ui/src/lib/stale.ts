import { cn } from "./utils";

/**
 * Dims content that is still showing the previous query's result while the
 * next one loads (`placeholderData: keepPreviousData`). Like the Button's
 * loading state, it waits 150ms, so a quick reload shows nothing: a
 * transition that has not started is simply cancelled. Fresh data shows at
 * full strength at once.
 */
export function staleClass(stale: boolean) {
  return cn(
    "transition-opacity duration-0",
    stale && "opacity-50 delay-150 duration-150 motion-reduce:duration-0",
  );
}
