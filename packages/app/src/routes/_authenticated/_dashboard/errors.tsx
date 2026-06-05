import {
  ErrorIssueSearchSchema,
  ErrorIssues,
} from "@everr/telemetry-explorer/errors";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  createFileRoute,
  Link,
  Outlet,
  stripSearchParams,
} from "@tanstack/react-router";
import { remoteErrorsRepo } from "@/data/errors/remote-repo";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";

const defaultSearch = ErrorIssueSearchSchema.parse({});

export const Route = createFileRoute("/_authenticated/_dashboard/errors")({
  staticData: { breadcrumb: "Errors", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Errors" }] }),
  validateSearch: ErrorIssueSearchSchema,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  component: ErrorsRoute,
});

function ErrorsRoute() {
  // Always keep the list mounted in the same position so opening/closing the
  // modal never remounts it (a remount resets the virtualized list and re-runs
  // queries, which shows up as a flash on close).
  return (
    <>
      <ErrorsPage />
      <Outlet />
    </>
  );
}

function ErrorsPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange, q, service, fingerprint, sort, refresh, attributes } =
    withTimeRange(search);

  return (
    <ErrorIssues
      repo={remoteErrorsRepo}
      timeRange={timeRange}
      refresh={refresh ?? ""}
      search={{ q, service, fingerprint, sort, attributes }}
      onSearchChange={(patch) =>
        navigate({
          search: (prev) => ({ ...prev, ...patch }),
          replace: true,
        })
      }
      renderIssueLink={({ fingerprint: issueFingerprint, children }) => (
        <Link
          to="/errors/$fingerprint/modal"
          params={{ fingerprint: issueFingerprint }}
          search={{ ...search, occurrence: "" }}
          className="block text-foreground no-underline"
        >
          {children}
        </Link>
      )}
    />
  );
}
