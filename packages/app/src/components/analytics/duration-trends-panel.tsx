import { DurationTrendsChart } from "@/components/analytics/duration-trends-chart";
import { Panel } from "@/components/ui/panel";
import { durationTrendsOptions } from "@/data/analytics";

export function DurationTrendsPanel() {
  return (
    <Panel
      title="Duration Trends"
      description="Job duration over time (avg, p50, p95)"
      queries={[durationTrendsOptions]}
    >
      {(data) => <DurationTrendsChart data={data} />}
    </Panel>
  );
}
