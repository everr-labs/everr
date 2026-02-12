import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  type TimeRange,
  TimeRangeSearchSchema,
  validateTimeRange,
} from "@/lib/time-range";

export function useTimeRange() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const timeRange = validateTimeRange(TimeRangeSearchSchema.parse(search));
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
