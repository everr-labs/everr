import { LogsExploreFilters } from "@everr/telemetry-explorer/logs";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  createFileRoute,
  Outlet,
  retainSearchParams,
  useMatches,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { remoteRepo } from "@/data/logs-explorer/remote-repo";

const ExploreSearchSchema = z.object({
  service: z.array(z.string()).default([]),
  environment: z.array(z.string()).default([]),
});

export const Route = createFileRoute("/_authenticated/_dashboard/_explore")({
  validateSearch: ExploreSearchSchema,
  search: {
    middlewares: [retainSearchParams(["service", "environment"])],
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
  const navigate = Route.useNavigate();
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

  const onServiceChange = (next: string[]) =>
    navigate({ search: (prev) => ({ ...prev, service: next }), replace: true });
  const onEnvironmentChange = (next: string[]) =>
    navigate({
      search: (prev) => ({ ...prev, environment: next }),
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
          {/* errors branch added in Task 5 */}
          {/* traces branch added in Task 6 */}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
