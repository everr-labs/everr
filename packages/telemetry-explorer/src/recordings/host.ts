import type { ReactNode } from "react";
import type { ClipSubject } from "./data/schemas";

/**
 * Session recordings on this deployment, present only where they are stored.
 * With it, both lists draw the "With session recording" switch, and the trace
 * view and the error detail draw its player. Without it, neither is drawn and
 * `withRecording` is ignored.
 */
export type SessionRecordingsHost = {
  /** The player for the Clips covering `subject`; nothing when none does. */
  renderPlayer: (subject: ClipSubject) => ReactNode;
};
