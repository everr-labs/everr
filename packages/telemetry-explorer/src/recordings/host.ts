import type { ReactNode } from "react";
import type { ClipSubject } from "./data/schemas";

/**
 * Where the player is drawn.
 * - `inline`: one block in a scrolling column, open from the start.
 * - `split`: panels at the top of a vertical `ResizablePanelGroup`, above the
 *   caller's own panel, so the reader can drag the space between them. It
 *   starts as one row and opens from that row.
 */
export type PlayerPlacement = "inline" | "split";

/**
 * Session recordings on this deployment, present only where they are stored.
 * With it, both lists draw the "With session recording" switch, and the trace
 * view and the error detail draw its player. Without it, neither is drawn and
 * `withRecording` is ignored.
 */
export type SessionRecordingsHost = {
  /** The player for the Clips covering `subject`; nothing when none does. */
  renderPlayer: (subject: ClipSubject, placement: PlayerPlacement) => ReactNode;
};
