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

import {
  type AutomaticRecordingTrigger,
  claimAutomaticClip,
  emitLogNow,
  onSessionChange,
  passiveSessionId,
  setAttributes,
  setRecordingTrigger,
} from "@everr/otel-web";
import type { Instrumentation } from "./instrumentations/runtime.js";
import { hashUnit } from "./instrumentations/sampled.js";

export {
  RECORDING_AUTO_LAST_MS,
  RECORDING_PAUSE_TAG,
  RECORDING_RESUME_TAG,
  RECORDING_TAIL_SLICE_MS,
} from "./recording/format.js";

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

// `last` and `since` are exclusive. With neither, the Clip is the whole buffer.
// `since` is a mark name or an epoch-millisecond timestamp.
export type EmitRecordingOptions = (
  | { last: number; since?: never }
  | { since: string | number; last?: never }
  | { last?: never; since?: never }
) & {
  /**
   * Milliseconds after the call that the Clip stays open. The default is 0.
   * Values above 60 000 are capped. The buffered part is sent at once; the
   * tail leaves as more Segments, one every 5 seconds, and the span when it
   * closes.
   */
  next?: number;
};

type Recorder = {
  emit(options?: EmitRecordingOptions): void;
  mark(name: string, timestamp: number): void;
  pause(): void;
  resume(): void;
  automatic(trigger: AutomaticRecordingTrigger, at?: number): void;
  /** Closes an open tail at page hide, so its Segments and span go at exit. */
  hide(at: number): void;
  stop(): void;
};

let claimed = false;
let current: Recorder | undefined;
let emitMark: ((name: string, timestamp: number) => void) | undefined;

/** Sends a Clip from the current Stream. Does nothing when no recorder is running. */
export function emitRecording(options?: EmitRecordingOptions): void {
  const recorder = current;
  if (!recorder) return;
  // Resolve a Session that changed since the last record before any Segment is
  // built. The listener ends the Stream and drops its buffer, so a Clip never
  // mixes two Sessions.
  passiveSessionId();
  recorder.emit(options);
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
    // The page hide runs before the exit flush of the SDK. Closing an open tail
    // here gives its unsent Segments and its recording span to that flush,
    // inside the keepalive budget.
    const removeHide = ctx.onHide(() => {
      current?.hide(Date.now());
    });
    const release = () => {
      removeHide();
      claimed = false;
      emitMark = undefined;
    };

    const rate = options?.sampleRate ?? 1;
    const clamped = rate <= 0 ? 0 : rate >= 1 ? 1 : rate;
    if (clamped === 0) return release;

    let stopped = false;
    let activeId = "";
    let generation = 0;
    // A trigger can arrive in the moment between stopping the old Stream and
    // the new chunk starting, because a new Session ends the Stream inside the
    // same record that reports the error. Hold it for the new Stream instead
    // of losing the Clip.
    let pendingTrigger:
      | { trigger: AutomaticRecordingTrigger; at: number }
      | undefined;
    // True between a Session change and the new Stream's chunk starting. A
    // trigger in that window belongs to the new Stream, not to the old buffer.
    let restarting = false;
    // Automatic triggers come from the main bundle, next to captureError and
    // the network spans. This entry only registers the listener, and it
    // reaches the current Stream. Before the first chunk loads, current is
    // unset and a trigger does nothing.
    const removeTrigger = setRecordingTrigger((trigger) => {
      if (current) current.automatic(trigger);
      else if (restarting) pendingTrigger = { trigger, at: Date.now() };
    });
    // The same Session decides the same way in every tab. A new Session during
    // this page decides again: the old Stream ends and its buffer is dropped.
    const keeps = (id: string) =>
      clamped >= 1 || hashUnit(`${id}:recording`) < clamped;

    const stopStream = () => {
      generation += 1;
      current?.stop();
      current = undefined;
    };

    const startStream = () => {
      const generationAtStart = generation;
      // The chunk imports @rrweb/record. The host stays here, so the chunk does
      // not carry a second copy of the SDK state. The Clip count is claimed
      // through the main bundle too, because that is the identity store.
      void import("./recording/recorder.js").then((mod) => {
        if (stopped || generationAtStart !== generation) return;
        current = mod.startRecorder({
          dev: ctx.dev,
          options,
          newId,
          claimAutomaticClip,
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
        // The first full snapshot is already in the new buffer, so a trigger
        // that arrived while the chunk loaded can open its Clip now.
        restarting = false;
        const pending = pendingTrigger;
        pendingTrigger = undefined;
        if (pending) current.automatic(pending.trigger, pending.at);
      });
    };

    const sync = (id: string) => {
      if (stopped || id === activeId) return;
      // A session change from an active Stream restarts it; the first sync
      // starts it for the first time.
      restarting = activeId !== "";
      activeId = id;
      stopStream();
      if (keeps(id)) startStream();
      else {
        restarting = false;
        pendingTrigger = undefined;
      }
    };

    const unsubscribe = onSessionChange(sync);
    sync(ctx.ids().sessionId);

    return () => {
      stopped = true;
      restarting = false;
      pendingTrigger = undefined;
      removeTrigger();
      unsubscribe();
      stopStream();
      release();
    };
  };
}
