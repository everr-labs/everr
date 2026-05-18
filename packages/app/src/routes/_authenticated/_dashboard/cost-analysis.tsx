import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, DollarSign, Server } from "lucide-react";
import { useState } from "react";
import {
  ActionsUsageChart,
  type ActionsUsageDimension,
  CostByWorkflowTable,
} from "@/components/cost-analysis";
import { TimeRangePanel } from "@/components/time-range-panel";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  costByWorkflowOptions,
  costOverTimeBreakdownOptions,
  costOverviewOptions,
} from "@/data/cost-analysis/options";
import type { CostMetric } from "@/data/cost-analysis/schemas";
import { formatCost } from "@/lib/runner-pricing";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cost-analysis",
)({
  staticData: { breadcrumb: "Cost Analysis" },
  head: () => ({
    meta: [{ title: "Everr - Cost Analysis" }],
  }),
  component: CostAnalysisPage,
  validateSearch: TimeRangeSearchSchema,
  loaderDeps: ({ search }) => withTimeRange(search),
  loader: async ({ context: { queryClient }, deps: { timeRange } }) => {
    const input = { timeRange };
    await Promise.all([
      queryClient.prefetchQuery(costOverviewOptions(input)),
      queryClient.prefetchQuery(
        costOverTimeBreakdownOptions({ ...input, dimension: "repo" }),
      ),
      queryClient.prefetchQuery(costByWorkflowOptions(input)),
    ]);
  },
});

function MetricToggle({
  value,
  onChange,
}: {
  value: CostMetric;
  onChange: (metric: CostMetric) => void;
}) {
  return (
    <ToggleGroup
      value={[value]}
      variant="outline"
      size="sm"
      spacing={0}
      onValueChange={(next) => {
        const selected = next[0];
        if (selected === "spend" || selected === "minutes") onChange(selected);
      }}
      aria-label="Usage metric"
    >
      <ToggleGroupItem value="spend">Spend</ToggleGroupItem>
      <ToggleGroupItem value="minutes">Minutes</ToggleGroupItem>
    </ToggleGroup>
  );
}

function DimensionToggle({
  value,
  onChange,
}: {
  value: ActionsUsageDimension;
  onChange: (dimension: ActionsUsageDimension) => void;
}) {
  return (
    <ToggleGroup
      value={[value]}
      variant="outline"
      size="sm"
      spacing={0}
      onValueChange={(next) => {
        const selected = next[0];
        if (selected === "repo" || selected === "runner") onChange(selected);
      }}
      aria-label="Breakdown dimension"
    >
      <ToggleGroupItem value="repo">By Repository</ToggleGroupItem>
      <ToggleGroupItem value="runner">By Runner</ToggleGroupItem>
    </ToggleGroup>
  );
}

function CostAnalysisPage() {
  const [metric, setMetric] = useState<CostMetric>("spend");
  const [dimension, setDimension] = useState<ActionsUsageDimension>("repo");

  const breakdownQuery = (input: TimeRangeInput) =>
    costOverTimeBreakdownOptions({ ...input, dimension });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cost Analysis</h1>
          <p className="text-muted-foreground">
            Estimated CI runner spend based on runner usage
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <TimeRangePanel
          title="Estimated Cost"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={DollarSign}
        >
          {(overview) => formatCost(overview.summary.totalCost)}
        </TimeRangePanel>

        <TimeRangePanel
          title="Total Minutes"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={Clock}
        >
          {(overview) =>
            Math.round(overview.summary.totalMinutes).toLocaleString()
          }
        </TimeRangePanel>

        <TimeRangePanel
          title="Self-Hosted Minutes"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={Server}
        >
          {(overview) =>
            Math.round(overview.summary.selfHostedMinutes).toLocaleString()
          }
        </TimeRangePanel>
      </div>

      <TimeRangePanel
        title="Actions Usage"
        queries={[breakdownQuery]}
        action={
          <div className="flex items-center gap-2">
            <MetricToggle value={metric} onChange={setMetric} />
            <DimensionToggle value={dimension} onChange={setDimension} />
          </div>
        }
      >
        {(breakdown) => <ActionsUsageChart data={breakdown} metric={metric} />}
      </TimeRangePanel>

      <TimeRangePanel
        title="Cost by Workflow"
        description="Per-workflow cost breakdown"
        queries={[costByWorkflowOptions]}
        inset="flush-content"
      >
        {(byWorkflow) => <CostByWorkflowTable data={byWorkflow} />}
      </TimeRangePanel>
    </div>
  );
}
