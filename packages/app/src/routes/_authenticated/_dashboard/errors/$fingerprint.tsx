import { Button, buttonVariants } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { ErrorDetailHeader } from "@/components/errors/error-detail-header";
import { ErrorLatestOccurrence } from "@/components/errors/error-latest-occurrence";
import { ErrorOccurrencesList } from "@/components/errors/error-occurrences-list";
import { ErrorStacktrace } from "@/components/errors/error-stacktrace";
import { TraceLink } from "@/components/errors/trace-link";
import { errorIssueOptions } from "@/data/errors/options";
import { ErrorIssueSearchSchema } from "@/data/errors/schemas";
import { getErrorIssue } from "@/data/errors/server";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/errors/$fingerprint",
)({
  staticData: { breadcrumb: "Error", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Error detail" }] }),
  validateSearch: ErrorIssueSearchSchema,
  component: ErrorDetailPage,
});

function ErrorDetailPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const { fingerprint } = Route.useParams();
  const search = Route.useSearch();
  const { timeRange, service, refresh } = withTimeRange(search);
  const refreshValue = refresh ?? "";
  const issueQuery = useQuery(
    errorIssueOptions({
      getErrorIssue,
      fingerprint,
      timeRange,
      refresh: refreshValue,
      service,
      occurrenceLimit: 50,
    }),
  );

  if (issueQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-3 py-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="mt-2 h-3 w-96 max-w-full" />
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (issueQuery.isError || !issueQuery.data) {
    return (
      <Empty className="min-h-96 border-0">
        <EmptyHeader>
          <EmptyTitle>Failed to load error</EmptyTitle>
          <EmptyDescription>
            {issueQuery.error?.message ?? "The selected error was not found."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => issueQuery.refetch()}
            >
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
            <Link
              to="/errors"
              search={search}
              className={buttonVariants({ variant: "outline" })}
            >
              Back to errors
            </Link>
          </div>
        </EmptyContent>
      </Empty>
    );
  }

  const detail = issueQuery.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ErrorDetailHeader issue={detail.summary} backSearch={search} />
      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <main className="grid min-w-0 content-start gap-3">
          <ErrorLatestOccurrence occurrence={detail.latest} />
          <ErrorStacktrace stacktrace={detail.latest.exceptionStacktrace} />
        </main>
        <aside className="min-w-0">
          <ErrorOccurrencesList
            occurrences={detail.occurrences}
            renderTraceLink={({ occurrence, children }) => (
              <TraceLink occurrence={occurrence}>{children}</TraceLink>
            )}
          />
        </aside>
      </div>
    </div>
  );
}
