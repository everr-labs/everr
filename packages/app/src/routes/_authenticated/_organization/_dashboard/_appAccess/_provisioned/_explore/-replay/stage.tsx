import type { Span } from "@everr/telemetry-explorer/traces";
import {
  computeDetailWindow,
  getTraceOptions,
  TraceExplorer,
  type TraceExplorerProps,
} from "@everr/telemetry-explorer/traces";
import { Button } from "@everr/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getTraceReplay,
  type LoadedClip,
  type SessionClipLink,
} from "@/data/replay/server";
import { remoteTracesRepo } from "@/data/traces/remote-repo";
import { type ReplayEvent, type ReplayHandle, ReplayStage } from "./player";

type StageProps = Omit<TraceExplorerProps, "repo">;

const NS_PER_MS = 1_000_000n;

function spanStartMs(span: Span): number {
  return Number(BigInt(span.timestampNs) / NS_PER_MS);
}

function spanDepth(span: Span, byId: Map<string, Span>): number {
  let depth = 0;
  let parentId = span.parentSpanId;
  const seen = new Set<string>();
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentSpanId ?? "";
  }
  return depth;
}

const EMPTY_SPANS: Span[] = [];

function spanUnderClock(spans: Span[], absoluteMs: number): string | undefined {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const covering = spans.filter((span) => {
    const start = spanStartMs(span);
    const end = start + Number(BigInt(span.duration) / NS_PER_MS);
    return start <= absoluteMs && absoluteMs <= end;
  });
  covering.sort((a, b) => {
    const depth = spanDepth(b, byId) - spanDepth(a, byId);
    if (depth !== 0) return depth;
    return spanStartMs(b) - spanStartMs(a);
  });
  return covering[0]?.spanId;
}

function replayEvents(clip: LoadedClip | null): ReplayEvent[] {
  if (!clip) return [];
  const parsed: unknown = JSON.parse(clip.eventsJson);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (event): event is ReplayEvent =>
      Boolean(event) &&
      typeof event === "object" &&
      typeof (event as ReplayEvent).type === "number" &&
      typeof (event as ReplayEvent).timestamp === "number",
  );
}

function entryFromSpans(
  spans: Span[],
  spanId: string | undefined,
): Span | undefined {
  const explicit = spanId
    ? spans.find((span) => span.spanId === spanId)
    : undefined;
  if (explicit) return explicit;
  if (spanId) return undefined;
  return spans.find((span) => span.parentSpanId === "") ?? spans[0];
}

export function TraceStage({
  traceId,
  search,
  onBack,
  onSpanChange,
}: StageProps) {
  const window = computeDetailWindow({
    start: search.start,
    end: search.end,
    timeRange: { from: search.from, to: search.to },
  });
  const traceQuery = useQuery(
    getTraceOptions({
      repo: remoteTracesRepo,
      traceId,
      window,
      refresh: search.refresh ?? "off",
    }),
  );
  const spans = traceQuery.data ?? EMPTY_SPANS;
  const [entryKey, setEntryKey] = useState<{
    traceId: string;
    spanId: string;
  } | null>(null);
  if (spans.length > 0 && entryKey?.traceId !== traceId) {
    const entry = entryFromSpans(spans, search.span);
    if (entry) setEntryKey({ traceId, spanId: entry.spanId });
  }
  const entry =
    entryKey?.traceId === traceId
      ? spans.find((span) => span.spanId === entryKey.spanId)
      : undefined;
  const sessionId = entry?.spanAttributes["session.id"] ?? "";
  const streamId = entry?.spanAttributes["everr.recording.stream.id"] ?? "";
  const replay = useQuery({
    queryKey: [
      "replay",
      "trace",
      traceId,
      sessionId,
      streamId,
      entry?.timestamp,
      entry?.serviceName,
      window.fromTs,
      window.toTs,
    ],
    queryFn: () =>
      getTraceReplay({
        data: {
          sessionId,
          streamId,
          serviceName: entry?.serviceName ?? "",
          entryTs: entry?.timestamp ?? "",
          fromTs: window.fromTs,
          toTs: window.toTs,
        },
      }),
    enabled: sessionId.length > 0 && Boolean(entry),
  });

  return (
    <ReplayLayout
      traceId={traceId}
      search={search}
      spans={spans}
      sessionId={sessionId}
      clip={replay.data?.clip ?? null}
      clips={replay.data?.clips ?? []}
      replayPending={sessionId.length > 0 && replay.isPending}
      replayError={replay.isError}
      onBack={onBack}
      onSpanChange={onSpanChange}
    />
  );
}

function ReplayLayout({
  traceId,
  search,
  spans,
  sessionId,
  clip,
  clips,
  replayPending,
  replayError,
  onBack,
  onSpanChange,
}: StageProps & {
  spans: Span[];
  sessionId: string;
  clip: LoadedClip | null;
  clips: SessionClipLink[];
  replayPending: boolean;
  replayError: boolean;
}) {
  const playerRef = useRef<ReplayHandle>(null);
  const [playing, setPlaying] = useState(false);
  const [scrub, setScrub] = useState<{ clipId: string; ms: number } | null>(
    null,
  );
  const playingRef = useRef(false);
  playingRef.current = playing;
  const onSpanChangeRef = useRef(onSpanChange);
  onSpanChangeRef.current = onSpanChange;
  const searchSpanRef = useRef(search.span);
  searchSpanRef.current = search.span;

  const events = useMemo(() => replayEvents(clip), [clip]);
  const offsetMs =
    clip && scrub?.clipId === clip.clipId
      ? scrub.ms
      : (clip?.startOffsetMs ?? 0);
  const firstEventMs = events[0]?.timestamp ?? 0;
  const playheadSpanId =
    playing && clip
      ? spanUnderClock(spans, firstEventMs + offsetMs)
      : undefined;
  const shownSpan = playheadSpanId ?? search.span;

  useEffect(() => {
    if (!playing || !clip) return;
    let frame = 0;
    const tick = () => {
      const next = playerRef.current?.getTime();
      if (next != null) {
        setScrub({ clipId: clip.clipId, ms: next });
        const id = spanUnderClock(spans, firstEventMs + next);
        if (id && id !== searchSpanRef.current) onSpanChangeRef.current(id);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, clip, spans, firstEventMs]);

  const seekToSpan = (spanId: string | undefined) => {
    if (!spanId || !clip) return;
    const span = spans.find((item) => item.spanId === spanId);
    if (!span) return;
    const offset = Math.max(0, spanStartMs(span) - firstEventMs);
    setScrub({ clipId: clip.clipId, ms: offset });
    playerRef.current?.seek(offset, playingRef.current);
  };

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {sessionId.length > 0 && (
        <section
          className="relative h-56 shrink-0 border-b"
          aria-label="Replay"
        >
          {clip && events.length > 0 ? (
            <ReplayStage
              key={clip.clipId}
              handleRef={playerRef}
              events={events}
              initialTime={clip.startOffsetMs}
              onEnded={() => setPlaying(false)}
            />
          ) : (
            <NoClip pending={replayPending} error={replayError} clips={clips} />
          )}
        </section>
      )}
      {clip && (
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              const next = !playing;
              setPlaying(next);
              playerRef.current?.seek(offsetMs, next);
            }}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <span className="font-mono text-xs">
            {(offsetMs / 1000).toFixed(1)}s
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <TraceExplorer
          repo={remoteTracesRepo}
          traceId={traceId}
          search={{ ...search, span: shownSpan }}
          onBack={onBack}
          onSpanChange={(spanId) => {
            onSpanChange(spanId);
            seekToSpan(spanId);
          }}
        />
      </div>
    </section>
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
