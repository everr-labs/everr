import { ErrorIssueSearchSchema, ErrorIssues } from "@everr/telemetry-explorer/errors";
import { ExploreSearchShape } from "@everr/telemetry-explorer/filters";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { createFileRoute, Link, stripSearchParams, useSearch } from "@tanstack/react-router";
import { ExplorePersistentFilters } from "#app/components/explore-persistent-filters.tsx";
import { remoteErrorsRepo } from "#app/data/errors/remote-repo.ts";

const RouteSearchSchema = ErrorIssueSearchSchema.extend(ExploreSearchShape);
const defaultSearch = RouteSearchSchema.parse({});

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/errors",
)({
  staticData: { breadcrumb: "Errors" },
  validateSearch: RouteSearchSchema,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  head: () => ({ meta: [{ title: "Everr - Errors" }] }),
  component: ErrorsPage,
});

function ErrorsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore",
  });
  const { timeRange, q, fingerprint, sort, attributes } = withTimeRange(search);

  return (
    <ErrorIssues
      repo={remoteErrorsRepo}
      timeRange={timeRange}
      search={{ q, service, fingerprint, sort, attributes }}
      environment={environment}
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={(patch) =>
        // Push a history entry per change so Back undoes filter changes one at a
        // time (including Clear page filters, which routes through this same
        // handler).
        void navigate({
          search: (prev) => ({ ...prev, ...patch }),
        })
      }
      renderIssueLink={({ fingerprint: issueFingerprint, className, children }) => (
        <Link
          to="/errors/$fingerprint"
          params={{ fingerprint: issueFingerprint }}
          search={{ ...search, occurrence: "" }}
          className={className}
        >
          {children}
        </Link>
      )}
    />
  );
}
