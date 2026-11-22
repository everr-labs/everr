import { cn } from "@everr/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("skeleton rounded-md", className)} {...props} />;
}

/** One text line's box with a centred bar, so a row of these is exactly as
 *  tall as the row of text it stands in for. */
function SkeletonLine({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex h-[1lh] items-center", className)} {...props} />;
}

/** Spread over the range in no visible order. */
const RAGGED = [0.55, 0.2, 0.85, 0.4, 1, 0.1, 0.7, 0.3];

/** A bar width between `min` and `max` that changes from row to row, so a list
 *  of placeholders reads like text of mixed lengths. Fixed per index, so every
 *  render draws the same shape. */
function raggedWidth(index: number, min: number, max: number, unit = "%") {
  return `${min + RAGGED[index % RAGGED.length] * (max - min)}${unit}`;
}

export { raggedWidth, Skeleton, SkeletonLine };
