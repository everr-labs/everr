/**
 * How a silence reads on both screens that list one: the marks for each
 * state, which states are still open, and how its window prints. Shared so
 * the detail's list and the Silences page cannot drift apart on the same row.
 */
import type { AlertSilenceRecord } from "@/data/alerting/triage/view";

type SilenceState = AlertSilenceRecord["state"];

/** What a person may still do to a silence in each state. A window that has
 *  closed cannot be reopened, so the only move left on a past silence is to
 *  write a new one shaped like it. */
export const STATE_META: Record<
  SilenceState,
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

export const isOpen = (state: SilenceState) =>
  state === "active" || state === "scheduled";

// Built once: a formatter is a locale lookup and a table, and a page of two
// hundred rows printing two bounds each would otherwise build hundreds per
// render.
const DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * Both bounds of the window, to the second. Whether a given notification fell
 * inside it is what a silence row gets read for, and a bound rounded to the
 * minute cannot answer that for an event stamped four seconds in.
 *
 * A window that opens and closes on one day prints that day once. Most do,
 * and repeating it wraps the second bound onto its own line in a column this
 * narrow.
 */
export type WindowBounds = ReturnType<typeof windowBounds>;

export function windowBounds(
  record: Pick<AlertSilenceRecord, "startsAt" | "endsAt" | "canceledAt">,
): {
  start: { iso: string; text: string };
  end: { iso: string; text: string };
} {
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
      text: `${DAY.format(start)}, ${CLOCK.format(start)}`,
    },
    end: {
      iso: endIso,
      text: sameDay
        ? CLOCK.format(end)
        : `${DAY.format(end)}, ${CLOCK.format(end)}`,
    },
  };
}

/** The window as one phrase, for a label or a toast. */
export const windowText = (bounds: WindowBounds) =>
  `${bounds.start.text} to ${bounds.end.text}`;

/**
 * What names one silence out loud, on either screen.
 *
 * The rule it names first, by the name the product calls that rule; its scope
 * next; and its window when it has neither. Derived here rather than at each
 * call site because the two screens had drifted onto different answers, and a
 * silence that is called one thing in a button's label and another in the
 * toast that confirms it is two silences to the reader.
 *
 * The scope, and not every matcher, because the rule matcher holds a
 * definition's row id: on a silence whose rule did not resolve, spelling the
 * matchers out read a raw uuid into the label and the toast.
 */
export function spokenSilence(record: AlertSilenceRecord): string {
  return (
    record.ruleName ||
    record.rule ||
    record.scope ||
    windowText(windowBounds(record))
  );
}

/**
 * What a cancel hands the toast so it can name what it closed and write it
 * again.
 *
 * `restore` is null for a silence that names no single rule, on every screen.
 * The rule a panel happens to be open on is not that silence's scope: writing
 * it again under that rule would mute something the reader never muted, which
 * is the one thing an Undo must not do.
 *
 * Null for a scheduled silence too, for the same reason read off the clock
 * rather than the scope. The only write available starts a silence at `now`
 * and runs it for a duration, so undoing a cancelled window that had not
 * opened yet would mute from this instant until that window's end: cancel a
 * one-hour silence booked for next week and Undo would mute the next seven
 * days. A silence still to start is a booking, and the model has no way to
 * book one again.
 */
export function cancelTargetFor(record: AlertSilenceRecord): {
  id: string;
  label: string;
  restore: {
    path: string;
    matchers: string;
    comment: string;
    endsAt: string;
  } | null;
} {
  return {
    id: record.id,
    label: spokenSilence(record),
    restore:
      record.rule && record.state === "active"
        ? {
            path: record.rule,
            matchers: record.scope,
            comment: record.comment,
            endsAt: record.endsAt,
          }
        : null,
  };
}

/**
 * What the row's one button is called out loud. Every silence on both screens
 * offers the same two words, so the label has to carry the silence it belongs
 * to.
 */
export const cancelLabel = (spoken: string) => `Cancel this silence, ${spoken}`;

export const silenceAgainLabel = (spoken: string) =>
  `Silence again with the same scope as the one for ${spoken}`;
