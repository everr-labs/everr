import type { Span, TraceLogMarker } from "@everr/telemetry-explorer/traces";
import {
  getTraceOptions,
  TraceExplorer,
  type TraceExplorerProps,
} from "@everr/telemetry-explorer/traces";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { replayQueryOptions } from "@/data/replay/options";
import type { LoadedClip, SessionClipLink } from "@/data/replay/server";
import { remoteTracesRepo } from "@/data/traces/remote-repo";
import { getTraceLogs } from "@/data/traces/server";
import { ReplayPanel } from "./player-panel";
import { resolveReplaySource } from "./source";
import { EMPTY_SPANS, usePlayback } from "./use-playback";

type StageProps = Omit<TraceExplorerProps, "repo">;

const NS_PER_MS = 1_000_000n;
const EMPTY_LOGS: TraceLogMarker[] = [];

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
  const traceQuery = useQuery(
    getTraceOptions({
      repo: remoteTracesRepo,
      traceId,
      refresh: search.refresh ?? "off",
    }),
  );
  const spans = traceQuery.data ?? EMPTY_SPANS;
  // One read for every Log of the Trace. The waterfall joins it to the spans
  // by TraceId and SpanId; the query already drops logs with no SpanId.
  const logsQuery = useQuery({
    queryKey: ["traces", "logs", traceId],
    queryFn: () => getTraceLogs({ data: { traceId } }),
    enabled: traceId.length > 0,
  });
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
  const source = resolveReplaySource(entry, spans);
  const sessionId = source?.sessionId ?? "";
  const streamId = source?.streamId ?? "";
  const replay = useQuery({
    ...replayQueryOptions({
      sessionId,
      streamId,
      serviceName: source?.serviceName ?? "",
      entryTs: entry?.timestamp ?? "",
    }),
    enabled: sessionId.length > 0 && Boolean(entry),
  });

  return (
    <ReplayLayout
      traceId={traceId}
      search={search}
      spans={spans}
      logMarkers={logsQuery.data ?? EMPTY_LOGS}
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
  logMarkers,
  sessionId,
  clip,
  clips,
  replayPending,
  replayError,
  onBack,
  onSpanChange,
}: StageProps & {
  spans: Span[];
  logMarkers: TraceLogMarker[];
  sessionId: string;
  clip: LoadedClip | null;
  clips: SessionClipLink[];
  replayPending: boolean;
  replayError: boolean;
}) {
  const onSpanChangeRef = useRef(onSpanChange);
  onSpanChangeRef.current = onSpanChange;
  const searchSpanRef = useRef(search.span);
  searchSpanRef.current = search.span;

  const {
    playerRef,
    playing,
    events,
    firstEventMs,
    offsetMs,
    togglePlay,
    seek,
    stop,
  } = usePlayback(clip, (absoluteMs) => {
    const id = spanUnderClock(spans, absoluteMs);
    if (id && id !== searchSpanRef.current) onSpanChangeRef.current(id);
  });

  const playheadSpanId =
    playing && clip
      ? spanUnderClock(spans, firstEventMs + offsetMs)
      : undefined;
  const shownSpan = playheadSpanId ?? search.span;

  const seekToSpan = (spanId: string | undefined) => {
    if (!spanId || !clip) return;
    const span = spans.find((item) => item.spanId === spanId);
    if (!span) return;
    seek(Math.max(0, spanStartMs(span) - firstEventMs));
  };

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {sessionId.length > 0 && (
        <ReplayPanel
          clip={clip}
          events={events}
          clips={clips}
          pending={replayPending}
          error={replayError}
          handleRef={playerRef}
          offsetMs={offsetMs}
          playing={playing}
          onTogglePlay={togglePlay}
          onEnded={stop}
        />
      )}
      <div className="min-h-0 flex-1">
        <TraceExplorer
          repo={remoteTracesRepo}
          traceId={traceId}
          search={{ ...search, span: shownSpan }}
          logMarkers={logMarkers}
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
