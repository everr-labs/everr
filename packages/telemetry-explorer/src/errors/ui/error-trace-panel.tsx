import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatDuration } from "@everr/ui/lib/formatting";
import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { cn } from "@everr/ui/lib/utils";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorOccurrence, RelatedSpan } from "../data/types";

const TRACE_WINDOW_MS = 5 * 60 * 1000;

export type RenderTraceLink = (input: {
  traceId: string;
  spanId: string;
  start: string;
  end: string;
  children: ReactNode;
}) => ReactNode;

function getTraceWindow(timestamp: string): { start: string; end: string } {
  const parsed = parseTimestampAsUTC(timestamp) ?? new Date();
  return {
    start: toClickHouseDateTime(new Date(parsed.getTime() - TRACE_WINDOW_MS)),
    end: toClickHouseDateTime(new Date(parsed.getTime() + TRACE_WINDOW_MS)),
  };
}

function spanStatusLabel(span: RelatedSpan, isErrorSpan: boolean): string {
  if (isErrorSpan) return "error span";
  if (!span.conclusion) return "span";
  if (span.conclusion.length > 28) return "error";
  return span.conclusion;
}

export function ErrorTracePanel({
  occurrence,
  spans,
  isPending,
  isError,
  onRetry,
  renderTraceLink,
}: {
  occurrence: ErrorOccurrence;
  spans: RelatedSpan[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  renderTraceLink: RenderTraceLink;
}) {
  const errorSpanId = occurrence.spanId;

  if (occurrence.traceId.trim().length === 0) return null;

  const window = getTraceWindow(occurrence.timestamp);

  return (
    <section className="min-w-0 rounded-md border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Related trace</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span
              className="max-w-80 truncate font-mono"
              title={occurrence.traceId}
            >
              {occurrence.traceId || "No trace id"}
            </span>
            {occurrence.spanId ? (
              <span className="font-mono" title={occurrence.spanId}>
                span {occurrence.spanId}
              </span>
            ) : null}
          </div>
        </div>
        {renderTraceLink({
          traceId: occurrence.traceId,
          spanId: occurrence.spanId,
          start: window.start,
          end: window.end,
          children: (
            <>
              <ExternalLink data-icon="inline-start" />
              Open trace
            </>
          ),
        })}
      </div>

      <div className="p-3">
        {isPending ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-3 bg-muted/20 px-3 py-2">
            <p className="text-sm text-muted-foreground">
              The related spans could not be loaded.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          </div>
        ) : spans.length === 0 ? (
          <p className="bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            No spans were found for this trace.
          </p>
        ) : (
          <ol className="divide-y">
            {spans.map((span) => {
              const isErrorSpan = span.spanId === errorSpanId;
              return (
                <li
                  key={span.spanId}
                  className={cn(
                    "grid min-w-0 gap-2 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto]",
                    isErrorSpan &&
                      "border-l-2 border-l-destructive bg-destructive/10 pl-2.5",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {span.name || "Unnamed span"}
                      </span>
                      <Badge
                        variant={isErrorSpan ? "destructive" : "secondary"}
                      >
                        {spanStatusLabel(span, isErrorSpan)}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono" title={span.spanId}>
                        {span.spanId}
                      </span>
                      {span.parentSpanId ? (
                        <span className="font-mono" title={span.parentSpanId}>
                          parent {span.parentSpanId}
                        </span>
                      ) : (
                        <span>root span</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground md:justify-end">
                    {span.jobName ? (
                      <Badge variant="outline">{span.jobName}</Badge>
                    ) : null}
                    <span className="font-mono">
                      {formatDuration(span.durationMs, "ms")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
