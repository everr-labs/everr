import { cn } from "@everr/ui/lib/utils";
import type { ComponentProps } from "react";

export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "font-heading text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
