import { Button, buttonVariants } from "@everr/ui/components/button";
import { formatRelativeTime, parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorOccurrence } from "../data/types";
import { getErrorOccurrenceKey } from "./error-occurrence-key";
import { ErrorService } from "./error-service";

export type RenderOccurrenceLink = (input: {
  occurrence: ErrorOccurrence;
  /** The accessible name of the link, for example "Older occurrence". */
  label: string;
  className: string;
  children: ReactNode;
}) => ReactNode;

const TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
};

/**
 * The occurrence on screen and the pager that steps through the loaded
 * occurrences. The list has the newest occurrence first, so the left arrow goes
 * to a newer occurrence and the right arrow to an older one.
 */
export function ErrorOccurrenceBar({
  occurrences,
  selected,
  totalCount,
  renderOccurrenceLink,
}: {
  occurrences: ErrorOccurrence[];
  selected: ErrorOccurrence;
  /** All occurrences of the Error in the time range, loaded or not. */
  totalCount: number;
  renderOccurrenceLink: RenderOccurrenceLink;
}) {
  const selectedKey = getErrorOccurrenceKey(selected);
  const index = Math.max(
    0,
    occurrences.findIndex((occurrence) => getErrorOccurrenceKey(occurrence) === selectedKey),
  );
  const date = parseTimestampAsUTC(selected.timestamp);

  return (
    <div className="bg-muted/20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-1.5 text-xs">
      {/* One occurrence has no other to step to. */}
      {occurrences.length > 1 ? (
        <nav aria-label="Occurrences" className="flex items-center gap-1">
          <PagerLink
            occurrence={occurrences[index - 1]}
            label="Newer occurrence"
            renderOccurrenceLink={renderOccurrenceLink}
          >
            <ChevronLeft />
          </PagerLink>
          <PagerLink
            occurrence={occurrences[index + 1]}
            label="Older occurrence"
            renderOccurrenceLink={renderOccurrenceLink}
          >
            <ChevronRight />
          </PagerLink>
        </nav>
      ) : null}
      <span className="font-medium tabular-nums">
        Occurrence {(index + 1).toLocaleString()} of {occurrences.length.toLocaleString()}
      </span>
      {totalCount > occurrences.length ? (
        <span className="text-muted-foreground tabular-nums">
          latest {occurrences.length.toLocaleString()} of {totalCount.toLocaleString()}
        </span>
      ) : null}
      <span className="text-muted-foreground tabular-nums" title={`${selected.timestamp} UTC`}>
        <span className="text-foreground">
          {date ? date.toLocaleString(undefined, TIMESTAMP_FORMAT) : selected.timestamp}
        </span>
        {date ? `, ${formatRelativeTime(selected.timestamp)}` : null}
      </span>
      <ErrorService serviceName={selected.serviceName} className="max-w-52" />
    </div>
  );
}

function PagerLink({
  occurrence,
  label,
  renderOccurrenceLink,
  children,
}: {
  occurrence: ErrorOccurrence | undefined;
  label: string;
  renderOccurrenceLink: RenderOccurrenceLink;
  children: ReactNode;
}) {
  // At an end of the list there is no occurrence to link to. A link cannot be
  // disabled, so the control becomes a disabled button with the same name.
  if (!occurrence) {
    return (
      <Button type="button" variant="outline" size="icon-sm" aria-label={label} disabled>
        {children}
      </Button>
    );
  }
  return renderOccurrenceLink({
    occurrence,
    label,
    className: buttonVariants({ variant: "outline", size: "icon-sm" }),
    children,
  });
}
