import type {
  ClipSubject,
  CoveringClip,
  PlayerPlacement,
} from "@everr/telemetry-explorer/recordings";
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { ResizableHandle, ResizablePanel, usePanelRef } from "@everr/ui/components/resizable";
import { cn } from "@everr/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipEventsError,
  clipEventsOptions,
  coveringClipsOptions,
} from "#app/data/replay/options.ts";
import {
  clock,
  gapLabels,
  hasFullSnapshot,
  startOffsetMs,
  throughClipEnd,
  type TimelineModel,
  timelineModel,
} from "./clip-model";
import { type ReplayHandle, ReplayStage } from "./replay-stage";

const LABEL = "Session recording";
/** The header row's height, which is all a closed player takes in the split. */
const ROW_SIZE = "2rem";
const ROW = "flex h-8 shrink-0 items-center gap-2 overflow-hidden px-4 text-xs whitespace-nowrap";

/** The Clips covering a subject. Most records have none, and then nothing is drawn. */
export function RecordingPanel({
  subject,
  placement,
}: {
  subject: ClipSubject;
  placement: PlayerPlacement;
}) {
  const covering = useQuery(coveringClipsOptions(subject));
  const [clipIndex, setClipIndex] = useState(0);

  if (covering.isError) {
    const row = (
      <section aria-label={LABEL} className={cn(ROW, "border-b")}>
        <span className="text-muted-foreground">Could not look up session recordings.</span>
        <Button variant="ghost" size="xs" onClick={() => void covering.refetch()}>
          Retry
        </Button>
      </section>
    );
    return placement === "split" ? (
      <ResizablePanel id="recording" defaultSize={ROW_SIZE} minSize={ROW_SIZE} maxSize={ROW_SIZE}>
        {row}
      </ResizablePanel>
    ) : (
      row
    );
  }

  const clips = covering.data ?? [];
  const clip = clips[clipIndex] ?? clips[0];
  if (!clip) return null;

  return (
    <ClipPlayer
      key={clip.clipId}
      clip={clip}
      placement={placement}
      focusLabel={subject.kind === "trace" ? "Trace" : "Error"}
      picker={
        clips.length > 1 && (
          <select
            aria-label="Clip"
            value={clipIndex}
            onChange={(event) => setClipIndex(Number(event.target.value))}
            className="border-border bg-input/30 h-6 rounded-md border px-1.5 text-xs"
          >
            {clips.map((option, index) => (
              <option key={option.clipId} value={index}>
                Clip {index + 1} of {clips.length}, {new Date(option.startMs).toLocaleTimeString()}
              </option>
            ))}
          </select>
        )
      }
    />
  );
}

function ClipPlayer({
  clip,
  placement,
  focusLabel,
  picker,
}: {
  clip: CoveringClip;
  placement: PlayerPlacement;
  focusLabel: string;
  picker: ReactNode;
}) {
  const queryClient = useQueryClient();
  const stageRef = useRef<ReplayHandle>(null);
  const panelRef = usePanelRef();
  // The split reopens at the height the reader last left it at. It is taken before a drag
  // starts, because a drag that shuts the panel passes through its minimum on the way.
  const openSize = useRef("40%");
  const rememberSize = () => {
    const panel = panelRef.current;
    if (panel && !panel.isCollapsed()) openSize.current = `${panel.getSize().inPixels}px`;
  };
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Milliseconds after the first event, once the user seeks or the player runs.
  const [positionMs, setPositionMs] = useState<number>();
  const recording = useQuery({ ...clipEventsOptions(clip), enabled: open });
  const split = placement === "split";

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const time = stageRef.current?.getTime();
      if (time !== undefined) setPositionMs(time);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const events = useMemo(
    () => recording.data && throughClipEnd(recording.data.events, clip.endMs),
    [recording.data, clip.endMs],
  );
  const firstEventMs = events?.[0]?.timestamp;
  const lastEventMs = events?.at(-1)?.timestamp;
  const playable = events ? hasFullSnapshot(events) : true;
  const blocked = recording.isError || !playable;
  const startMs = firstEventMs === undefined ? 0 : startOffsetMs(clip, firstEventMs);
  const offsetMs = positionMs ?? startMs;
  const timeline = firstEventMs === undefined ? undefined : timelineModel(clip, firstEventMs);
  const gaps = gapLabels(recording.data?.gaps ?? []);

  const play = () => {
    setOpen(true);
    if (split && panelRef.current?.isCollapsed()) panelRef.current.resize(openSize.current);
    setPlaying(true);
    // Before the events arrive the player has no position yet: it is created at the start offset.
    if (firstEventMs === undefined || lastEventMs === undefined) return;
    const from = offsetMs >= lastEventMs - firstEventMs ? startMs : offsetMs;
    setPositionMs(from);
    stageRef.current?.seek(from, true);
  };
  const pause = () => {
    setPlaying(false);
    const at = stageRef.current?.getTime();
    if (at === undefined) return;
    setPositionMs(at);
    stageRef.current?.seek(at, false);
  };
  const seek = (ms: number) => {
    setPositionMs(ms);
    stageRef.current?.seek(ms, playing);
  };
  const close = () => {
    if (playing) pause();
    setOpen(false);
  };
  const hide = () => {
    close();
    if (!split) return;
    rememberSize();
    panelRef.current?.collapse();
  };
  const togglePlayback = playing ? pause : play;

  const section = (
    <section
      aria-label={LABEL}
      className={cn("flex flex-col", split ? "h-full" : "shrink-0 border-b")}
    >
      <div className={ROW}>
        <Button
          variant="outline"
          size="icon-xs"
          aria-label={playing && !blocked ? "Pause" : "Play"}
          disabled={blocked}
          onPointerEnter={() => void queryClient.prefetchQuery(clipEventsOptions(clip))}
          onClick={togglePlayback}
        >
          {playing && !blocked ? <Pause /> : <Play />}
        </Button>
        <span className="font-medium">{LABEL}</span>
        <span className="text-muted-foreground font-mono">
          {open && timeline
            ? `${clock(offsetMs)} / ${clock(timeline.durationMs)}`
            : clock(clip.endMs - clip.startMs)}
        </span>
        <time className="text-muted-foreground" dateTime={new Date(clip.startMs).toISOString()}>
          {new Date(clip.startMs).toLocaleTimeString()}
        </time>
        <Badge
          variant={clip.trigger === "error" ? "destructive" : "secondary"}
          className="uppercase"
        >
          {clip.trigger} trigger
        </Badge>
        {clip.truncated && (
          <Badge
            variant="outline"
            className="uppercase"
            title="The recording did not reach back to the start it asked for."
          >
            truncated
          </Badge>
        )}
        {gaps.map((label) => (
          <Badge key={label} variant="outline" title="Parts of this recording were not received.">
            {label}
          </Badge>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {picker}
          {open && (
            <Button variant="ghost" size="xs" onClick={hide}>
              Hide
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className={cn("border-t", split ? "min-h-0 flex-1" : "h-[min(45vh,28rem)]")}>
          {recording.isPending ? (
            <StageMessage>Loading the recording…</StageMessage>
          ) : recording.isError ? (
            recording.error instanceof ClipEventsError && recording.error.code === "too_large" ? (
              <StageMessage>This clip is too large to play here.</StageMessage>
            ) : (
              <StageMessage>
                Could not load this recording.
                <Button variant="outline" size="xs" onClick={() => void recording.refetch()}>
                  Retry
                </Button>
              </StageMessage>
            )
          ) : !events || !playable ? (
            <StageMessage>The start of this clip was not received, so it cannot play.</StageMessage>
          ) : (
            <ReplayStage
              events={events}
              initialTime={offsetMs}
              autoplay={playing}
              handleRef={stageRef}
              onClick={togglePlayback}
              onFinish={() => {
                setPlaying(false);
                if (firstEventMs !== undefined && lastEventMs !== undefined) {
                  setPositionMs(lastEventMs - firstEventMs);
                }
              }}
            />
          )}
        </div>
      )}
      {open && playable && timeline && (
        <Timeline timeline={timeline} positionMs={offsetMs} focusLabel={focusLabel} onSeek={seek} />
      )}
    </section>
  );

  if (!split) return section;
  return (
    <>
      <ResizablePanel
        id="recording"
        panelRef={panelRef}
        collapsible
        collapsedSize={ROW_SIZE}
        defaultSize={ROW_SIZE}
        minSize="10rem"
        maxSize="75%"
        groupResizeBehavior="preserve-pixel-size"
        // Dragging the handle shut closes the player, and dragging it open opens it, paused.
        onResize={() => {
          if (panelRef.current?.isCollapsed()) {
            if (open) close();
            return;
          }
          if (!open) setOpen(true);
        }}
      >
        {section}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label="Resize session recording and trace"
        onPointerDown={rememberSize}
        onKeyDown={rememberSize}
      />
    </>
  );
}

/** One track: what has played, the subject's moment, and the thumb to seek. */
function Timeline({
  timeline,
  positionMs,
  focusLabel,
  onSeek,
}: {
  timeline: TimelineModel;
  positionMs: number;
  focusLabel: string;
  onSeek: (ms: number) => void;
}) {
  const value = Math.min(positionMs, timeline.durationMs);
  return (
    <div className="flex shrink-0 items-center gap-3 border-t px-4 py-2">
      <div className="relative h-3 flex-1">
        {/* Inset by half the thumb, so a percentage of the track sits under the thumb's centre. */}
        <div className="bg-muted pointer-events-none absolute inset-x-1.5 top-1/2 h-1 -translate-y-1/2 rounded-full">
          <div
            className="bg-muted-foreground/60 absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${(value / timeline.durationMs) * 100}%` }}
          />
          <div
            className="bg-primary absolute -inset-y-0.5 rounded-sm"
            style={{ left: `${timeline.focus.leftPct}%`, width: `${timeline.focus.widthPct}%` }}
          />
        </div>
        <input
          type="range"
          aria-label="Seek"
          aria-valuetext={`${clock(value)} of ${clock(timeline.durationMs)}`}
          min={0}
          max={timeline.durationMs}
          step={100}
          value={value}
          onChange={(event) => onSeek(Number(event.target.value))}
          className={SEEK}
        />
      </div>
      <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[10px]">
        <span className="bg-primary inline-block size-2 rounded-sm" aria-hidden />
        {focusLabel}
      </span>
    </div>
  );
}

/** A bare range input whose track is drawn by Timeline: only the thumb is its own. */
const SEEK = cn(
  "absolute inset-0 h-3 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none",
  "[&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-sm",
  "[&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0",
  // The focus ring of the system's buttons and switches, with an offset sized to the small thumb.
  "focus-visible:[&::-webkit-slider-thumb]:ring-primary focus-visible:[&::-webkit-slider-thumb]:ring-offset-background focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-offset-2",
  "focus-visible:[&::-moz-range-thumb]:ring-primary focus-visible:[&::-moz-range-thumb]:ring-offset-background focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-offset-2",
);

function StageMessage({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center gap-2 px-4 text-xs">
      {children}
    </div>
  );
}
