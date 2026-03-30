import { createFileRoute } from "@tanstack/react-router";
import { Clock, DollarSign, Receipt, Server } from "lucide-react";
import {
  CostByRepoTable,
  CostByRunnerChart,
  CostByWorkflowTable,
  CostOverTimeChart,
} from "@/components/cost-analysis";
import { Panel } from "@/components/panel";
import {
  costByRepoOptions,
  costByWorkflowOptions,
  costOverviewOptions,
} from "@/data/cost-analysis/options";
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
      queryClient.prefetchQuery(costByRepoOptions(input)),
      queryClient.prefetchQuery(costByWorkflowOptions(input)),
    ]);
  },
});

function CostAnalysisPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cost Analysis</h1>
          <p className="text-muted-foreground">
            Estimated GitHub Actions spend based on runner usage
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Panel
          title="Estimated Cost"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={DollarSign}
        >
          {(overview) => formatCost(overview.summary.totalCost)}
        </Panel>

        <Panel
          title="Total Minutes"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={Clock}
        >
          {(overview) =>
            Math.round(overview.summary.totalMinutes).toLocaleString()
          }
        </Panel>

        <Panel
          title="Billing Minutes"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={Receipt}
        >
          {(overview) => overview.summary.totalBillingMinutes.toLocaleString()}
        </Panel>

        <Panel
          title="Self-Hosted Minutes"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={Server}
        >
          {(overview) =>
            Math.round(overview.summary.selfHostedMinutes).toLocaleString()
          }
        </Panel>
      </div>

      <Panel
        title="Cost Over Time"
        description="Daily estimated cost by operating system"
        queries={[costOverviewOptions]}
      >
        {(overview) => <CostOverTimeChart data={overview.overTime} />}
      </Panel>

      <Panel
        title="Cost by Runner"
        description="Estimated cost per runner type"
        queries={[costOverviewOptions]}
      >
        {(overview) => <CostByRunnerChart data={overview.byRunner} />}
      </Panel>

      <Panel
        title="Cost by Repository"
        description="Per-repository cost breakdown"
        queries={[costByRepoOptions]}
        inset="flush-content"
      >
        {(byRepo) => <CostByRepoTable data={byRepo} />}
      </Panel>

      <Panel
        title="Cost by Workflow"
        description="Per-workflow cost breakdown"
        queries={[costByWorkflowOptions]}
        inset="flush-content"
      >
        {(byWorkflow) => <CostByWorkflowTable data={byWorkflow} />}
      </Panel>
    </div>
  );
}
