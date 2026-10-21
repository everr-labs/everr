// The parts of the Clip format that the Everr app reads back. The recorder
// writes them and the app's replay loader imports them from
// `@everr/otel-web/recording`, so the two cannot drift.

/** rrweb custom event tag the recorder adds when it pauses. */
export const RECORDING_PAUSE_TAG = "everr.recording.pause";
/** rrweb custom event tag the recorder adds when it resumes. */
export const RECORDING_RESUME_TAG = "everr.recording.resume";
/** A tail closes its current Segment on this cadence, and sooner when it ends. */
export const RECORDING_TAIL_SLICE_MS = 5_000;
/**
 * An automatic Clip asks for this much before its first trigger, so the
 * trigger sits this far after the start of the recording span.
 */
export const RECORDING_AUTO_LAST_MS = 60_000;
