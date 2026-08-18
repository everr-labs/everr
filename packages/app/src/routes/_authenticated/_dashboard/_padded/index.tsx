import { withTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ServicesSection } from "@/components/home/services-section";
import {
  ConnectGithubCard,
  InstallEverrCard,
} from "@/components/home/setup-cards";
import {
  compactNumber,
  StatSection,
  StatTile,
} from "@/components/home/stat-tile";
import { costOverviewOptions } from "@/data/cost-analysis/options";
import { homeOverviewOptions } from "@/data/home/options";
import { getGithubAppInstallStatus } from "@/data/onboarding";
import { formatCost } from "@/lib/runner-pricing";
import { TimeRangeSearchSchema } from "@/lib/time-range";

const githubInstallStatusOptions = queryOptions({
  queryKey: ["github", "install-status"],
  queryFn: () => getGithubAppInstallStatus(),
  staleTime: 5 * 60_000,
});

export const Route = createFileRoute("/_authenticated/_dashboard/_padded/")({
  staticData: { breadcrumb: "Home" },
  head: () => ({
    meta: [{ title: "Everr - Home" }],
  }),
  validateSearch: TimeRangeSearchSchema,
  loaderDeps: ({ search }) => withTimeRange(search),
  loader: async ({ context: { queryClient }, deps }) => {
    const input = { timeRange: deps.timeRange };
    await Promise.all([
      queryClient.prefetchQuery(homeOverviewOptions(input)),
      queryClient.prefetchQuery(costOverviewOptions(input)),
      queryClient.prefetchQuery(githubInstallStatusOptions),
    ]);
  },
  component: HomePage,
});

/**
 * A duration in whichever single unit reads best, spelled out: "970
 * milliseconds", "6.2 minutes". The tile has room for words, and the compact
 * `6m 12s` form used in dense run and span lists reads oddly on its own.
 */
function formatDurationLong(ms: number): string {
  const [unit, value] =
    ms < 1000
      ? (["millisecond", ms] as const)
      : ms < 60000
        ? (["second", ms / 1000] as const)
        : (["minute", ms / 60000] as const);
  return new Intl.NumberFormat("en-US", {
    style: "unit",
    unit,
    unitDisplay: "long",
    maximumFractionDigits: 1,
  }).format(value);
}

function HomePage() {
  const { timeRange } = Route.useLoaderDeps();
  const input = { timeRange };
  const { data: overview } = useQuery(homeOverviewOptions(input));
  const { data: cost } = useQuery(costOverviewOptions(input));
  const { data: installations } = useQuery(githubInstallStatusOptions);

  const githubInstalled = installations?.some((i) => i.installed) ?? true;

  return (
    <div className="space-y-6">
      <InstallEverrCard />

      <StatSection label="Telemetry">
        <StatTile
          label="Logs"
          to="/logs"
          value={overview && compactNumber.format(overview.logs.total)}
          series={overview?.logs.series}
          color="var(--chart-2)"
        />
        <StatTile
          label="Traces"
          to="/traces"
          value={overview && compactNumber.format(overview.traces.total)}
          series={overview?.traces.series}
          color="var(--chart-1)"
        />
        <StatTile
          label="Error issues"
          to="/errors"
          value={overview && compactNumber.format(overview.errors.issues)}
          series={overview?.errors.series}
          color="var(--destructive)"
        />
      </StatSection>

      <ServicesSection services={overview?.services} />

      <StatSection label="CI/CD">
        {githubInstalled ? (
          <>
            <StatTile
              label="Workflow runs"
              to="/runs"
              value={overview && compactNumber.format(overview.ci.totalRuns)}
              series={overview?.ci.series}
              color="var(--chart-4)"
            />
            <StatTile
              label="CI time per PR"
              to="/runs"
              value={
                overview &&
                (overview.ci.prMedianTotalTimeMs > 0
                  ? formatDurationLong(overview.ci.prMedianTotalTimeMs)
                  : "No PR runs")
              }
            />
            <StatTile
              label="Estimated cost"
              to="/cost-analysis"
              value={cost && formatCost(cost.summary.totalCost)}
            />
          </>
        ) : (
          <ConnectGithubCard />
        )}
      </StatSection>
    </div>
  );
}
