import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatch,
} from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ErrorFilters,
  ErrorSearchForm,
} from "@/components/errors/error-filters";
import { ErrorIssueList } from "@/components/errors/error-issue-list";
import {
  errorIssuesInfiniteOptions,
  errorServicesOptions,
} from "@/data/errors/options";
import { ErrorIssueSearchSchema, PAGE_SIZE } from "@/data/errors/schemas";
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
  const { timeRange, q, service, fingerprint, sort, refresh } =
    withTimeRange(search);
  const refreshValue = refresh ?? "";

  const issuesQuery = useInfiniteQuery({
    ...errorIssuesInfiniteOptions({
      searchErrorIssues,
      timeRange,
      refresh: refreshValue,
      q,
      service,
      fingerprint,
      sort,
      limit: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });
  const issues = useMemo(
    () => (issuesQuery.data?.pages ?? []).flatMap((p) => p.issues),
    [issuesQuery.data],
  );
  const servicesQuery = useQuery(
    errorServicesOptions({
      listErrorServices,
      timeRange,
      refresh: refreshValue,
    }),
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b bg-muted/10 px-3 py-2">
          <ErrorSearchForm
            value={q}
            onChange={(nextQ) =>
              navigate({
                search: (prev) => ({ ...prev, q: nextQ }),
                replace: true,
              })
            }
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <ErrorFilters
            value={{ q, service, fingerprint, sort }}
            services={servicesQuery.data ?? []}
            onChange={(patch) =>
              navigate({
                search: (prev) => ({ ...prev, ...patch }),
                replace: true,
              })
            }
          />
          <main className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 flex-col">
              <ErrorIssueList
                issues={issues}
                isPending={issuesQuery.isPending}
                isError={issuesQuery.isError}
                onRetry={() => issuesQuery.refetch()}
                hasNextPage={issuesQuery.hasNextPage}
                isFetchingNextPage={issuesQuery.isFetchingNextPage}
                onLoadMore={() => issuesQuery.fetchNextPage()}
                renderIssueLink={({
                  fingerprint: issueFingerprint,
                  children,
                }) => (
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
          </main>
        </div>
      </section>
    </div>
  );
}
