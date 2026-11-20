import type {
  ClipSubject,
  CoveringClip,
  PlayerPlacement,
} from "@everr/telemetry-explorer/recordings";
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { ResizableHandle, ResizablePanel, usePanelRef } from "@everr/ui/components/resizable";
import { easeSplit, fadeIn, fold, unfold } from "@everr/ui/lib/unfold";
import { cn } from "@everr/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pause, Play } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipEventsError,
  clipEventsOptions,
  coveringClipsOptions,
} from "#app/data/replay/options.ts";
import {
  canDraw,
  clock,
  gapLabels,
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
  // The Clip is kept by id: a refetch can add one that sorts before it.
  const [clipId, setClipId] = useState<string>();

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
  const clip = clips.find((option) => option.clipId === clipId) ?? clips[0];
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
            value={clip.clipId}
            onChange={(event) => setClipId(event.target.value)}
            className="border-border bg-input/30 h-6 rounded-md border px-1.5 text-xs"
          >
            {clips.map((option, index) => (
              <option key={option.clipId} value={option.clipId}>
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
  const panelElement = useRef<HTMLDivElement>(null);
  // The split reopens at the height the reader last left it at. It is taken before a drag
  // starts, because a drag that shuts the panel passes through its minimum on the way.
  const openSize = useRef("40%");
  const rememberSize = () => {
    const panel = panelRef.current;
    if (panel && !panel.isCollapsed()) openSize.current = `${panel.getSize().inPixels}px`;
  };
  // A page column scrolls past the player, so there it starts open; the split starts as its row.
  const [open, setOpen] = useState(placement === "inline");
  // The picture stays while the player closes around it, then goes.
  const [closing, setClosing] = useState(false);
  const shown = open || closing;
  // Each close is numbered, so the end of one that a later close replaced keeps the picture.
  const closeRun = useRef(0);
  const body = useRef<HTMLDivElement | null>(null);
  // Play on a closed player marks the body that mounts next to unfold.
  const unfoldOnMount = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);
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
  const playable = events ? canDraw(events) : true;
  const blocked = recording.isError || !playable || playerFailed;
  const startMs = firstEventMs === undefined ? 0 : startOffsetMs(clip, firstEventMs);
  const offsetMs = positionMs ?? startMs;
  const timeline = firstEventMs === undefined ? undefined : timelineModel(clip, firstEventMs);
  const gaps = gapLabels(recording.data?.gaps ?? []);

  // Opens the player paused where playback starts, like the error detail's.
  const show = () => {
    if (split && panelRef.current?.isCollapsed()) {
      const size = openSize.current;
      void easeSplit(panelElement.current, () => panelRef.current?.resize(size));
    }
    // Show while the column's player is still closing turns it back from where it is.
    if (!split && body.current) void unfold(body.current, body.current.offsetHeight);
    else if (!body.current) unfoldOnMount.current = true;
    setOpen(true);
    setClosing(false);
  };
  const play = () => {
    setPlaying(true);
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
    const run = ++closeRun.current;
    const motion = split
      ? easeSplit(panelElement.current, () => {
          rememberSize();
          panelRef.current?.collapse();
        })
      : fold(body.current);
    if (!motion) return;
    setClosing(true);
    void motion.then(() => {
      if (closeRun.current === run) setClosing(false);
    });
  };
  const bodyRef = useCallback(
    (element: HTMLDivElement | null) => {
      body.current = element;
      if (!element || !unfoldOnMount.current) return;
      unfoldOnMount.current = false;
      // In the split, the panel growing around it is the opening.
      void (split ? fadeIn(element) : unfold(element, 0));
    },
    [split],
  );
  const togglePlayback = playing ? pause : play;
  // A failed query has no data, so it always counts as stale: Retry is the way to try again.
  const prefetch = () => {
    const options = clipEventsOptions(clip);
    if (queryClient.getQueryState(options.queryKey)?.status === "error") return;
    void queryClient.prefetchQuery(options);
  };

  const facts = (
    <>
      <span className="font-medium">{LABEL}</span>
      <span className="text-muted-foreground font-mono">{clock(clip.endMs - clip.startMs)}</span>
      <time className="text-muted-foreground" dateTime={new Date(clip.startMs).toISOString()}>
        {new Date(clip.startMs).toLocaleTimeString()}
      </time>
      <Badge variant={clip.trigger === "error" ? "destructive" : "secondary"} className="uppercase">
        {clip.trigger} trigger
      </Badge>
      {gaps.map((label) => (
        <Badge key={label} variant="outline" title="Parts of this recording were not received.">
          {label}
        </Badge>
      ))}
    </>
  );

  const section = (
    <section
      aria-label={LABEL}
      className={cn(
        "flex flex-col",
        split ? "h-full" : "shrink-0 overflow-hidden rounded-md border",
      )}
    >
      {split ? (
        // The row opens and closes like the Flamegraph row below it: the whole row is the toggle.
        <div className="flex h-8 shrink-0 items-center overflow-hidden text-xs whitespace-nowrap">
          <button
            type="button"
            className="hover:bg-muted/40 flex h-full min-w-0 flex-1 items-center gap-2 px-4"
            aria-expanded={open}
            onPointerEnter={prefetch}
            onClick={open ? hide : show}
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {facts}
          </button>
          {picker && <div className="pr-4">{picker}</div>}
        </div>
      ) : (
        <div className={ROW}>
          {facts}
          <div className="ml-auto flex items-center gap-2">
            {picker}
            {open ? (
              <Button variant="ghost" size="xs" onClick={hide}>
                Hide
              </Button>
            ) : (
              <Button variant="ghost" size="xs" onClick={show}>
                Show
              </Button>
            )}
          </div>
        </div>
      )}
      {shown && (
        <div
          ref={bodyRef}
          className={cn("flex flex-col overflow-hidden", split && "min-h-0 flex-1")}
        >
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
              <StageMessage>
                The start of this clip was not received, so it cannot play.
                <Button variant="outline" size="xs" onClick={() => void recording.refetch()}>
                  Retry
                </Button>
              </StageMessage>
            ) : playerFailed ? (
              <StageMessage>
                Could not start the player.
                <Button variant="outline" size="xs" onClick={() => setPlayerFailed(false)}>
                  Retry
                </Button>
              </StageMessage>
            ) : (
              <ReplayStage
                events={events}
                initialTime={offsetMs}
                autoplay={playing}
                handleRef={stageRef}
                onClick={togglePlayback}
                onError={() => {
                  setPlayerFailed(true);
                  setPlaying(false);
                }}
                onFinish={() => {
                  setPlaying(false);
                  if (firstEventMs !== undefined && lastEventMs !== undefined) {
                    setPositionMs(lastEventMs - firstEventMs);
                  }
                }}
              />
            )}
          </div>
          <Controls
            timeline={blocked ? undefined : timeline}
            positionMs={offsetMs}
            playing={playing && !blocked}
            focusLabel={focusLabel}
            onToggle={togglePlayback}
            onSeek={seek}
          />
        </div>
      )}
    </section>
  );

  if (!split) return section;
  return (
    <>
      <ResizablePanel
        id="recording"
        panelRef={panelRef}
        elementRef={panelElement}
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

/**
 * Play or pause, where playback is, and one track to seek on: what has played, the
 * subject's moment, and the thumb. Until the Clip can play, only the empty track shows.
 */
function Controls({
  timeline,
  positionMs,
  playing,
  focusLabel,
  onToggle,
  onSeek,
}: {
  timeline: TimelineModel | undefined;
  positionMs: number;
  playing: boolean;
  focusLabel: string;
  onToggle: () => void;
  onSeek: (ms: number) => void;
}) {
  const value = timeline ? Math.min(positionMs, timeline.durationMs) : 0;
  return (
    <div className="flex shrink-0 items-center gap-3 border-t px-4 py-1.5">
      <Button
        variant="outline"
        size="icon-xs"
        aria-label={playing ? "Pause" : "Play"}
        disabled={!timeline}
        onClick={onToggle}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      {timeline && (
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {clock(value)} / {clock(timeline.durationMs)}
        </span>
      )}
      <div className="relative h-3 flex-1">
        {/* Inset by half the thumb, so a percentage of the track sits under the thumb's centre. */}
        <div className="bg-muted pointer-events-none absolute inset-x-1.5 top-1/2 h-1 -translate-y-1/2 rounded-full">
          {timeline && (
            <>
              <div
                className="bg-muted-foreground/60 absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(value / timeline.durationMs) * 100}%` }}
              />
              <div
                className="bg-primary absolute -inset-y-0.5 rounded-sm"
                style={{
                  left: `${timeline.focus.leftPct}%`,
                  width: `${timeline.focus.widthPct}%`,
                }}
              />
            </>
          )}
        </div>
        {timeline && (
          <input
            type="range"
            aria-label="Seek"
            aria-valuetext={`${clock(value)} of ${clock(timeline.durationMs)}`}
            min={0}
            max={timeline.durationMs}
            // No step: one would snap the thumb to it while playing, behind the fill.
            step="any"
            value={value}
            onChange={(event) => onSeek(Number(event.target.value))}
            className={SEEK}
          />
        )}
      </div>
      <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[10px]">
        <span className="bg-primary inline-block size-2 rounded-sm" aria-hidden />
        {focusLabel}
      </span>
    </div>
  );
}

/** A bare range input whose track is drawn by Controls: only the thumb is its own. */
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
