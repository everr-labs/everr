import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { Skeleton } from "@everr/ui/components/skeleton";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { errorIssueOptions } from "../data/options";
import type { ErrorsRepositoryLike } from "../data/repository";
import type { ErrorOccurrence } from "../data/types";
import { ErrorAttributes } from "./error-attributes";
import { ErrorDetailHeader } from "./error-detail-header";
import { ErrorHandoffButton } from "./error-handoff-button";
import { ErrorOccurrenceBar, type RenderOccurrenceLink } from "./error-occurrence-bar";
import { findErrorOccurrenceByKey } from "./error-occurrence-key";
import { ErrorStacktrace } from "./error-stacktrace";

const OCCURRENCE_LIMIT = 50;

export type ErrorDetailProps = {
  repo: ErrorsRepositoryLike;
  fingerprint: string;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  /** Selected occurrence key (timestamp|rank), or "" for the latest. */
  occurrence: string;
  onBack?: () => void;
  onClose?: () => void;
  renderOccurrenceLink: RenderOccurrenceLink;
  /** App supplies the related-trace panel (it owns the spans source). */
  renderTracePanel?: (input: { occurrence: ErrorOccurrence }) => ReactNode;
};

export function ErrorDetail({
  repo,
  fingerprint,
  timeRange,
  refresh,
  service,
  occurrence,
  onBack,
  onClose,
  renderOccurrenceLink,
  renderTracePanel,
}: ErrorDetailProps) {
  const issueQuery = useQuery(
    errorIssueOptions(repo, {
      fingerprint,
      timeRange,
      refresh,
      service,
      occurrenceLimit: OCCURRENCE_LIMIT,
    }),
  );

  if (issueQuery.isPending) return <ErrorDetailSkeleton />;

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
              // oxlint-disable-next-line typescript/no-misused-promises -- Preserve the original callback promise result.
              onClick={() => issueQuery.refetch()}
            >
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
            {onBack && (
              <Button type="button" variant="outline" onClick={onBack}>
                Back to errors
              </Button>
            )}
          </div>
        </EmptyContent>
      </Empty>
    );
  }

  const detail = issueQuery.data;
  const selected = findErrorOccurrenceByKey(detail.occurrences, occurrence) ?? detail.latest;
  const message = selected.exceptionMessage || selected.body;
  const componentStack = selected.logAttributes["everr.react.component_stack"] ?? "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ErrorDetailHeader
        issue={detail.summary}
        message={message}
        onBack={onBack}
        onClose={onClose}
        actions={<ErrorHandoffButton issue={detail.summary} />}
      />
      <ErrorOccurrenceBar
        occurrences={detail.occurrences}
        selected={selected}
        totalCount={detail.summary.occurrenceCount}
        renderOccurrenceLink={renderOccurrenceLink}
      />
      <ScrollArea render={<main />} className="min-h-0 flex-1">
        {/* The column is centred inside a full-width scroller, so its width
            bound belongs to a child: on the viewport it would narrow the
            scrolling box itself and pull the scrollbar in with it. */}
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-5 pb-10">
          <ErrorStacktrace
            stacktrace={selected.exceptionStacktrace}
            message={selected.exceptionMessage}
            emptyText="This occurrence has no stack trace."
          />
          <ErrorStacktrace title="Component stack" stacktrace={componentStack} />
          {renderTracePanel?.({ occurrence: selected })}
          <ErrorAttributes occurrence={selected} />
        </div>
      </ScrollArea>
    </div>
  );
}

// The shape of the loaded page: the header, the occurrence bar, then the stack
// trace. The content does not move when the data arrives.
function ErrorDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-3">
        <Skeleton className="h-5 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        <Skeleton className="mt-4 h-3 w-[32rem] max-w-full" />
      </div>
      <div className="border-b px-4 py-2">
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 pt-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-48 w-full" />
      </div>
    </div>
  );
}
