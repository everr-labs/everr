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
import {
  findErrorOccurrenceByKey,
  getErrorOccurrenceKey,
} from "@/components/errors/error-occurrence-key";
import { ErrorOccurrencesList } from "@/components/errors/error-occurrences-list";
import { ErrorStacktrace } from "@/components/errors/error-stacktrace";
import { ErrorTracePanel } from "@/components/errors/error-trace-panel";
import { errorIssueOptions } from "@/data/errors/options";
import { ErrorIssueSearchSchema } from "@/data/errors/schemas";
import { getErrorIssue } from "@/data/errors/server";
import { runSpansOptions } from "@/data/runs/options";
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
  const selectedOccurrence = issueQuery.data
    ? findErrorOccurrenceByKey(issueQuery.data.occurrences, search.occurrence)
    : undefined;
  const selectedTraceId = selectedOccurrence?.traceId ?? "";
  const spansQuery = useQuery({
    ...runSpansOptions(selectedTraceId),
    enabled: issueQuery.isSuccess && selectedTraceId.length > 0,
  });

  if (issueQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-3 py-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="mt-2 h-3 w-96 max-w-full" />
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3">
          <Skeleton className="h-96" />
          <Skeleton className="h-64" />
          <Skeleton className="h-80" />
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
  const occurrence = selectedOccurrence ?? detail.latest;
  const selectedOccurrenceKey = getErrorOccurrenceKey(occurrence);
  const backSearch = { ...search, occurrence: "" };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ErrorDetailHeader issue={detail.summary} backSearch={backSearch} />
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid max-w-7xl gap-3 p-3">
          <ErrorStacktrace stacktrace={occurrence.exceptionStacktrace} />
          <ErrorTracePanel
            occurrence={occurrence}
            spans={spansQuery.data ?? []}
            isPending={spansQuery.isPending && selectedTraceId.length > 0}
            isError={spansQuery.isError}
            onRetry={() => void spansQuery.refetch()}
          />
          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <ErrorLatestOccurrence occurrence={occurrence} />
            <ErrorOccurrencesList
              occurrences={detail.occurrences}
              selectedOccurrenceKey={selectedOccurrenceKey}
              renderOccurrenceLink={({
                occurrence: linkedOccurrence,
                children,
                isSelected,
              }) => (
                <Link
                  to="/errors/$fingerprint"
                  params={{ fingerprint }}
                  search={{
                    ...search,
                    occurrence: getErrorOccurrenceKey(linkedOccurrence),
                  }}
                  aria-current={isSelected ? "page" : undefined}
                  className={buttonVariants({
                    variant: isSelected ? "secondary" : "outline",
                    size: "sm",
                  })}
                >
                  {children}
                </Link>
              )}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
