import { Badge } from "@everr/ui/components/badge";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorIssueSummary } from "../data/types";
import { ErrorServiceBadge } from "./error-service-badge";

export type RenderBackLink = (children: ReactNode) => ReactNode;

export function ErrorDetailHeader({
  issue,
  renderBackLink,
}: {
  issue: ErrorIssueSummary;
  renderBackLink: RenderBackLink;
}) {
  const title = issue.exceptionType || "Unknown exception";
  const message = issue.exceptionMessage || issue.body || issue.fingerprint;

  return (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        <p className="truncate text-xs text-muted-foreground">{message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <ErrorServiceBadge serviceName={issue.latestServiceName} />
          <Badge variant="secondary">
            {issue.occurrenceCount}{" "}
            {issue.occurrenceCount === 1 ? "occurrence" : "occurrences"}
          </Badge>
          <span>Last seen {formatRelativeTime(issue.lastSeen)}</span>
        </div>
      </div>
      {renderBackLink(
        <>
          <ArrowLeft data-icon="inline-start" />
          Errors
        </>,
      )}
    </header>
  );
}
