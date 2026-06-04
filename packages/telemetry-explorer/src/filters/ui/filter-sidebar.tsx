import { ListFilter } from "lucide-react";
import type { ReactNode } from "react";

export function FilterSidebar({
  label,
  hasActiveFilters,
  onClear,
  children,
}: {
  label: string;
  hasActiveFilters: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="bg-muted/15 flex h-full min-h-0 flex-col gap-3 overflow-auto border-b p-3 lg:border-r lg:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <ListFilter className="text-muted-foreground size-3.5" />
          Filter
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs underline"
            onClick={onClear}
          >
            Clear all
          </button>
        )}
      </div>
      {children}
    </aside>
  );
}
