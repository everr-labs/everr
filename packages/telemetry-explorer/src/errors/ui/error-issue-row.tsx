import { Badge } from "@everr/ui/components/badge";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";
import type { ErrorIssueSummary } from "../data/types";
import { ErrorServiceBadge } from "./error-service-badge";
import { ErrorStatusBadge } from "./error-status-badge";

export type RenderErrorIssueLink = (input: {
  fingerprint: string;
  children: ReactNode;
}) => ReactNode;

export function ErrorIssueRow({
  issue,
  renderIssueLink,
}: {
  issue: ErrorIssueSummary;
  renderIssueLink: RenderErrorIssueLink;
}) {
  const title = issue.exceptionType || "Unknown exception";
  const message = issue.exceptionMessage || issue.body || issue.fingerprint;

  return (
    <li className="border-b last:border-b-0">
      {renderIssueLink({
        fingerprint: issue.fingerprint,
        children: (
          <div className="min-w-0 px-3 py-2.5 hover:bg-muted/40">
            <div className="min-w-0">
              <div
                className={cn(
                  "truncate text-sm font-medium",
                  // Ignored is muted-by-choice; the dimmed title keeps the
                  // scan focused on Errors still competing for attention.
                  issue.status === "ignored" && "text-muted-foreground",
                )}
              >
                {title}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {message}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {issue.status ? (
                  <ErrorStatusBadge status={issue.status} />
                ) : null}
                <ErrorServiceBadge serviceName={issue.latestServiceName} />
                <Badge variant="secondary">
                  {issue.occurrenceCount}{" "}
                  {issue.occurrenceCount === 1 ? "occurrence" : "occurrences"}
                </Badge>
                <span>Last seen {formatRelativeTime(issue.lastSeen)}</span>
              </div>
            </div>
          </div>
        ),
      })}
    </li>
  );
}
