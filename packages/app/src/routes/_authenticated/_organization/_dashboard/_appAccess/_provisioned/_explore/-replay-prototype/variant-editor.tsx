import {
  DURATION_MS,
  formatSeconds,
  msFromPointer,
  onTrackKey,
  pct,
  signalById,
  signals,
} from "./fixture";
import { EmptyRecording, FixtureHeader, PlayButton } from "./header";
import { ReplayStage } from "./player";
import type { VariantProps } from "./types";

// One ruler. The player is a lane. There is no span tree and no side panel.
export function VariantEditor(props: VariantProps) {
  const selected = signalById(props.selectedId);
  const showSlot = props.mode !== "no-session";
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Editor">
      <FixtureHeader host={props.host} />
      <div className="relative shrink-0 border-b">
        <div className="flex items-center gap-3 px-3 py-2">
          <PlayButton
            playing={props.playing}
            disabled={props.mode !== "recording"}
            onClick={props.onTogglePlay}
          />
          <span className="w-12 font-mono text-xs">
            {formatSeconds(props.timeMs)}
          </span>
          <span className="truncate text-sm">{selected.name}</span>
          <span className="text-muted-foreground truncate text-xs">
            {selected.detail}
          </span>
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={DURATION_MS}
          aria-valuenow={Math.min(props.timeMs, DURATION_MS)}
          className="relative mx-3 mb-3 h-10 cursor-pointer"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            props.onSeek(msFromPointer(event.clientX, rect.left, rect.width));
          }}
          onKeyDown={(event) => onTrackKey(event, props.timeMs, props.onSeek)}
        >
          {signals.map((signal) => (
            <button
              key={signal.id}
              type="button"
              title={`${signal.kind} ${signal.name}`}
              className={`absolute top-2 h-6 rounded-sm text-[10px] text-white ${
                signal.kind === "error"
                  ? "bg-destructive"
                  : signal.kind === "log"
                    ? "bg-amber-600"
                    : "bg-foreground/80"
              } ${signal.id === props.selectedId ? "ring-2 ring-sky-500" : ""}`}
              style={{
                left: pct(signal.t),
                width:
                  signal.dur > 0 ? `max(${pct(signal.dur)}, 10px)` : "10px",
              }}
              onClick={(event) => {
                event.stopPropagation();
                props.onSelect(signal);
              }}
            />
          ))}
          {props.mode !== "no-session" && (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-sky-500"
              style={{ left: pct(Math.min(props.timeMs, DURATION_MS)) }}
            />
          )}
        </div>
      </div>
      {showSlot && (
        <div className="min-h-0 flex-1">
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
        </div>
      )}
    </section>
  );
}
