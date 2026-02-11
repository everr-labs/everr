import { SuccessRateChart } from "@/components/analytics/success-rate-chart";
import { Panel } from "@/components/ui/panel";
import { successRateTrendsOptions } from "@/data/analytics";

export function SuccessRatePanel() {
  return (
    <Panel
      title="Success Rate Trends"
      description="Build reliability over time"
      queries={[successRateTrendsOptions]}
    >
      {(data) => <SuccessRateChart data={data} />}
    </Panel>
  );
}
