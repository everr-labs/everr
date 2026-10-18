import type { RefObject } from "react";
import type { Signal } from "./fixture";
import type { ReplayHandle } from "./player";

export type Host = "trace" | "error";
export type RecordingMode = "recording" | "none" | "no-session";

export type VariantProps = {
  host: Host;
  mode: RecordingMode;
  timeMs: number;
  playing: boolean;
  selectedId: string;
  playerRef: RefObject<ReplayHandle | null>;
  onSeek: (ms: number) => void;
  onSelect: (signal: Signal) => void;
  onClearSelection: () => void;
  onTogglePlay: () => void;
  onEnded: () => void;
};
