import {
  RECORDING_AUTO_LAST_MS,
  RECORDING_PAUSE_TAG,
  RECORDING_RESUME_TAG,
  RECORDING_TAIL_SLICE_MS,
} from "@everr/otel-web/recording";
import { attributeText } from "@everr/telemetry-explorer/sql";
import type { SqlClient } from "@everr/telemetry-explorer/traces";
import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

const NS_PER_MS = 1_000_000n;
const LEAD_IN_MS = 60_000n;
// rrweb custom events mark a pause. They travel in the Segment body, so a
// silent page is not mistaken for a paused recorder.
const CUSTOM_EVENT = 5;

const TraceReplayInputSchema = z.object({
  sessionId: z.string().min(1),
  streamId: z.string(),
  serviceName: z.string(),
  entryTs: z.string().min(1),
});

export type TraceReplayInput = z.infer<typeof TraceReplayInputSchema>;

export type ClipReplayEvent = {
  type: number;
  timestamp: number;
  /** The rrweb custom event tag; pause and resume markers read it. */
  data?: { tag?: string };
};

export type SessionClipLink = {
  clipId: string;
  traceId: string;
  spanId: string;
  startTs: string;
  endTs: string;
};

export type ClipGap = {
  /** Milliseconds from the Clip's first event. */
  fromMs: number;
  toMs: number;
  reason: "missing-segment" | "paused";
};

export type LoadedClip = {
  clipId: string;
  traceId: string;
  /** Playback position of the entry, milliseconds from the first event. */
  startOffsetMs: number;
  /** Parsed rrweb events, in playback order. */
  events: ClipReplayEvent[];
  /** The recording span's end, milliseconds from the first event. */
  endOffsetMs: number;
  /** The range the Clip asked for. It predates the first event when truncated. */
  requestedStartTs: string;
  requestedStartOffsetMs: number;
  /** `error`, `network`, or `manual`; "" when an older span has no trigger. */
  trigger: string;
  truncated: boolean;
  /** The automatic Clip's trigger, milliseconds from the first event. */
  triggerOffsetMs: number | null;
  gaps: ClipGap[];
};

type TraceReplay = {
  clip: LoadedClip | null;
  clips: SessionClipLink[];
};

type RecordingSpanRow = {
  traceId: string;
  spanId: string;
  startTs: string;
  startNs: string;
  durationNs: string;
  clipId: string;
  trigger: string;
  truncated: string;
};

type SegmentRow = {
  body: string;
  segmentIndex: string;
};

type ClipSegment = {
  index: number;
  firstMs: number;
  lastMs: number;
};

type ClipEvents = {
  events: ClipReplayEvent[];
  segments: ClipSegment[];
};

const SESSION_ID = attributeText("SpanAttributes", "session.id");
const STREAM_ID = attributeText("SpanAttributes", "everr.recording.stream.id");
const CLIP_ID = attributeText("SpanAttributes", "everr.recording.clip.id");
const TRIGGER = attributeText("SpanAttributes", "everr.recording.trigger");
const TRUNCATED = attributeText(
  "SpanAttributes",
  "everr.recording.clip.truncated",
);
const SEGMENT_INDEX = attributeText(
  "LogAttributes",
  "everr.recording.segment.index",
);

const RECORDING_SPAN_SQL = `
  SELECT
    TraceId AS traceId,
    SpanId AS spanId,
    toString(Timestamp) AS startTs,
    toString(toUnixTimestamp64Nano(Timestamp)) AS startNs,
    toString(Duration) AS durationNs,
    ${CLIP_ID} AS clipId,
    ${TRIGGER} AS trigger,
    ${TRUNCATED} AS truncated
  FROM traces
`;

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return client;
}

function msToCh(ms: bigint): string {
  return toClickHouseDateTime(new Date(Number(ms)));
}

function clipEndTs(row: RecordingSpanRow): string {
  const endMs = (BigInt(row.startNs) + BigInt(row.durationNs)) / NS_PER_MS;
  return msToCh(endMs);
}

function toLink(row: RecordingSpanRow): SessionClipLink {
  return {
    clipId: row.clipId,
    traceId: row.traceId,
    spanId: row.spanId,
    startTs: row.startTs,
    endTs: clipEndTs(row),
  };
}

function earliestClip(rows: RecordingSpanRow[]): RecordingSpanRow | undefined {
  return rows
    .filter((row) => row.clipId !== "")
    .sort((a, b) => {
      const aNs = BigInt(a.startNs);
      const bNs = BigInt(b.startNs);
      if (aNs < bNs) return -1;
      if (aNs > bNs) return 1;
      if (a.spanId < b.spanId) return -1;
      if (a.spanId > b.spanId) return 1;
      return 0;
    })[0];
}

function readEvents(rows: SegmentRow[]): ClipEvents {
  const ordered = [...rows].sort(
    (a, b) => Number(a.segmentIndex) - Number(b.segmentIndex),
  );
  const events: ClipReplayEvent[] = [];
  const segments: ClipSegment[] = [];
  for (const row of ordered) {
    const parsed: unknown =
      typeof row.body === "string" ? JSON.parse(row.body) : row.body;
    if (!Array.isArray(parsed)) continue;
    let firstMs: number | undefined;
    let lastMs: number | undefined;
    for (const event of parsed) {
      if (!event || typeof event !== "object") continue;
      const candidate = event as ClipReplayEvent;
      if (
        typeof candidate.type !== "number" ||
        typeof candidate.timestamp !== "number"
      ) {
        continue;
      }
      events.push(event as ClipReplayEvent);
      firstMs ??= candidate.timestamp;
      lastMs = candidate.timestamp;
    }
    if (firstMs != null && lastMs != null) {
      segments.push({ index: Number(row.segmentIndex), firstMs, lastMs });
    }
  }
  return { events, segments };
}

// A Segment index that never arrived is a lost request. Every index below the
// highest received one is expected, so a lost index 0 and an interior hole both
// show. A run of missing indexes becomes one gap, from the previous Segment to
// the next.
function segmentGaps(segments: ClipSegment[], firstMs: number): ClipGap[] {
  if (segments.length === 0) return [];
  const byIndex = new Map(segments.map((segment) => [segment.index, segment]));
  const highest = Math.max(...segments.map((segment) => segment.index));
  const gaps: ClipGap[] = [];
  let previous: ClipSegment | undefined;
  let missing = false;
  for (let index = 0; index <= highest; index++) {
    const segment = byIndex.get(index);
    if (!segment) {
      missing = true;
      continue;
    }
    if (missing) {
      gaps.push({
        fromMs: previous ? previous.lastMs - firstMs : 0,
        toMs: segment.firstMs - firstMs,
        reason: "missing-segment",
      });
      missing = false;
    }
    previous = segment;
  }
  return gaps;
}

// Pause and resume are rrweb custom events in the Segment body. A silent page
// is not a pause: only these markers make a paused range.
function pauseGaps(
  events: ClipReplayEvent[],
  firstMs: number,
  endMs: number,
): ClipGap[] {
  const gaps: ClipGap[] = [];
  let pausedAt: number | undefined;
  for (const event of events) {
    if (event.type !== CUSTOM_EVENT) continue;
    if (event.data?.tag === RECORDING_PAUSE_TAG) {
      pausedAt ??= event.timestamp;
      continue;
    }
    if (event.data?.tag !== RECORDING_RESUME_TAG || pausedAt === undefined)
      continue;
    if (event.timestamp > pausedAt) {
      gaps.push({
        fromMs: pausedAt - firstMs,
        toMs: event.timestamp - firstMs,
        reason: "paused",
      });
    }
    pausedAt = undefined;
  }
  if (pausedAt !== undefined && endMs > pausedAt) {
    gaps.push({
      fromMs: pausedAt - firstMs,
      toMs: endMs - firstMs,
      reason: "paused",
    });
  }
  return gaps;
}

function clipGaps(
  { events, segments }: ClipEvents,
  firstMs: number,
  endMs: number,
): ClipGap[] {
  const gaps = [
    ...segmentGaps(segments, firstMs),
    ...pauseGaps(events, firstMs, endMs),
  ];
  const lastMs = events[events.length - 1]?.timestamp;
  // A silence past the tail cadence before the span's end is a tail gap.
  if (lastMs != null && endMs - lastMs > RECORDING_TAIL_SLICE_MS) {
    const fromMs = lastMs - firstMs;
    const toMs = endMs - firstMs;
    const paused = gaps.some(
      (gap) =>
        gap.reason === "paused" && gap.fromMs <= fromMs && toMs <= gap.toMs,
    );
    if (!paused) {
      gaps.push({ fromMs, toMs, reason: "missing-segment" });
    }
  }
  return gaps.sort((a, b) => a.fromMs - b.fromMs);
}

function isTrue(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function startOffsetMs(events: ClipReplayEvent[], entryTs: string): number {
  const entry = parseTimestampAsUTC(entryTs);
  const first = events[0]?.timestamp;
  if (!entry || first == null) return 0;
  return Math.max(0, entry.getTime() - first);
}

function triggerOffsetMs(
  trigger: string,
  startNs: bigint,
  firstMs: number | undefined,
): number | null {
  if (trigger !== "error" && trigger !== "network") return null;
  if (firstMs == null) return null;
  // An automatic Clip starts this far before its first trigger.
  const triggerMs = Number(startNs / NS_PER_MS) + RECORDING_AUTO_LAST_MS;
  return Math.max(0, triggerMs - firstMs);
}

// Cloud and local share this predicate. Tenant isolation is the row policy
// on app.recordings. The local table has no tenant_id column, so the query
// must not mention one.
const SEGMENT_SQL = `
  SELECT
    Body AS body,
    ${SEGMENT_INDEX} AS segmentIndex
  FROM recordings
  WHERE ServiceName = {service:String}
    AND Timestamp BETWEEN parseDateTime64BestEffort({fromTs:String}, 9)
                      AND parseDateTime64BestEffort({toTs:String}, 9)
    AND session_id = {sessionId:String}
    AND clip_id = {clipId:String}
  ORDER BY toInt64OrZero(segmentIndex)
`;

async function loadTraceReplay(
  client: SqlClient,
  input: TraceReplayInput,
): Promise<TraceReplay> {
  let chosen: RecordingSpanRow | undefined;
  if (input.streamId) {
    // The entry anchors the scan: the Clip covering it started in the hour
    // before it. No clock-relative range reaches this query.
    const covering = await client.execute<RecordingSpanRow>(
      `${RECORDING_SPAN_SQL}
      WHERE SpanName = 'recording'
        AND ${SESSION_ID} = {sessionId:String}
        AND ${STREAM_ID} = {streamId:String}
        AND Timestamp BETWEEN parseDateTime64BestEffort({entryTs:String}, 9) - INTERVAL 1 HOUR
                          AND parseDateTime64BestEffort({entryTs:String}, 9)
        AND addNanoseconds(Timestamp, Duration) >= parseDateTime64BestEffort({entryTs:String}, 9)
      ORDER BY Timestamp ASC, SpanId ASC`,
      {
        sessionId: input.sessionId,
        streamId: input.streamId,
        entryTs: input.entryTs,
      },
    );
    chosen = earliestClip(covering);
  }

  if (!chosen) {
    // The list is the Session's Clips, not the Clips inside the detail window.
    // A Clip outside the window still opens; only the Session filters it.
    const sessionClips = await client.execute<RecordingSpanRow>(
      `${RECORDING_SPAN_SQL}
      WHERE SpanName = 'recording'
        AND ${SESSION_ID} = {sessionId:String}
      ORDER BY Timestamp ASC, SpanId ASC`,
      { sessionId: input.sessionId },
    );
    return {
      clip: null,
      clips: sessionClips.filter((row) => row.clipId).map(toLink),
    };
  }

  const startNs = BigInt(chosen.startNs);
  const durationNs = BigInt(chosen.durationNs);
  const segments = await client.execute<SegmentRow>(SEGMENT_SQL, {
    service: input.serviceName,
    fromTs: msToCh(startNs / NS_PER_MS - LEAD_IN_MS),
    toTs: msToCh((startNs + durationNs) / NS_PER_MS),
    sessionId: input.sessionId,
    clipId: chosen.clipId,
  });
  const clipEvents = readEvents(segments);
  const firstMs = clipEvents.events[0]?.timestamp;
  const endMs = Number((startNs + durationNs) / NS_PER_MS);
  return {
    clip: {
      clipId: chosen.clipId,
      traceId: chosen.traceId,
      startOffsetMs: startOffsetMs(clipEvents.events, input.entryTs),
      events: clipEvents.events,
      endOffsetMs: firstMs == null ? 0 : Math.max(0, endMs - firstMs),
      requestedStartTs: chosen.startTs,
      requestedStartOffsetMs:
        firstMs == null ? 0 : Number(startNs / NS_PER_MS) - firstMs,
      trigger: chosen.trigger ?? "",
      truncated: isTrue(chosen.truncated),
      triggerOffsetMs: triggerOffsetMs(chosen.trigger ?? "", startNs, firstMs),
      gaps: firstMs == null ? [] : clipGaps(clipEvents, firstMs, endMs),
    },
    clips: [],
  };
}

export const getTraceReplay = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(TraceReplayInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    loadTraceReplay(repoFromContext(clickhouse), data),
  );
