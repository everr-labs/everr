// The recording Instrumentation. It lives on `@everr/otel-web/recording` so the
// main entry does not carry it. `recording()` decides the sample, then loads
// the recorder chunk with import() only for a sampled Session. `emitRecording()`
// sends a Clip. Before the chunk has loaded, and in an unsampled Session, it
// does nothing. `markRecording()` still emits its mark log in those cases:
// the named point is only stored once a recorder is running.
//
// One recorder per page. A second `recording()` while the first is installed
// does nothing. Shutdown of the first releases the page, so a later WebSDK
// (a consent upgrade constructs one) can record again.

import { emitLogNow, setAttributes } from "@everr/otel-web";
import type { Instrumentation } from "./instrumentations/runtime.js";
import { hashUnit } from "./instrumentations/sampled.js";

const STREAM_ID = "everr.recording.stream.id";

export type RecordingOptions = {
  /** Fraction of Sessions that load the recorder. The default is 1. */
  sampleRate?: number;
};

// `last` and `since` are exclusive. With neither, the Clip is the whole buffer.
// `since` is a mark name or an epoch-millisecond timestamp.
export type EmitRecordingOptions =
  | { last: number; since?: never }
  | { since: string | number; last?: never };

type Recorder = {
  emit(options?: { last?: number; since?: string | number }): void;
  mark(name: string, timestamp: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
};

let claimed = false;
let current: Recorder | undefined;
let emitMark: ((name: string, timestamp: number) => void) | undefined;

/** Sends a Clip from the current Stream. Does nothing when no recorder is running. */
export function emitRecording(options?: EmitRecordingOptions): void {
  current?.emit(options);
}

/** Names a point in the current Stream. The same name replaces the earlier mark. */
export function markRecording(name: string): void {
  const timestamp = Date.now();
  emitMark?.(name, timestamp);
  current?.mark(name, timestamp);
}

/** Stops the recorder. Nothing is buffered while it is paused. */
export function pauseRecording(): void {
  current?.pause();
}

/** Starts the recorder again. The new start takes a full snapshot. */
export function resumeRecording(): void {
  current?.resume();
}

/**
 * The id shape used for a visitor, a session, and a page view: a timestamp
 * and a random 13-digit integer. Inlined so this entry does not load the
 * session store.
 */
const newId = (): string =>
  `${Date.now()}-${Math.floor(Math.random() * (9e12 - 1)) + 1e12}`;

export function recording(options?: RecordingOptions): Instrumentation {
  // This function has a name. sampled() hashes instrumentation.name, and a
  // wrapper around recording() must not share a nameless decision.
  return function recording(ctx) {
    if (claimed) return;
    claimed = true;
    emitMark = (name, timestamp) => {
      ctx.emit(
        "everr.browser.recording.mark",
        { "everr.recording.mark.name": name },
        timestamp,
      );
    };
    const release = () => {
      claimed = false;
      emitMark = undefined;
    };

    const rate = options?.sampleRate ?? 1;
    const clamped = rate <= 0 ? 0 : rate >= 1 ? 1 : rate;
    if (
      clamped === 0 ||
      (clamped < 1 && hashUnit(`${ctx.ids().sessionId}:recording`) >= clamped)
    ) {
      return release;
    }

    let stopped = false;
    // The chunk imports @rrweb/record. The host stays here, so the chunk does
    // not carry a second copy of the SDK state.
    void import("./recording/recorder.js").then((mod) => {
      if (stopped) return;
      current = mod.startRecorder({
        newId,
        setStreamId: (id) => {
          setAttributes({ [STREAM_ID]: id });
        },
        emitSegment: (body, attributes, timestamp) => {
          emitLogNow(
            "everr.browser.recording.segment",
            attributes,
            timestamp,
            undefined,
            body,
          );
        },
        span: (start, end, attributes) => {
          const span = ctx.tracer.startSpan("recording", {
            root: true,
            startTime: start,
            attributes,
          });
          span.end(end);
        },
      });
    });

    return () => {
      stopped = true;
      current?.stop();
      current = undefined;
      release();
    };
  };
}
