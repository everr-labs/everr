// The recorder chunk. The stub in ../recording.ts imports it only when the
// recording starts, so rrweb stays out of every other bundle.

import { setAttributes } from "@everr/otel-web";
import type { Tracer } from "@opentelemetry/api";
import { record } from "@rrweb/record";
import type { RecordingClip, RecordingOptions, StartClipOptions } from "../recording.js";
import { emitLogNow } from "../state/emit.js";
import { privacy } from "./privacy.js";

const WINDOW_MS = 5 * 60_000;
const MAX_BYTES = 10_000_000;
const CHECKOUT_MS = 30_000;
const SEGMENT_BYTES = 950_000;
const TAIL_FLUSH_MS = 5_000;
const TAIL_CAP_MS = 60_000;
const BUCKET_TOKENS = 100;
const TOKENS_PER_MS = 10 / 1_000;
const AUTO_CLIP = { last: 60_000, next: 10_000 };
const AUTO_CLIPS_PER_PAGE = 5;

// The rrweb event types and the incremental sources that the recorder reads.
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const META = 4;
const CUSTOM = 5;
const MUTATION = 0;

type RrwebEvent = { type: number; timestamp: number; data: Record<string, unknown> };
type Mutation = {
  attributes: { id: number }[];
  adds: unknown[];
  removes: unknown[];
  texts: unknown[];
};

/** One buffered event, already scrubbed and serialized. */
type Entry = { time: number; type: number; json: string; bytes: number };

type Trigger = "error" | "network" | "manual";

/**
 * Where a Clip starts. With `last`, at the full snapshot at or before that
 * many milliseconds ago. Else with `whole`, at the oldest snapshot in the
 * buffer. Else at a new full snapshot taken at the call.
 */
export type ClipRange = StartClipOptions & { whole?: boolean };

/** The buffer of one document in one Session. */
export type Stream = {
  clip(range: ClipRange, trigger: Trigger): RecordingClip | undefined;
  trigger(kind: "error" | "network"): void;
  pause(): void;
  resume(): void;
  /** Closes the open Clips at the hide time and drops their unsent tails. */
  hide(): void;
  /** Sends the open tails, ends the Clips, and drops the buffer. */
  end(): void;
};

// The automatic Clips of this document. The chunk loads once per document, and
// the count outlives a shutdown and a new start.
let autoClips = 0;

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const utf8 = new TextEncoder();

// Splits serialized JSON into pieces of at most SEGMENT_BYTES of UTF-8, between
// code points, so each piece encodes on its own. The input has no raw control
// characters, so the OTLP string escape at most doubles a piece (a quote or a
// backslash), far under the 20 MiB limit of the collector.
const pieces = (json: string): string[] => {
  const out: string[] = [];
  let start = 0;
  let size = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    const pair = code >= 0xd800 && code < 0xdc00 && (json.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    const width = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
    if (size + width > SEGMENT_BYTES) {
      out.push(json.slice(start, i));
      start = i;
      size = 0;
    }
    size += width;
    if (pair) i++;
  }
  out.push(json.slice(start));
  return out;
};

export function startStream(tracer: Tracer, sessionId: string, options: RecordingOptions): Stream {
  const streamId = randomId();
  const { rrweb, replacer } = privacy(options, (id) => {
    const node = record.mirror.getNode(id);
    return node instanceof Element ? node : null;
  });
  let entries: Entry[] = [];
  let bytes = 0;
  const buckets = new Map<number, [tokens: number, time: number]>();
  const clips = new Set<{ tail: Entry[]; close(hide: boolean): void }>();
  let auto: RecordingClip | undefined;
  let stop: (() => void) | undefined;
  let checkout: ReturnType<typeof setInterval> | undefined;
  let paused = false;
  let ended = false;

  // The 5-minute window and the 10 MB cap. The newest event always stays, with
  // the Meta in front of a full snapshot, so a snapshot over the cap still plays.
  const trim = (now: number) => {
    const keep = entries.at(-2)?.type === META ? 2 : 1;
    let drop = 0;
    while (
      drop < entries.length - keep &&
      (entries[drop].time < now - WINDOW_MS || bytes > MAX_BYTES)
    )
      bytes -= entries[drop++].bytes;
    if (drop) entries = entries.slice(drop);
  };

  const push = (entry: Entry) => {
    entries.push(entry);
    bytes += entry.bytes;
    trim(entry.time);
    for (const clip of clips) clip.tail.push(entry);
  };

  const marker = (tag: string) => {
    const json = JSON.stringify({
      type: CUSTOM,
      timestamp: Date.now(),
      data: { tag, payload: {} },
    });
    push({ time: Date.now(), type: CUSTOM, json, bytes: json.length });
  };

  // One token per attribute mutation on a node. A node inside an <svg> pays
  // from the bucket of its nearest <svg>.
  const allowed = (id: number, now: number) => {
    const node = record.mirror.getNode(id);
    const svg = node instanceof Element ? node.closest("svg") : null;
    const key = svg ? record.mirror.getId(svg) : id;
    const [tokens, time] = buckets.get(key) ?? [BUCKET_TOKENS, now];
    const refilled = Math.min(BUCKET_TOKENS, tokens + (now - time) * TOKENS_PER_MS);
    buckets.set(key, [refilled >= 1 ? refilled - 1 : refilled, now]);
    return refilled >= 1;
  };

  const add = (event: RrwebEvent) => {
    if (paused || ended) return;
    // oxlint-disable-next-line typescript/consistent-type-assertions -- rrweb types data per event type; the checks below narrow it to a mutation.
    const data = event.data as Partial<Mutation> & { source?: number };
    if (event.type === INCREMENTAL && data.source === MUTATION && data.attributes?.length) {
      const attributes = data.attributes.filter((m) => allowed(m.id, event.timestamp));
      if (attributes.length < data.attributes.length) {
        if (
          !attributes.length &&
          !data.adds?.length &&
          !data.removes?.length &&
          !data.texts?.length
        )
          return;
        event = { ...event, data: { ...data, attributes } };
      }
    }
    // The replacer applies the privacy rules on a copy. The bytes are UTF-8,
    // so a Segment and the 10 MB cap measure what the request carries.
    const json = JSON.stringify(event, replacer);
    if (event.type === FULL_SNAPSHOT) buckets.clear();
    push({ time: event.timestamp, type: event.type, json, bytes: utf8.encode(json).length });
  };

  const halt = () => {
    paused = true;
    stop?.();
    stop = undefined;
    clearInterval(checkout);
  };

  const run = () => {
    paused = false;
    try {
      stop = record({ emit: add, ...rrweb, errorHandler: () => true });
      // Our own checkout, and not checkoutEveryNms: rrweb counts that interval
      // from the last event, so an idle page would age its only snapshot out.
      checkout = setInterval(() => record.takeFullSnapshot(true), CHECKOUT_MS);
    } catch {
      halt();
    }
  };

  const clip = (range: ClipRange, trigger: Trigger): RecordingClip | undefined => {
    if (ended) return;
    const now = Date.now();
    trim(now);
    const fromBuffer = range.last !== undefined || range.whole === true;
    const requested = range.last === undefined ? undefined : now - range.last;
    // A Clip from the buffer starts at a full snapshot, with the Meta event in
    // front of it.
    let first = -1;
    let earliest = -1;
    entries.forEach((entry, i) => {
      if (entry.type !== FULL_SNAPSHOT) return;
      if (earliest < 0) earliest = i;
      if (requested === undefined ? first < 0 : entry.time <= requested) first = i;
    });
    if (fromBuffer && earliest < 0) return;
    const truncated = requested !== undefined && first < 0;
    if (truncated) first = earliest;
    if (entries[first - 1]?.type === META) first--;
    const startTime = !fromBuffer ? now : (requested ?? entries[first].time);

    const id = randomId();
    const span = tracer.startSpan("recording", {
      root: true,
      startTime,
      attributes: {
        "session.id": sessionId,
        "everr.recording.clip.id": id,
        "everr.recording.stream.id": streamId,
        "everr.recording.trigger": trigger,
        ...(truncated ? { "everr.recording.clip.truncated": true } : {}),
      },
    });

    let index = 0;
    const emitSegment = (body: string, time: number, piece?: Record<string, number>) =>
      void emitLogNow(
        "everr.browser.recording.segment",
        {
          "session.id": sessionId,
          "everr.recording.stream.id": streamId,
          "everr.recording.clip.id": id,
          "everr.recording.segment.index": index++,
          ...piece,
        },
        time,
        body,
      );
    const emitBatch = (events: Entry[]) =>
      emitSegment(`[${events.map((e) => e.json).join(",")}]`, events[events.length - 1].time);
    // About 950 KB per Segment. A larger event goes in pieces, one Segment
    // each, in a row. The reader joins the pieces in order and parses the event.
    const send = (list: Entry[]) => {
      let batch: Entry[] = [];
      let size = 2;
      for (const entry of list) {
        if (batch.length && size + entry.bytes > SEGMENT_BYTES) {
          emitBatch(batch);
          batch = [];
          size = 2;
        }
        if (entry.bytes + 2 > SEGMENT_BYTES) {
          const parts = pieces(entry.json);
          const event = index;
          parts.forEach((part, i) =>
            emitSegment(part, entry.time, {
              "everr.recording.event.index": event,
              "everr.recording.event.piece": i,
              "everr.recording.event.pieces": parts.length,
            }),
          );
          continue;
        }
        batch.push(entry);
        size += entry.bytes + 1;
      }
      if (batch.length) emitBatch(batch);
    };

    let live = true;
    const tail: Entry[] = [];
    const state = {
      tail,
      close(hide: boolean) {
        if (!live) return;
        live = false;
        clearInterval(flush);
        clearTimeout(cap);
        clips.delete(state);
        if (!hide) send(state.tail);
        span.end();
      },
    };
    if (fromBuffer) send(entries.slice(first));
    clips.add(state);
    // A Clip from the call starts with the Meta and full snapshot that this
    // takes, through its tail. A paused recorder takes them on resume.
    if (!fromBuffer && !paused) {
      try {
        record.takeFullSnapshot(true);
      } catch {
        // rrweb throws when it is not recording. The Clip then starts at the next snapshot.
      }
    }
    const flush = setInterval(() => send(state.tail.splice(0)), TAIL_FLUSH_MS);
    const cap = setTimeout(
      () => state.close(false),
      Math.min(range.next ?? TAIL_CAP_MS, TAIL_CAP_MS),
    );
    if (range.next === 0) state.close(false);
    return { id, startTime, isRecording: () => live, end: () => state.close(false) };
  };

  setAttributes({ "everr.recording.stream.id": streamId });
  run();

  return {
    clip,
    trigger(kind) {
      if (auto?.isRecording() || autoClips >= AUTO_CLIPS_PER_PAGE) return;
      auto = clip(AUTO_CLIP, kind);
      if (auto) autoClips++;
    },
    pause() {
      if (paused || ended) return;
      marker("everr.recording.pause");
      halt();
    },
    resume() {
      if (!paused || ended) return;
      paused = false;
      marker("everr.recording.resume");
      run();
    },
    hide() {
      for (const open of clips) open.close(true);
    },
    end() {
      if (ended) return;
      for (const open of clips) open.close(false);
      halt();
      ended = true;
      entries = [];
      setAttributes({ "everr.recording.stream.id": null });
    },
  };
}
