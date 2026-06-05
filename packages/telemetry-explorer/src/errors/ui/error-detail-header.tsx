import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { ArrowLeft } from "lucide-react";
import type { ErrorIssueSummary } from "../data/types";
import { ErrorServiceBadge } from "./error-service-badge";

export function ErrorDetailHeader({
  issue,
  onBack,
}: {
  issue: ErrorIssueSummary;
  onBack?: () => void;
}) {
  const title = issue.exceptionType || "Unknown exception";
  const message = issue.exceptionMessage || issue.body || issue.fingerprint;

  return (
    <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
      {onBack && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to errors"
          title="Back to errors"
          onClick={onBack}
          className="shrink-0"
        >
          <ArrowLeft />
        </Button>
      )}
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
    </header>
  );
}
