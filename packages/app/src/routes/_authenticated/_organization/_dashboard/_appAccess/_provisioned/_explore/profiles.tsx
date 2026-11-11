import { ExploreSearchShape } from "@everr/telemetry-explorer/filters";
import { ProfilesExplorer, ProfilesSearchParamsSchema } from "@everr/telemetry-explorer/profiles";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { createFileRoute, Link, stripSearchParams, useSearch } from "@tanstack/react-router";
import { ExplorePersistentFilters } from "#app/components/explore-persistent-filters.tsx";
import { remoteProfilesRepo } from "#app/data/profiles/remote-repo.ts";
import { remoteRuntimeMetricsRepo } from "#app/data/profiles/runtime.ts";

// service/environment live on the shared _explore layout but must also be in
// the child schema so the leaf route's validateSearch doesn't strip them.
const RouteSearchSchema = ProfilesSearchParamsSchema.extend(ExploreSearchShape);

// Keep the URL clean: validation fills in defaults, which would otherwise be
// written back into the query string on every navigation.
const defaultSearch = RouteSearchSchema.parse({});

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/profiles",
)({
  staticData: { breadcrumb: "Profiles" },
  validateSearch: RouteSearchSchema,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  head: () => ({ meta: [{ title: "Everr - Profiles" }] }),
  component: ProfilesPage,
});

function ProfilesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange } = withTimeRange(search);
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore",
  });

  return (
    <ProfilesExplorer
      repo={remoteProfilesRepo}
      runtimeRepo={remoteRuntimeMetricsRepo}
      timeRange={timeRange}
      refresh={search.refresh ?? "off"}
      search={{
        service,
        q: search.q,
        sampleType: search.sampleType,
        sampleUnit: search.sampleUnit,
        traceId: search.traceId,
        spanId: search.spanId,
        attributes: search.attributes,
        showVolume: search.showVolume,
        compare: search.compare,
        baseFrom: search.baseFrom,
        baseTo: search.baseTo,
        version: search.version,
        baseVersion: search.baseVersion,
        fn: search.fn,
      }}
      environment={environment}
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={(patch) =>
        // One history entry per change, so Back undoes filter changes one at a time.
        void navigate({ search: (prev) => ({ ...prev, ...patch }) })
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
      onTimeRangeSelect={(from, to) =>
        void navigate({
          search: (prev) => ({ ...prev, from: from.toISOString(), to: to.toISOString() }),
        })
      }
    />
  );
}
