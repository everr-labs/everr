import { TimeRangePicker as BaseTimeRangePicker } from "@everr/ui/components/time-range-picker";
import { useTimeRange } from "@/hooks/use-time-range";

export function TimeRangePicker() {
  const { timeRange, setTimeRange } = useTimeRange();
  return <BaseTimeRangePicker value={timeRange} onChange={setTimeRange} />;
}
