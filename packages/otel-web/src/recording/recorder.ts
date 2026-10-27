// The recorder chunk. It is loaded with import() from the recording entry, and
// only for a sampled Session. @rrweb/record is pinned to the rrweb@2.1.7
// release. This module does not import the SDK: the host passed in is the
// live WebSDK, so a built chunk cannot carry a second copy of the envelope.

import { record } from "@rrweb/record";
import type { AttrValue } from "../pipeline/emitter.js";
import type { RecordingClip, RecordingOptions, StartClipOptions } from "../recording.js";
import type { AutomaticRecordingTrigger, RecordingTrigger } from "../state/clip-trigger.js";
import { recordPrivacy, resolvePrivacy, rewriteEvent } from "./privacy.js";

const FULL_SNAPSHOT = 2;
const INCREMENTAL_SNAPSHOT = 3;
const META = 4;
const CUSTOM_EVENT = 5;
const MUTATION_SOURCE = 0;

// Pause, resume, and oversized events travel in the Segment body as rrweb
// custom events, so the player can draw the range without guessing from silence.
const PAUSE_TAG = "everr.recording.pause";
const RESUME_TAG = "everr.recording.resume";
const OVERSIZED_TAG = "everr.recording.oversized";

const BUFFER_MS = 5 * 60 * 1000;
const CHECKOUT_MS = 30_000;
// Raw rrweb JSON. Past this, the oldest events go first. No single event is
// over this cap, because a larger event stops the recorder before the buffer.
const BUFFER_BYTES = 10 * 1024 * 1024;
// A Segment closes before the JSON of its events passes this size. One event
// that is already larger goes out alone.
const SEGMENT_BYTES = 950 * 1024;
// A tail closes its current Segment on this cadence, and sooner when it ends.
const TAIL_SLICE_MS = 5_000;
const MAX_NEXT_MS = 60_000;
const AUTO_LAST_MS = 60_000;
const AUTO_NEXT_MS = 10_000;

const BUCKET_CAPACITY = 100;
const BUCKET_REFILL_PER_MS = 10 / 1000;

type RrwebEvent = {
  type: number;
  timestamp: number;
  data?: unknown;
};

type BufferedEvent = { event: RrwebEvent; bytes: number };
type RecordingBuffer = { events: BufferedEvent[]; bytes: number };
type TokenBucket = { tokens: number; updatedAt: number };

export type RecordingHost = {
  options?: RecordingOptions;
  newId(): string;
  setStreamId(id: string | null): void;
  emitSegment(body: string, attributes: Record<string, AttrValue>, timestamp: number): void;
  span(start: number, end: number, attributes: Record<string, AttrValue>): void;
  claimAutomaticClip(): boolean;
};

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

const inertClip = (startTime: number): RecordingClip => ({
  id: "",
  startTime,
  isRecording: () => false,
  end: () => {},
});

function trim(buffer: RecordingBuffer, now: number): void {
  const { events } = buffer;
  const cutoff = now - BUFFER_MS;
  let drop = 0;
  while (drop < events.length && events[drop].event.timestamp < cutoff) {
    buffer.bytes -= events[drop].bytes;
    drop++;
  }
  if (drop > 0) events.splice(0, drop);
  let keep = 0;
  while (keep < events.length - 1 && buffer.bytes > BUFFER_BYTES) {
    buffer.bytes -= events[keep].bytes;
    keep++;
  }
  if (keep > 0) events.splice(0, keep);
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
    if (events[i].type === FULL_SNAPSHOT && events[i].timestamp <= requestedStart) {
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
  const from = snapshotAt > 0 && events[snapshotAt - 1].type === META ? snapshotAt - 1 : snapshotAt;
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
  if (next === undefined) return MAX_NEXT_MS;
  if (!(next > 0)) return 0;
  return next > MAX_NEXT_MS ? MAX_NEXT_MS : next;
}

function isElement(node: Node): node is Element {
  return node.nodeType === node.ELEMENT_NODE;
}

function throttleBucketId(id: number): number {
  const node = record.mirror.getNode(id);
  if (node && isElement(node)) {
    // Nearest <svg> ancestor: an animated SVG changes many children at once.
    let current: Element | null = node;
    let svg: Element | null = null;
    while (current) {
      if (current.tagName.toLowerCase() === "svg") {
        svg = current;
        break;
      }
      current = current.parentElement;
    }
    if (svg) {
      const svgId = record.mirror.getId(svg);
      if (svgId > 0) return svgId;
    }
  }
  return id;
}

function takeToken(buckets: Map<number, TokenBucket>, id: number, now: number): boolean {
  const key = throttleBucketId(id);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: BUCKET_CAPACITY, updatedAt: now };
    buckets.set(key, bucket);
  } else {
    const elapsed = now - bucket.updatedAt;
    if (elapsed > 0) {
      bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsed * BUCKET_REFILL_PER_MS);
      bucket.updatedAt = now;
    }
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMutationAttribute(
  value: unknown,
): value is { id: number; attributes: Record<string, unknown> } {
  return isRecord(value) && typeof value.id === "number" && isRecord(value.attributes);
}

function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function throttleEvent(
  event: { type: number; data?: unknown },
  buckets: Map<number, TokenBucket>,
  now: number,
): boolean {
  if (event.type !== INCREMENTAL_SNAPSHOT) return true;
  const data = event.data;
  if (!isRecord(data) || data.source !== MUTATION_SOURCE) return true;
  if (!Array.isArray(data.attributes) || data.attributes.length === 0) return true;
  const kept = data.attributes.filter(
    (item) => isMutationAttribute(item) && takeToken(buckets, item.id, now),
  );
  data.attributes = kept;
  if (kept.length > 0) return true;
  return listLength(data.adds) > 0 || listLength(data.removes) > 0 || listLength(data.texts) > 0;
}

export function startRecorder(host: RecordingHost): {
  startClip(options?: StartClipOptions): RecordingClip;
  pause(): void;
  resume(): void;
  automatic(trigger: AutomaticRecordingTrigger): void;
  hide(at: number): void;
  stop(): void;
} {
  const streamId = host.newId();
  host.setStreamId(streamId);
  const buffer: RecordingBuffer = { events: [], bytes: 0 };
  const buckets = new Map<number, TokenBucket>();
  const tails: Tail[] = [];
  let stopped = false;
  let paused = false;
  let stopRecord: (() => void) | undefined;
  const privacy = resolvePrivacy(host.options);

  const send = (clipId: string, index: number, group: RrwebEvent[], truncated: boolean): void => {
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

  const closeTail = (tail: Tail, end: number, dropPending = false): void => {
    if (tail.closed) return;
    tail.closed = true;
    if (tail.timer !== undefined) {
      clearTimeout(tail.timer);
      tail.timer = undefined;
    }
    const at = tails.indexOf(tail);
    if (at >= 0) tails.splice(at, 1);
    if (dropPending) tail.pending = [];
    else flushTail(tail);
    finishSpan(tail, end);
  };

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

  const marker = (tag: string): void => {
    try {
      record.addCustomEvent(tag, undefined);
    } catch {
      // No recorder is running, so there is no Segment to carry the marker.
    }
  };

  const pushEvent = (stamped: RrwebEvent, bytes = byteLength(JSON.stringify(stamped))): void => {
    buffer.events.push({ event: stamped, bytes });
    buffer.bytes += bytes;
    trim(buffer, Date.now());
    for (const tail of tails) tail.pending.push(stamped);
  };

  const openClip = (options: {
    requestedStart: number;
    next: number | undefined;
    trigger: RecordingTrigger;
    automatic: boolean;
  }): RecordingClip => {
    const now = Date.now();
    trim(buffer, now);
    if (buffer.events.length === 0) return inertClip(options.requestedStart);
    const clip = clipFrom(buffered(), options.requestedStart);
    if (clip.events.length === 0) return inertClip(options.requestedStart);
    if (options.automatic && !host.claimAutomaticClip()) {
      return inertClip(options.requestedStart);
    }
    const clipId = host.newId();
    const groups = segmentsOf(clip.events);
    for (let index = 0; index < groups.length; index++) {
      send(clipId, index, groups[index], clip.truncated);
    }
    const next = clampNext(options.next);
    const tail: Tail = {
      clipId,
      trigger: options.trigger,
      automatic: options.automatic,
      requestedStart: options.requestedStart,
      truncated: clip.truncated,
      openedAt: now,
      endAt: now + next,
      index: groups.length,
      pending: [],
      timer: undefined,
      closed: false,
    };
    if (next === 0) {
      tail.closed = true;
      finishSpan(tail, now);
      return {
        id: clipId,
        startTime: options.requestedStart,
        isRecording: () => false,
        end: () => {},
      };
    }
    tails.push(tail);
    arm(tail);
    return {
      id: clipId,
      startTime: options.requestedStart,
      isRecording: () => !tail.closed && !stopped,
      end: () => {
        if (stopped || tail.closed) return;
        closeTail(tail, Math.min(tail.endAt, Date.now()));
      },
    };
  };

  const armRecord = (): void => {
    const stop = record({
      checkoutEveryNms: CHECKOUT_MS,
      ...recordPrivacy(privacy),
      emit: (event) => {
        if (stopped || paused) return;
        // 1. Privacy: attribute masking and file input removal.
        rewriteEvent(event, privacy);
        // 2. Mutation throttle.
        if (!throttleEvent(event, buckets, Date.now())) return;
        // 3. Oversized events. The emit argument is already an rrweb event.
        const bytes = byteLength(JSON.stringify(event));
        if (bytes > BUFFER_BYTES) {
          pushEvent({
            type: CUSTOM_EVENT,
            timestamp: event.timestamp,
            data: { tag: OVERSIZED_TAG },
          });
          paused = true;
          stopRecord?.();
          stopRecord = undefined;
          return;
        }
        pushEvent(event, bytes);
      },
    });
    if (stopped || paused) {
      stop?.();
    } else {
      stopRecord = stop;
    }
  };
  armRecord();

  return {
    pause() {
      if (stopped || paused) return;
      if (stopRecord) marker(PAUSE_TAG);
      paused = true;
      stopRecord?.();
      stopRecord = undefined;
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      armRecord();
      if (!paused) marker(RESUME_TAG);
    },
    startClip(options) {
      const now = Date.now();
      const start =
        options?.last != null ? now - options.last : (buffer.events[0]?.event.timestamp ?? now);
      if (stopped || buffer.events.length === 0) return inertClip(start);
      return openClip({
        requestedStart: start,
        next: options?.next,
        trigger: "manual",
        automatic: false,
      });
    },
    automatic(trigger) {
      if (stopped) return;
      const now = Date.now();
      for (const tail of tails.filter((item) => item.automatic && item.endAt <= now)) {
        closeTail(tail, tail.endAt);
      }
      if (tails.some((tail) => tail.automatic && tail.endAt > now)) return;
      openClip({
        requestedStart: now - AUTO_LAST_MS,
        next: AUTO_NEXT_MS,
        trigger,
        automatic: true,
      });
    },
    hide(at) {
      if (stopped) return;
      for (const tail of tails.slice()) {
        closeTail(tail, Math.min(tail.endAt, at), true);
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
      buckets.clear();
      host.setStreamId(null);
    },
  };
}
