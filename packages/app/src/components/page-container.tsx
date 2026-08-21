import { ScrollArea } from "@everr/ui/components/scroll-area";
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

// The same inset in a scroll column of its own, for the layouts whose parent
// column is `overflow-hidden` and so cannot scroll for them. The viewport is a
// flex column so PageContainer's fill semantics keep working: without it
// `flex-1` is inert and the inset sizes to its content instead of the column.
export function ScrollingPageContainer({
  children,
  ...props
}: React.ComponentProps<typeof PageContainer>) {
  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportClassName="flex flex-col overscroll-y-contain"
    >
      <PageContainer {...props}>{children}</PageContainer>
    </ScrollArea>
  );
}
