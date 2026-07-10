import {
  ErrorDetail,
  type ErrorIssueSearch,
  type ErrorOccurrence,
  ErrorTracePanel,
  type ErrorTriageActions,
  getErrorOccurrenceKey,
} from "@everr/telemetry-explorer/errors";
import { buttonVariants } from "@everr/ui/components/button";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { remoteErrorsRepo } from "@/data/errors/remote-repo";
import {
  createErrorInvestigation,
  createErrorStatusEvent,
  deleteErrorInvestigation,
  updateErrorInvestigation,
} from "@/data/errors/server";
import { runSpansOptions } from "@/data/runs/options";
import { authClient } from "@/lib/auth-client";

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
  const { timeRange, service, refresh } = withTimeRange(search);
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user.id ?? "";

  // The timeline renders once the session user is known; the server enforces
  // author-only writes regardless.
  const triage = useMemo<ErrorTriageActions | undefined>(
    () =>
      currentUserId
        ? {
            currentUserId,
            createInvestigation: (input) =>
              createErrorInvestigation({ data: input }),
            updateInvestigation: (input) =>
              updateErrorInvestigation({ data: input }),
            deleteInvestigation: (input) =>
              deleteErrorInvestigation({ data: input }),
            createStatusEvent: (input) =>
              createErrorStatusEvent({ data: input }),
          }
        : undefined,
    [currentUserId],
  );

  return (
    <ErrorDetail
      repo={remoteErrorsRepo}
      fingerprint={fingerprint}
      timeRange={timeRange}
      refresh={refresh ?? "off"}
      service={service}
      occurrence={search.occurrence}
      onBack={onBack}
      onClose={onClose}
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
      triage={triage}
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
