import { cn } from "@everr/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-white/[0.04] bg-[linear-gradient(90deg,transparent_0%,oklch(1_0_0/5%)_50%,transparent_100%)] bg-size-[200%_100%] bg-no-repeat animate-shimmer motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
