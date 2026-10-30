// The slot for the automatic recording Clips. The errors and the network
// instrumentation pull the trigger. The recording subpath fills the slot, so
// that the main entry carries no recording code.

type RecordingTrigger = (kind: "error" | "network") => void;

let trigger: RecordingTrigger | undefined;

export const triggerRecording: RecordingTrigger = (kind) => trigger?.(kind);

/** @internal For `@everr/otel-web/recording`. Returns the function that empties the slot. */
export function setRecordingTrigger(next: RecordingTrigger): () => void {
  trigger = next;
  return () => {
    if (trigger === next) trigger = undefined;
  };
}
