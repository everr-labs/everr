import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

interface RetainTimeRangeArgs {
  search: Record<string, unknown>;
  next: (search: Record<string, unknown>) => Record<string, unknown>;
}

export function retainTimeRangeSearch({
  search,
  next,
}: RetainTimeRangeArgs): Record<string, unknown> {
  const result = next(search);
  const merged = { ...result };

  // `validateSearch` can inject defaults before middleware runs.
  if (
    (merged.from === undefined || merged.from === DEFAULT_TIME_RANGE.from) &&
    search.from !== undefined
  ) {
    merged.from = search.from;
  }
  if (
    (merged.to === undefined || merged.to === DEFAULT_TIME_RANGE.to) &&
    search.to !== undefined
  ) {
    merged.to = search.to;
  }
  if (
    (merged.refresh === undefined || merged.refresh === "") &&
    search.refresh
  ) {
    merged.refresh = search.refresh;
  }

  return merged;
}
