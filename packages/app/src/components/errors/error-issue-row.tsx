import { Badge } from "@everr/ui/components/badge";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorIssueSummary } from "@/data/errors/types";

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
          <div className="flex min-w-0 items-start gap-3 px-3 py-2.5 hover:bg-muted/40">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-medium">{title}</div>
                <Badge variant="outline">{issue.latestServiceName}</Badge>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {message}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="secondary">
                  {issue.occurrenceCount}{" "}
                  {issue.occurrenceCount === 1 ? "occurrence" : "occurrences"}
                </Badge>
                <Badge variant="outline">
                  {issue.traceCount}{" "}
                  {issue.traceCount === 1 ? "trace" : "traces"}
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
