import { cn } from "@everr/ui/lib/utils";
import { Outlet, useChildMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useFocusLastOpened } from "../../shell/use-last-opened";

/**
 * A list page whose detail route opens over it instead of replacing it, so the
 * list keeps its scroll position and loaded pages for when the reader comes
 * back.
 */
export function DetailOverList({ list }: { list: ReactNode }) {
  const detailOpen = useChildMatches({ select: (matches) => matches.length > 0 });
  const listRef = useFocusLastOpened<HTMLDivElement>(detailOpen);
  // `invisible`, not `hidden`: the list must keep its size, or Virtuoso
  // measures nothing and resets its scroll.
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        inert={detailOpen}
        className={cn("flex min-h-0 flex-1 flex-col", detailOpen && "invisible")}
      >
        {list}
      </div>
      {detailOpen && (
        <div className="bg-background absolute inset-0 flex min-h-0 flex-col">
          <Outlet />
        </div>
      )}
    </div>
  );
}
