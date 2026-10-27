import type { RecordingSegment } from "./schemas";

export type ReplayEvent = {
  type: number;
  timestamp: number;
  data?: unknown;
};

function isReplayEvent(value: unknown): value is ReplayEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "number" &&
    "timestamp" in value &&
    typeof value.timestamp === "number"
  );
}

/**
 * Segments are rrweb JSON arrays. A retried insert can store one index twice;
 * the first body wins. Indexes are the emission order.
 */
export function eventsFromSegments(segments: RecordingSegment[]): ReplayEvent[] {
  const ordered = [...segments].sort((left, right) => left.index - right.index);
  const seen = new Set<number>();
  const events: ReplayEvent[] = [];
  for (const segment of ordered) {
    if (seen.has(segment.index)) continue;
    seen.add(segment.index);
    let parsed: unknown;
    try {
      parsed = JSON.parse(segment.body);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      if (isReplayEvent(item)) events.push(item);
    }
  }
  return events;
}
