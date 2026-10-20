// The recorder chunk. It is loaded with import() from the recording entry, and
// only for a sampled Session. @rrweb/record is pinned to the rrweb@2.1.7
// release. This module does not import the SDK: the host passed in is the
// live WebSDK, so a built chunk cannot carry a second copy of the envelope.

import { record } from "@rrweb/record";
import type { AttrValue } from "../pipeline/emitter.js";

const FULL_SNAPSHOT = 2;
const META = 4;
const BUFFER_MS = 5 * 60 * 1000;
const CHECKOUT_MS = 10_000;
// A Segment closes before the JSON of its events passes this size. One event
// that is already larger goes out alone.
const SEGMENT_BYTES = 950 * 1024;

type RrwebEvent = {
  type: number;
  timestamp: number;
  data?: unknown;
};

export type RecordingHost = {
  newId(): string;
  setStreamId(id: string | null): void;
  emitSegment(
    body: string,
    attributes: Record<string, AttrValue>,
    timestamp: number,
  ): void;
  span(start: number, end: number, attributes: Record<string, AttrValue>): void;
};

const byteLength = (value: string): number => new Blob([value]).size;

function trim(events: RrwebEvent[], now: number): void {
  const cutoff = now - BUFFER_MS;
  let drop = 0;
  while (drop < events.length && events[drop].timestamp < cutoff) drop++;
  if (drop > 0) events.splice(0, drop);
}

// rrweb plays from a full snapshot. The Meta event emitted with that snapshot
// stays in front of it, because the player reads the viewport from it.
function clipFrom(
  events: RrwebEvent[],
  requestedStart: number,
): { events: RrwebEvent[]; truncated: boolean } {
  let snapshotAt = -1;
  for (let i = 0; i < events.length; i++) {
    if (
      events[i].type === FULL_SNAPSHOT &&
      events[i].timestamp <= requestedStart
    ) {
      snapshotAt = i;
    }
  }
  if (snapshotAt === -1) {
    return {
      events: events.slice(),
      truncated: events.length > 0 && events[0].timestamp > requestedStart,
    };
  }
  const from =
    snapshotAt > 0 && events[snapshotAt - 1].type === META
      ? snapshotAt - 1
      : snapshotAt;
  return { events: events.slice(from), truncated: false };
}

function segmentsOf(events: RrwebEvent[]): RrwebEvent[][] {
  const groups: RrwebEvent[][] = [];
  let current: RrwebEvent[] = [];
  let size = 2;
  for (const event of events) {
    const piece = JSON.stringify(event);
    const pieceBytes = byteLength(piece);
    const next = current.length === 0 ? pieceBytes + 2 : size + 1 + pieceBytes;
    if (current.length > 0 && next > SEGMENT_BYTES) {
      groups.push(current);
      current = [event];
      size = pieceBytes + 2;
    } else {
      current.push(event);
      size = next;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function startRecorder(host: RecordingHost): {
  emit(options?: { last?: number }): void;
  stop(): void;
} {
  const streamId = host.newId();
  host.setStreamId(streamId);
  const events: RrwebEvent[] = [];
  let stopped = false;

  const stopRecord = record({
    checkoutEveryNms: CHECKOUT_MS,
    emit: (event) => {
      if (stopped) return;
      const stamped = event as RrwebEvent;
      trim(events, Date.now());
      events.push(stamped);
    },
  });

  return {
    emit(options) {
      if (stopped) return;
      const now = Date.now();
      trim(events, now);
      if (events.length === 0) return;
      const requestedStart =
        options?.last == null ? events[0].timestamp : now - options.last;
      const clip = clipFrom(events, requestedStart);
      if (clip.events.length === 0) return;
      const clipId = host.newId();
      const groups = segmentsOf(clip.events);
      for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        host.emitSegment(
          JSON.stringify(group),
          {
            "everr.recording.clip.id": clipId,
            "everr.recording.stream.id": streamId,
            "everr.recording.segment.index": index,
          },
          group[group.length - 1].timestamp,
        );
      }
      host.span(requestedStart, now, {
        "everr.recording.clip.id": clipId,
        "everr.recording.stream.id": streamId,
        "everr.recording.trigger": "manual",
        ...(clip.truncated ? { "everr.recording.clip.truncated": true } : {}),
      });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      stopRecord?.();
      events.splice(0, events.length);
      host.setStreamId(null);
    },
  };
}
