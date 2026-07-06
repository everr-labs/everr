// Pure merge/dedup logic for the monitor stream's unified event view: stored CC
// history from ClickHouse layered under the live SSE tail. Client-safe (types only
// from the server module).
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import type { CcEvent } from "./types";

/**
 * Memory bound for the merged list. The live hook caps its buffer at 500 and the
 * history fetch is capped at 500 by the server fn, so the merged view holds at
 * most 700 rows (~a few hundred KB of labels/strings) regardless of session length.
 */
export const CC_UNIFIED_EVENTS_CAP = 700;

export type CcUnifiedEvent = {
  source: "live" | "history";
  ts: string; // ISO timestamp (live eval_ts / stored TimestampTime)
  // instance_fired | instance_resolved | rule_health | delivery | silenced
  eventType: string;
  // firing/resolved for instance transitions; null for the other event types.
  status: "firing" | "resolved" | null;
  severity: string | null; // live frames carry it; stored records do not (yet)
  labels: Record<string, string>;
  // Human handle for the rule: the slug (everr.name annotation) when known,
  // otherwise the rule id.
  rule: string;
  fingerprint: string; // instance_key (live) === alert.instance_fingerprint (stored)
  suppressed: boolean;
  deliveryTargets: string[];
  /** Identity for live/history dedup: see {@link ccEventDedupKey}. */
  key: string;
};

/**
 * Dedup identity across the SSE and ClickHouse representations of one event:
 * (instance fingerprint, eval timestamp, event type). The stored record's
 * timestamp is CC's eval_ts truncated to whole seconds by formatDateTime, so
 * both sides floor to epoch seconds before comparing.
 */
export function ccEventDedupKey(
  fingerprint: string,
  ts: string,
  eventType: string,
): string {
  const ms = Date.parse(ts);
  const sec = Number.isNaN(ms) ? ts : Math.floor(ms / 1000);
  return `${fingerprint}|${sec}|${eventType}`;
}

// Live frames carry (kind, status); stored records carry alert.event_type. Map the
// live pair onto the stored vocabulary so one column renders both.
function liveEventType(e: CcEvent): string {
  if (e.kind === "rule_health") return "rule_health";
  return e.status === "resolved" ? "instance_resolved" : "instance_fired";
}

export function liveToUnified(e: CcEvent): CcUnifiedEvent {
  const eventType = liveEventType(e);
  return {
    source: "live",
    ts: e.eval_ts,
    eventType,
    status: eventType === "rule_health" ? null : e.status,
    severity: e.severity,
    labels: e.labels,
    rule: e.annotations["everr.name"] || e.rule,
    fingerprint: e.instance_key,
    suppressed: false, // the SSE payload has no suppression flag
    deliveryTargets: [],
    key: ccEventDedupKey(e.instance_key, e.eval_ts, eventType),
  };
}

export function historyToUnified(r: AlertEventLogRow): CcUnifiedEvent {
  const status =
    r.eventType === "instance_fired"
      ? "firing"
      : r.eventType === "instance_resolved"
        ? "resolved"
        : null;
  return {
    source: "history",
    ts: r.timestamp,
    eventType: r.eventType,
    status,
    severity: r.severity || null,
    labels: r.labels,
    rule: r.slug,
    fingerprint: r.instanceFingerprint,
    suppressed: r.suppressed,
    deliveryTargets: r.deliveryTargets,
    key: ccEventDedupKey(r.instanceFingerprint, r.timestamp, r.eventType),
  };
}

/**
 * Merge the live buffer over the stored history, newest first, capped at `cap`.
 *
 * Dedup runs BETWEEN the two sources only: a stored row whose key also appears in
 * the live buffer is dropped (the live frame wins: it carries severity and full
 * annotations). Rows within one source are trusted as distinct, so two same-second
 * records from ClickHouse (e.g. delivery fan-out) are never collapsed.
 */
export function mergeCcEvents(
  live: CcUnifiedEvent[],
  history: CcUnifiedEvent[],
  cap: number = CC_UNIFIED_EVENTS_CAP,
): CcUnifiedEvent[] {
  const liveKeys = new Set(live.map((e) => e.key));
  const merged = [...live, ...history.filter((h) => !liveKeys.has(h.key))];
  // Stable sort: same-timestamp rows keep live-before-history order from above.
  // Unparseable timestamps sink to the bottom instead of poisoning the comparator.
  const epochMs = (ts: string) => {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? 0 : ms;
  };
  merged.sort((a, b) => epochMs(b.ts) - epochMs(a.ts));
  return merged.length > cap ? merged.slice(0, cap) : merged;
}
