// The recorder chunk. The stub in ../recording.ts imports it only for a sampled
// Session, so rrweb stays out of every other bundle.

import { emitLogNow, setAttributes } from "@everr/otel-web";
import type { Tracer } from "@opentelemetry/api";
import { record } from "@rrweb/record";
import type { RecordingClip, RecordingOptions, StartClipOptions } from "../recording.js";
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

/** The buffer of one document in one Session. */
export type Stream = {
  clip(options: StartClipOptions, trigger: Trigger): RecordingClip | undefined;
  trigger(kind: "error" | "network"): void;
  pause(): void;
  resume(): void;
  /** Closes the open Clips at the hide time and drops their unsent tails. */
  hide(): void;
  /** Sends the open tails, ends the Clips, and drops the buffer. */
  end(): void;
};

// The automatic Clips of this document. The chunk loads once per document, and
// the count outlives a Session change.
let autoClips = 0;

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const utf8 = new TextEncoder();

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

  // The 5-minute window and the 10 MB cap. The newest event always stays.
  const trim = (now: number) => {
    let drop = 0;
    while (drop < entries.length - 1 && (entries[drop].time < now - WINDOW_MS || bytes > MAX_BYTES))
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
    // so a Segment and the 10 MB check measure what the request carries.
    const json = JSON.stringify(event, replacer);
    const size = utf8.encode(json).length;
    if (size > MAX_BYTES) {
      // In practice a full snapshot. No later event plays without it, so the
      // recorder stops until resume() or a new Stream.
      marker("everr.recording.oversized");
      halt();
      return;
    }
    if (event.type === FULL_SNAPSHOT) buckets.clear();
    push({ time: event.timestamp, type: event.type, json, bytes: size });
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
      const stopRecord = record({ emit: add, ...rrweb, errorHandler: () => true });
      // An oversized initial snapshot halts before record() returns.
      if (paused) return stopRecord?.();
      stop = stopRecord;
      // Our own checkout, and not checkoutEveryNms: rrweb counts that interval
      // from the last event, so an idle page would age its only snapshot out.
      checkout = setInterval(() => record.takeFullSnapshot(true), CHECKOUT_MS);
    } catch {
      halt();
    }
  };

  const clip = (clipOptions: StartClipOptions, trigger: Trigger): RecordingClip | undefined => {
    if (ended) return;
    const now = Date.now();
    trim(now);
    const requested = clipOptions.last === undefined ? undefined : now - clipOptions.last;
    // A Clip starts at a full snapshot, with the Meta event in front of it.
    let first = -1;
    let earliest = -1;
    entries.forEach((entry, i) => {
      if (entry.type !== FULL_SNAPSHOT) return;
      if (earliest < 0) earliest = i;
      if (requested === undefined ? first < 0 : entry.time <= requested) first = i;
    });
    if (earliest < 0) return;
    const truncated = first < 0;
    if (truncated) first = earliest;
    if (entries[first - 1]?.type === META) first--;
    const startTime = requested ?? entries[first].time;

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
    const emitSegment = (events: Entry[]) =>
      void emitLogNow(
        "everr.browser.recording.segment",
        {
          "session.id": sessionId,
          "everr.recording.stream.id": streamId,
          "everr.recording.clip.id": id,
          "everr.recording.segment.index": index++,
        },
        events[events.length - 1].time,
        `[${events.map((e) => e.json).join(",")}]`,
      );
    // About 950 KB per Segment. An event that is larger goes alone.
    const send = (list: Entry[]) => {
      let batch: Entry[] = [];
      let size = 2;
      for (const entry of list) {
        if (batch.length && size + entry.bytes > SEGMENT_BYTES) {
          emitSegment(batch);
          batch = [];
          size = 2;
        }
        batch.push(entry);
        size += entry.bytes + 1;
      }
      if (batch.length) emitSegment(batch);
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
    send(entries.slice(first));
    clips.add(state);
    const flush = setInterval(() => send(state.tail.splice(0)), TAIL_FLUSH_MS);
    const cap = setTimeout(
      () => state.close(false),
      Math.min(clipOptions.next ?? TAIL_CAP_MS, TAIL_CAP_MS),
    );
    if (clipOptions.next === 0) state.close(false);
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
