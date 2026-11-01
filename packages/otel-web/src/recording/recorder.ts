// The recorder chunk. The stub in ../recording.ts imports it only when the
// recording starts, so rrweb stays out of every other bundle.

import { setAttributes } from "@everr/otel-web";
import { record } from "@rrweb/record";
import type { InstrumentationContext } from "../instrumentations/runtime.js";
import type { SendEvent } from "../pipeline/emitter.js";
import type { RecordingClip, RecordingOptions, StartClipOptions } from "../recording.js";
import { randomHex } from "../state/session.js";
import { privacy } from "./privacy.js";

const WINDOW_MS = 5 * 60_000;
const MAX_BYTES = 10_000_000;
const CHECKOUT_MS = 30_000;
const SEGMENT_BYTES = 950_000;
const FLUSH_MS = 5_000;
const CLIP_CAP_MS = 60_000;
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
type Entry = { time: number; json: string; bytes: number };

/**
 * The events from one Meta and full snapshot up to the next, so a replay can
 * start at each. The number counts the generations of the Stream from 0. The
 * sent entries are a prefix, so `sent` counts them. The first entry is the
 * Meta, and its time is the time of the generation.
 */
type Generation = { n: number; entries: Entry[]; bytes: number; sent: number };

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
  /** Reads each record that the SDK sends, and opens an automatic Clip on a failure. */
  observe(item: SendEvent): void;
  pause(): void;
  resume(): void;
  /** Closes the open Clips at the hide time, and sends nothing more for them. */
  hide(): void;
  /** Sends what the open Clips still need, ends them, and drops the buffer. */
  end(): void;
};

// The automatic Clips of this document. The chunk loads once per document, and
// the count outlives a shutdown and a new start.
let autoClips = 0;

// The UTF-8 width of the code point at i. A surrogate pair is 4 bytes.
const width = (s: string, i: number) => {
  const code = s.charCodeAt(i);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return code >= 0xd800 && code < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 4 : 3;
};

// Counts the UTF-8 bytes without encoding the string.
const utf8Bytes = (s: string) => {
  let size = 0;
  for (let i = 0; i < s.length; i++) {
    const w = width(s, i);
    size += w;
    if (w === 4) i++;
  }
  return size;
};

// Splits serialized JSON into pieces of at most SEGMENT_BYTES of UTF-8, between
// code points, so each piece encodes on its own. The input has no raw control
// characters, so the OTLP string escape at most doubles a piece (a quote or a
// backslash), far under the 20 MiB limit of the collector.
const pieces = (json: string): string[] => {
  const out: string[] = [];
  let start = 0;
  let size = 0;
  for (let i = 0; i < json.length; i++) {
    const w = width(json, i);
    if (size + w > SEGMENT_BYTES) {
      out.push(json.slice(start, i));
      start = i;
      size = 0;
    }
    size += w;
    if (w === 4) i++;
  }
  out.push(json.slice(start));
  return out;
};

// The failures that open an automatic Clip, read from what the SDK sends: an
// exception, and a request span with a 5xx or with no response. An abort is
// not one. startRequest in ../instrumentations/network/request.ts sets these
// attributes, and also an error.type for a 4xx, which is not a failure here.
const failure = (item: SendEvent): Trigger | undefined => {
  if (item.kind === "log") return item.eventName === "exception" ? "error" : undefined;
  const { attributes: a } = item;
  const status = a["http.response.status_code"];
  const error = a["error.type"];
  return a["http.request.method"] !== undefined &&
    (typeof status === "number" ? status >= 500 : !!error && error !== "AbortError")
    ? "network"
    : undefined;
};

export function startStream(
  ctx: InstrumentationContext,
  sessionId: string,
  options: RecordingOptions,
): Stream {
  const streamId = randomHex(16);
  const { rrweb, replacer } = privacy(options, (id) => {
    const node = record.mirror.getNode(id);
    return node instanceof Element ? node : null;
  });
  // The Clips are ranges over this Stream, so each event leaves the page at
  // most once. A reader finds the events of a Clip by the Stream id and the
  // time range of the Clip's Span.
  const generations: Generation[] = [];
  let generationCount = 0;
  let bytes = 0;
  let index = 0;
  const buckets = new Map<number, [tokens: number, time: number]>();
  // Each open Clip needs the events of its first generation and after.
  const clips = new Set<{ from: number; close(hide: boolean): void }>();
  let flush: ReturnType<typeof setInterval> | undefined;
  let auto: RecordingClip | undefined;
  let stop: (() => void) | undefined;
  let paused = false;
  let ended = false;

  const emitSegment = (body: string, time: number, piece?: Record<string, number>) =>
    void ctx.emitNow(
      "everr.browser.recording.segment",
      {
        "session.id": sessionId,
        "everr.recording.stream.id": streamId,
        "everr.recording.segment.index": index++,
        ...piece,
      },
      time,
      body,
    );
  const emitBatch = (events: Entry[]) =>
    emitSegment(`[${events.map((e) => e.json).join(",")}]`, events[0].time);

  // Sends the unsent events of one generation. A Segment never spans two
  // generations, so its time, that of its first event, places it in a Clip.
  // About 950 KB per Segment. A larger event goes in pieces, one Segment
  // each, in a row. The reader joins the pieces in order and parses the event.
  const send = (generation: Generation) => {
    let batch: Entry[] = [];
    let size = 2;
    for (; generation.sent < generation.entries.length; generation.sent++) {
      const entry = generation.entries[generation.sent];
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

  // The first generation that an open Clip needs, or Infinity with none open.
  const liveFrom = () => {
    let from = Infinity;
    for (const c of clips) from = Math.min(from, c.from);
    return from;
  };
  const sendLive = () => {
    const from = liveFrom();
    for (const generation of generations) if (generation.n >= from) send(generation);
  };

  // Drops whole generations, oldest first, past the 5-minute window or the
  // 10 MB cap. The newest generation always stays, so an idle page keeps its
  // only snapshot, and the cap gives way by at most one generation. An open
  // Clip gets the events of a generation before it goes.
  const trim = (now: number) => {
    while (
      generations.length > 1 &&
      (generations[1].entries[0].time <= now - WINDOW_MS || bytes > MAX_BYTES)
    ) {
      const oldest = generations[0];
      generations.shift();
      if (oldest.n >= liveFrom()) send(oldest);
      bytes -= oldest.bytes;
    }
  };

  // One token per attribute mutation on a node. A node inside an <svg> pays
  // from the bucket of its nearest <svg>.
  const allowed = (id: number, now: number) => {
    const node = record.mirror.getNode(id);
    // Only an SVG node walks up; an HTML node pays from its own bucket.
    const svg = node instanceof SVGElement ? node.closest("svg") : null;
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
    // rrweb emits a Meta event right before each full snapshot.
    if (event.type === META)
      generations.push({ n: generationCount++, entries: [], bytes: 0, sent: 0 });
    if (event.type === FULL_SNAPSHOT) buckets.clear();
    const current = generations.at(-1);
    if (!current) return;
    // The replacer applies the privacy rules on a copy. The bytes are UTF-8,
    // so a Segment and the 10 MB cap measure what the request carries.
    const json = JSON.stringify(event, replacer);
    const entry = { time: event.timestamp, json, bytes: utf8Bytes(json) };
    current.entries.push(entry);
    current.bytes += entry.bytes;
    bytes += entry.bytes;
    trim(entry.time);
  };

  const marker = (tag: string) =>
    add({ type: CUSTOM, timestamp: Date.now(), data: { tag, payload: {} } });

  const halt = () => {
    paused = true;
    stop?.();
    stop = undefined;
  };

  const run = () => {
    try {
      // rrweb checks the interval at each change, so an idle page takes no new
      // snapshot. Its newest generation keeps it playable.
      stop = record({
        emit: add,
        ...rrweb,
        checkoutEveryNms: CHECKOUT_MS,
        errorHandler: () => true,
      });
    } catch {
      halt();
    }
  };

  const clip = (range: ClipRange, trigger: Trigger): RecordingClip | undefined => {
    if (ended) return;
    const now = Date.now();
    trim(now);
    const fromBuffer = range.last !== undefined || range.whole === true;
    if (fromBuffer && !generations.length) return;
    // A Clip from the buffer starts at a generation: the newest one at or
    // before the requested start, else the oldest one. A Clip from the call
    // starts at the generation that the snapshot below opens.
    const time = (i: number) => generations[i].entries[0].time;
    const requested = range.last === undefined ? -Infinity : now - range.last;
    let first = 0;
    while (first + 1 < generations.length && time(first + 1) <= requested) first++;
    const truncated = range.last !== undefined && time(0) > requested;
    const start = fromBuffer ? time(first) : now;

    const id = randomHex(16);
    const span = ctx.tracer.startSpan("recording", {
      root: true,
      startTime: start,
      attributes: {
        "session.id": sessionId,
        "everr.recording.clip.id": id,
        "everr.recording.stream.id": streamId,
        "everr.recording.trigger": trigger,
        ...(truncated ? { "everr.recording.clip.truncated": true } : {}),
      },
    });

    let live = true;
    const state = {
      from: fromBuffer ? generations[first].n : generationCount,
      close(hide: boolean) {
        if (!live) return;
        live = false;
        clearTimeout(cap);
        if (!hide) sendLive();
        clips.delete(state);
        if (!clips.size) clearInterval(flush);
        span.end();
      },
    };
    if (!clips.size) flush = setInterval(sendLive, FLUSH_MS);
    clips.add(state);
    if (fromBuffer) sendLive();
    // A paused recorder takes the snapshot on resume.
    else if (!paused) {
      try {
        record.takeFullSnapshot(true);
      } catch {
        // rrweb throws when it is not recording. The Clip then starts at the next snapshot.
      }
    }
    const cap = setTimeout(
      () => state.close(false),
      Math.min(range.next ?? CLIP_CAP_MS, CLIP_CAP_MS),
    );
    if (range.next === 0) state.close(false);
    return { id, startTime: start, isRecording: () => live, end: () => state.close(false) };
  };

  setAttributes({ "everr.recording.stream.id": streamId });
  run();

  return {
    clip,
    observe(item) {
      const kind = failure(item);
      if (!kind || auto?.isRecording() || autoClips >= AUTO_CLIPS_PER_PAGE) return;
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
      generations.length = 0;
      buckets.clear();
      setAttributes({ "everr.recording.stream.id": null });
    },
  };
}
