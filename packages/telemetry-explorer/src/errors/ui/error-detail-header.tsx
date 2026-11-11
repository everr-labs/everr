import { Button } from "@everr/ui/components/button";
import { formatRelativeTime, parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorIssueSummary } from "../data/types";
import { CopyId } from "./copy-id";
import { ErrorService } from "./error-service";
import { ErrorTrend } from "./error-trend";

export function ErrorDetailHeader({
  issue,
  message,
  onBack,
  onClose,
  actions,
}: {
  issue: ErrorIssueSummary;
  /** The message of the occurrence on screen. */
  message: string;
  onBack?: () => void;
  onClose?: () => void;
  /** Right-aligned header actions (e.g. the agent-handoff button). */
  actions?: ReactNode;
}) {
  const title = issue.exceptionType || "Unknown exception";
  const otherServices = issue.services.filter((name) => name !== issue.latestServiceName);

  return (
    <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          className="shrink-0"
        >
          <X />
        </Button>
      ) : onBack ? (
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
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="text-base leading-6 font-semibold break-words">{title}</h1>
        {message ? (
          // The message keeps its own line breaks. A long one stops after four
          // lines here, and the stack trace below has the rest.
          <p
            className="text-muted-foreground mt-0.5 line-clamp-4 text-sm break-words whitespace-pre-wrap"
            title={message}
          >
            {message}
          </p>
        ) : null}
        <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          <ErrorService
            serviceName={issue.latestServiceName}
            others={otherServices.length}
            title={[issue.latestServiceName, ...otherServices].join(", ")}
            className="max-w-52"
          />
          <Count value={issue.occurrenceCount} one="occurrence" many="occurrences" />
          {issue.traceCount > 0 ? (
            <Count value={issue.traceCount} one="trace" many="traces" />
          ) : null}
          <Seen label="First seen" timestamp={issue.firstSeen} />
          <Seen label="Last seen" timestamp={issue.lastSeen} />
          <span className="flex items-center gap-1.5">
            Fingerprint
            <CopyId value={issue.fingerprint} label="fingerprint" />
          </span>
          <ErrorTrend buckets={issue.trend} className="h-5 w-36" />
        </div>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

function Count({ value, one, many }: { value: number; one: string; many: string }) {
  return (
    <span>
      <span className="text-foreground font-medium tabular-nums">{value.toLocaleString()}</span>{" "}
      {value === 1 ? one : many}
    </span>
  );
}

function Seen({ label, timestamp }: { label: string; timestamp: string }) {
  const date = parseTimestampAsUTC(timestamp);
  return (
    <span title={date ? date.toLocaleString() : timestamp}>
      {label} <span className="text-foreground">{formatRelativeTime(timestamp)}</span>
    </span>
  );
}
