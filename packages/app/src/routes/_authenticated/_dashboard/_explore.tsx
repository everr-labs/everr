import { ErrorsExploreFilters } from "@everr/telemetry-explorer/errors";
import { LogsExploreFilters } from "@everr/telemetry-explorer/logs";
import { TracesExploreFilters } from "@everr/telemetry-explorer/traces";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  createFileRoute,
  Outlet,
  retainSearchParams,
  stripSearchParams,
  useMatches,
  useNavigate,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { remoteErrorsRepo } from "@/data/errors/remote-repo";
import { remoteRepo } from "@/data/logs-explorer/remote-repo";
import { remoteTracesRepo } from "@/data/traces/remote-repo";

const ExploreSearchSchema = z.object({
  service: z.array(z.string()).catch([]).default([]),
  environment: z.array(z.string()).catch([]).default([]),
});

const exploreDefaults = ExploreSearchSchema.parse({});

export const Route = createFileRoute("/_authenticated/_dashboard/_explore")({
  validateSearch: ExploreSearchSchema,
  search: {
    middlewares: [
      stripSearchParams(exploreDefaults),
      retainSearchParams(["service", "environment"]),
    ],
  },
  component: ExploreLayout,
});

type ExploreDomain = "logs" | "errors" | "traces";

function domainFromPath(pathname: string): ExploreDomain | null {
  if (pathname.startsWith("/logs")) return "logs";
  if (pathname.startsWith("/errors")) return "errors";
  if (pathname.startsWith("/traces")) return "traces";
  return null;
}

function ExploreLayout() {
  const { service, environment } = Route.useSearch();
  // useNavigate() (unbound) keeps navigation on the current path.
  // Route.useNavigate() binds from: "/" (the pathless layout's fullPath) and
  // would redirect every search-only update to the homepage.
  const navigate = useNavigate();
  const dashSearch = useSearch({ from: "/_authenticated/_dashboard" });
  const { timeRange } = withTimeRange(dashSearch);
  const refresh = dashSearch.refresh ?? "off";

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const domain = domainFromPath(pathname);

  const matches = useMatches();
  let hideExploreBar = false;
  for (const match of matches) {
    if (match.staticData?.hideExploreBar !== undefined) {
      hideExploreBar = match.staticData.hideExploreBar;
    }
  }

  const onServiceChange = (next: string[]) =>
    navigate({
      // @ts-expect-error -- route-agnostic navigation; useNavigate() can't infer search params without route context
      search: (prev: Record<string, unknown>) => ({ ...prev, service: next }),
      replace: true,
    });
  const onEnvironmentChange = (next: string[]) =>
    navigate({
      // @ts-expect-error -- route-agnostic navigation; useNavigate() can't infer search params without route context
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        environment: next,
      }),
      replace: true,
    });

  const showBar = !hideExploreBar && domain !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showBar ? (
        <div className="flex h-12 items-center justify-end gap-2 border-b border-sidebar-border bg-sidebar px-3">
          {domain === "logs" ? (
            <LogsExploreFilters
              repo={remoteRepo}
              timeRange={timeRange}
              service={service}
              environment={environment}
              onServiceChange={onServiceChange}
              onEnvironmentChange={onEnvironmentChange}
            />
          ) : null}
          {domain === "errors" ? (
            <ErrorsExploreFilters
              repo={remoteErrorsRepo}
              timeRange={timeRange}
              refresh={refresh}
              service={service}
              environment={environment}
              onServiceChange={onServiceChange}
              onEnvironmentChange={onEnvironmentChange}
            />
          ) : null}
          {domain === "traces" ? (
            <TracesExploreFilters
              repo={remoteTracesRepo}
              timeRange={timeRange}
              refresh={refresh}
              service={service}
              environment={environment}
              onServiceChange={onServiceChange}
              onEnvironmentChange={onEnvironmentChange}
            />
          ) : null}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
