// The recording entry. This stub decides the sampling for each Session, and
// only a sampled Session imports the recorder chunk with rrweb. The chunk
// keeps the last 5 minutes of the page in memory, and nothing leaves the page
// until a Clip. Refer to docs/specs/2026-10-22-otel-web-recording.md.

import type { Instrumentation } from "@everr/otel-web";
// The page state is imported by path, not by the package name, so these stay
// off the public entry. The build puts it in a chunk shared with that entry.
import { setRecordingTrigger } from "./state/recording.js";
import { onSessionChange } from "./state/session.js";
import { hashUnit } from "./instrumentations/sampled.js";
import type { Stream } from "./recording/recorder.js";

export type RecordingOptions = {
  /** The share of Sessions that load the recorder, from 0 to 1. The default is 1. */
  sampleRate?: number;
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
  /** Starts the Clip this many milliseconds before the call. Without it, the Clip is the whole buffer. */
  last?: number;
};

export type StartClipOptions = EmitClipOptions & {
  /** Closes the tail after this many milliseconds, capped at 60 000. */
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
  /** Sends the buffered history now and closes the Clip: `startClip(options).end()`. */
  emitClip(options?: EmitClipOptions): void {
    recorder.startClip(options).end();
  },
  /** Starts a Clip from the current Stream. The buffered part is sent before it returns. */
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
  const rate = options.sampleRate ?? 1;
  return function recording(ctx) {
    if (page) return;
    const state: { stream?: Stream } = {};
    page = state;
    let session: string | null = null;

    const start = (id: string | null) => {
      state.stream?.end();
      state.stream = undefined;
      session = id;
      if (!id || !(rate >= 1 || hashUnit(`${id}:recording`) < rate)) return;
      import("./recording/recorder.js")
        .then(({ startStream }) => {
          if (page === state && session === id) state.stream = startStream(ctx.tracer, id, options);
        })
        // A failed chunk load or start only means no recording. It is never an app error.
        .catch(() => {});
    };

    start(ctx.ids().sessionId);
    const stopSession = onSessionChange((id) => id !== session && start(id));
    const stopTrigger = setRecordingTrigger((kind) => state.stream?.trigger(kind));
    const stopHide = ctx.onHide(() => state.stream?.hide());
    return () => {
      stopHide();
      stopTrigger();
      stopSession();
      start(null);
      if (page === state) page = undefined;
    };
  };
}
