import { useState } from "react";
import {
  DURATION_MS,
  formatSeconds,
  msFromPointer,
  onTrackKey,
  pct,
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

const OCCURRENCES = [
  { id: "this", label: "2m ago", note: "this Session", recorded: true },
  { id: "other-1", label: "18m ago", note: "another Session", recorded: false },
  { id: "other-2", label: "1h ago", note: "another Session", recorded: false },
];

// The Trace or the error stays the page. Replay is a dock that follows the selection.
export function VariantDock(props: VariantProps) {
  const [occurrence, setOccurrence] = useState(OCCURRENCES[0].id);
  const current =
    OCCURRENCES.find((item) => item.id === occurrence) ?? OCCURRENCES[0];
  const showRecording = props.mode === "recording" && current.recorded;
  const showSlot = props.mode !== "no-session";
  const selected = signalById(props.selectedId);
  const spans = signals.filter((signal) => signal.kind === "span");

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Dock">
      <FixtureHeader host={props.host} />
      <div
        className={`grid min-h-0 flex-1 ${showSlot ? "grid-cols-[minmax(0,1fr)_22rem]" : ""}`}
      >
        <div className="min-h-0 overflow-auto border-r">
          {props.host === "trace" ? (
            <div
              role="slider"
              tabIndex={0}
              aria-label="Spans"
              aria-valuemin={0}
              aria-valuemax={DURATION_MS}
              aria-valuenow={Math.min(props.timeMs, DURATION_MS)}
              className="relative cursor-pointer px-4 py-3"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                props.onSeek(
                  msFromPointer(event.clientX, rect.left, rect.width),
                );
              }}
              onKeyDown={(event) =>
                onTrackKey(event, props.timeMs, props.onSeek)
              }
            >
              {spans.map((signal) => (
                <button
                  key={signal.id}
                  type="button"
                  className={`relative mb-1 block h-8 w-full rounded text-left text-xs ${
                    signal.id === props.selectedId ? "bg-muted" : ""
                  }`}
                  style={{ paddingLeft: 12 + signal.depth * 16 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSelect(signal);
                  }}
                >
                  <span
                    className="absolute top-1 h-6 rounded-sm bg-sky-700/80"
                    style={{
                      left: `calc(${pct(signal.t)} + ${signal.depth * 16}px)`,
                      width: `max(${pct(signal.dur)}, 6px)`,
                    }}
                  />
                  <span className="relative">{signal.name}</span>
                </button>
              ))}
              <Marks {...props} />
              {props.mode !== "no-session" && (
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
                  style={{ left: pct(props.timeMs) }}
                />
              )}
            </div>
          ) : (
            <div className="grid gap-3 p-4">
              <StackBlock />
              <ul className="grid gap-1">
                {OCCURRENCES.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs ${
                        item.id === occurrence ? "bg-muted" : ""
                      }`}
                      onClick={() => {
                        setOccurrence(item.id);
                        if (!item.recorded && props.playing)
                          props.onTogglePlay();
                      }}
                    >
                      <span>{item.label}</span>
                      <span className="text-muted-foreground">{item.note}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {showSlot && (
          <aside className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <PlayButton
                playing={props.playing}
                disabled={!showRecording}
                onClick={props.onTogglePlay}
              />
              <ClockReadout timeMs={props.timeMs} />
              <span className="text-muted-foreground text-[10px]">
                Stream checkout
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {showRecording ? (
                <ReplayStage
                  key={`${props.host}-${props.mode}-${occurrence}`}
                  handleRef={props.playerRef}
                  initialTime={props.timeMs}
                  onEnded={props.onEnded}
                />
              ) : (
                <EmptyRecording mode={current.recorded ? props.mode : "none"} />
              )}
            </div>
            <div className="border-t px-3 py-2 text-xs">
              <div className="font-medium">{selected.name}</div>
              <div className="text-muted-foreground">
                {formatSeconds(selected.t)} · {selected.detail}
              </div>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

function Marks(props: VariantProps) {
  const marks = signals.filter((signal) => signal.kind !== "span");
  return (
    <>
      {marks.map((signal) => (
        <button
          key={signal.id}
          type="button"
          title={signal.name}
          className={`absolute top-1 size-2 rounded-full ${
            signal.kind === "error" ? "bg-destructive" : "bg-amber-600"
          }`}
          style={{ left: pct(signal.t) }}
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(signal);
          }}
        />
      ))}
    </>
  );
}
