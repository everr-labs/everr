import { QueueTimeChart } from "@/components/analytics/queue-time-chart";
import { Panel } from "@/components/ui/panel";
import { queueTimeAnalysisOptions } from "@/data/analytics";

export function QueueTimePanel() {
  return (
    <Panel
      title="Queue Time Analysis"
      description="Wait time before jobs start"
      queries={[queueTimeAnalysisOptions]}
    >
      {(data) => <QueueTimeChart data={data} />}
    </Panel>
  );
}
