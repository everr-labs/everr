import { Badge } from "@everr/ui/components/badge";
import { buttonVariants } from "@everr/ui/components/button";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { ErrorIssueSearch } from "@/data/errors/schemas";
import type { ErrorIssueSummary } from "@/data/errors/types";

export function ErrorDetailHeader({
  issue,
  backSearch,
}: {
  issue: ErrorIssueSummary;
  backSearch: ErrorIssueSearch;
}) {
  const title = issue.exceptionType || "Unknown exception";
  const message = issue.exceptionMessage || issue.body || issue.fingerprint;

  return (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-2">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
          <AlertTriangle aria-hidden="true" className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            <Badge variant="outline">{issue.latestServiceName}</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">{message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">
              {issue.occurrenceCount}{" "}
              {issue.occurrenceCount === 1 ? "occurrence" : "occurrences"}
            </Badge>
            <Badge variant="outline">
              {issue.traceCount} {issue.traceCount === 1 ? "trace" : "traces"}
            </Badge>
            <span>Last seen {formatRelativeTime(issue.lastSeen)}</span>
          </div>
        </div>
      </div>
      <Link
        to="/errors"
        search={backSearch}
        className={buttonVariants({
          variant: "outline",
          size: "sm",
          className: "shrink-0",
        })}
      >
        <ArrowLeft data-icon="inline-start" />
        Errors
      </Link>
    </header>
  );
}
