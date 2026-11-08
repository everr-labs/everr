// The recording entry. This stub imports the recorder chunk with rrweb when
// the instrumentation starts, so a Session that `sampled()` refuses never
// downloads it. The chunk keeps the page in memory, aiming for the last 5
// minutes and 10 MB, and nothing leaves the page until a Clip. Refer to
// docs/specs/2026-10-22-otel-web-recording.md.

import type { Instrumentation } from "@everr/otel-web";
import type { Stream } from "./recording/recorder.js";

export type RecordingOptions = {
  maskAllText?: boolean;
  maskAllInputs?: boolean;
  blockAllMedia?: boolean;
  mask?: string[];
  unmask?: string[];
  block?: string[];
  ignore?: string[];
  maskFn?: (text: string) => string;
  maskAttributes?: string[];
};

export type EmitClipOptions = {
  /**
   * Starts the Clip this many milliseconds before the call, at the full
   * snapshot at or before that moment. Without it, `emitClip()` sends the whole
   * buffer (it aims for the last 5 minutes) and `startClip()` starts at the call.
   */
  last?: number;
};

export type StartClipOptions = EmitClipOptions & {
  /** Closes the Clip this many milliseconds after the call. Capped at, and by default, 60 000. */
  next?: number;
};

export type RecordingClip = {
  /** Empty for an inert Clip. */
  readonly id: string;
  /** Epoch milliseconds of the start: the call, or the full snapshot at or before `last` milliseconds before it. */
  readonly startTime: number;
  /** False before the recorder chunk loads, in an unsampled Session, after the Stream ends, or after end(). */
  isRecording(): boolean;
  /** Sends what the Clip still needs and emits the recording Span. Idempotent. */
  end(): void;
};

// The handle when capture cannot start. Callers need no branch before end().
const inertClip = ({ last }: EmitClipOptions): RecordingClip => ({
  id: "",
  startTime: Date.now() - (last ?? 0),
  isRecording: () => false,
  end() {},
});

// The recorder of this page. One recorder runs per page, also with two WebSDK
// instances. Its shutdown releases the page.
let page: { stream?: Stream } | undefined;

/** Acts on the recorder of the current page. Each method does nothing when no Stream buffers. */
export const recorder = {
  /** Sends the buffered history now: the last `last` milliseconds, or by default the whole buffer. */
  emitClip(options: EmitClipOptions = {}): void {
    // With next: 0 the Clip closes before clip() returns.
    page?.stream?.clip({ ...options, whole: true, next: 0 }, "manual");
  },
  /**
   * Starts a Clip that records until `end()`, `next`, or 60 seconds. Without
   * `last`, it starts at the call with a new full snapshot and sends nothing
   * from before. With `last`, the buffered part is sent before it returns.
   */
  startClip(options: StartClipOptions = {}): RecordingClip {
    return page?.stream?.clip(options, "manual") ?? inertClip(options);
  },
  pause(): void {
    page?.stream?.pause();
  },
  resume(): void {
    page?.stream?.resume();
  },
};

export function recording(options: RecordingOptions = {}): Instrumentation {
  return function recording(ctx) {
    if (page) return;
    const state: { stream?: Stream } = {};
    page = state;
    // One Stream per page, for the Session at setup.
    const id = ctx.ids().sessionId;
    import("./recording/recorder.js")
      .then(({ startStream }) => {
        if (page === state) state.stream = startStream(ctx, id, options);
      })
      // A failed chunk load or start only means no recording. It is never an app error.
      .catch(() => {});
    const stopRecord = ctx.onRecord((item) => state.stream?.observe(item));
    // A hidden tab can come back: its open Clips send what they have and go
    // on. An unload ends them; a request started then may not finish.
    const stopHide = ctx.onHide((unload) =>
      unload ? state.stream?.hide() : state.stream?.flush(),
    );
    return () => {
      stopHide();
      stopRecord();
      state.stream?.end();
      if (page === state) page = undefined;
    };
  };
}
