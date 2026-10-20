import { attributeText } from "@everr/telemetry-explorer/sql";
import type { SqlClient } from "@everr/telemetry-explorer/traces";
import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

const NS_PER_MS = 1_000_000n;
const LEAD_IN_MS = 60_000n;

const TraceReplayInputSchema = z.object({
  sessionId: z.string().min(1),
  streamId: z.string(),
  serviceName: z.string(),
  entryTs: z.string().min(1),
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
});

type ReplayEvent = {
  type: number;
  timestamp: number;
};

export type SessionClipLink = {
  clipId: string;
  traceId: string;
  spanId: string;
  startTs: string;
  endTs: string;
};

export type LoadedClip = {
  clipId: string;
  traceId: string;
  startOffsetMs: number;
  eventsJson: string;
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
};

type SegmentRow = {
  body: string;
  segmentIndex: string;
};

const SESSION_ID = attributeText("SpanAttributes", "session.id");
const STREAM_ID = attributeText("SpanAttributes", "everr.recording.stream.id");
const CLIP_ID = attributeText("SpanAttributes", "everr.recording.clip.id");
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
    ${CLIP_ID} AS clipId
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

function readEvents(rows: SegmentRow[]): ReplayEvent[] {
  const ordered = [...rows].sort(
    (a, b) => Number(a.segmentIndex) - Number(b.segmentIndex),
  );
  const events: ReplayEvent[] = [];
  for (const row of ordered) {
    const parsed: unknown =
      typeof row.body === "string" ? JSON.parse(row.body) : row.body;
    if (!Array.isArray(parsed)) continue;
    for (const event of parsed) {
      if (!event || typeof event !== "object") continue;
      const candidate = event as ReplayEvent;
      if (
        typeof candidate.type !== "number" ||
        typeof candidate.timestamp !== "number"
      ) {
        continue;
      }
      events.push(event as ReplayEvent);
    }
  }
  return events;
}

function startOffsetMs(events: ReplayEvent[], entryTs: string): number {
  const entry = parseTimestampAsUTC(entryTs);
  const first = events[0]?.timestamp;
  if (!entry || first == null) return 0;
  return Math.max(0, entry.getTime() - first);
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
  input: z.infer<typeof TraceReplayInputSchema>,
): Promise<TraceReplay> {
  const scan = {
    sessionId: input.sessionId,
    fromTs: input.fromTs,
    toTs: input.toTs,
    entryTs: input.entryTs,
  };
  let chosen: RecordingSpanRow | undefined;
  if (input.streamId) {
    const covering = await client.execute<RecordingSpanRow>(
      `${RECORDING_SPAN_SQL}
      WHERE SpanName = 'recording'
        AND ${SESSION_ID} = {sessionId:String}
        AND ${STREAM_ID} = {streamId:String}
        AND Timestamp BETWEEN parseDateTime64BestEffort({fromTs:String}, 9)
                          AND parseDateTime64BestEffort({toTs:String}, 9)
        AND Timestamp <= parseDateTime64BestEffort({entryTs:String}, 9)
        AND addNanoseconds(Timestamp, Duration) >= parseDateTime64BestEffort({entryTs:String}, 9)
      ORDER BY Timestamp ASC, SpanId ASC`,
      { ...scan, streamId: input.streamId },
    );
    chosen = earliestClip(covering);
  }

  if (!chosen) {
    const sessionClips = await client.execute<RecordingSpanRow>(
      `${RECORDING_SPAN_SQL}
      WHERE SpanName = 'recording'
        AND ${SESSION_ID} = {sessionId:String}
        AND Timestamp BETWEEN parseDateTime64BestEffort({fromTs:String}, 9)
                          AND parseDateTime64BestEffort({toTs:String}, 9)
      ORDER BY Timestamp ASC, SpanId ASC`,
      {
        sessionId: input.sessionId,
        fromTs: input.fromTs,
        toTs: input.toTs,
      },
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
  const events = readEvents(segments);
  return {
    clip: {
      clipId: chosen.clipId,
      traceId: chosen.traceId,
      startOffsetMs: startOffsetMs(events, input.entryTs),
      eventsJson: JSON.stringify(events),
    },
    clips: [],
  };
}

export const getTraceReplay = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(TraceReplayInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    loadTraceReplay(repoFromContext(clickhouse), data),
  );
