// The recording Instrumentation. It lives on `@everr/otel-web/recording` so the
// main entry does not carry it. `recording()` decides the sample, then loads
// the recorder chunk with import() only for a sampled Session. `emitRecording()`
// sends a Clip. Before the chunk has loaded, and in an unsampled Session, it
// does nothing.
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
  /** Mask every text node. The default is on when `dev` is not true. */
  maskAllText?: boolean;
  /** Mask input values. The default is on when `dev` is not true. */
  maskAllInputs?: boolean;
  /** Block media. The default is on when `dev` is not true. */
  blockAllMedia?: boolean;
  /** Selectors to Mask, added to the markers. */
  mask?: string[];
  /** Selectors that win over Mask. */
  unmask?: string[];
  /** Selectors to Block, added to the markers. */
  block?: string[];
  /** Selectors that win over Block. */
  unblock?: string[];
  /** Selectors to Ignore, added to the markers. File inputs stay ignored. */
  ignore?: string[];
  /** Replaces the asterisk substitution. */
  maskFn?: (text: string) => string;
  /**
   * Attributes to Mask. When omitted and `dev` is not true, the default is
   * title, placeholder, and aria-label.
   */
  maskAttributes?: string[];
};

export type EmitRecordingOptions = {
  /** Milliseconds before the call. Without it, the Clip is the whole buffer. */
  last?: number;
};

type Recorder = {
  emit(options?: EmitRecordingOptions): void;
  stop(): void;
};

let claimed = false;
let current: Recorder | undefined;

/** Sends a Clip from the current Stream. Does nothing when no recorder is running. */
export function emitRecording(options?: EmitRecordingOptions): void {
  current?.emit(options);
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
    const release = () => {
      claimed = false;
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
        dev: ctx.dev,
        options,
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
