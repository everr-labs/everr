import { ExploreSearchShape } from "@everr/telemetry-explorer/filters";
import {
  ProfilesExplorer,
  ProfilesRepository,
  RuntimeMetricsRepository,
  type ProfilesSearchParams,
  ProfilesSearchParamsSchema,
} from "@everr/telemetry-explorer/profiles";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ExploreShell } from "../explore/explore-shell";
import { ExplorePersistentFilters } from "../explore/persistent-filters";
import { useExploreControls } from "../explore/use-explore-controls";
import { LocalTelemetryGate } from "../local-telemetry/collector-status";
import { localSqlClient } from "../logs/local-sql-client";

// service/environment are shared with the other Explore pages, so the route
// schema keeps them when moving between pages.
export const ProfilesSearchSchema = ProfilesSearchParamsSchema.extend(ExploreSearchShape);

const localProfilesRepo = new ProfilesRepository(localSqlClient);
const localRuntimeMetricsRepo = new RuntimeMetricsRepository(localSqlClient);

export function ProfilesPage() {
  const search: Partial<ProfilesSearchParams> & { service?: string[]; environment?: string[] } =
    useSearch({ strict: false });
  const navigate = useNavigate();
  const controls = useExploreControls("/profiles");
  const { timeRange } = withTimeRange(search);
  const refresh = search.refresh ?? "";
  const service = search.service ?? [];
  const environment = search.environment ?? [];

  return (
    <ExploreShell title="Profiles" timeRange={timeRange} refresh={refresh} {...controls}>
      <LocalTelemetryGate>
        <ProfilesExplorer
          repo={localProfilesRepo}
          runtimeRepo={localRuntimeMetricsRepo}
          timeRange={timeRange}
          refresh={refresh}
          search={{
            service,
            q: search.q ?? "",
            sampleType: search.sampleType,
            sampleUnit: search.sampleUnit,
            traceId: search.traceId,
            spanId: search.spanId,
            attributes: search.attributes ?? [],
            showVolume: search.showVolume ?? true,
            compare: search.compare,
            baseFrom: search.baseFrom,
            baseTo: search.baseTo,
            version: search.version,
            baseVersion: search.baseVersion,
            fn: search.fn,
          }}
          environment={environment}
          persistentFilters={
            <ExplorePersistentFilters
              to="/profiles"
              timeRange={timeRange}
              service={service}
              environment={environment}
            />
          }
          // oxlint-disable-next-line typescript/no-misused-promises -- Preserve the existing async callback and its promise result; the caller already controls its use.
          onSearchChange={(patch) =>
            navigate({
              to: "/profiles",
              search: (prev) => ({ ...prev, ...patch }),
              replace: true,
            })
          }
          renderTraceLink={({ traceId, spanId, className, children }) => (
            <Link
              to="/traces/$traceId"
              params={{ traceId }}
              search={{ span: spanId || undefined }}
              className={className}
            >
              {children}
            </Link>
          )}
          // oxlint-disable-next-line typescript/no-misused-promises -- Preserve the existing async callback and its promise result; the caller already controls its use.
          onTimeRangeSelect={(from, to) =>
            navigate({
              to: "/profiles",
              search: (prev) => ({ ...prev, from: from.toISOString(), to: to.toISOString() }),
              replace: true,
            })
          }
        />
      </LocalTelemetryGate>
    </ExploreShell>
  );
}
