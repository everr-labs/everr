import type { ClipSubject, CoveringClip } from "@everr/telemetry-explorer/recordings";
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ClipEventsError,
  clipEventsOptions,
  coveringClipsOptions,
} from "#app/data/replay/options.ts";
import { clock, gapLabels, hasFullSnapshot, startOffsetMs, timelineModel } from "./clip-model";
import { type ReplayHandle, ReplayStage } from "./replay-stage";

const LABEL = "Session recording";

/** The Clips covering a subject. Most records have none, and then nothing is drawn. */
export function RecordingPanel({ subject }: { subject: ClipSubject }) {
  const covering = useQuery(coveringClipsOptions(subject));
  const [clipIndex, setClipIndex] = useState(0);

  if (covering.isError) {
    return (
      <section aria-label={LABEL} className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5">
        <span className="text-muted-foreground text-xs">Could not look up session recordings.</span>
        <Button variant="ghost" size="xs" onClick={() => void covering.refetch()}>
          Retry
        </Button>
      </section>
    );
  }

  const clips = covering.data ?? [];
  const clip = clips[clipIndex] ?? clips[0];
  if (!clip) return null;

  return (
    <ClipPlayer
      key={clip.clipId}
      clip={clip}
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
  focusLabel,
  picker,
}: {
  clip: CoveringClip;
  focusLabel: string;
  picker: ReactNode;
}) {
  const queryClient = useQueryClient();
  const stageRef = useRef<ReplayHandle>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Milliseconds after the first event, once the user seeks or the player runs.
  const [positionMs, setPositionMs] = useState<number>();
  const recording = useQuery({ ...clipEventsOptions(clip), enabled: open });

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

  const events = recording.data?.events;
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

  return (
    <section aria-label={LABEL} className="shrink-0 border-b">
      <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-xs">
        <Button
          variant="outline"
          size="icon-xs"
          aria-label={playing && !blocked ? "Pause" : "Play"}
          disabled={blocked}
          onPointerEnter={() => void queryClient.prefetchQuery(clipEventsOptions(clip))}
          onClick={playing ? pause : play}
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
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                if (playing) pause();
                setOpen(false);
              }}
            >
              Hide
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="h-[min(45vh,28rem)] border-t">
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
          ) : !playable ? (
            <StageMessage>The start of this clip was not received, so it cannot play.</StageMessage>
          ) : (
            <ReplayStage
              events={recording.data.events}
              initialTime={offsetMs}
              autoplay={playing}
              handleRef={stageRef}
              onFinish={() => setPlaying(false)}
            />
          )}
        </div>
      )}
      {open && playable && timeline && (
        <div className="flex flex-col gap-1 px-4 py-2">
          <div className="relative h-1.5 rounded-full bg-muted" aria-hidden>
            <div
              className="bg-primary/40 absolute inset-y-0 rounded-full"
              style={{ left: `${timeline.focus.leftPct}%`, width: `${timeline.focus.widthPct}%` }}
            />
          </div>
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={timeline.durationMs}
            step={100}
            value={Math.min(offsetMs, timeline.durationMs)}
            onChange={(event) => seek(Number(event.target.value))}
            className="accent-primary w-full"
          />
          <span className="text-muted-foreground flex items-center gap-1 text-[10px]">
            <span className="bg-primary/40 inline-block size-2 rounded-sm" aria-hidden />
            {focusLabel}
          </span>
        </div>
      )}
    </section>
  );
}

function StageMessage({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center gap-2 px-4 text-xs">
      {children}
    </div>
  );
}
