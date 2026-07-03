import { cn } from "@everr/ui/lib/utils";
import type * as React from "react";

// The standard page inset (12px gutter + gap), in one place. `flex-1 min-h-0`
// keeps fill semantics so pages with their own internal scroll can size to the
// scroll column.
export function PageContainer({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-3 p-3", className)}
      {...props}
    >
      {children}
    </div>
  );
}
