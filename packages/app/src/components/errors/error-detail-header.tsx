import { Badge } from "@everr/ui/components/badge";
import { buttonVariants } from "@everr/ui/components/button";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ErrorIssueSearch } from "@/data/errors/schemas";
import type { ErrorIssueSummary } from "@/data/errors/types";
import { ErrorServiceBadge } from "./error-service-badge";

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
      <div className="min-w-0">
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
