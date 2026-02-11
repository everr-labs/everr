import { RunnerUtilizationChart } from "@/components/analytics/runner-utilization-chart";
import { Panel } from "@/components/ui/panel";
import { runnerUtilizationOptions } from "@/data/analytics";

export function RunnerUtilizationPanel() {
  return (
    <Panel
      title="Runner Utilization"
      description="Most used runners and their metrics"
      queries={[runnerUtilizationOptions]}
    >
      {(data) => <RunnerUtilizationChart data={data} />}
    </Panel>
  );
}
