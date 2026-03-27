import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ResolvedTimeRangeSearchSchema,
  type TimeRange,
} from "@/lib/time-range";

export function useTimeRange() {
  const timeRange = useSearch({
    from: "/_authenticated/_dashboard",
    select(state) {
      const { from, to } = ResolvedTimeRangeSearchSchema.parse(state);
      return { from, to };
    },
  });
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
