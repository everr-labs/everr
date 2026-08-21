import { ScrollArea } from "@everr/ui/components/scroll-area";
import { ListFilter } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The Explore filter rail.
 *
 * The rail has two zones, and a thick divider separates them. The top zone holds
 * Service and Environment, which stay set on Traces, Logs and Errors. The bottom
 * zone holds the filters of the current page, and the search field is first.
 *
 * No label marks the division. Position alone shows which two filters stay set,
 * so their order and their position must not change.
 *
 * The name of "Clear page filters" gives the exact effect. It resets the bottom
 * zone only. The user clears Service and Environment from the "All services" and
 * "All environments" row in each control.
 */
export function FilterSidebar({
  label,
  persistentFilters,
  hasActiveFilters,
  onClear,
  children,
}: {
  label: string;
  persistentFilters?: ReactNode;
  hasActiveFilters: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <ScrollArea
      render={
        <aside
          aria-label={label}
          // The Base UI ScrollArea root writes role="presentation" onto this
          // element, which strips the implied landmark off the aside, so the
          // explicit role is not redundant here: it wins the landmark back.
          // biome-ignore lint/a11y/noRedundantRoles: overridden by Base UI
          role="complementary"
        />
      }
      className="bg-muted/15 h-full min-h-0 border-b lg:border-r lg:border-b-0"
      viewportClassName="flex flex-col gap-3 p-3"
    >
      <div className="text-muted-foreground flex items-center gap-2 text-[0.6875rem] font-medium tracking-wider uppercase">
        <ListFilter className="size-3.5" />
        Filters
      </div>

      {persistentFilters ? (
        <>
          <div className="flex flex-col gap-3">{persistentFilters}</div>
          <div
            data-slot="filter-sidebar-divider"
            role="presentation"
            className="bg-border/80 my-1 h-0.5 shrink-0 rounded-full"
          />
        </>
      ) : null}

      <div className="flex flex-col gap-3">{children}</div>

      {hasActiveFilters && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground self-start text-xs underline"
          onClick={onClear}
        >
          Clear page filters
        </button>
      )}
    </ScrollArea>
  );
}
