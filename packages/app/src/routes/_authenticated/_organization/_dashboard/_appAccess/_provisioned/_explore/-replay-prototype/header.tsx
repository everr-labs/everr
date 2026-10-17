import { Pause, Play } from "lucide-react";
import { formatSeconds, STACK } from "./fixture";
import type { Host, RecordingMode } from "./types";

export function FixtureHeader({ host }: { host: Host }) {
  const error = host === "error";
  return (
    <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-medium">
          {error ? "Card declined" : "GET /checkout"}
        </h1>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
          <span>{error ? "shop-api" : "shop-web"}</span>
          <span className="font-mono">18.0s</span>
          <span>4 spans</span>
          <span className="text-destructive">1 error</span>
          <span className="font-mono">trace a1b2c3</span>
        </div>
      </div>
    </div>
  );
}

export function EmptyRecording({ mode }: { mode: RecordingMode }) {
  if (mode === "recording") return null;
  return (
    <div className="grid h-full place-items-center bg-muted/40 p-6 text-center">
      <div>
        <p className="text-sm font-medium">This Session has no Recording.</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Spans, Logs, and errors stay on the timeline.
        </p>
      </div>
    </div>
  );
}

export function PlayButton({
  playing,
  disabled,
  onClick,
}: {
  playing: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={playing ? "Pause" : "Play"}
      disabled={disabled}
      className="inline-flex size-7 items-center justify-center rounded-md border bg-background disabled:opacity-40"
      onClick={onClick}
    >
      {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
    </button>
  );
}

export function StackBlock() {
  return (
    <pre className="overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5">
      {STACK}
    </pre>
  );
}

export function ClockReadout({ timeMs }: { timeMs: number }) {
  return <span className="font-mono text-xs">{formatSeconds(timeMs)}</span>;
}
