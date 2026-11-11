import { ProfilesExplorer } from "../../profiles";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { Link } from "@tanstack/react-router";
import { useRouteSearch, useSearchPatch } from "../../shell/search-io";
import { useExploreBackend } from "../backend";
import { profilesRoute } from "../routes";
import { ExplorePersistentFilters } from "./persistent-filters";

export function ProfilesRoute() {
  const { repos } = useExploreBackend();
  const search = useRouteSearch(profilesRoute.validateSearch);
  const patchSearch = useSearchPatch();
  const { timeRange } = withTimeRange(search);
  const { service = [], environment = [] } = search;

  return (
    <ProfilesExplorer
      repo={repos.profiles}
      runtimeRepo={repos.runtimeMetrics}
      timeRange={timeRange}
      refresh={search.refresh ?? ""}
      search={{ ...search, service }}
      environment={environment}
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={(patch) =>
        // One history entry per change, so Back undoes filter changes one at a time.
        patchSearch(patch)
      }
      renderTraceLink={({ traceId, spanId, className, children }) => (
        <Link
          to="/traces/$traceId"
          params={{ traceId }}
          search={spanId ? { span: spanId } : {}}
          className={className}
        >
          {children}
        </Link>
      )}
      onTimeRangeSelect={(from, to) =>
        patchSearch({ from: from.toISOString(), to: to.toISOString() })
      }
    />
  );
}
