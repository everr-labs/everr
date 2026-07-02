import { cn } from "@everr/ui/lib/utils";
import type * as React from "react";

// THE standard page inset. Every padded page (settings, home, cost analysis,
// run detail, previewable content, …) wraps its content in this so the spacing
// rhythm — a 12px gutter on all sides plus a 12px flex gap between stacked
// blocks — lives in one place instead of on the shared scroll column.
//
// `flex-1 min-h-0` preserves fill semantics: pages whose content stretches to
// the viewport (tables/panels with their own internal scroll) rely on being a
// flex child of the `_dashboard` scroll column, and this keeps that chain
// intact so the container fills the column and the child can size to it.
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
