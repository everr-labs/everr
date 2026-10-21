import { Button } from "@everr/ui/components/button";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import type { Ref } from "react";
import type {
  ClipGap,
  ClipReplayEvent,
  LoadedClip,
  SessionClipLink,
} from "@/data/replay/server";
import { type ReplayHandle, ReplayStage } from "./player";

const EMPTY_EVENTS: ClipReplayEvent[] = [];

export function clipEvents(clip: LoadedClip | null): ClipReplayEvent[] {
  return clip?.events ?? EMPTY_EVENTS;
}

function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 23);
}

const GAP_DISPLAY: Record<
  ClipGap["reason"],
  { label: string; className: string }
> = {
  "missing-segment": {
    label: "missing segment",
    className: "bg-destructive/40",
  },
  paused: {
    label: "paused",
    className: "bg-muted-foreground/30",
  },
};

function gapCounts(clip: LoadedClip): {
  missing: number;
  paused: number;
} {
  const counts = { missing: 0, paused: 0 };
  for (const gap of clip.gaps) {
    if (gap.reason === "missing-segment") counts.missing += 1;
    else counts.paused += 1;
  }
  return counts;
}

export function ReplayPanel({
  clip,
  events,
  clips,
  pending,
  error,
  handleRef,
  offsetMs,
  playing,
  onTogglePlay,
  onEnded,
}: {
  clip: LoadedClip | null;
  events: ClipReplayEvent[];
  clips: SessionClipLink[];
  pending: boolean;
  error: boolean;
  handleRef: Ref<ReplayHandle>;
  offsetMs: number;
  playing: boolean;
  onTogglePlay: () => void;
  onEnded: () => void;
}) {
  const firstMs = events[0]?.timestamp;
  const lastMs = events[events.length - 1]?.timestamp;
  const durationMs =
    firstMs != null
      ? Math.max(lastMs != null ? lastMs - firstMs : 0, clip?.endOffsetMs ?? 0)
      : 0;
  const trigger =
    clip?.trigger === "error" || clip?.trigger === "network"
      ? `${clip.trigger} trigger`
      : "";
  const gaps = clip ? gapCounts(clip) : { missing: 0, paused: 0 };
  const requestedStartMs = clip
    ? parseTimestampAsUTC(clip.requestedStartTs)?.getTime()
    : undefined;
  const triggerAt =
    firstMs != null && clip?.triggerOffsetMs != null
      ? clock(firstMs + clip.triggerOffsetMs)
      : undefined;

  return (
    <section aria-label="Replay" className="shrink-0 border-b">
      <div className="relative h-56">
        {clip && events.length > 0 ? (
          <ReplayStage
            key={clip.clipId}
            handleRef={handleRef}
            events={events}
            initialTime={clip.startOffsetMs}
            onEnded={onEnded}
          />
        ) : (
          <NoClip pending={pending} error={error} clips={clips} />
        )}
      </div>
      {clip && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <span className="font-mono text-xs">
            {(offsetMs / 1000).toFixed(1)}s
          </span>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            {requestedStartMs != null && (
              <span className="font-mono" title="the start the Clip asked for">
                from {clock(requestedStartMs)}
              </span>
            )}
            {clip.truncated && (
              <span
                className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase"
                title={`requested start ${clip.requestedStartTs}`}
              >
                truncated
              </span>
            )}
            {trigger && (
              <span
                className="rounded bg-destructive/10 px-1.5 py-0.5 font-medium uppercase text-destructive"
                title={trigger}
              >
                {trigger}
                {triggerAt && (
                  <span className="ml-1 font-mono normal-case">
                    at {triggerAt}
                  </span>
                )}
              </span>
            )}
            {clip.gaps.length > 0 && (
              <span
                className="flex flex-wrap items-center gap-1.5"
                title="stretches of the Clip with no events"
              >
                {gaps.missing > 0 && (
                  <span>
                    {gaps.missing} missing segment
                    {gaps.missing === 1 ? "" : "s"}
                  </span>
                )}
                {gaps.paused > 0 && (
                  <span>
                    {gaps.paused} paused range
                    {gaps.paused === 1 ? "" : "s"}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
      {clip && events.length > 0 && (
        <ClipTimeline
          clip={clip}
          firstMs={firstMs}
          durationMs={durationMs}
          offsetMs={offsetMs}
        />
      )}
    </section>
  );
}

function ClipTimeline({
  clip,
  firstMs,
  durationMs,
  offsetMs,
}: {
  clip: LoadedClip;
  firstMs: number | undefined;
  durationMs: number;
  offsetMs: number;
}) {
  if (firstMs == null) return null;
  const span = Math.max(1, durationMs);
  const left = (ms: number) =>
    `${Math.max(0, Math.min(100, (ms / span) * 100))}%`;

  return (
    <div className="px-4 pb-2">
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        {clip.gaps.map((gap) => {
          const display = GAP_DISPLAY[gap.reason];
          return (
            <span
              key={`${gap.reason}-${gap.fromMs}-${gap.toMs}`}
              role="img"
              aria-label={display.label}
              title={`${display.label} ${clock(firstMs + gap.fromMs)} to ${clock(firstMs + gap.toMs)}`}
              className={`absolute inset-y-0 ${display.className}`}
              style={{
                left: left(gap.fromMs),
                width: left(gap.toMs - gap.fromMs),
              }}
            />
          );
        })}
        {clip.triggerOffsetMs != null && (
          <span
            role="img"
            aria-label="tail"
            title="the tail after the trigger"
            className="absolute inset-y-0 bg-primary/20"
            style={{ left: left(clip.triggerOffsetMs), right: 0 }}
          />
        )}
        {clip.requestedStartOffsetMs >= 0 && (
          <span
            role="img"
            aria-label="requested start"
            title={`recorded from ${clip.requestedStartTs}`}
            className="absolute inset-y-0 w-px bg-muted-foreground"
            style={{ left: left(clip.requestedStartOffsetMs) }}
          />
        )}
        {clip.triggerOffsetMs != null && (
          <span
            role="img"
            aria-label="trigger"
            className="absolute inset-y-0 w-0.5 bg-destructive"
            style={{ left: left(clip.triggerOffsetMs) }}
          />
        )}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 bg-primary"
          style={{ left: left(offsetMs) }}
        />
      </div>
    </div>
  );
}

function NoClip({
  pending,
  error,
  clips,
}: {
  pending: boolean;
  error: boolean;
  clips: SessionClipLink[];
}) {
  if (pending) return <div className="h-full bg-muted/40" />;
  return (
    <div className="grid h-full place-items-center bg-muted/40 p-6 text-center">
      <div>
        <p className="text-sm font-medium">
          {error ? "Could not load the clip." : "no clip at this moment"}
        </p>
        {clips.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {clips.map((clip) => (
              <li key={clip.clipId}>
                <Link
                  to="/traces/$traceId"
                  params={{ traceId: clip.traceId }}
                  search={(prev) => ({
                    ...prev,
                    span: clip.spanId,
                    start: clip.startTs,
                    end: clip.endTs,
                  })}
                >
                  {clip.clipId}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
