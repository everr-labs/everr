// The recording entry. This stub imports the recorder chunk with rrweb when
// the instrumentation starts, so a Session that `sampled()` refuses never
// downloads it. The chunk keeps the last 5 minutes of the page in memory, and
// nothing leaves the page until a Clip. Refer to docs/specs/2026-10-22-otel-web-recording.md.

import type { Instrumentation } from "@everr/otel-web";
// The page state is imported by path, not by the package name, so these stay
// off the public entry. The build puts it in a chunk shared with that entry.
import { setRecordingTrigger } from "./state/recording.js";
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
   * buffer (up to 5 minutes) and `startClip()` starts at the call.
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
  /** Epoch milliseconds of the start: the call, or `last` milliseconds before it. */
  readonly startTime: number;
  /** False before the recorder chunk loads, in an unsampled Session, after the Stream ends, or after end(). */
  isRecording(): boolean;
  /** Closes the tail and emits the recording Span. Idempotent. */
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
  /** Sends the buffered history now: the last `last` milliseconds, or by default the whole buffer (up to 5 minutes). */
  emitClip(options: EmitClipOptions = {}): void {
    (
      page?.stream?.clip({ ...options, whole: true, next: 0 }, "manual") ?? inertClip(options)
    ).end();
  },
  /**
   * Starts a Clip that records until `end()`, `next`, or 60 seconds. Without
   * `last`, it starts at the call with a new full snapshot and sends nothing
   * from before. With `last`, the buffered part is sent before it returns.
   */
  startClip(options: StartClipOptions = {}): RecordingClip {
    return page?.stream?.clip(options, "manual") ?? inertClip(options);
  },
};

export function recording(options: RecordingOptions = {}): Instrumentation {
  return function recording(ctx) {
    if (page) return;
    const state: { stream?: Stream } = {};
    page = state;
    // One Stream per page, for the Session at setup.
    const id = ctx.ids().sessionId;
    if (id) {
      import("./recording/recorder.js")
        .then(({ startStream }) => {
          if (page === state) state.stream = startStream(ctx.tracer, id, options);
        })
        // A failed chunk load or start only means no recording. It is never an app error.
        .catch(() => {});
    }
    const stopTrigger = setRecordingTrigger((kind) => state.stream?.trigger(kind));
    const stopHide = ctx.onHide(() => state.stream?.hide());
    return () => {
      stopHide();
      stopTrigger();
      state.stream?.end();
      state.stream = undefined;
      if (page === state) page = undefined;
    };
  };
}
