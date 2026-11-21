import {
  ErrorDetail,
  type ErrorIssueSearch,
  type ErrorOccurrence,
  ErrorTracePanel,
  getErrorOccurrenceKey,
} from "@everr/telemetry-explorer/errors";
import { buttonVariants } from "@everr/ui/components/button";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { remoteErrorsRepo } from "#app/data/errors/remote-repo.ts";
import { runSpansOptions } from "#app/data/runs/options.ts";

export function ErrorDetailRouteContent({
  fingerprint,
  search,
  detailTo,
  onBack,
  onClose,
}: {
  fingerprint: string;
  search: ErrorIssueSearch;
  detailTo: "/errors/$fingerprint" | "/errors/$fingerprint/modal";
  onBack?: () => void;
  onClose?: () => void;
}) {
  const { timeRange, service } = withTimeRange(search);

  return (
    <ErrorDetail
      repo={remoteErrorsRepo}
      fingerprint={fingerprint}
      timeRange={timeRange}
      service={service}
      occurrence={search.occurrence}
      onBack={onBack}
      onClose={onClose}
      renderOccurrenceLink={({ occurrence: linkedOccurrence, label, className, children }) => (
        <Link
          to={detailTo}
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
    // Switching occurrence keeps the previous trace's spans, dimmed, until
    // this one's arrive: occurrences of one error tend to share a shape, so the
    // list changes in place instead of collapsing and regrowing.
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
