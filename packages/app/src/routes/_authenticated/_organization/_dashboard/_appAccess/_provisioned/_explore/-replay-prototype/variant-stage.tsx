import {
  DURATION_MS,
  formatSeconds,
  msFromPointer,
  onTrackKey,
  pct,
  type Signal,
  signalById,
  signals,
} from "./fixture";
import {
  ClockReadout,
  EmptyRecording,
  FixtureHeader,
  PlayButton,
  StackBlock,
} from "./header";
import { ReplayStage } from "./player";
import type { VariantProps } from "./types";

// Player is the page. Spans, Logs, and errors are lanes under it.
export function VariantStage(props: VariantProps) {
  const selected = signalById(props.selectedId);
  const showSlot = props.mode !== "no-session";
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Stage">
      <FixtureHeader host={props.host} />
      {showSlot && (
        <div className="relative min-h-0 flex-[3] border-b">
          {props.mode === "recording" ? (
            <ReplayStage
              key={`${props.host}-${props.mode}`}
              handleRef={props.playerRef}
              initialTime={props.timeMs}
              onEnded={props.onEnded}
            />
          ) : (
            <EmptyRecording mode={props.mode} />
          )}
          <div className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground">
            Stream checkout
          </div>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <PlayButton
          playing={props.playing}
          disabled={props.mode !== "recording"}
          onClick={props.onTogglePlay}
        />
        <ClockReadout timeMs={props.timeMs} />
        <span className="text-muted-foreground text-xs">
          {props.mode === "recording"
            ? "buffer until the error, then the Session"
            : "timeline only"}
        </span>
      </div>
      <div className="min-h-0 flex-[2] overflow-auto px-4 py-3">
        <Lane
          label="Spans"
          items={signals.filter((signal) => signal.kind === "span")}
          {...props}
        />
        <Lane
          label="Logs"
          items={signals.filter((signal) => signal.kind === "log")}
          {...props}
        />
        <Lane
          label="Errors"
          items={signals.filter((signal) => signal.kind === "error")}
          {...props}
        />
        <div className="mt-3 rounded-md border px-3 py-2 text-sm">
          <div className="font-medium">{selected.name}</div>
          <div className="text-muted-foreground text-xs">
            {selected.service} · {formatSeconds(selected.t)} · {selected.detail}
          </div>
          {props.host === "error" && (
            <div className="mt-3">
              <StackBlock />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Lane({
  label,
  items,
  timeMs,
  selectedId,
  onSeek,
  onSelect,
}: {
  label: string;
  items: Signal[];
} & Pick<VariantProps, "timeMs" | "selectedId" | "onSeek" | "onSelect">) {
  return (
    <div className="mb-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
        {label}
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={DURATION_MS}
        aria-valuenow={Math.min(timeMs, DURATION_MS)}
        className="relative h-8 cursor-pointer rounded bg-muted/50"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onSeek(msFromPointer(event.clientX, rect.left, rect.width));
        }}
        onKeyDown={(event) => onTrackKey(event, timeMs, onSeek)}
      >
        {items.map((signal) => (
          <button
            key={signal.id}
            type="button"
            title={signal.name}
            className={`absolute top-1 h-6 rounded-sm text-left text-[10px] text-white ${
              signal.kind === "error"
                ? "bg-destructive"
                : signal.kind === "log"
                  ? "bg-amber-600"
                  : "bg-sky-700"
            } ${signal.id === selectedId ? "ring-2 ring-foreground" : ""}`}
            style={{
              left: pct(signal.t),
              width: signal.dur > 0 ? `max(${pct(signal.dur)}, 8px)` : "8px",
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(signal);
            }}
          >
            <span className="truncate px-1">{signal.name}</span>
          </button>
        ))}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
          style={{ left: pct(Math.min(timeMs, DURATION_MS)) }}
        />
      </div>
    </div>
  );
}
