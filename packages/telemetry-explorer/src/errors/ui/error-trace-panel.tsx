import { Badge } from "@everr/ui/components/badge";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatDuration } from "@everr/ui/lib/formatting";
import { cn } from "@everr/ui/lib/utils";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorOccurrence, RelatedSpan } from "../data/types";
import { CopyId } from "./copy-id";
import { ErrorDetailSection } from "./error-detail-section";

const RELATED_TRACE_ITEM_LIMIT = 10;
// Deeper spans keep the indent of this level, so a deep trace cannot push the
// span names out of the row.
const MAX_INDENT_DEPTH = 8;

export type RenderTraceLink = (input: {
  traceId: string;
  spanId: string;
  children: ReactNode;
}) => ReactNode;

type TreeRow = { span: RelatedSpan; depth: number };

// The spans in the order of the trace tree: each span, then its children. A
// span whose parent is not in the list starts a tree of its own.
function toTreeRows(spans: RelatedSpan[]): TreeRow[] {
  const ids = new Set(spans.map((span) => span.spanId));
  const children = new Map<string, RelatedSpan[]>();
  const roots: RelatedSpan[] = [];
  for (const span of spans) {
    if (span.parentSpanId && span.parentSpanId !== span.spanId && ids.has(span.parentSpanId)) {
      const siblings = children.get(span.parentSpanId);
      if (siblings) siblings.push(span);
      else children.set(span.parentSpanId, [span]);
    } else {
      roots.push(span);
    }
  }

  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const visit = (span: RelatedSpan, depth: number) => {
    if (seen.has(span.spanId)) return;
    seen.add(span.spanId);
    rows.push({ span, depth });
    for (const child of children.get(span.spanId) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // Spans in a parent cycle have no root. They go last, at the top level.
  for (const span of spans) visit(span, 0);
  return rows;
}

// The rows that fit the panel. The span of the Error and its ancestors come
// first: they are the path from the entry point to the failure, and a panel
// that cuts them off shows a trace with no failure in it.
function pickVisibleRows(rows: TreeRow[], errorSpanId: string): TreeRow[] {
  if (rows.length <= RELATED_TRACE_ITEM_LIMIT) return rows;

  const keep = new Set<number>();
  const errorIndex = rows.findIndex((row) => row.span.spanId === errorSpanId);
  if (errorIndex >= 0) {
    keep.add(errorIndex);
    let depth = rows[errorIndex]?.depth ?? 0;
    for (let i = errorIndex - 1; i >= 0 && depth > 0; i--) {
      const row = rows[i];
      if (row && row.depth < depth) {
        keep.add(i);
        depth = row.depth;
      }
    }
  }
  for (let i = 0; i < rows.length && keep.size < RELATED_TRACE_ITEM_LIMIT; i++) keep.add(i);

  return rows.filter((_, index) => keep.has(index)).slice(-RELATED_TRACE_ITEM_LIMIT);
}

function isFailure(conclusion: string | undefined): boolean {
  return conclusion !== undefined && /error|fail/i.test(conclusion);
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
  if (occurrence.traceId.trim().length === 0) return null;

  const rows = toTreeRows(spans);
  const visibleRows = pickVisibleRows(rows, occurrence.spanId);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <ErrorDetailSection
      title="Related trace"
      description={
        <>
          <CopyId value={occurrence.traceId} label="trace ID" />
          {occurrence.spanId ? (
            <span className="flex items-center gap-1.5">
              span
              <CopyId value={occurrence.spanId} label="span ID" />
            </span>
          ) : null}
        </>
      }
      actions={renderTraceLink({
        traceId: occurrence.traceId,
        spanId: occurrence.spanId,
        children: (
          <>
            <ExternalLink data-icon="inline-start" />
            Open trace
          </>
        ),
      })}
    >
      {isPending ? (
        <div className="divide-y rounded-md border">
          {Array.from({ length: 4 }).map((_, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- fixed-length placeholder skeletons with no data identity; list is static
            <div key={index} className="flex items-center gap-3 px-3 py-2">
              <Skeleton className="h-3.5 w-56 max-w-full" />
              <Skeleton className="ml-auto h-3 w-12" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <RetryError
          variant="inline"
          message="The spans of this trace could not be loaded."
          onRetry={onRetry}
        />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border px-3 py-2 text-xs">
          No spans were found for this trace.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <ol className="divide-y">
            {visibleRows.map(({ span, depth }) => {
              const isErrorSpan = span.spanId === occurrence.spanId;
              return (
                <li
                  key={span.spanId}
                  aria-current={isErrorSpan ? "true" : undefined}
                  className={cn(
                    "flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm leading-tight",
                    isErrorSpan && "bg-destructive/10",
                  )}
                  style={{ paddingLeft: `${0.75 + Math.min(depth, MAX_INDENT_DEPTH) * 0.875}rem` }}
                >
                  <span className={cn("min-w-0 truncate", isErrorSpan && "font-medium")}>
                    {span.name || "Unnamed span"}
                  </span>
                  {isErrorSpan ? (
                    <Badge variant="destructive">This error</Badge>
                  ) : isFailure(span.conclusion) ? (
                    <Badge variant="outline" className="max-w-40">
                      <span className="truncate">{span.conclusion}</span>
                    </Badge>
                  ) : null}
                  <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-3 text-xs">
                    {span.jobName ? (
                      <span className="hidden max-w-48 truncate md:inline">{span.jobName}</span>
                    ) : null}
                    <span className="w-14 text-right tabular-nums">
                      {formatDuration(span.durationMs, "ms")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          {hiddenCount > 0 ? (
            <p className="text-muted-foreground border-t px-3 py-1.5 text-xs">
              {hiddenCount.toLocaleString()} more {hiddenCount === 1 ? "span" : "spans"} in the
              trace.
            </p>
          ) : null}
        </div>
      )}
    </ErrorDetailSection>
  );
}
