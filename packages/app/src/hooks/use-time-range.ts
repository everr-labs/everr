import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  DEFAULT_TIME_RANGE,
  parseTimeRangeFromSearch,
  type TimeRange,
} from "@/lib/time-range";

export function useTimeRange() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const timeRange = parseTimeRangeFromSearch(search, DEFAULT_TIME_RANGE);
  const navigate = useNavigate();

  const setTimeRange = (range: TimeRange) => {
    void navigate({
      // @ts-expect-error -- route-agnostic navigation; useNavigate() can't infer search params without route context
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        from: range.from,
        to: range.to,
      }),
    });
  };

  return { timeRange, setTimeRange };
}
