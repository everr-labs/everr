// The recording Instrumentation. It lives on `@everr/otel-web/recording` so the
// main entry does not carry it. `recording()` decides the sample, then loads
// the recorder chunk with import() only for a sampled Session. `recorder` is
// the imperative surface: `emitClip()`, `startClip()`, `pause()`, and
// `resume()`.
//
// One recorder per page. A second `recording()` while the first is installed
// does nothing. Shutdown of the first releases the page, so a later WebSDK
// (a consent upgrade constructs one) can record again.

import {
  type AutomaticRecordingTrigger,
  emitLogNow,
  onSessionChange,
  setAttributes,
  setRecordingTrigger,
} from "@everr/otel-web";
import type { Instrumentation } from "./instrumentations/runtime.js";
import { hashUnit } from "./instrumentations/sampled.js";

const STREAM_ID = "everr.recording.stream.id";

export type RecordingOptions = {
  /** Fraction of Sessions that load the recorder. The default is 1. */
  sampleRate?: number;
  /** Mask every text node. The default is on. */
  maskAllText?: boolean;
  /** Mask input values. The default is on. */
  maskAllInputs?: boolean;
  /** Block media. The default is on. */
  blockAllMedia?: boolean;
  /** Selectors to Mask, added to the markers. */
  mask?: string[];
  /** Selectors that win over Mask. */
  unmask?: string[];
  /** Selectors to Block, added to the markers. */
  block?: string[];
  /** Selectors to Ignore, added to the markers. File inputs stay ignored. */
  ignore?: string[];
  /** Replaces the asterisk substitution. */
  maskFn?: (text: string) => string;
  /**
   * Attributes to Mask. When omitted, the default is title, placeholder, and
   * aria-label. Passing an empty list disables attribute masking.
   */
  maskAttributes?: string[];
};

export type EmitClipOptions = {
  /** Milliseconds before the call to start the Clip. Without `last`, the Clip is the whole buffer. */
  last?: number;
};

export type StartClipOptions = {
  /** Milliseconds before the call to start the Clip. Without `last`, the Clip is the whole buffer. */
  last?: number;
  /** Milliseconds after the call that the Clip stays open. Capped at 60 000. */
  next?: number;
};

export type RecordingClip = {
  /** Empty for an inert Clip. */
  readonly id: string;
  /** Epoch milliseconds of the requested start. */
  readonly startTime: number;
  /** False before the recorder chunk loads, in an unsampled Session, after the Stream ends, or after end(). */
  isRecording(): boolean;
  /** Closes the tail and emits the recording Span. Idempotent. */
  end(): void;
};

type Recorder = {
  startClip(options?: StartClipOptions): RecordingClip;
  pause(): void;
  resume(): void;
  automatic(trigger: AutomaticRecordingTrigger): void;
  hide(at: number): void;
  stop(): void;
};

let claimed = false;
let current: Recorder | undefined;

export const inertClip = (startTime: number): RecordingClip => ({
  id: "",
  startTime,
  isRecording: () => false,
  end: () => {},
});

export const recorder: {
  emitClip(options?: EmitClipOptions): void;
  startClip(options?: StartClipOptions): RecordingClip;
  pause(): void;
  resume(): void;
} = {
  emitClip(options) {
    recorder.startClip(options).end();
  },
  startClip(options) {
    if (current) return current.startClip(options);
    const now = Date.now();
    return inertClip(options?.last != null ? now - options.last : now);
  },
  pause() {
    current?.pause();
  },
  resume() {
    current?.resume();
  },
};

/**
 * The id shape used for a visitor, a session, and a page view: a timestamp
 * and a random 13-digit integer. Inlined so this entry does not load the
 * session store.
 */
const newId = (): string => `${Date.now()}-${Math.floor(Math.random() * (9e12 - 1)) + 1e12}`;

export function recording(options?: RecordingOptions): Instrumentation {
  // This function has a name. sampled() hashes instrumentation.name, and a
  // wrapper around recording() must not share a nameless decision.
  return function recording(ctx) {
    if (claimed) return;
    claimed = true;
    const removeHide = ctx.onHide(() => {
      current?.hide(Date.now());
    });
    const release = () => {
      removeHide();
      claimed = false;
    };

    const rate = options?.sampleRate ?? 1;
    const clamped = rate <= 0 ? 0 : rate >= 1 ? 1 : rate;
    if (clamped === 0) return release;

    let stopped = false;
    let activeId = "";
    let generation = 0;
    let autoClips = 0;

    const removeTrigger = setRecordingTrigger((trigger) => {
      current?.automatic(trigger);
    });
    const keeps = (id: string) => clamped >= 1 || hashUnit(`${id}:recording`) < clamped;

    const stopStream = () => {
      generation += 1;
      current?.stop();
      current = undefined;
    };

    const startStream = (sessionId: string) => {
      const generationAtStart = generation;
      void import("./recording/recorder.js").then((mod) => {
        if (stopped || generationAtStart !== generation) return;
        current = mod.startRecorder({
          options,
          newId,
          claimAutomaticClip: () => {
            if (autoClips >= 5) return false;
            autoClips += 1;
            return true;
          },
          setStreamId: (id) => {
            setAttributes({ [STREAM_ID]: id });
          },
          emitSegment: (body, attributes, timestamp) => {
            emitLogNow(
              "everr.browser.recording.segment",
              { "session.id": sessionId, ...attributes },
              timestamp,
              undefined,
              body,
            );
          },
          span: (start, end, attributes) => {
            const span = ctx.tracer.startSpan("recording", {
              root: true,
              startTime: start,
              attributes: { "session.id": sessionId, ...attributes },
            });
            span.end(end);
          },
        });
      });
    };

    const sync = (id: string) => {
      if (stopped || id === activeId) return;
      activeId = id;
      stopStream();
      if (id && keeps(id)) startStream(id);
    };

    const unsubscribe = onSessionChange(sync);
    sync(ctx.ids().sessionId);

    return () => {
      stopped = true;
      removeTrigger();
      unsubscribe();
      stopStream();
      release();
    };
  };
}
