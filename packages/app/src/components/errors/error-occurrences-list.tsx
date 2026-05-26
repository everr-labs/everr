import { Badge } from "@everr/ui/components/badge";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorOccurrence } from "@/data/errors/types";

export type RenderTraceLink = (input: {
  occurrence: ErrorOccurrence;
  children: ReactNode;
}) => ReactNode;

export function ErrorOccurrencesList({
  occurrences,
  renderTraceLink,
}: {
  occurrences: ErrorOccurrence[];
  renderTraceLink: RenderTraceLink;
}) {
  if (occurrences.length === 0) return null;

  return (
    <section className="min-w-0 rounded-md border bg-background">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-medium">Occurrences</h2>
        <p className="text-xs text-muted-foreground">
          Latest {occurrences.length} matching logs
        </p>
      </div>
      <ul className="min-w-0 list-none p-0">
        {occurrences.map((occurrence, index) => (
          <li
            key={`${occurrence.timestamp}-${occurrence.traceId}-${occurrence.spanId}-${index}`}
            className="border-b px-3 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                  <AlertTriangle aria-hidden="true" className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {occurrence.exceptionType || "Unknown exception"}
                    </span>
                    <Badge variant="outline">{occurrence.serviceName}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {occurrence.exceptionMessage || occurrence.body}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{formatRelativeTime(occurrence.timestamp)}</span>
                    {occurrence.traceId ? (
                      <span className="font-mono">{occurrence.traceId}</span>
                    ) : null}
                  </div>
                </div>
              </div>
              {occurrence.traceId ? (
                <div className="shrink-0">
                  {renderTraceLink({
                    occurrence,
                    children: "Open trace",
                  })}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
