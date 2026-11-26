import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { SideDrawer } from "@everr/ui/components/side-drawer";
import { useIsNarrow } from "@everr/ui/hooks/use-mobile";
import { ListFilter } from "lucide-react";
import { type ReactNode, useState } from "react";
import { FilterSidebar, FiltersLabel } from "./filter-sidebar";

/**
 * Puts the Explore filter rail in position.
 *
 * In a wide window the rail is the first column of the grid. In a narrow window
 * the column becomes a "Filters" button, and the button opens the same rail in
 * a side drawer. The component builds the rail one time in both cases. There is no
 * second copy that CSS hides, so each section keeps one set of inputs and one
 * query state.
 *
 * The caller supplies the two counts, and this component derives the flags.
 * The count on the button includes both zones, because the drawer also hides
 * Service and Environment. A count without them reports less than the number of
 * filters that narrow the results. "Clear page filters" changes the page zone
 * only, so the page count alone controls it.
 */
export function ExploreFilterRail({
  label,
  persistentFilters,
  persistentFilterCount,
  pageFilterCount,
  onClear,
  narrowToolbar,
  children,
}: {
  label: string;
  persistentFilters?: ReactNode;
  persistentFilterCount: number;
  pageFilterCount: number;
  onClear: () => void;
  /** Page controls beside the Filters button in a narrow window, so its bar is not empty. */
  narrowToolbar?: ReactNode;
  children: ReactNode;
}) {
  // Below `lg` there is no space for a 260px rail next to the results.
  const isNarrow = useIsNarrow();
  const [open, setOpen] = useState(false);

  const rail = (
    <FilterSidebar
      label={label}
      persistentFilters={persistentFilters}
      hasActiveFilters={pageFilterCount > 0}
      onClear={onClear}
    >
      {children}
    </FilterSidebar>
  );

  if (!isNarrow) return rail;

  const activeFilterCount = persistentFilterCount + pageFilterCount;

  return (
    <div className="bg-pane flex items-center gap-3 border-b px-3 py-2">
      {/* Finger-sized on touch screens, where this bar is the way into the filters. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-coarse:h-10 pointer-coarse:px-3 pointer-coarse:text-sm"
        onClick={() => setOpen(true)}
      >
        <ListFilter />
        Filters
        {activeFilterCount > 0 && <Badge variant="secondary">{activeFilterCount}</Badge>}
      </Button>
      {narrowToolbar}
      <SideDrawer
        open={open}
        onOpenChange={setOpen}
        // The drawer's header replaces the rail's own "Filters" heading.
        title={<FiltersLabel />}
        description={label}
        closeLabel="Close filters"
        className="[--drawer-bleed-background:var(--color-pane)]"
      >
        {rail}
      </SideDrawer>
    </div>
  );
}
