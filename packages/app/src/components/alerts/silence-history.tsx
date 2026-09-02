import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { BellOff } from "lucide-react";
import { Fragment, useState } from "react";
import type { AlertSilenceRecord } from "@/data/alerting/triage/view";
import { Section } from "./detail-section";

/** What a person may still do to a silence in each state. A window that has
 *  closed cannot be reopened, so the only move left on a past silence is to
 *  write a new one shaped like it. */
const STATE_META: Record<
  AlertSilenceRecord["state"],
  { label: string; dot: string; text: string }
> = {
  active: {
    label: "Active",
    dot: "bg-chart-2",
    text: "text-foreground",
  },
  // Hollow rather than filled: it is a window that exists but is not muting
  // anything yet, and the reader has to be able to tell at a glance which of
  // several rows is the one costing them notifications right now.
  scheduled: {
    label: "Scheduled",
    dot: "border border-chart-2 bg-transparent",
    text: "text-foreground",
  },
  expired: {
    label: "Expired",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
  // Distinct from `expired` on purpose. "Ran its course" and "somebody ended
  // it early" are different answers to why the pages came back, and the
  // glossary keeps `cancel` for the second one.
  cancelled: {
    label: "Cancelled",
    dot: "border border-muted-foreground/50 bg-transparent",
    text: "text-muted-foreground",
  },
};

/** Active first, then what is coming, then history. Within each group the
 *  server's newest-first order stands, except for scheduled silences, which
 *  are read as a queue: the one about to start matters most. */
const GROUP_ORDER: Record<AlertSilenceRecord["state"], number> = {
  active: 0,
  scheduled: 1,
  expired: 2,
  cancelled: 2,
};

/** A silence that has closed is evidence, not a control surface. Enough of
 *  them stay visible to answer "has this been muted before", and the rest
 *  wait behind a count so a noisy rule's history cannot push the sections
 *  below it off the panel. */
const CLOSED_PREVIEW = 4;

const isOpen = (record: AlertSilenceRecord) =>
  record.state === "active" || record.state === "scheduled";

function sortSilences(
  silences: AlertSilenceRecord[],
  activeSilenceId: string | null,
): AlertSilenceRecord[] {
  return [...silences].sort((a, b) => {
    const group = GROUP_ORDER[a.state] - GROUP_ORDER[b.state];
    if (group !== 0) return group;
    // The silence the rule's status is attributed to leads its group: it is
    // the one the header is talking about.
    if (a.id === activeSilenceId) return -1;
    if (b.id === activeSilenceId) return 1;
    if (a.state === "scheduled") return a.startsAt.localeCompare(b.startsAt);
    return b.startsAt.localeCompare(a.startsAt);
  });
}

const dayLabel = (at: Date) =>
  at.toLocaleDateString(undefined, { month: "short", day: "numeric" });

const clockLabel = (at: Date) =>
  at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

/**
 * Both bounds of the window, to the second. Whether a given notification fell
 * inside it is what this row gets read for, and a bound rounded to the minute
 * cannot answer that for an event stamped four seconds in.
 *
 * A window that opens and closes on one day prints that day once. Most do,
 * and repeating it wraps the second bound onto its own line in a panel this
 * narrow.
 */
function windowBounds(record: AlertSilenceRecord) {
  const start = new Date(record.startsAt);
  // Cancelling collapses `ends_at` to the cancel instant, give or take the
  // transaction that wrote it. That jitter is under a second and invisible
  // until the bounds are printed to one, so a cancelled window closes at the
  // stamp that recorded the act rather than at the window it overwrote.
  const endIso = record.canceledAt ?? record.endsAt;
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  return {
    start: {
      iso: record.startsAt,
      text: `${dayLabel(start)}, ${clockLabel(start)}`,
    },
    end: {
      iso: endIso,
      text: sameDay ? clockLabel(end) : `${dayLabel(end)}, ${clockLabel(end)}`,
    },
  };
}

/** Its own element rather than a character written into either string: the
 *  facts on this line are set in two different faces, and a separator baked
 *  into a string takes that string's space width. */
const Separator = () => <span className="mx-1.5 opacity-60">·</span>;

function SilenceRow({
  record,
  inForce,
  pending,
  onCancel,
  onSilence,
}: {
  record: AlertSilenceRecord;
  /** This is the silence the rule's `silenced` status is attributed to, and
   *  more than one silence is active, so saying which is worth a badge. */
  inForce: boolean;
  pending: boolean;
  onCancel: (id: string) => void;
  onSilence: (seed: { matchers: string; comment: string }) => void;
}) {
  const meta = STATE_META[record.state];
  // A window that is still open can be closed early; one that has closed can
  // only be written again. Both are one button, in the same place, so the row
  // never has to explain which of the two it is offering.
  const open = isOpen(record);
  const bounds = windowBounds(record);
  const spoken = `${bounds.start.text} to ${bounds.end.text}`;
  // Only the facts this silence actually carries, so the row never prints a
  // placeholder for one it does not. A silence with no matchers is an
  // unnarrowed one, which the row already says by not narrowing it, and "no
  // comment, unknown author" reads as a person declining to explain
  // themselves: a claim the row is in no position to make.
  const facts = [
    !record.wholeRule && record.matchers.trim()
      ? { key: "matchers", text: record.matchers, mono: true }
      : null,
    record.impact ? { key: "impact", text: record.impact, mono: true } : null,
    record.comment
      ? { key: "comment", text: record.comment, mono: false }
      : null,
    record.author ? { key: "author", text: record.author, mono: false } : null,
  ].filter((fact) => fact !== null);

  return (
    // The dot hangs in its own column rather than riding inside the label.
    // The panel is narrow enough that the facts wrap under the state on most
    // rows, and a wrapped line that starts at the dot instead of at the label
    // leaves the whole section looking a character left-ragged.
    <li className="grid grid-cols-[0.375rem_1fr] items-baseline gap-x-1.5 border-t py-2.5 first:border-t-0">
      <span className={cn("size-1.5 -translate-y-px rounded-full", meta.dot)} />
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={cn("shrink-0 text-xs font-medium", meta.text)}>
            {meta.label}
          </span>
          {/* The bounds themselves, not a phrase about them. The row is read
              against a timestamp from somewhere else, so it prints the two
              numbers that comparison needs. */}
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            <time dateTime={bounds.start.iso}>{bounds.start.text}</time>
            {" → "}
            <time dateTime={bounds.end.iso}>{bounds.end.text}</time>
          </span>
          {inForce && (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] leading-none text-muted-foreground">
              in force
            </span>
          )}
          {/* Everything else the row knows, as one more item in the same wrap
              group. Most silences carry one or two short facts, and a row that
              spent a whole second line on two words left the section looking
              left-ragged; as a wrap item the facts sit after the window when
              they fit and take their own line only when they have earned one.

              Mono for the facts the system derived, sans for the ones a person
              typed, which is how the panel's own header splits the two. The
              group's own gap is what separates it from the window, so nothing
              here opens with a dangling separator on the line it wraps to. */}
          {facts.length > 0 && (
            <span className="min-w-0 text-xs text-muted-foreground">
              {facts.map((fact, index) => (
                <Fragment key={fact.key}>
                  {index > 0 && <Separator />}
                  {fact.mono ? (
                    <span className="font-mono">{fact.text}</span>
                  ) : (
                    fact.text
                  )}
                </Fragment>
              ))}
            </span>
          )}
        </div>
        {/* Repeating a closed silence is offered on every past row, so it is
            toned to match them. Ending a live one is the single consequential
            action in the section and keeps full weight. */}
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={
            open
              ? `Cancel this silence, ${spoken}`
              : `Silence again with the same scope as the one from ${spoken}`
          }
          className={cn(
            "-my-1 -mr-2 shrink-0",
            !open && "font-normal text-muted-foreground hover:text-foreground",
          )}
          onClick={() =>
            open
              ? onCancel(record.id)
              : onSilence({
                  matchers: record.matchers,
                  comment: record.comment,
                })
          }
        >
          {open ? "Cancel" : "Silence again"}
        </Button>
      </div>
    </li>
  );
}

/**
 * Every silence that overlapped the selected window, not only the one in
 * force. "Why did nobody get paged" is asked after the fact, and by then the
 * silence responsible has usually closed.
 *
 * The list is where silences are operated from, not just read: the header's
 * one button can only reach the silence the status is attributed to, which
 * leaves a scheduled silence, and the second of two overlapping ones, with no
 * way off the screen at all.
 */
export function SilenceHistory({
  silences,
  activeSilenceId,
  pending,
  onSilence,
  onCancel,
}: {
  silences: AlertSilenceRecord[];
  activeSilenceId: string | null;
  /** A silence mutation is in flight. Every button here writes to the same
   *  rule, so they go inert together rather than racing each other. */
  pending: boolean;
  /** Opens the silence dialog. A seed prefills it from a silence that has
   *  already closed: the same noise coming back is the commonest reason
   *  anyone reads this section, and retyping the matchers is the commonest
   *  reason the replacement is scoped wrong. */
  onSilence: (seed?: { matchers: string; comment: string }) => void;
  onCancel: (id: string) => void;
}) {
  const [showAllClosed, setShowAllClosed] = useState(false);
  const ordered = sortSilences(silences, activeSilenceId);
  const closedCount = ordered.filter((record) => !isOpen(record)).length;
  const hidden = showAllClosed ? 0 : Math.max(0, closedCount - CLOSED_PREVIEW);
  const visible =
    hidden === 0 ? ordered : ordered.slice(0, ordered.length - hidden);

  // Only worth marking when there is something to mistake it for. One active
  // silence is necessarily the one in force, and a badge saying so on the
  // only row it could describe is a word the reader has to rule out.
  const contested =
    ordered.filter((record) => record.state === "active").length > 1;

  return (
    <Section
      title={
        <>
          Silences
          {ordered.length > 0 && (
            // The list is bounded by the time range, which the empty state
            // says and the populated one used to leave the reader to guess.
            <span className="ml-2 font-mono tabular-nums text-muted-foreground/70">
              {ordered.length} in range
            </span>
          )}
        </>
      }
      aside={
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          className="-my-1 -mr-2"
          onClick={() => onSilence()}
        >
          <BellOff data-icon="inline-start" />
          Silence rule
        </Button>
      }
    >
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No silence covered this rule in the selected time range.
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {visible.map((record) => (
              <SilenceRow
                key={record.id}
                record={record}
                inForce={contested && record.id === activeSilenceId}
                pending={pending}
                onCancel={onCancel}
                onSilence={onSilence}
              />
            ))}
          </ul>
          {hidden > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="-mb-1 mt-1 -ml-2 font-normal text-muted-foreground hover:text-foreground"
              onClick={() => setShowAllClosed(true)}
            >
              Show {hidden} older
            </Button>
          )}
        </>
      )}
    </Section>
  );
}
