import {
  type GetRecordingInput,
  type ListRecordingsInput,
  MAX_SEGMENTS,
  type RecordingClipDetail,
  type RecordingClipSummary,
  type RecordingSegment,
} from "./schemas";

export type SqlClient = {
  execute: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
};

type ClipRow = Omit<RecordingClipSummary, "trigger" | "segmentCount"> & {
  segmentCount: string | number;
};

type TriggerRow = {
  clipId: string;
  trigger: string;
};

type SegmentRow = {
  segmentIndex: string | number;
  body: string;
};

const FROM_TS = "parseDateTime64BestEffort({fromTs:String}, 9)";
const TO_TS = "parseDateTime64BestEffort({toTs:String}, 9)";

// The app_ro row policy applies tenant isolation. These statements do not
// mention tenant_id. app.recordings is ordered by (tenant_id, ServiceName,
// Timestamp). A detail read filters ServiceName and Timestamp. A list read
// filters Timestamp so daily partitions prune, and ServiceName when the
// Explore service filter is set. session_id and clip_id use the bloom filters.
//
// The recording Span, not the Segment, carries everr.recording.trigger. Trigger
// lookup is a second query on the page's clip ids, not a join of every Span.

function filled(values: string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function clipsSql(options: { clipId: boolean; service: boolean; environment: boolean }): string {
  const filters = [
    options.clipId ? "AND clip_id = {clipId:String}" : "",
    options.service ? "AND ServiceName IN {services:Array(String)}" : "",
    options.environment
      ? "AND toString(ResourceAttributes.`deployment.environment.name`) IN {environments:Array(String)}"
      : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n  ");

  return `
SELECT
  clip_id AS clipId,
  argMax(stream_id, Timestamp) AS streamId,
  argMax(session_id, Timestamp) AS sessionId,
  argMax(ServiceName, Timestamp) AS serviceName,
  toString(min(Timestamp)) AS startedAt,
  toString(max(Timestamp)) AS endedAt,
  argMin(toString(LogAttributes.\`url.full\`), Timestamp) AS url,
  argMin(toString(LogAttributes.\`everr.route.pattern\`), Timestamp) AS route,
  count() AS segmentCount
FROM recordings
WHERE Timestamp >= ${FROM_TS}
  AND Timestamp <= ${TO_TS}
  AND clip_id != ''
  ${filters}
GROUP BY clip_id
ORDER BY max(Timestamp) DESC, clip_id ASC
LIMIT {limit:UInt32}
OFFSET {offset:UInt32}
`;
}

function triggersSql(service: boolean): string {
  const serviceFilter = service ? "AND ServiceName IN {services:Array(String)}" : "";
  return `
SELECT
  toString(SpanAttributes.\`everr.recording.clip.id\`) AS clipId,
  any(toString(SpanAttributes.\`everr.recording.trigger\`)) AS trigger
FROM traces
WHERE SpanName = 'recording'
  AND Timestamp >= ${FROM_TS} - INTERVAL 6 MINUTE
  AND Timestamp <= ${TO_TS}
  AND toString(SpanAttributes.\`everr.recording.clip.id\`) IN {clipIds:Array(String)}
  ${serviceFilter}
GROUP BY clipId
`;
}

// The first Segment in the page window can sit after the snapshot. A manual
// Clip keeps up to 5 minutes of buffer, and snapshot thinning can keep a full
// snapshot nearly 70 seconds before the requested start. 7 minutes covers both
// from the first in-window Segment.
const SEGMENTS_SQL = `
SELECT
  toInt64OrZero(toString(LogAttributes.\`everr.recording.segment.index\`)) AS segmentIndex,
  Body AS body
FROM recordings
WHERE ServiceName = {service:String}
  AND Timestamp >= ${FROM_TS} - INTERVAL 7 MINUTE
  AND Timestamp <= ${TO_TS} + INTERVAL 5 SECOND
  AND session_id = {sessionId:String}
  AND clip_id = {clipId:String}
ORDER BY segmentIndex ASC
LIMIT {maxSegments:UInt32}
`;

function countOf(value: string | number): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? count : 0;
}

function toSummary(row: ClipRow, trigger: string): RecordingClipSummary {
  return {
    clipId: row.clipId,
    streamId: row.streamId,
    sessionId: row.sessionId,
    serviceName: row.serviceName,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    url: row.url,
    route: row.route,
    trigger,
    segmentCount: countOf(row.segmentCount),
  };
}

export class RecordingsRepository {
  constructor(private readonly client: SqlClient) {}

  async list(input: ListRecordingsInput): Promise<RecordingClipSummary[]> {
    const services = filled(input.service);
    const environments = filled(input.environment);
    const rows = await this.client.execute<ClipRow>(
      clipsSql({
        clipId: false,
        service: services.length > 0,
        environment: environments.length > 0,
      }),
      {
        fromTs: input.fromTs,
        toTs: input.toTs,
        limit: input.limit,
        offset: input.offset,
        ...(services.length > 0 ? { services } : {}),
        ...(environments.length > 0 ? { environments } : {}),
      },
    );
    const triggers = await this.triggersFor(rows, input.fromTs, input.toTs, services);
    return rows.map((row) => toSummary(row, triggers.get(row.clipId) ?? ""));
  }

  async get(input: GetRecordingInput): Promise<RecordingClipDetail | null> {
    const services = filled(input.service);
    const environments = filled(input.environment);
    const rows = await this.client.execute<ClipRow>(
      clipsSql({
        clipId: true,
        service: services.length > 0,
        environment: environments.length > 0,
      }),
      {
        fromTs: input.fromTs,
        toTs: input.toTs,
        clipId: input.clipId,
        limit: 1,
        offset: 0,
        ...(services.length > 0 ? { services } : {}),
        ...(environments.length > 0 ? { environments } : {}),
      },
    );
    const row = rows[0];
    if (!row) return null;

    const [triggers, segmentRows] = await Promise.all([
      this.triggersFor([row], input.fromTs, input.toTs, services),
      this.client.execute<SegmentRow>(SEGMENTS_SQL, {
        service: row.serviceName,
        sessionId: row.sessionId,
        clipId: row.clipId,
        fromTs: row.startedAt,
        toTs: row.endedAt,
        maxSegments: MAX_SEGMENTS,
      }),
    ]);

    const segments: RecordingSegment[] = [];
    for (const segment of segmentRows) {
      if (!segment.body) continue;
      const index = countOf(segment.segmentIndex);
      segments.push({ index, body: segment.body });
    }

    return {
      ...toSummary(row, triggers.get(row.clipId) ?? ""),
      segments,
    };
  }

  private async triggersFor(
    rows: ClipRow[],
    fromTs: string,
    toTs: string,
    services: string[],
  ): Promise<Map<string, string>> {
    const clipIds = rows.map((row) => row.clipId).filter((id) => id.length > 0);
    if (clipIds.length === 0) return new Map();
    const triggers = await this.client.execute<TriggerRow>(triggersSql(services.length > 0), {
      fromTs,
      toTs,
      clipIds,
      ...(services.length > 0 ? { services } : {}),
    });
    return new Map(triggers.map((row) => [row.clipId, row.trigger]));
  }
}
