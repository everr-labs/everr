import { ExploreGlobalFilters } from "@everr/telemetry-explorer/filters";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  createFileRoute,
  Outlet,
  useMatches,
  useNavigate,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { remoteRepo } from "@/data/logs-explorer/remote-repo";
import { remoteTracesRepo } from "@/data/traces/remote-repo";
import { ExploreSearchSchema } from "@/lib/explore-search";

export const Route = createFileRoute("/_authenticated/_dashboard/_explore")({
  validateSearch: ExploreSearchSchema,
  // service/environment retain + strip is handled on the `_dashboard` layout, not
  // here. Search middlewares run leaf→root, so the `_dashboard` retain runs AFTER
  // any strip declared on this route — which re-injects a just-cleared filter from
  // the previous location. Keeping both on `_dashboard` (retain then strip) lets a
  // cleared `[]` survive retain and then get stripped as a default last of all.
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
  // Optional in the schema (see ExploreSearchShape) so absence stays meaningful
  // for retainSearchParams; coalesce to [] for the presentational filters.
  const { service = [], environment = [] } = Route.useSearch();
  // useNavigate() (unbound) keeps navigation on the current path.
  // Route.useNavigate() binds from: "/" (the pathless layout's fullPath) and
  // would redirect every search-only update to the homepage.
  const navigate = useNavigate();
  const dashSearch = useSearch({ from: "/_authenticated/_dashboard" });
  const { timeRange } = withTimeRange(dashSearch);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const domain = domainFromPath(pathname);

  const matches = useMatches();
  let hideExploreBar = false;
  for (const match of matches) {
    if (match.staticData?.hideExploreBar !== undefined) {
      hideExploreBar = match.staticData.hideExploreBar;
    }
  }

  // Each filter mutation pushes a history entry so Back steps through filter
  // states one change at a time (matching the per-page filters and Clear all).
  const onServiceChange = (next: string[]) =>
    navigate({
      // @ts-expect-error -- route-agnostic navigation; useNavigate() can't infer search params without route context
      search: (prev: Record<string, unknown>) => ({ ...prev, service: next }),
    });
  const onEnvironmentChange = (next: string[]) =>
    navigate({
      // @ts-expect-error -- route-agnostic navigation; useNavigate() can't infer search params without route context
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        environment: next,
      }),
    });

  const showBar = !hideExploreBar && domain !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showBar ? (
        <div className="flex h-12 items-center justify-start gap-2 border-b border-sidebar-border bg-sidebar px-3">
          {/* One filter bar for every Explore view: the Service/Environment
              options are the union across logs + traces, so they no longer
              depend on which domain you are currently looking at. */}
          <ExploreGlobalFilters
            logsRepo={remoteRepo}
            tracesRepo={remoteTracesRepo}
            timeRange={timeRange}
            service={service}
            environment={environment}
            onServiceChange={onServiceChange}
            onEnvironmentChange={onEnvironmentChange}
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
