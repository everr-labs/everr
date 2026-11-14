import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { formatRelativeTime, parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import type { ReactNode } from "react";
import type { ErrorIssueSummary } from "../data/types";
import { CopyId } from "./copy-id";
import { ErrorService } from "./error-service";
import { ErrorTrend } from "./error-trend";

export type RenderErrorIssueLink = (input: {
  fingerprint: string;
  className: string;
  children: ReactNode;
}) => ReactNode;

/** What the host app tracks for an Error, such as the issue it opened. */
export type RenderErrorTracked = (fingerprint: string) => ReactNode;

export function ErrorIssueRow({
  issue,
  renderIssueLink,
  renderTracked,
}: {
  issue: ErrorIssueSummary;
  renderIssueLink: RenderErrorIssueLink;
  renderTracked?: RenderErrorTracked;
}) {
  const type = issue.exceptionType || "Unknown exception";
  const message = issue.exceptionMessage || issue.body;
  const firstSeen = parseTimestampAsUTC(issue.firstSeen);
  const lastSeen = parseTimestampAsUTC(issue.lastSeen);
  const otherServices = issue.services.filter((name) => name !== issue.latestServiceName);

  // The same structure as a row of the Traces list. The link wraps only the
  // Error but its `after` pseudo-element stretches over the whole row, so the
  // entire row navigates while the copy control and the tooltip stay siblings
  // of the anchor (lifted above the overlay with z-10) and not interactive
  // elements nested in it.
  return (
    <div className="hover:bg-muted/50 relative flex items-center gap-2 border-b px-3 py-1.5 text-sm leading-tight">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {renderIssueLink({
          fingerprint: issue.fingerprint,
          className:
            "flex min-w-0 items-baseline gap-2 text-foreground no-underline after:absolute after:inset-0 after:content-['']",
          children: (
            <>
              <span className="max-w-[60%] shrink-0 truncate font-medium">{type}</span>
              {/* A space character, and not only the flex gap. Without it the
                  accessible name becomes "TypeErrorCannot read". A run of space
                  characters is not a flex item, so the layout does not change. */}
              {message ? " " : null}
              {message ? (
                <span className="text-muted-foreground min-w-0 truncate">{message}</span>
              ) : null}
            </>
          ),
        })}
        <CopyId value={issue.fingerprint} label="fingerprint" className="hidden md:inline-flex" />
        {renderTracked ? (
          <span className="relative z-10 shrink-0">{renderTracked(issue.fingerprint)}</span>
        ) : null}
      </div>

      {/* Fixed widths, and shrink-0, so that each column stays in one line down
          the list and the user can compare the rows. A long message must not
          make a column narrower. */}
      <ErrorService
        serviceName={issue.latestServiceName}
        others={otherServices.length}
        title={[issue.latestServiceName, ...otherServices].join(", ")}
        className="hidden w-28 shrink-0 md:flex"
      />

      <ErrorTrend buckets={issue.trend} className="hidden h-5 w-24 shrink-0 lg:block" />

      <span className="w-24 shrink-0 text-right tabular-nums">
        {issue.occurrenceCount.toLocaleString()}
        <span className="sr-only">
          {issue.occurrenceCount === 1 ? " occurrence" : " occurrences"}
        </span>
      </span>

      <Tooltip>
        <TooltipTrigger
          render={
            <span className="text-muted-foreground relative z-10 hidden w-20 shrink-0 text-right text-xs tabular-nums lg:inline" />
          }
        >
          {formatRelativeTime(issue.lastSeen)}
        </TooltipTrigger>
        <TooltipContent side="left">
          <span className="flex flex-col gap-0.5 tabular-nums">
            <span>Last seen {lastSeen ? lastSeen.toLocaleString() : issue.lastSeen}</span>
            <span className="text-background/70">
              First seen {firstSeen ? firstSeen.toLocaleString() : issue.firstSeen}
            </span>
          </span>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
