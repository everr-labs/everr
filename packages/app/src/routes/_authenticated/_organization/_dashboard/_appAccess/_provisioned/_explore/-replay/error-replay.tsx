import type { ErrorOccurrence } from "@everr/telemetry-explorer/errors";
import { getTraceOptions } from "@everr/telemetry-explorer/traces";
import { useQuery } from "@tanstack/react-query";
import { getTraceReplay } from "@/data/replay/server";
import { remoteTracesRepo } from "@/data/traces/remote-repo";
import { ReplayPanel } from "./player-panel";
import { sourceFromAttributes, sourceFromClientSpans } from "./source";
import { EMPTY_SPANS, usePlayback } from "./use-playback";
import { windowAround } from "./window";

/**
 * The player on the error view. A browser error log carries its own Session.
 * A backend error log, or a log with a Span id, needs the Trace: it opens on
 * the Span that carries the log, and a backend log takes the Session from the
 * browser Client spans. The stack is not part of this component; the error
 * view keeps `exception.stacktrace` where it always was.
 */
export function ErrorReplayPlayer({
  occurrence,
}: {
  occurrence: ErrorOccurrence;
}) {
  const logSource = sourceFromAttributes(
    occurrence.logAttributes,
    occurrence.serviceName,
  );
  const needsTrace =
    occurrence.traceId !== "" && (!logSource || occurrence.spanId !== "");
  const traceQuery = useQuery({
    ...getTraceOptions({
      repo: remoteTracesRepo,
      traceId: occurrence.traceId,
      refresh: "off",
    }),
    enabled: needsTrace,
  });
  const spans = traceQuery.data ?? EMPTY_SPANS;
  const source = logSource ?? sourceFromClientSpans(spans);
  const entrySpan = occurrence.spanId
    ? spans.find((span) => span.spanId === occurrence.spanId)
    : undefined;
  const entryTs = entrySpan?.timestamp ?? occurrence.timestamp;
  const entryReady = !needsTrace || traceQuery.isFetched;
  // Anchored to the entry, as on the trace view. A relative list range
  // ("now-7d") resolves against the clock, so it changed the query key on
  // every render and refetched without end.
  const window = windowAround(entryTs);

  const replay = useQuery({
    queryKey: [
      "replay",
      "error",
      occurrence.fingerprint,
      occurrence.timestamp,
      occurrence.traceId,
      occurrence.spanId,
      source?.sessionId,
      source?.streamId,
      entryTs,
      source?.serviceName,
      window.fromTs,
      window.toTs,
    ],
    queryFn: () =>
      getTraceReplay({
        data: {
          sessionId: source?.sessionId ?? "",
          streamId: source?.streamId ?? "",
          serviceName: source?.serviceName ?? "",
          entryTs,
          fromTs: window.fromTs,
          toTs: window.toTs,
        },
      }),
    enabled: Boolean(source?.sessionId) && entryReady,
  });

  const clip = replay.data?.clip ?? null;
  const { playerRef, playing, events, offsetMs, togglePlay, stop } =
    usePlayback(clip);

  if (!source) return null;

  return (
    <ReplayPanel
      clip={clip}
      events={events}
      clips={replay.data?.clips ?? []}
      pending={replay.isPending}
      error={replay.isError}
      handleRef={playerRef}
      offsetMs={offsetMs}
      playing={playing}
      onTogglePlay={togglePlay}
      onEnded={stop}
    />
  );
}
