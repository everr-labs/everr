import { createFileRoute } from "@tanstack/react-router";
import { TimeRangeSelect } from "@/components/analytics";
import {
  FailurePatternsTable,
  FailuresByRepoTable,
  FailureTrendChart,
} from "@/components/failures";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimeRange } from "@/data/analytics";
import {
  getFailurePatterns,
  getFailuresByRepo,
  getFailureTrend,
} from "@/data/failures";

export const Route = createFileRoute("/dashboard/failures")({
  component: FailuresPage,
  validateSearch: (search: Record<string, unknown>) => ({
    timeRange: (search.timeRange as TimeRange) || "7d",
  }),
  loaderDeps: ({ search }) => ({ timeRange: search.timeRange }),
  loader: async ({ deps: { timeRange } }) => {
    const [patterns, trend, byRepo] = await Promise.all([
      getFailurePatterns({ data: { timeRange } }),
      getFailureTrend({ data: { timeRange } }),
      getFailuresByRepo({ data: { timeRange } }),
    ]);
    return { patterns, trend, byRepo };
  },
  pendingComponent: FailuresSkeleton,
});

function FailuresPage() {
  const { patterns, trend, byRepo } = Route.useLoaderData();
  const { timeRange } = Route.useSearch();
  const navigate = Route.useNavigate();

  const handleTimeRangeChange = (newRange: TimeRange) => {
    navigate({ search: { timeRange: newRange } });
  };

  const totalFailures = patterns.reduce((sum, p) => sum + p.count, 0);
  const uniquePatterns = patterns.length;
  const mostAffectedRepo = byRepo.length > 0 ? byRepo[0].repo : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Failure Analysis
          </h1>
          <p className="text-muted-foreground">
            Common failure patterns across workflows
          </p>
        </div>
        <TimeRangeSelect value={timeRange} onChange={handleTimeRangeChange} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Failures</CardDescription>
            <CardTitle className="text-3xl tabular-nums text-red-600">
              {totalFailures}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unique Patterns</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {uniquePatterns}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Most Affected Repo</CardDescription>
            <CardTitle className="text-lg truncate">
              {mostAffectedRepo}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Failure Trend</CardTitle>
          <CardDescription>
            Daily failures and unique patterns over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FailureTrendChart data={trend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Failure Patterns</CardTitle>
          <CardDescription>
            Recurring failure messages ranked by frequency
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FailurePatternsTable data={patterns} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Failures by Repository</CardTitle>
          <CardDescription>Per-repository failure breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <FailuresByRepoTable data={byRepo} />
        </CardContent>
      </Card>
    </div>
  );
}

function FailuresSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-1 h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-[140px]" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
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
