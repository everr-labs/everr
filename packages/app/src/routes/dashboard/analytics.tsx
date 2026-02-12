import { createFileRoute } from "@tanstack/react-router";
import {
  DurationTrendsPanel,
  QueueTimePanel,
  RunnerUtilizationPanel,
  SuccessRatePanel,
  TimeRangePicker,
} from "@/components/analytics";
import { useTimeRange } from "@/hooks/use-time-range";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/analytics")({
  staticData: { breadcrumb: "Analytics" },
  component: AnalyticsPage,
  validateSearch: TimeRangeSearchSchema,
});

function AnalyticsPage() {
  const { timeRange, setTimeRange } = useTimeRange();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">CI/CD performance insights</p>
        </div>
        <TimeRangePicker value={timeRange} onChange={setTimeRange} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DurationTrendsPanel />
        <QueueTimePanel />
        <SuccessRatePanel />
        <RunnerUtilizationPanel />
      </div>
    </div>
  );
}
