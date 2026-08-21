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
import { ErrorDetailHeader } from "./error-detail-header";
import { ErrorHandoffButton } from "./error-handoff-button";
import { ErrorLatestOccurrence } from "./error-latest-occurrence";
import {
  findErrorOccurrenceByKey,
  getErrorOccurrenceKey,
} from "./error-occurrence-key";
import {
  ErrorOccurrencesList,
  type RenderOccurrenceLink,
} from "./error-occurrences-list";
import { ErrorStacktrace } from "./error-stacktrace";

const OCCURRENCE_LIMIT = 50;

export type ErrorDetailProps = {
  repo: ErrorsRepositoryLike;
  fingerprint: string;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  /** Selected occurrence key (timestamp|traceId|spanId), or "" for the latest. */
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

  if (issueQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-4 py-3">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="mt-2 h-3 w-96 max-w-full" />
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
  const selected =
    findErrorOccurrenceByKey(detail.occurrences, occurrence) ?? detail.latest;
  const selectedOccurrenceKey = getErrorOccurrenceKey(selected);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ErrorDetailHeader
        issue={detail.summary}
        onBack={onBack}
        onClose={onClose}
        actions={<ErrorHandoffButton issue={detail.summary} />}
      />
      <ScrollArea render={<main />} className="min-h-0 flex-1">
        <div className="mx-auto grid max-w-7xl gap-3 p-3">
          <ErrorStacktrace
            stacktrace={selected.exceptionStacktrace}
            message={selected.exceptionMessage}
          />
          {renderTracePanel?.({ occurrence: selected })}
          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <ErrorLatestOccurrence occurrence={selected} />
            <ErrorOccurrencesList
              occurrences={detail.occurrences}
              selectedOccurrenceKey={selectedOccurrenceKey}
              renderOccurrenceLink={renderOccurrenceLink}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
