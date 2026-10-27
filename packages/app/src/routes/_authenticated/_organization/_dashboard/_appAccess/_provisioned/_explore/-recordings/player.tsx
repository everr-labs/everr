import { eventsFromSegments, type ReplayEvent } from "#app/data/recordings/events.ts";
import type { RecordingSegment } from "#app/data/recordings/schemas.ts";
import { Button } from "@everr/ui/components/button";
import "@rrweb/replay/dist/style.css";
import { Replayer } from "@rrweb/replay";
import { Pause, Play } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RecordingPlayer({
  clipId,
  segments,
}: {
  clipId: string;
  segments: RecordingSegment[];
}) {
  const events = useMemo(() => eventsFromSegments(segments), [segments]);
  const hasSnapshot = events.some((event) => event.type === 2);
  if (!hasSnapshot) {
    return (
      <div className="text-muted-foreground flex h-full min-h-40 items-center justify-center text-sm">
        This recording has no snapshot to play.
      </div>
    );
  }
  return <ReplayStage key={clipId} events={events} />;
}

function ReplayStage({ events }: { events: ReplayEvent[] }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const sliderId = useId();
  const [playing, setPlaying] = useState(false);
  const [offset, setOffset] = useState(0);
  const duration = Math.max(0, (events.at(-1)?.timestamp ?? 0) - (events[0]?.timestamp ?? 0));

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;
    const replayer = new Replayer(
      events.map((event) => JSON.stringify(event)),
      {
        root,
        mouseTail: false,
        showWarning: false,
        showDebug: false,
        skipInactive: true,
      },
    );
    replayerRef.current = replayer;

    const fit = () => {
      const wrapper = replayer.wrapper;
      const width = wrapper.offsetWidth;
      const height = wrapper.offsetHeight;
      if (!width || !height || !stage.clientWidth || !stage.clientHeight) return;
      const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height);
      wrapper.style.transformOrigin = "top left";
      wrapper.style.transform = `scale(${scale})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);

    return () => {
      observer.disconnect();
      replayer.pause();
      replayer.destroy();
      replayerRef.current = null;
      root.replaceChildren();
    };
  }, [events]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setOffset(replayerRef.current?.getCurrentTime() ?? 0);
    }, 250);
    return () => clearInterval(timer);
  }, [playing]);

  const seek = (next: number) => {
    setOffset(next);
    replayerRef.current?.play(next);
    setPlaying(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-muted"
      >
        <div ref={rootRef} className="absolute inset-0" />
      </div>
      <div className="flex items-center gap-3">
        {playing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              replayerRef.current?.pause();
              setPlaying(false);
            }}
          >
            <Pause data-icon="inline-start" />
            Pause
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              replayerRef.current?.play(offset);
              setPlaying(true);
            }}
          >
            <Play data-icon="inline-start" />
            Play
          </Button>
        )}
        <label className="sr-only" htmlFor={sliderId}>
          Playback position
        </label>
        <input
          id={sliderId}
          className="min-w-0 flex-1"
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={100}
          value={Math.min(offset, duration)}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">
          {clock(offset)} / {clock(duration)}
        </span>
      </div>
    </div>
  );
}
