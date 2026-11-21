import { cn } from "@everr/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("skeleton rounded-md", className)} {...props} />;
}

/** One text line's box with a centred bar, so a row of these is exactly as
 *  tall as the row of text it stands in for. */
function SkeletonLine({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex h-[1lh] items-center", className)} {...props} />;
}

export { Skeleton, SkeletonLine };
