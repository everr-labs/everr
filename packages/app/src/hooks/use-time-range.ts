import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ResolvedTimeRangeSearchSchema,
  type TimeRange,
  validateTimeRange,
} from "@/lib/time-range";

export function useTimeRange() {
  const search = useSearch({ from: "/dashboard" });
  const timeRange = validateTimeRange(
    ResolvedTimeRangeSearchSchema.parse(search),
  );
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
