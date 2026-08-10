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

// The scroll-owning page column shared by the `_padded` pathless layout and
// the alerts section layout: the `_dashboard` column is `overflow-hidden`, so
// these layouts own their own scroll; the flex idiom keeps PageContainer's
// fill working for both tall and full-height content. overscroll-y-contain is
// tuned for macOS rubber-band behavior — leave the overscroll classes alone.
export function ScrollPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-y-contain">
      <PageContainer>{children}</PageContainer>
    </div>
  );
}
