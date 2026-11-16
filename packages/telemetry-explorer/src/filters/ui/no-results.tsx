import { Button } from "@everr/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@everr/ui/components/empty";
import { formatTimeRangeDisplay } from "@everr/ui/components/time-range-picker";
import type { TimeRange } from "@everr/ui/lib/time-range";

/**
 * An explorer with nothing to list. It says why: the filters hide everything,
 * or nothing was recorded in the time range at all. "Clear filters" shows only
 * when it would change the results.
 */
export function NoResults({
  noun,
  timeRange,
  filterCount,
  onClearFilters,
  className,
}: {
  /** Plural, lower case: "logs", "traces". */
  noun: string;
  timeRange: TimeRange;
  /** Every filter that narrows the results, Service and Environment included. */
  filterCount: number;
  /** Clears the page filters. Leave it out when none is set: Service and
   *  Environment stay, so the button would change nothing. */
  onClearFilters?: () => void;
  className?: string;
}) {
  const range = rangePhrase(timeRange);
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyTitle>
          {filterCount > 0 ? `No ${noun} match these filters` : `No ${noun} in this time range`}
        </EmptyTitle>
        <EmptyDescription>
          {filterCount > 0
            ? `Nothing recorded for ${range} matches them. Try fewer filters or a wider time range.`
            : `Nothing was recorded for ${range}. Try a wider time range.`}
        </EmptyDescription>
      </EmptyHeader>
      {filterCount > 0 && onClearFilters ? (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      ) : null}
    </Empty>
  );
}

/** The range as it reads mid-sentence: "the last 7 days", "today", or the
 *  dates as the time picker shows them. */
function rangePhrase(timeRange: TimeRange): string {
  const label = formatTimeRangeDisplay(timeRange);
  if (label.startsWith("Last ")) return `the ${label.toLowerCase()}`;
  if (/^(Today|Yesterday|This )/.test(label)) return label.toLowerCase();
  return label;
}

/** The list footer once every match is loaded: "Showing all 12 matching
 *  traces", or "Showing 1 matching trace" (not "all 1"). */
export function showingAll(count: number, noun: string): string {
  return count === 1
    ? `Showing 1 matching ${noun}`
    : `Showing all ${count.toLocaleString()} matching ${noun}s`;
}
