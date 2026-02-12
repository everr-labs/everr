import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TimeRangePicker } from "@/components/analytics";
import {
  CostByRepoTable,
  CostByRunnerChart,
  CostByWorkflowTable,
  CostOverTimeChart,
} from "@/components/cost-analysis";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  costByRepoOptions,
  costByWorkflowOptions,
  costOverviewOptions,
  formatCost,
} from "@/data/cost-analysis";
import { type TimeRange, TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/cost-analysis")({
  staticData: { breadcrumb: "Cost Analysis" },
  component: CostAnalysisPage,
  validateSearch: TimeRangeSearchSchema,
  loaderDeps: ({ search }) => ({
    timeRange: { from: search.from, to: search.to },
  }),
  loader: async ({ context: { queryClient }, deps: { timeRange } }) => {
    const input = { timeRange };
    await Promise.all([
      queryClient.prefetchQuery(costOverviewOptions(input)),
      queryClient.prefetchQuery(costByRepoOptions(input)),
      queryClient.prefetchQuery(costByWorkflowOptions(input)),
    ]);
  },
  pendingComponent: CostAnalysisSkeleton,
});

function CostAnalysisPage() {
  const { from, to } = Route.useSearch();
  const timeRange = { from, to };
  const input = { timeRange };
  const { data: overview } = useQuery(costOverviewOptions(input));
  const { data: byRepo } = useQuery(costByRepoOptions(input));
  const { data: byWorkflow } = useQuery(costByWorkflowOptions(input));
  const navigate = Route.useNavigate();

  if (!overview) return null;

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({ search: { from: newRange.from, to: newRange.to } });
  };

  const { summary, overTime, byRunner } = overview;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cost Analysis</h1>
          <p className="text-muted-foreground">
            Estimated GitHub Actions spend based on runner usage
          </p>
        </div>
        <TimeRangePicker value={timeRange} onChange={handleTimeRangeChange} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Estimated Cost</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatCost(summary.totalCost)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Minutes</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {Math.round(summary.totalMinutes).toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Billing Minutes</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.totalBillingMinutes.toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Self-Hosted Minutes</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {Math.round(summary.selfHostedMinutes).toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cost Over Time</CardTitle>
          <CardDescription>
            Daily estimated cost by operating system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CostOverTimeChart data={overTime} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cost by Runner</CardTitle>
          <CardDescription>Estimated cost per runner type</CardDescription>
        </CardHeader>
        <CardContent>
          <CostByRunnerChart data={byRunner} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cost by Repository</CardTitle>
          <CardDescription>Per-repository cost breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <CostByRepoTable data={byRepo ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cost by Workflow</CardTitle>
          <CardDescription>Per-workflow cost breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <CostByWorkflowTable data={byWorkflow ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}

function CostAnalysisSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-1 h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-[140px]" />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
