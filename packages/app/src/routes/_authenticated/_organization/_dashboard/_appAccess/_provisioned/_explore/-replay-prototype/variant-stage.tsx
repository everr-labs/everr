import { TraceExplorer } from "@everr/telemetry-explorer/traces";
import {
  checkoutTraceRepo,
  signals,
  spanUnderPlayhead,
  TRACE_END,
  TRACE_ID,
  TRACE_START,
} from "./fixture";
import {
  ClockReadout,
  EmptyRecording,
  FixtureHeader,
  PlayButton,
} from "./header";
import { ReplayStage } from "./player";
import type { VariantProps } from "./types";

// Player is the page. Under it, the real trace view: waterfall, span details,
// and the click, log, and error as span events.
export function VariantStage(props: VariantProps) {
  const showReplay = props.mode !== "no-session";
  const spanId = explorerSpanId(props.selectedId, props.playing, props.timeMs);
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Stage">
      <FixtureHeader host={props.host} />
      {showReplay && (
        <div className="relative h-56 shrink-0 border-b">
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
      {showReplay && (
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <PlayButton
            playing={props.playing}
            disabled={props.mode !== "recording"}
            onClick={props.onTogglePlay}
          />
          <ClockReadout timeMs={props.timeMs} />
          <span className="text-muted-foreground text-xs">trace view</span>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <TraceExplorer
          repo={checkoutTraceRepo}
          traceId={TRACE_ID}
          search={{ span: spanId, start: TRACE_START, end: TRACE_END }}
          onBack={() => {}}
          onSpanChange={(next) => {
            if (!next) {
              props.onClearSelection();
              return;
            }
            const signal = signals.find((item) => item.id === next);
            if (signal) props.onSelect(signal);
          }}
        />
      </div>
    </section>
  );
}

function explorerSpanId(selectedId: string, playing: boolean, timeMs: number) {
  if (playing) return spanUnderPlayhead(timeMs);
  if (selectedId === "err") return "post";
  const signal = signals.find((item) => item.id === selectedId);
  if (!signal) return undefined;
  if (signal.kind === "span") return signal.id;
  return spanUnderPlayhead(signal.t);
}
