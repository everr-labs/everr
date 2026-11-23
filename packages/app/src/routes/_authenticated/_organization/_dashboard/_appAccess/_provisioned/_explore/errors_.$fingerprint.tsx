import {
  ErrorDetail,
  type ErrorOccurrence,
  ErrorIssueSearchSchema,
  ErrorTracePanel,
  getErrorOccurrenceKey,
} from "@everr/telemetry-explorer/errors";
import { buttonVariants } from "@everr/ui/components/button";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, stripSearchParams } from "@tanstack/react-router";
import { remoteErrorsRepo } from "#app/data/errors/remote-repo.ts";
import { runSpansOptions } from "#app/data/runs/options.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/errors_/$fingerprint",
)({
  staticData: { breadcrumb: "Detail", hideExploreBar: true },
  validateSearch: ErrorIssueSearchSchema,
  search: { middlewares: [stripSearchParams(ErrorIssueSearchSchema.parse({}))] },
  head: () => ({ meta: [{ title: "Everr - Error detail" }] }),
  component: ErrorDetailPage,
});

function ErrorDetailPage() {
  const { fingerprint } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange, service } = withTimeRange(search);

  return (
    <ErrorDetail
      repo={remoteErrorsRepo}
      fingerprint={fingerprint}
      timeRange={timeRange}
      service={service}
      occurrence={search.occurrence}
      onBack={() =>
        void navigate({
          to: "/errors",
          search: { ...search, occurrence: "" },
        })
      }
      renderOccurrenceLink={({ occurrence: linkedOccurrence, label, className, children }) => (
        <Link
          to="/errors/$fingerprint"
          params={{ fingerprint }}
          search={{
            ...search,
            occurrence: getErrorOccurrenceKey(linkedOccurrence),
          }}
          // A step of the pager replaces the history entry, so that Back
          // leaves the Error and does not go through each occurrence again.
          replace
          aria-label={label}
          title={label}
          className={className}
        >
          {children}
        </Link>
      )}
      renderTracePanel={({ occurrence }) => <WebErrorTracePanel occurrence={occurrence} />}
    />
  );
}

function WebErrorTracePanel({ occurrence }: { occurrence: ErrorOccurrence }) {
  const hasTrace = occurrence.traceId.length > 0;
  const spansQuery = useQuery({
    ...runSpansOptions(occurrence.traceId),
    enabled: hasTrace,
    // Occurrences of one error tend to share a shape, so the list changes in
    // place instead of collapsing and regrowing.
    placeholderData: keepPreviousData,
  });
  const spans = (spansQuery.data ?? []).map((span) => ({
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    durationMs: span.duration,
    conclusion: span.conclusion,
    jobName: span.jobName,
  }));

  return (
    <ErrorTracePanel
      occurrence={occurrence}
      spans={spans}
      isPending={spansQuery.isPending && hasTrace}
      isError={spansQuery.isError}
      isStale={spansQuery.isPlaceholderData}
      onRetry={() => void spansQuery.refetch()}
      renderTraceLink={({ traceId, spanId, children }) => (
        <Link
          to="/traces/$traceId"
          params={{ traceId }}
          search={{ span: spanId || undefined }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {children}
        </Link>
      )}
    />
  );
}
