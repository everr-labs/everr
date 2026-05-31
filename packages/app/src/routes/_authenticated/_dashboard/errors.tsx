import {
  ErrorIssueSearchSchema,
  ErrorIssues,
} from "@everr/telemetry-explorer/errors";
import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatch,
} from "@tanstack/react-router";
import { remoteErrorsRepo } from "@/data/errors/remote-repo";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";

export const Route = createFileRoute("/_authenticated/_dashboard/errors")({
  staticData: { breadcrumb: "Errors", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Errors" }] }),
  validateSearch: ErrorIssueSearchSchema,
  component: ErrorsRoute,
});

function ErrorsRoute() {
  const errorDetailMatch = useMatch({
    from: "/_authenticated/_dashboard/errors/$fingerprint",
    shouldThrow: false,
  });
  return errorDetailMatch ? <Outlet /> : <ErrorsPage />;
}

function ErrorsPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange, q, service, fingerprint, sort, refresh } =
    withTimeRange(search);

  return (
    <ErrorIssues
      repo={remoteErrorsRepo}
      timeRange={timeRange}
      refresh={refresh ?? ""}
      search={{ q, service, fingerprint, sort }}
      onSearchChange={(patch) =>
        navigate({
          search: (prev) => ({ ...prev, ...patch }),
          replace: true,
        })
      }
      renderIssueLink={({ fingerprint: issueFingerprint, children }) => (
        <Link
          to="/errors/$fingerprint"
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
