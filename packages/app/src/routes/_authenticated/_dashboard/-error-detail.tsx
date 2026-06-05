import {
  ErrorDetail,
  type ErrorIssueSearch,
  type ErrorOccurrence,
  ErrorTracePanel,
  getErrorOccurrenceKey,
} from "@everr/telemetry-explorer/errors";
import { buttonVariants } from "@everr/ui/components/button";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { remoteErrorsRepo } from "@/data/errors/remote-repo";
import { runSpansOptions } from "@/data/runs/options";

export function ErrorDetailRouteContent({
  fingerprint,
  search,
  detailTo,
  onBack,
}: {
  fingerprint: string;
  search: ErrorIssueSearch;
  detailTo: "/errors/$fingerprint" | "/errors/$fingerprint/modal";
  onBack: () => void;
}) {
  const { timeRange, service, refresh } = withTimeRange(search);

  return (
    <ErrorDetail
      repo={remoteErrorsRepo}
      fingerprint={fingerprint}
      timeRange={timeRange}
      refresh={refresh ?? ""}
      service={service}
      occurrence={search.occurrence}
      onBack={onBack}
      renderOccurrenceLink={({
        occurrence: linkedOccurrence,
        children,
        isSelected,
      }) => (
        <Link
          to={detailTo}
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
      renderTracePanel={({ occurrence }) => (
        <WebErrorTracePanel occurrence={occurrence} />
      )}
    />
  );
}

function WebErrorTracePanel({ occurrence }: { occurrence: ErrorOccurrence }) {
  const hasTrace = occurrence.traceId.length > 0;
  const spansQuery = useQuery({
    ...runSpansOptions(occurrence.traceId),
    enabled: hasTrace,
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
      onRetry={() => void spansQuery.refetch()}
      renderTraceLink={({ traceId, spanId, start, end, children }) => (
        <Link
          to="/traces/$traceId"
          params={{ traceId }}
          search={{ span: spanId || undefined, start, end }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {children}
        </Link>
      )}
    />
  );
}
