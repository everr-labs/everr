import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@everr/ui/components/sheet";
import { useIsNarrow } from "@everr/ui/hooks/use-mobile";
import { ListFilter } from "lucide-react";
import { type ReactNode, useState } from "react";
import { FilterSidebar } from "./filter-sidebar";

/**
 * Puts the Explore filter rail in position.
 *
 * In a wide window the rail is the first column of the grid. In a narrow window
 * the column becomes a "Filters" button, and the button opens the same rail in
 * a sheet. The component builds the rail one time in both cases. There is no
 * second copy that CSS hides, so each section keeps one set of inputs and one
 * query state.
 *
 * The caller supplies the two counts, and this component derives the flags.
 * The count on the button includes both zones, because the sheet also hides
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
  children,
}: {
  label: string;
  persistentFilters?: ReactNode;
  persistentFilterCount: number;
  pageFilterCount: number;
  onClear: () => void;
  children: ReactNode;
}) {
  // The same width as the `lg:` column rules on the three Explore grids. Below
  // it there is no space for a 260px rail next to the results, and the rail
  // moves into a sheet.
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
    <div className="bg-muted/15 flex items-center border-b px-3 py-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <ListFilter />
        Filters
        {activeFilterCount > 0 && (
          <Badge variant="secondary">{activeFilterCount}</Badge>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[300px] p-0 sm:max-w-[300px]">
          <SheetTitle className="sr-only">{label}</SheetTitle>
          {rail}
        </SheetContent>
      </Sheet>
    </div>
  );
}
