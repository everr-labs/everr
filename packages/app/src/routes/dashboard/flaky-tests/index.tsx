import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  FlakinessTrendChart,
  FlakyTestsFilterBar,
  FlakyTestsTable,
} from "@/components/flaky-tests";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  flakinessTrendOptions,
  flakyTestFilterOptionsOptions,
  flakyTestSummaryOptions,
  flakyTestsOptions,
} from "@/data/flaky-tests";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/flaky-tests/")({
  component: FlakyTestsPage,
  validateSearch: TimeRangeSearchSchema.extend({
    from: z.string().default("now-14d"),
    to: z.string().default("now"),
    repo: z.string().optional(),
    branch: z.string().optional(),
    search: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    timeRange: { from: search.from, to: search.to },
    repo: search.repo,
    branch: search.branch,
    search: search.search,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const filterInput = {
      timeRange: deps.timeRange,
      repo: deps.repo,
      branch: deps.branch,
      search: deps.search,
    };
    await Promise.all([
      queryClient.prefetchQuery(flakyTestsOptions(filterInput)),
      queryClient.prefetchQuery(flakyTestSummaryOptions(filterInput)),
      queryClient.prefetchQuery(flakinessTrendOptions(filterInput)),
      queryClient.prefetchQuery(flakyTestFilterOptionsOptions()),
    ]);
  },
  pendingComponent: FlakyTestsSkeleton,
});

function FlakyTestsPage() {
  const { from, to, repo, branch, search } = Route.useSearch();
  const timeRange = { from, to };
  const filterInput = { timeRange, repo, branch, search };
  const { data: flakyTests } = useQuery(flakyTestsOptions(filterInput));
  const { data: summary } = useQuery(flakyTestSummaryOptions(filterInput));
  const { data: trend } = useQuery(flakinessTrendOptions(filterInput));
  const { data: filterOptions } = useQuery(flakyTestFilterOptionsOptions());
  const navigate = Route.useNavigate();

  if (!flakyTests) return null;

  const updateFilter = (updates: Record<string, unknown>) => {
    navigate({ search: (prev) => ({ ...prev, ...updates }) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flaky Tests</h1>
          <p className="text-muted-foreground">
            Tests with inconsistent pass/fail results
          </p>
        </div>
      </div>

      <FlakyTestsFilterBar
        filterOptions={filterOptions ?? { repos: [], branches: [] }}
        repo={repo}
        branch={branch}
        search={search}
        onRepoChange={(v) => updateFilter({ repo: v })}
        onBranchChange={(v) => updateFilter({ branch: v })}
        onSearchChange={(v) => updateFilter({ search: v || undefined })}
      />

      {/* Summary stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Flaky Tests</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary?.flakyTestCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Tests</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary?.totalTestCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Flaky Percentage</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary?.flakyPercentage}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Flakiness Trend</CardTitle>
          <CardDescription>
            Number of flaky tests detected over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FlakinessTrendChart data={trend ?? []} />
        </CardContent>
      </Card>

      {/* Flaky tests table */}
      <Card>
        <CardHeader>
          <CardTitle>Flaky Tests</CardTitle>
          <CardDescription>
            Ranked by failure rate (tests with both pass and fail results)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FlakyTestsTable data={flakyTests} />
        </CardContent>
      </Card>
    </div>
  );
}

function FlakyTestsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-1 h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-[140px]" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Skeleton key={i} className="h-9 w-[160px]" />
        ))}
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
    </div>
  );
}
