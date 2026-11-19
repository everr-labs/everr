import { attributeExists, attributeText } from "../../sql/json-attributes";
import { validateTableName } from "../../sql/table";
import { CLIP_TRIGGERS, type ClipSubject, RECORDING_STREAM_ATTRIBUTE } from "../data/schemas";

/*
 * When a Clip covers a record. The list filters and the player's lookup are
 * all built from the pair relations below, so they cannot disagree.
 *
 * A Clip covers a record when
 *   (a) the record carries the Clip's stream id,
 *   (b) their time ranges overlap (a log is an instant), and
 *   (c) the Clip starts within REACH of the record's start.
 * A trace is covered when one of its spans is. An exception log without a
 * stream id is covered when its trace is.
 *
 * (c) keeps every scan window finite and the same in the filters and the
 * lookup. One hour is also loadClipById's lookback in the app's reader.
 */
const REACH = "INTERVAL 1 HOUR";

/** SQL expressions (DateTime64(9)) that bound the records' start times. */
type TimeBounds = { from: string; to: string };

const span = (key: string) => attributeText("SpanAttributes", key);

/** Valid Clips that can cover a record starting within `bounds`, one row per clip id. */
function clipsSql(traces: string, bounds: TimeBounds): string {
  return `
    SELECT
      ${span("everr.recording.clip.id")} AS clip_id,
      ${span(RECORDING_STREAM_ATTRIBUTE)} AS clip_stream,
      ${span("session.id")} AS clip_session,
      ServiceName AS clip_service,
      ${span("everr.recording.trigger")} AS clip_trigger,
      toUInt8(${span("everr.recording.clip.truncated")} = 'true') AS clip_truncated,
      Timestamp AS clip_start,
      addNanoseconds(Timestamp, Duration) AS clip_end
    FROM ${traces}
    WHERE SpanName = 'recording'
      AND Timestamp BETWEEN (${bounds.from}) - ${REACH} AND (${bounds.to}) + ${REACH}
      AND clip_id != '' AND clip_stream != '' AND clip_session != '' AND clip_service != ''
      AND clip_trigger IN (${CLIP_TRIGGERS.map((t) => `'${t}'`).join(", ")})
    ORDER BY clip_start ASC
    LIMIT 1 BY clip_id`;
}

const CLIP_COLUMNS =
  "c.clip_id, c.clip_stream, c.clip_session, c.clip_service, c.clip_trigger, c.clip_truncated, c.clip_start, c.clip_end";

/** (span, Clip) pairs. `spanWhere` picks the spans and keeps their starts within `bounds`. */
function spanClipPairsSql(traces: string, spanWhere: string, bounds: TimeBounds): string {
  return `
    SELECT
      s.trace_id AS trace_id,
      ${CLIP_COLUMNS},
      greatest(s.span_start, c.clip_start) AS focus_start,
      least(s.span_end, c.clip_end) AS focus_end
    FROM (
      SELECT
        TraceId AS trace_id,
        ${span(RECORDING_STREAM_ATTRIBUTE)} AS span_stream,
        Timestamp AS span_start,
        addNanoseconds(Timestamp, Duration) AS span_end
      FROM ${traces}
      WHERE ${spanWhere}
        AND ${attributeExists("SpanAttributes", RECORDING_STREAM_ATTRIBUTE)}
    ) AS s
    INNER JOIN (${clipsSql(traces, bounds)}) AS c ON s.span_stream = c.clip_stream
    WHERE s.span_start <= c.clip_end AND s.span_end >= c.clip_start
      AND c.clip_start BETWEEN s.span_start - ${REACH} AND s.span_start + ${REACH}`;
}

/** (log instant, Clip) pairs. `logsSql` yields `log_stream` and `log_ts` within `bounds`. */
function logClipPairsSql(traces: string, logsSql: string, bounds: TimeBounds): string {
  return `
    SELECT
      l.log_stream AS log_stream,
      l.log_ts AS log_ts,
      ${CLIP_COLUMNS},
      l.log_ts AS focus_start,
      l.log_ts AS focus_end
    FROM (${logsSql}) AS l
    INNER JOIN (${clipsSql(traces, bounds)}) AS c ON l.log_stream = c.clip_stream
    WHERE l.log_ts BETWEEN c.clip_start AND c.clip_end
      AND c.clip_start >= l.log_ts - ${REACH}`;
}

/**
 * The ids of recorded traces among spans that start within `bounds`, for
 * `TraceId IN (...)`. `onlyTraces`, a TraceId subquery, narrows the span scan.
 */
export function recordedTraceIdsSql(
  traces: string,
  bounds: TimeBounds,
  onlyTraces?: string,
): string {
  validateTableName(traces);
  const spanWhere = `Timestamp BETWEEN ${bounds.from} AND ${bounds.to}${
    onlyTraces ? ` AND TraceId IN (${onlyTraces})` : ""
  }`;
  return `SELECT DISTINCT trace_id FROM (${spanClipPairsSql(traces, spanWhere, bounds)})`;
}

/**
 * A predicate over one exception log row in `tables.logs`, true when a Clip
 * covers it. `exceptionFilter` narrows the inner scans to exception logs.
 *
 * Its TypeScript half is `clipSubjectOfOccurrence`; both test the stream id
 * against '' so a key present with an empty value takes the trace path in both.
 */
export function recordedLogPredicateSql(
  tables: { traces: string; logs: string },
  bounds: TimeBounds,
  exceptionFilter: string,
): string {
  validateTableName(tables.traces);
  validateTableName(tables.logs);
  const stream = attributeText("LogAttributes", RECORDING_STREAM_ATTRIBUTE);
  const inWindow = `Timestamp BETWEEN ${bounds.from} AND ${bounds.to} AND ${exceptionFilter}`;
  const ownLogs = `
    SELECT ${stream} AS log_stream, Timestamp AS log_ts
    FROM ${tables.logs}
    WHERE ${inWindow} AND ${attributeExists("LogAttributes", RECORDING_STREAM_ATTRIBUTE)}`;
  const streamlessTraces = `
    SELECT TraceId FROM ${tables.logs}
    WHERE ${inWindow} AND ${stream} = '' AND TraceId != ''`;
  // The detail reads the whole trace, so the spans scanned run from the
  // start of these traces to the end of them, from the TraceId-sorted lookup.
  const lookup = `${tables.traces}_trace_id_ts`;
  const traceBounds = {
    from: `(SELECT toDateTime64(min(Start), 9) FROM ${lookup} WHERE TraceId IN (${streamlessTraces}))`,
    to: `(SELECT toDateTime64(max(End), 9) + INTERVAL 1 SECOND FROM ${lookup} WHERE TraceId IN (${streamlessTraces}))`,
  };
  return `(
    (${stream} != '' AND (${stream}, Timestamp) IN (
      SELECT log_stream, log_ts FROM (${logClipPairsSql(tables.traces, ownLogs, bounds)})
    ))
    OR (${stream} = '' AND TraceId != '' AND TraceId IN (
      ${recordedTraceIdsSql(tables.traces, traceBounds, streamlessTraces)}
    ))
  )`;
}

/** The Clips covering one subject: one row per Clip, earliest first, at most 10. */
export function coveringClipsQuery(
  traces: string,
  subject: ClipSubject,
): { sql: string; params: Record<string, unknown> } {
  validateTableName(traces);
  let pairs: string;
  let params: Record<string, unknown>;
  switch (subject.kind) {
    case "trace": {
      // The window getTrace reads, from the TraceId-sorted lookup table.
      const lookup = `${traces}_trace_id_ts`;
      const from = `(SELECT toDateTime64(min(Start), 9) FROM ${lookup} WHERE TraceId = {traceId:String})`;
      const to = `(SELECT toDateTime64(max(End), 9) + INTERVAL 1 SECOND FROM ${lookup} WHERE TraceId = {traceId:String})`;
      pairs = spanClipPairsSql(
        traces,
        `TraceId = {traceId:String} AND Timestamp >= ${from} AND Timestamp < ${to}`,
        { from, to },
      );
      params = { traceId: subject.traceId };
      break;
    }
    case "log": {
      const at = "parseDateTime64BestEffort({at:String}, 9)";
      pairs = logClipPairsSql(traces, `SELECT {streamId:String} AS log_stream, ${at} AS log_ts`, {
        from: at,
        to: at,
      });
      params = { streamId: subject.streamId, at: subject.at };
      break;
    }
  }
  return {
    params,
    sql: `
      SELECT
        clip_id AS clipId,
        clip_stream AS streamId,
        clip_session AS sessionId,
        clip_service AS serviceName,
        clip_trigger AS trigger,
        clip_truncated AS truncated,
        toUnixTimestamp64Milli(clip_start) AS startMs,
        toUnixTimestamp64Milli(clip_end) AS endMs,
        toUnixTimestamp64Milli(min(focus_start)) AS focusStartMs,
        toUnixTimestamp64Milli(max(focus_end)) AS focusEndMs
      FROM (${pairs})
      GROUP BY clip_id, clip_stream, clip_session, clip_service, clip_trigger, clip_truncated, clip_start, clip_end
      ORDER BY startMs ASC, clipId ASC
      LIMIT 10
    `,
  };
}
