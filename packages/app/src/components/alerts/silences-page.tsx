import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { Plus } from "lucide-react";
import { formatElapsed } from "@/data/alerting/triage/format";
import type { AlertSilenceRecord } from "@/data/alerting/triage/view";
import { COLUMN_LABEL } from "./list-columns";
import type { SilenceSeed } from "./silence-dialog";
import {
  cancelLabel,
  isOpen,
  STATE_META,
  silenceAgainLabel,
  windowBounds,
} from "./silence-state";

/**
 * Measured against the list column rather than the window, the same way the
 * triage list and the rule inventory are: narrow, the row is what is silenced
 * and the button, with the times and the impact reflowed onto a line of their
 * own underneath; at full width it is the table. Each fact is rendered once
 * either way, so nothing here can print two different answers at two sizes.
 */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 @[52rem]/list:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_9rem_8rem_7rem]";

/** "ends in 2h 10m" for a silence that is muting, "starts in 4h" for one that
 *  will; a closed one just says which way it closed. */
function stateText(row: AlertSilenceRecord, now: number): string {
  if (row.state === "active")
    return `ends in ${formatElapsed(new Date(row.endsAt).getTime() - now)}`;
  if (row.state === "scheduled")
    return `starts in ${formatElapsed(new Date(row.startsAt).getTime() - now)}`;
  return STATE_META[row.state].label;
}

function Row({
  row,
  now,
  pending,
  onCancel,
  onSilenceAgain,
}: {
  row: AlertSilenceRecord;
  now: number;
  pending: boolean;
  onCancel: (id: string) => void;
  onSilenceAgain: (seed: SilenceSeed) => void;
}) {
  const open = isOpen(row.state);
  const bounds = windowBounds(row);
  // Who made it, then why. The author leads: on a page that spans every rule,
  // most rows were written by somebody else, and a comment long enough to
  // truncate would otherwise take the name off the row with it. Both are typed
  // by a person and both are set in the row's sans; what the system derived
  // stays mono.
  const attribution = [row.author, row.comment].filter(Boolean).join(" · ");
  // What names this row out loud. Every button on the page reads the same two
  // words, so the label has to carry the silence it belongs to: its matchers
  // where it has them, and its window where it does not.
  const spoken = row.matchers || `${bounds.start.text} to ${bounds.end.text}`;
  return (
    <li
      className={cn(
        COLUMNS,
        "border-t px-3 py-2.5 text-sm transition-colors hover:bg-muted/25",
        !open && "text-muted-foreground",
      )}
    >
      {/* The matchers are the silence: there is no name to put above them, and
          the rule is one matcher among the others rather than a title the rest
          narrow. A silence with none prints nothing here; absence of text is
          the statement.

          No state dot rides in front of them. The section a row sits in is its
          state, and the one section that holds two states prints the word. */}
      <div className="min-w-0">
        {row.matchers && (
          <div className="truncate font-mono text-xs">{row.matchers}</div>
        )}
        {attribution && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {attribution}
          </p>
        )}
      </div>
      {/* Second in the markup so it lands beside the matchers on a narrow
          list, last in the table once there are columns to be last of. */}
      <div className="justify-self-end @[52rem]/list:order-last">
        {open ? (
          <Button
            size="sm"
            variant="ghost"
            className="-my-1"
            disabled={pending}
            aria-label={cancelLabel(spoken)}
            onClick={() => onCancel(row.id)}
          >
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="-my-1 font-normal text-muted-foreground"
            disabled={pending}
            aria-label={silenceAgainLabel(spoken)}
            onClick={() =>
              onSilenceAgain({
                rule: row.rule,
                matchers: row.scope,
                comment: row.comment,
              })
            }
          >
            Silence again
          </Button>
        )}
      </div>
      {/* One wrapped line under the matchers while the list is narrow; three
          columns of the table once it is not. `contents` is what lets the same
          three elements be both without being written twice. */}
      <div className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-3 @[52rem]/list:contents">
        <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
          <time dateTime={bounds.start.iso}>{bounds.start.text}</time>
          {" → "}
          <time dateTime={bounds.end.iso}>{bounds.end.text}</time>
        </span>
        <span className="font-mono text-xs tabular-nums">
          {stateText(row, now)}
        </span>
        {/* Nothing stands in for an impact of nothing: the column is read for
            the few rows where something was withheld, and a dash on every
            other row is what buries them. */}
        <span className="truncate font-mono text-xs text-muted-foreground">
          {row.impact}
        </span>
      </div>
    </li>
  );
}

function Section({
  title,
  hint,
  aside,
  rows,
  loading,
  empty,
  children,
}: {
  title: string;
  /** Only for what the reader cannot see from the rows. How a section is
   *  sorted is visible in it; what bounds it is not. */
  hint?: string;
  aside?: React.ReactNode;
  rows: AlertSilenceRecord[];
  /** The rows have not arrived. The heading and its action stay put: the way
   *  to write a silence must not be missing from the screen for as long as it
   *  takes to read the ones that already exist. */
  loading?: boolean;
  empty: string;
  children: (row: AlertSilenceRecord) => React.ReactNode;
}) {
  // The heading names the region, so a reader moving by landmark hears
  // "Active" rather than the second of two unnamed sections.
  const headingId = `silences-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3 px-3 pb-1.5">
        <h2
          id={headingId}
          className="flex items-baseline gap-2 text-sm font-medium"
        >
          {title}
          {/* A count of nothing, over a line that already says there is
              nothing. */}
          {rows.length > 0 && (
            <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          )}
          {hint && (
            <span className="text-xs font-normal text-muted-foreground">
              {hint}
            </span>
          )}
        </h2>
        {aside}
      </div>
      {/* Nothing to head while the section is empty, and nothing to head
          below the tier where the columns exist at all: the narrow row reflows
          its times onto one line, where a strip of labels would sit above a
          layout it does not describe. */}
      {rows.length > 0 && (
        <div className={cn(COLUMNS, "hidden px-3 pb-1.5 @[52rem]/list:grid")}>
          <span />
          <span className={COLUMN_LABEL}>Window</span>
          <span className={COLUMN_LABEL}>State</span>
          <span className={COLUMN_LABEL}>Impact</span>
          <span />
        </div>
      )}
      {loading ? (
        <div aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-t px-3 py-2.5">
              <Skeleton className="h-7 w-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="border-t px-3 py-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul>{rows.map(children)}</ul>
      )}
    </section>
  );
}

/**
 * "What is muting right now." Two stacked sections, one dense row per silence:
 * the active section is the control surface, and history is evidence that the
 * picked time range bounds.
 *
 * No page header: the shell's breadcrumb already names the screen, and the one
 * action it carried belongs on the section it acts on.
 */
export function SilencesPage({
  silences,
  pending,
  onNew,
  onCancel,
  onSilenceAgain,
}: {
  /** `null` while loading. */
  silences: AlertSilenceRecord[] | null;
  /** A silence write is in flight; every silence control goes inert. */
  pending: boolean;
  onNew: () => void;
  onCancel: (id: string) => void;
  onSilenceAgain: (seed: SilenceSeed) => void;
}) {
  // One reading of the clock per render, so two rows cannot disagree about
  // what "in 4m" is measured from.
  const now = Date.now();
  const loading = silences === null;
  const rows = silences ?? [];
  // Every silence this app writes starts at `now`, so `scheduled` has no way
  // to exist and the section that used to hold it could only ever draw its own
  // empty state. Open rows share one section instead. Should scheduling ever
  // ship, an unstarted row still lands here and still says "starts in 4h"
  // rather than falling out of the page.
  const open = rows.filter((row) => isOpen(row.state));
  const closed = rows.filter((row) => !isOpen(row.state));

  const row = (record: AlertSilenceRecord) => (
    <Row
      key={record.id}
      row={record}
      now={now}
      pending={pending}
      onCancel={onCancel}
      onSilenceAgain={onSilenceAgain}
    />
  );

  return (
    // Outside the spaced stack: `sr-only` is out of flow, and as the stack's
    // first child it was still spending the stack's gap on nothing.
    <>
      {/* The topnav breadcrumb is the visible title. This is the document's,
          so the page is not a screen of h2s under nothing. */}
      <h1 className="sr-only">Silences</h1>
      <div className="@container/list space-y-6">
        <Section
          title="Active"
          rows={open}
          loading={loading}
          // Said to the only reader who needs telling: the one who has never
          // made a silence. It used to run under the title on every visit,
          // including for the people who live here.
          empty="Nothing is silenced. A silence stops a rule's notifications without stopping the rule."
          aside={
            <Button
              size="sm"
              className="-my-1"
              disabled={pending}
              onClick={onNew}
            >
              <Plus className="size-4" />
              New silence
            </Button>
          }
        >
          {row}
        </Section>
        <Section
          title="History"
          hint="in range"
          rows={closed}
          loading={loading}
          empty="No silence closed in the selected time range."
        >
          {row}
        </Section>
      </div>
    </>
  );
}
