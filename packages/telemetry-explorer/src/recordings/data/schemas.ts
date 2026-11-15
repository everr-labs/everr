import { z } from "zod";

/** The SDK stamps this on every browser span and log once its page records. */
export const RECORDING_STREAM_ATTRIBUTE = "everr.recording.stream.id";

export const CLIP_TRIGGERS = ["error", "network", "manual"] as const;
export type ClipTrigger = (typeof CLIP_TRIGGERS)[number];

/**
 * The record whose Clips the player asks for, by identity only, so the server
 * runs the same coverage rule as the list filters.
 *
 * - `trace`: a trace, or an exception log without a stream id, through its trace.
 * - `log`: an exception log with a stream id. `at` is the log's
 *   `toString(Timestamp)`, which `parseDateTime64BestEffort(at, 9)` reads back
 *   to the same instant.
 */
export const ClipSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trace"), traceId: z.string().min(1) }),
  z.object({ kind: z.literal("log"), streamId: z.string().min(1), at: z.string().min(1) }),
]);
export type ClipSubject = z.infer<typeof ClipSubjectSchema>;

/** One Clip that covers a subject. Times are epoch milliseconds on the browser clock. */
export type CoveringClip = {
  clipId: string;
  streamId: string;
  sessionId: string;
  serviceName: string;
  trigger: ClipTrigger;
  /** The Stream did not reach back as far as the trigger asked. */
  truncated: boolean;
  startMs: number;
  endMs: number;
  /** The subject's part of the Clip: its covered spans, or the error instant. */
  focus: { startMs: number; endMs: number };
};
