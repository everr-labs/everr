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

/** What a silence whose rule has been deleted is called. The rule's own name
 *  went with it, and the row's window is not an identity: the window column
 *  beside it already prints that. */
const DELETED_RULE = "Deleted rule";

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
 * The scope, and not every matcher, because the rule matcher names the rule in
 * a form no reader knows: on a silence whose rule did not resolve, spelling the
 * matchers out read a raw uuid into the label and the toast.
 *
 * A silence naming a rule that is gone is named for that, rather than for its
 * own window: the row prints that window in the column beside this. The window
 * is the last resort, for the silence that names no single rule and narrows
 * nothing either.
 */
export function spokenSilence(record: AlertSilenceRecord): string {
  if (record.rule) return record.rule.name;
  if (record.deletedRule) return DELETED_RULE;
  return record.scope || windowText(windowBounds(record));
}

/**
 * What the row's one button is called out loud. Every silence on both screens
 * offers the same two words, so the label has to carry the silence it belongs
 * to.
 */
export const cancelLabel = (spoken: string) => `Cancel this silence, ${spoken}`;

export const silenceAgainLabel = (spoken: string) =>
  `Silence again with the same scope as the one for ${spoken}`;
