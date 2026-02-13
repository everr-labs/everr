import { createFileRoute } from "@tanstack/react-router";
import {
  DurationTrendsPanel,
  QueueTimePanel,
  RunnerUtilizationPanel,
  SuccessRatePanel,
} from "@/components/analytics";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/analytics")({
  staticData: { breadcrumb: "Analytics" },
  component: AnalyticsPage,
  validateSearch: TimeRangeSearchSchema,
});

function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">CI/CD performance insights</p>
        </div>
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
