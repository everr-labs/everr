import { ScrollArea } from "@everr/ui/components/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";
import { RailSearch } from "@/components/rail/rail-search";

/**
 * A rail's search field with its rows scrolling under it. Only the rows
 * scroll; the search stays pinned above.
 */
export function RailList({
  label,
  search,
  onSearchChange,
  className,
  children,
}: {
  /** Names what the rail lists, e.g. "dashboards". */
  label: string;
  search: string;
  onSearchChange: (value: string) => void;
  /** Extra layout for the scrolling rows, e.g. the gap between their groups. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <RailSearch label={label} value={search} onChange={onSearchChange} />
      <ScrollArea
        render={<nav aria-label={label} />}
        className="min-h-0 flex-1"
        viewportClassName={cn("flex flex-col pb-3", className)}
      >
        {children}
      </ScrollArea>
    </div>
  );
}
