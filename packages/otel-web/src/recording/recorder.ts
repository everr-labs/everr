// The recorder chunk. It is loaded with import() from the recording entry, and
// only for a sampled Session. @rrweb/record is pinned to the rrweb@2.1.7
// release. This module does not import the SDK: the host passed in is the
// live WebSDK, so a built chunk cannot carry a second copy of the envelope.

import { record } from "@rrweb/record";
import type { AttrValue } from "../pipeline/emitter.js";
import type { EmitRecordingOptions, RecordingOptions } from "../recording.js";
import type {
  AutomaticRecordingTrigger,
  RecordingTrigger,
} from "../state/clip-trigger.js";
import { recordPrivacy, resolvePrivacy, rewriteEvent } from "./privacy.js";

const FULL_SNAPSHOT = 2;
const META = 4;
// Pause and resume travel in the Segment body as rrweb custom events, so the
// player can draw the paused range without guessing from event silence.
const PAUSE_TAG = "everr.recording.pause";
const RESUME_TAG = "everr.recording.resume";
const BUFFER_MS = 5 * 60 * 1000;
const CHECKOUT_MS = 10_000;
// Raw rrweb JSON. Past this, the oldest events go first. One event that is
// already larger stays, alone, because dropping it would keep nothing newer.
const BUFFER_BYTES = 10 * 1024 * 1024;
// Every 10 s snapshot stays for the last minute. Older snapshots are one per
// minute, so a Clip starts at most a minute before the time that was asked.
const RECENT_SNAPSHOTS_MS = 60_000;
const SNAPSHOT_GAP_MS = 60_000;
// A Segment closes before the JSON of its events passes this size. One event
// that is already larger goes out alone.
const SEGMENT_BYTES = 950 * 1024;
// A tail closes its current Segment on this cadence, and sooner when it ends.
const TAIL_SLICE_MS = 5_000;
const MAX_NEXT_MS = 60_000;
const AUTO_LAST_MS = 60_000;
const AUTO_NEXT_MS = 10_000;
// An automatic tail stays open at most this long after its first trigger.
const AUTO_CAP_MS = 60_000;

type RrwebEvent = {
  type: number;
  timestamp: number;
  data?: unknown;
};

type BufferedEvent = { event: RrwebEvent; bytes: number };

// The running byte total is kept next to the events, so an event costs the
// bytes it drops and not a pass over the whole buffer. A heavy page emits many
// events per second, and a full sum on each one would be quadratic.
type RecordingBuffer = { events: BufferedEvent[]; bytes: number };

export type RecordingHost = {
  dev: boolean;
  options?: RecordingOptions;
  newId(): string;
  setStreamId(id: string | null): void;
  emitSegment(
    body: string,
    attributes: Record<string, AttrValue>,
    timestamp: number,
  ): void;
  span(start: number, end: number, attributes: Record<string, AttrValue>): void;
};

// A Clip whose tail is still open. The buffered part went out when it opened.
// Until endAt, new events collect in pending and leave every 5 seconds. The
// span is sent when the tail closes.
type Tail = {
  clipId: string;
  trigger: RecordingTrigger;
  automatic: boolean;
  requestedStart: number;
  truncated: boolean;
  openedAt: number;
  endAt: number;
  index: number;
  pending: RrwebEvent[];
  timer: ReturnType<typeof setTimeout> | undefined;
  closed: boolean;
};

const byteLength = (value: string): number => new Blob([value]).size;

// Drops checkout snapshots that are older than a minute and closer than a
// minute to the previous one that stayed. The Meta emitted with that snapshot
// goes with it. The player reads the viewport from the Meta in front of the
// snapshot a Clip starts on, so that Meta stays.
function thinSnapshots(buffer: RecordingBuffer, now: number): void {
  const { events } = buffer;
  const recentAt = now - RECENT_SNAPSHOTS_MS;
  const drop = new Set<number>();
  let lastKept = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < events.length; i++) {
    const event = events[i].event;
    if (event.type !== FULL_SNAPSHOT || event.timestamp >= recentAt) continue;
    if (event.timestamp - lastKept >= SNAPSHOT_GAP_MS) {
      lastKept = event.timestamp;
      continue;
    }
    drop.add(i);
    if (events[i - 1]?.event.type === META) drop.add(i - 1);
  }
  if (drop.size === 0) return;
  let write = 0;
  for (let i = 0; i < events.length; i++) {
    if (drop.has(i)) {
      buffer.bytes -= events[i].bytes;
      continue;
    }
    events[write++] = events[i];
  }
  events.length = write;
}

// The snapshot scan runs only when a snapshot arrives or a Clip is emitted.
// Thinning is a decision about snapshots, and a new snapshot is the only thing
// that can change it. Running it on every event would scan the buffer per
// event.
function trim(
  buffer: RecordingBuffer,
  marks: Map<string, number>,
  now: number,
  thin: boolean,
): void {
  const { events } = buffer;
  const cutoff = now - BUFFER_MS;
  let drop = 0;
  while (drop < events.length && events[drop].event.timestamp < cutoff) {
    buffer.bytes -= events[drop].bytes;
    drop++;
  }
  if (drop > 0) events.splice(0, drop);
  if (thin) thinSnapshots(buffer, now);
  let keep = 0;
  while (keep < events.length - 1 && buffer.bytes > BUFFER_BYTES) {
    buffer.bytes -= events[keep].bytes;
    keep++;
  }
  if (keep > 0) events.splice(0, keep);
  // A mark leaves with the events at its time. The cutoff is the same one.
  for (const [name, timestamp] of marks) {
    if (timestamp < cutoff) marks.delete(name);
  }
}

// rrweb plays from a full snapshot. The Meta event emitted with that snapshot
// stays in front of it, because the player reads the viewport from it. When
// the cap has dropped the snapshot at or before the requested start, the Clip
// starts at the earliest snapshot still in the buffer. A buffer with no
// snapshot at all cannot produce a playable Clip.
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
  let truncated = false;
  if (snapshotAt === -1) {
    for (let i = 0; i < events.length; i++) {
      if (events[i].type === FULL_SNAPSHOT) {
        snapshotAt = i;
        break;
      }
    }
    if (snapshotAt === -1) {
      return { events: [], truncated: false };
    }
    truncated = events[snapshotAt].timestamp > requestedStart;
  }
  const from =
    snapshotAt > 0 && events[snapshotAt - 1].type === META
      ? snapshotAt - 1
      : snapshotAt;
  return { events: events.slice(from), truncated };
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

function clampNext(next: number | undefined): number {
  if (next == null || !(next > 0)) return 0;
  return next > MAX_NEXT_MS ? MAX_NEXT_MS : next;
}

export function startRecorder(host: RecordingHost): {
  emit(options?: EmitRecordingOptions): void;
  mark(name: string, timestamp: number): void;
  pause(): void;
  resume(): void;
  automatic(trigger: AutomaticRecordingTrigger, at?: number): void;
  hide(at: number): void;
  stop(): void;
} {
  const streamId = host.newId();
  host.setStreamId(streamId);
  const buffer: RecordingBuffer = { events: [], bytes: 0 };
  const marks = new Map<string, number>();
  const tails: Tail[] = [];
  let stopped = false;
  let paused = false;
  let stopRecord: (() => void) | undefined;
  const privacy = resolvePrivacy(host.dev, host.options);

  const send = (
    clipId: string,
    index: number,
    group: RrwebEvent[],
    truncated: boolean,
  ): void => {
    host.emitSegment(
      JSON.stringify(group),
      {
        "everr.recording.clip.id": clipId,
        "everr.recording.stream.id": streamId,
        "everr.recording.segment.index": index,
        ...(truncated ? { "everr.recording.clip.truncated": true } : {}),
      },
      group[group.length - 1].timestamp,
    );
  };

  const finishSpan = (tail: Tail, end: number): void => {
    host.span(tail.requestedStart, end, {
      "everr.recording.clip.id": tail.clipId,
      "everr.recording.stream.id": streamId,
      "everr.recording.trigger": tail.trigger,
      ...(tail.truncated ? { "everr.recording.clip.truncated": true } : {}),
    });
  };

  const flushTail = (tail: Tail): void => {
    if (tail.pending.length === 0) return;
    const pending = tail.pending;
    tail.pending = [];
    for (const group of segmentsOf(pending)) {
      send(tail.clipId, tail.index++, group, tail.truncated);
    }
  };

  const closeTail = (tail: Tail, end: number): void => {
    if (tail.closed) return;
    tail.closed = true;
    if (tail.timer !== undefined) {
      clearTimeout(tail.timer);
      tail.timer = undefined;
    }
    const at = tails.indexOf(tail);
    if (at >= 0) tails.splice(at, 1);
    flushTail(tail);
    finishSpan(tail, end);
  };

  // The buffered part has already been sent. Until endAt, new events collect
  // here and leave every 5 seconds, then whatever remains leaves with the span.
  const arm = (tail: Tail): void => {
    if (tail.timer !== undefined) clearTimeout(tail.timer);
    const remaining = tail.endAt - Date.now();
    if (remaining <= 0) {
      closeTail(tail, tail.endAt);
      return;
    }
    tail.timer = setTimeout(
      () => {
        tail.timer = undefined;
        if (tail.closed || stopped) return;
        if (Date.now() >= tail.endAt) closeTail(tail, tail.endAt);
        else {
          flushTail(tail);
          arm(tail);
        }
      },
      Math.min(TAIL_SLICE_MS, remaining),
    );
  };

  const buffered = (): RrwebEvent[] => buffer.events.map((item) => item.event);

  // The marker is a normal rrweb event, so it enters the buffer through emit
  // and travels inside whichever Segment covers its timestamp.
  const marker = (tag: string): void => {
    try {
      record.addCustomEvent(tag, undefined);
    } catch {
      // No recorder is running, so there is no Segment to carry the marker.
    }
  };

  const openClip = (options: {
    requestedStart: number;
    next: number;
    trigger: RecordingTrigger;
    automatic: boolean;
    markMissing?: boolean;
    openedAt?: number;
  }): void => {
    const now = Date.now();
    trim(buffer, marks, now, true);
    if (buffer.events.length === 0) return;
    const clip = clipFrom(buffered(), options.requestedStart);
    if (options.markMissing) clip.truncated = true;
    if (clip.events.length === 0) return;
    const clipId = host.newId();
    const groups = segmentsOf(clip.events);
    for (let index = 0; index < groups.length; index++) {
      send(clipId, index, groups[index], clip.truncated);
    }
    const next = clampNext(options.next);
    // A deferred automatic trigger keeps its own time: its tail closes 10
    // seconds after the trigger, not 10 seconds after the chunk loaded.
    const openedAt = options.openedAt ?? now;
    const tail: Tail = {
      clipId,
      trigger: options.trigger,
      automatic: options.automatic,
      requestedStart: options.requestedStart,
      truncated: clip.truncated,
      openedAt,
      endAt: openedAt + next,
      index: groups.length,
      pending: [],
      timer: undefined,
      closed: false,
    };
    if (next === 0) {
      finishSpan(tail, now);
      return;
    }
    tails.push(tail);
    arm(tail);
  };

  // pause stops rrweb, so a paused screen never enters the buffer. resume
  // calls record() again. That start takes a full snapshot, the same one
  // record.takeFullSnapshot emits, so a Clip can play across the gap.
  // Calling takeFullSnapshot again would store a second snapshot.
  const armRecord = (): void => {
    stopRecord = record({
      checkoutEveryNms: CHECKOUT_MS,
      ...recordPrivacy(privacy),
      emit: (event) => {
        if (stopped || paused) return;
        // Attribute masking has no rrweb hook. Rewrite before the buffer.
        rewriteEvent(event, privacy);
        const stamped = event as RrwebEvent;
        const bytes = byteLength(JSON.stringify(stamped));
        buffer.events.push({ event: stamped, bytes });
        buffer.bytes += bytes;
        trim(buffer, marks, Date.now(), stamped.type === FULL_SNAPSHOT);
        // A clipped event belongs to every open tail, so overlapping Clips
        // both carry it. Trim above does not touch a tail's own copy.
        for (const tail of tails) tail.pending.push(stamped);
      },
    });
  };
  armRecord();

  const requestedStart = (
    options: EmitRecordingOptions | undefined,
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
        return { start: buffer.events[0].event.timestamp, markMissing: true };
      }
      return { start: marked, markMissing: false };
    }
    return { start: buffer.events[0].event.timestamp, markMissing: false };
  };

  return {
    mark(name, timestamp) {
      if (stopped) return;
      marks.set(name, timestamp);
    },
    pause() {
      if (stopped || paused) return;
      // The marker goes out before the recorder stops and before the pause
      // flag drops the event, so it is timestamped at the pause.
      if (stopRecord) marker(PAUSE_TAG);
      paused = true;
      stopRecord?.();
      stopRecord = undefined;
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      armRecord();
      // The start has already emitted the new Meta and full snapshot, so the
      // resume marker follows them at the resume time.
      marker(RESUME_TAG);
    },
    emit(options) {
      if (stopped || buffer.events.length === 0) return;
      const now = Date.now();
      const requested = requestedStart(options, now);
      openClip({
        requestedStart: requested.start,
        next: options?.next ?? 0,
        trigger: "manual",
        automatic: false,
        markMissing: requested.markMissing,
      });
    },
    automatic(trigger, at) {
      if (stopped) return;
      const now = Date.now();
      // A trigger that waited for a new Stream keeps the time it happened.
      const triggerAt = at ?? now;
      // A timer that is already due has not closed yet. Close it before
      // deciding, so this trigger does not extend a tail that is over.
      for (const tail of tails.filter(
        (item) => item.automatic && item.endAt <= now,
      )) {
        closeTail(tail, tail.endAt);
      }
      const open = tails.find((tail) => tail.automatic && tail.endAt > now);
      if (open) {
        // 10 seconds after this trigger, and never past 60 seconds after
        // the first one. The trigger label stays the first trigger's.
        const extended = Math.min(
          triggerAt + AUTO_NEXT_MS,
          open.openedAt + AUTO_CAP_MS,
        );
        if (extended > open.endAt) open.endAt = extended;
        return;
      }
      openClip({
        requestedStart: triggerAt - AUTO_LAST_MS,
        next: AUTO_NEXT_MS,
        trigger,
        automatic: true,
        openedAt: triggerAt,
      });
    },
    // The page is going away, so an open tail can no longer wait. Its pending
    // events leave now and its span ends at the hide. The exit flush of the SDK
    // fits the Segment in the keepalive room that the Spans and Logs leave.
    hide(at) {
      if (stopped) return;
      for (const tail of tails.slice()) {
        closeTail(tail, Math.min(tail.endAt, at));
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const tail of tails) {
        if (tail.timer !== undefined) clearTimeout(tail.timer);
        tail.closed = true;
      }
      tails.splice(0, tails.length);
      paused = false;
      stopRecord?.();
      stopRecord = undefined;
      buffer.events.splice(0, buffer.events.length);
      buffer.bytes = 0;
      marks.clear();
      host.setStreamId(null);
    },
  };
}
