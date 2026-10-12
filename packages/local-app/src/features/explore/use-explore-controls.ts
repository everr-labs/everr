import type { TimeRange } from "@everr/ui/lib/time-range";
import { useNavigate } from "@tanstack/react-router";

export function useExploreControls(to: "/logs" | "/errors" | "/traces") {
  const navigate = useNavigate();

  return {
    onTimeRangeChange: (range: TimeRange) =>
      navigate({
        to,
        search: (prev) => ({ ...prev, from: range.from, to: range.to }),
        replace: true,
      }),
    onRefreshChange: (value: string) =>
      navigate({
        to,
        search: (prev) => ({ ...prev, refresh: value || undefined }),
        replace: true,
      }),
  };
}
