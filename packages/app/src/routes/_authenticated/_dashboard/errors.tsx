import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatch,
} from "@tanstack/react-router";
import { ErrorFilters } from "@/components/errors/error-filters";
import { ErrorIssueList } from "@/components/errors/error-issue-list";
import { Pagination } from "@/components/runs-list/pagination";
import {
  errorIssuesOptions,
  errorServicesOptions,
} from "@/data/errors/options";
import { ErrorIssueSearchSchema } from "@/data/errors/schemas";
import { listErrorServices, searchErrorIssues } from "@/data/errors/server";
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
  const { timeRange, q, service, fingerprint, sort, page, limit, refresh } =
    withTimeRange(search);
  const refreshValue = refresh ?? "";
  const offset = (page - 1) * limit;

  const issuesQuery = useQuery(
    errorIssuesOptions({
      searchErrorIssues,
      timeRange,
      refresh: refreshValue,
      q,
      service,
      fingerprint,
      sort,
      limit,
      offset,
    }),
  );
  const servicesQuery = useQuery(
    errorServicesOptions({
      listErrorServices,
      timeRange,
      refresh: refreshValue,
    }),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Errors</h1>
          <p className="truncate text-xs text-muted-foreground">
            Grouped exception logs
          </p>
        </div>
      </div>
      <ErrorFilters
        value={{ q, service, fingerprint, sort, limit }}
        services={servicesQuery.data ?? []}
        onChange={(patch) =>
          navigate({
            search: (prev) => ({ ...prev, ...patch, page: 1 }),
            replace: true,
          })
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <ErrorIssueList
          issues={issuesQuery.data?.issues ?? []}
          isPending={issuesQuery.isPending}
          isError={issuesQuery.isError}
          onRetry={() => issuesQuery.refetch()}
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
      </div>
      {issuesQuery.data ? (
        <div className="border-t px-3 py-2">
          <Pagination
            page={page}
            totalCount={issuesQuery.data.totalCount}
            pageSize={limit}
            itemLabel="errors"
            onPageChange={(nextPage) =>
              navigate({
                search: (prev) => ({ ...prev, page: nextPage }),
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}
