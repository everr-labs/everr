import { serviceColor } from "@everr/telemetry-explorer/traces";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Sparkline } from "@everr/ui/components/sparkline";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Download, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { INSTALL_COMMAND } from "@/common/install-command";
import { InstallCommandBlock } from "@/components/install-command-block";
import { costOverviewOptions } from "@/data/cost-analysis/options";
import { homeOverviewOptions } from "@/data/home/options";
import type { HomeService } from "@/data/home/server";
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

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

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

function StatSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
        {label}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function StatTile({
  label,
  to,
  value,
  series,
  color,
}: {
  label: string;
  to: string;
  value: string | undefined;
  series?: number[];
  color?: string;
}) {
  return (
    <Link to={to} className="block h-full">
      <Card className="group relative h-full gap-2 overflow-hidden py-4 transition-colors hover:bg-muted/30">
        {series?.some((v) => v > 0) && (
          <Sparkline
            data={series}
            color={color}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 opacity-20 transition-opacity group-hover:opacity-35"
          />
        )}
        <CardContent className="relative space-y-1 px-4">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              {label}
            </p>
            <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          {value === undefined ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums leading-8">
              {value}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function ServicesSection({
  services,
}: {
  services: HomeService[] | undefined;
}) {
  if (services && services.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
        Services
      </h2>
      <Card className="divide-border gap-0 divide-y py-0">
        {services === undefined
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))
          : services.map((service) => (
              <Link
                key={service.name}
                to="/traces"
                search={{ service: [service.name] }}
                className="hover:bg-muted/30 flex items-center gap-3 px-4 py-3 transition-colors"
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: serviceColor(service.name) }}
                />
                <span className="truncate text-sm font-medium">
                  {service.name}
                </span>
                <span className="flex-1" />
                <ServiceStat
                  value={compactNumber.format(service.logCount)}
                  label="logs"
                />
                <ServiceStat
                  value={compactNumber.format(service.traceCount)}
                  label="traces"
                />
                <ServiceStat
                  value={compactNumber.format(service.errorCount)}
                  label="errors"
                />
              </Link>
            ))}
      </Card>
    </section>
  );
}

function ServiceStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="w-20 text-right">
      <span className="block text-sm tabular-nums">{value}</span>
      <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
        {label}
      </span>
    </span>
  );
}

function ConnectGithubCard() {
  return (
    <Card className="sm:col-span-2 lg:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="size-4 text-primary" />
          Connect GitHub
        </CardTitle>
        <CardDescription>
          Install the Everr GitHub app to track workflow runs, test results, and
          CI cost for your repositories.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          render={
            <a href="/api/github/install/start" target="_blank" rel="noopener">
              Install GitHub app
              <ArrowUpRight className="size-4" />
            </a>
          }
        />
      </CardContent>
    </Card>
  );
}

function InstallEverrCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="size-4 text-primary" />
          Install Everr
        </CardTitle>
        <CardDescription>
          Get notified when CI fails, run queries from your terminal, and
          integrate with your coding assistant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <InstallCommandBlock command={INSTALL_COMMAND} />
      </CardContent>
    </Card>
  );
}
