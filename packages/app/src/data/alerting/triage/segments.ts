/**
 * Turning a stream of alerting lifecycle events into the state chart's
 * segments.
 *
 * Kept pure and separate from the queries: this is the one piece of the triage
 * screen with real logic in it, and it needs to be testable without a
 * ClickHouse round trip.
 */
import type { ALERTING_EVENT_TYPES } from "../vocabulary";
import type { RuleStateSegment } from "./view";

/** The vocabulary the history table writes, not a copy of it: a new event type
 *  has to reach the switch below, and a re-declared union would let it compile
 *  silently unhandled. */
export type LifecycleEventType = (typeof ALERTING_EVENT_TYPES)[number];

export type LifecycleRow = {
  fingerprint: string;
  eventType: LifecycleEventType;
  /** Epoch milliseconds. */
  at: number;
};

type Interval = { from: number; to: number; rank: number };

// Worst wins where two instances overlap. Degraded outranks firing for the
// same reason it sorts first in triage: a rule we cannot evaluate is hiding an
// unknown number of firing instances.
const RANK = { pending: 1, firing: 2, degraded: 3 } as const;
const RANK_STATE: Record<number, RuleStateSegment["state"]> = {
  1: "pending",
  2: "firing",
  3: "degraded",
};

/**
 * Per-instance runs, from the transitions that open and close them.
 *
 * An instance that was already pending or firing when the window opened has no
 * opening event inside it. Two things carry that state into view: `prior`, the
 * last transition each instance made before the window, and a close with
 * nothing open, which back-dates to the window start rather than being
 * dropped. Without the first, a rule that fired hours ago and has been firing
 * quietly ever since charts as inactive, which is the opposite of the truth.
 */
function instanceIntervals(
  rows: LifecycleRow[],
  prior: LifecycleRow[],
  windowFrom: number,
  windowTo: number,
): Interval[] {
  const open = new Map<string, { since: number; rank: number }>();
  const out: Interval[] = [];

  for (const row of prior) {
    if (row.eventType === "instance_pending") {
      open.set(row.fingerprint, { since: windowFrom, rank: RANK.pending });
    } else if (row.eventType === "instance_fired") {
      open.set(row.fingerprint, { since: windowFrom, rank: RANK.firing });
    }
  }

  const close = (fingerprint: string, at: number) => {
    const current = open.get(fingerprint);
    if (!current) return;
    open.delete(fingerprint);
    if (at > current.since) {
      out.push({ from: current.since, to: at, rank: current.rank });
    }
  };

  for (const row of rows) {
    switch (row.eventType) {
      case "instance_pending":
        close(row.fingerprint, row.at);
        open.set(row.fingerprint, { since: row.at, rank: RANK.pending });
        break;
      case "instance_fired":
        close(row.fingerprint, row.at);
        open.set(row.fingerprint, { since: row.at, rank: RANK.firing });
        break;
      case "instance_resolved":
      case "instance_closed":
        if (!open.has(row.fingerprint)) {
          // Closing something that opened before the window: it was firing,
          // because only a firing instance resolves.
          open.set(row.fingerprint, {
            since: windowFrom,
            rank:
              row.eventType === "instance_resolved"
                ? RANK.firing
                : RANK.pending,
          });
        }
        close(row.fingerprint, row.at);
        break;
      case "evaluation_failed":
        break;
    }
  }

  // Whatever is still open ran to the end of the window.
  for (const current of open.values()) {
    if (windowTo > current.since) {
      out.push({ from: current.since, to: windowTo, rank: current.rank });
    }
  }
  return out;
}

/**
 * Failed evaluations, each covering the interval it stole. A failure means no
 * verdict until the next attempt, so it holds until one interval later; runs
 * of failures merge into one stretch rather than a dotted line nobody can
 * read.
 */
function degradedIntervals(
  rows: LifecycleRow[],
  intervalMs: number,
  windowTo: number,
): Interval[] {
  const out: Interval[] = [];
  for (const row of rows) {
    if (row.eventType !== "evaluation_failed") continue;
    const to = Math.min(row.at + intervalMs, windowTo);
    const last = out[out.length - 1];
    if (last && row.at <= last.to) {
      last.to = Math.max(last.to, to);
      continue;
    }
    out.push({ from: row.at, to, rank: RANK.degraded });
  }
  return out;
}

/**
 * Flatten overlapping intervals to the worst state in force at each instant,
 * then coalesce neighbours that agree. Without the flatten, two instances
 * firing over the same minutes would paint the same stretch twice and a
 * pending one underneath would show through the gap between them.
 */
function flattenByRank(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  // A sweep rather than a rescan of every interval at every edge: a rule with
  // many instances over a week is thousands of intervals, and rescanning them
  // squares that. There are only three ranks, so "the worst in force" is the
  // highest one still open.
  const events: { at: number; rank: number; delta: number }[] = [];
  for (const interval of intervals) {
    if (interval.to <= interval.from) continue;
    events.push({ at: interval.from, rank: interval.rank, delta: 1 });
    events.push({ at: interval.to, rank: interval.rank, delta: -1 });
  }
  events.sort((a, b) => a.at - b.at);

  const open = new Map<number, number>();
  const out: Interval[] = [];
  let cursor = 0;
  while (cursor < events.length) {
    const from = events[cursor].at;
    // Everything that opens or closes at this instant, before the slab that
    // starts here is measured.
    while (cursor < events.length && events[cursor].at === from) {
      const event = events[cursor++];
      open.set(event.rank, (open.get(event.rank) ?? 0) + event.delta);
    }
    if (cursor === events.length) break;
    const to = events[cursor].at;
    let rank = 0;
    for (const [openRank, count] of open) {
      if (count > 0) rank = Math.max(rank, openRank);
    }
    if (rank === 0) continue;
    const last = out[out.length - 1];
    if (last && last.to === from && last.rank === rank) {
      last.to = to;
      continue;
    }
    out.push({ from, to, rank });
  }
  return out;
}

/**
 * The state chart's segments for one rule, in minutes before the end of the
 * window, newest last.
 *
 * `silencedFrom` marks the instant an active silence took hold: a silenced
 * rule is still firing, so its firing stretches are re-labelled from there
 * rather than removed.
 */
export function ruleStateSegments(opts: {
  rows: LifecycleRow[];
  /** The last transition each instance made *before* the window, so a state
   *  that started earlier and never changed still gets drawn. At most one row
   *  per fingerprint; anything older is already superseded. */
  prior?: LifecycleRow[];
  windowFrom: number;
  windowTo: number;
  intervalMs: number;
  silencedFrom?: number | null;
}): RuleStateSegment[] {
  const rows = [...opts.rows].sort((a, b) => a.at - b.at);
  const flattened = flattenByRank([
    ...instanceIntervals(
      rows,
      opts.prior ?? [],
      opts.windowFrom,
      opts.windowTo,
    ),
    ...degradedIntervals(rows, opts.intervalMs, opts.windowTo),
  ]);

  const out: RuleStateSegment[] = [];
  for (const interval of flattened) {
    const from = Math.max(interval.from, opts.windowFrom);
    const to = Math.min(interval.to, opts.windowTo);
    if (to <= from) continue;
    const silencedFrom = opts.silencedFrom;
    const silenced =
      silencedFrom != null &&
      interval.rank === RANK.firing &&
      to > silencedFrom;
    // A stretch that starts before the silence and runs past it splits, so the
    // chart shows the moment somebody muted it.
    if (silenced && from < silencedFrom) {
      out.push({
        state: "firing",
        from: (opts.windowTo - from) / 60_000,
        to: (opts.windowTo - silencedFrom) / 60_000,
      });
      out.push({
        state: "silenced",
        from: (opts.windowTo - silencedFrom) / 60_000,
        to: (opts.windowTo - to) / 60_000,
      });
      continue;
    }
    out.push({
      state: silenced ? "silenced" : RANK_STATE[interval.rank],
      from: (opts.windowTo - from) / 60_000,
      to: (opts.windowTo - to) / 60_000,
    });
  }
  return out;
}
