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

function trim(
  events: RrwebEvent[],
  marks: Map<string, number>,
  now: number,
): void {
  const cutoff = now - BUFFER_MS;
  let drop = 0;
  while (drop < events.length && events[drop].timestamp < cutoff) drop++;
  if (drop > 0) events.splice(0, drop);
  // A mark leaves with the events at its time. The cutoff is the same one.
  for (const [name, timestamp] of marks) {
    if (timestamp < cutoff) marks.delete(name);
  }
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
  emit(options?: { last?: number; since?: string | number }): void;
  mark(name: string, timestamp: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
} {
  const streamId = host.newId();
  host.setStreamId(streamId);
  const events: RrwebEvent[] = [];
  const marks = new Map<string, number>();
  let stopped = false;
  let paused = false;
  let stopRecord: (() => void) | undefined;

  // pause stops rrweb, so a paused screen never enters the buffer. resume
  // calls record() again. That start takes a full snapshot, the same one
  // record.takeFullSnapshot emits, so a Clip can play across the gap.
  // Calling takeFullSnapshot again would store a second snapshot.
  const arm = (): void => {
    stopRecord = record({
      checkoutEveryNms: CHECKOUT_MS,
      emit: (event) => {
        if (stopped || paused) return;
        trim(events, marks, Date.now());
        events.push(event as RrwebEvent);
      },
    });
  };
  arm();

  const requestedStart = (
    options: { last?: number; since?: string | number } | undefined,
    now: number,
  ): { start: number; markMissing: boolean } => {
    if (options?.last != null) {
      return { start: now - options.last, markMissing: false };
    }
    if (typeof options?.since === "number") {
      return { start: options.since, markMissing: false };
    }
    if (typeof options?.since === "string") {
      const marked = marks.get(options.since);
      if (marked == null) {
        return { start: events[0].timestamp, markMissing: true };
      }
      return { start: marked, markMissing: false };
    }
    return { start: events[0].timestamp, markMissing: false };
  };

  return {
    mark(name, timestamp) {
      if (stopped) return;
      marks.set(name, timestamp);
    },
    pause() {
      if (stopped || paused) return;
      paused = true;
      stopRecord?.();
      stopRecord = undefined;
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      arm();
    },
    emit(options) {
      if (stopped) return;
      const now = Date.now();
      trim(events, marks, now);
      if (events.length === 0) return;
      const requested = requestedStart(options, now);
      const clip = clipFrom(events, requested.start);
      if (requested.markMissing) clip.truncated = true;
      if (clip.events.length === 0) return;
      const clipId = host.newId();
      const groups = segmentsOf(clip.events);
      const base: Record<string, AttrValue> = {
        "everr.recording.clip.id": clipId,
        "everr.recording.stream.id": streamId,
      };
      if (clip.truncated) base["everr.recording.clip.truncated"] = true;
      for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        host.emitSegment(
          JSON.stringify(group),
          {
            ...base,
            "everr.recording.segment.index": index,
          },
          group[group.length - 1].timestamp,
        );
      }
      host.span(requested.start, now, {
        ...base,
        "everr.recording.trigger": "manual",
      });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      paused = false;
      stopRecord?.();
      stopRecord = undefined;
      events.splice(0, events.length);
      marks.clear();
      host.setStreamId(null);
    },
  };
}
