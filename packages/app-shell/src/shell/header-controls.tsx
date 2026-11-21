import { RefreshPicker as BaseRefreshPicker } from "@everr/ui/components/refresh-picker";
import { TimeRangePicker as BaseTimeRangePicker } from "@everr/ui/components/time-range-picker";
import { type QueryFilters, useIsFetching } from "@tanstack/react-query";
import { useAutoRefresh, useTimeRange } from "./time-range";

export function TimeRangePicker() {
  const { timeRange, setTimeRange } = useTimeRange();
  return <BaseTimeRangePicker value={timeRange} onChange={setTimeRange} />;
}

export function RefreshPicker({ scope }: { scope?: QueryFilters }) {
  const { refreshInterval, setRefreshInterval, refreshNow } = useAutoRefresh(scope);
  const isFetching = useIsFetching(scope);

  return (
    <BaseRefreshPicker
      value={refreshInterval}
      onChange={setRefreshInterval}
      onRefresh={refreshNow}
      isFetching={isFetching > 0}
    />
  );
}
