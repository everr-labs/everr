// The slot an automatic Clip listens on. errors() and network() notify it
// after their own filters. The recording entry registers the listener through
// the main package, so the two bundles share this one binding.
// InstrumentationContext stays unchanged: integrators do not see the slot.

// A Clip is triggered by an error, a failed request, or a manual call.
// Automatic triggers are the subset the error and network paths send.
export type RecordingTrigger = "error" | "network" | "manual";
export type AutomaticRecordingTrigger = Exclude<RecordingTrigger, "manual">;

type RecordingTriggerListener = (trigger: AutomaticRecordingTrigger) => void;

let listener: RecordingTriggerListener | undefined;

export function setRecordingTrigger(next: RecordingTriggerListener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = undefined;
  };
}

export function notifyRecordingTrigger(trigger: AutomaticRecordingTrigger): void {
  try {
    listener?.(trigger);
  } catch {
    // A failure while opening a Clip must not break the error or the request.
  }
}
