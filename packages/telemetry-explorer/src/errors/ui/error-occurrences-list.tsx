import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";
import type { ErrorOccurrence } from "../data/types";
import { getErrorOccurrenceKey } from "./error-occurrence-key";
import { ErrorServiceBadge } from "./error-service-badge";

export type RenderOccurrenceLink = (input: {
  occurrence: ErrorOccurrence;
  children: ReactNode;
  isSelected: boolean;
}) => ReactNode;

export function ErrorOccurrencesList({
  occurrences,
  selectedOccurrenceKey,
  renderOccurrenceLink,
}: {
  occurrences: ErrorOccurrence[];
  selectedOccurrenceKey?: string;
  renderOccurrenceLink?: RenderOccurrenceLink;
}) {
  if (occurrences.length === 0) return null;

  return (
    <section className="min-w-0 rounded-md border bg-background">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-medium">Occurrences</h2>
        <p className="text-xs text-muted-foreground">Latest {occurrences.length} matching logs</p>
      </div>
      <ul className="min-w-0 list-none p-0">
        {occurrences.map((occurrence, index) => {
          const occurrenceKey = getErrorOccurrenceKey(occurrence);
          const isSelected = occurrenceKey === selectedOccurrenceKey;

          return (
            <li
              key={`${occurrenceKey}-${index}`}
              className={cn("border-b px-3 py-2.5 last:border-b-0", isSelected && "bg-muted/40")}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {occurrence.exceptionType || "Unknown exception"}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {occurrence.exceptionMessage || occurrence.body}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <ErrorServiceBadge serviceName={occurrence.serviceName} />
                    <span>{formatRelativeTime(occurrence.timestamp)}</span>
                    {occurrence.traceId ? (
                      <span
                        className="inline-block max-w-64 truncate align-bottom font-mono"
                        title={occurrence.traceId}
                      >
                        {occurrence.traceId}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0">
                  {renderOccurrenceLink
                    ? renderOccurrenceLink({
                        occurrence,
                        isSelected,
                        children: isSelected ? "Selected" : "View",
                      })
                    : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
