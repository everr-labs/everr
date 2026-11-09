import type { LucideIcon } from "lucide-react";

/**
 * Why a series chart has nothing to draw. Rows with no numeric column still
 * count as rows, so that case gets its own message instead of an empty plot.
 */
export function SeriesEmptyState({
  icon: Icon,
  hasQuery,
  hasRows,
}: {
  icon: LucideIcon;
  hasQuery: boolean;
  hasRows: boolean;
}) {
  const message = !hasQuery
    ? "Configure a query to see results"
    : !hasRows
      ? "No data in this time range"
      : "No numeric data to plot";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <Icon className="size-8" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
