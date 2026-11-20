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
 *
 * A Clip is not stored as a row. It is read from the Segments in the
 * recordings table, by the rule of the app's replay reader (CLIP_GROUP in
 * packages/app/src/data/replay/session.ts): the Segments of one Stream with
 * the same clip_start. Its range runs from clip_start to the last segment_end.
 */
const REACH = "INTERVAL 1 HOUR";

/** SQL expressions (DateTime64(9)) that bound the records' start times. */
type TimeBounds = { from: string; to: string };

const span = (key: string) => attributeText("SpanAttributes", key);

/** The tables the coverage queries read. */
type CoverageTables = { traces: string; recordings: string };

/**
 * Valid Clips that can cover a record starting within `bounds`, one row per
 * clip id.
 *
 * The inner query reads the Segments, which carry no Clip row. A run is the
 * Segments of one Stream with the same clip_start. The id, trigger and
 * truncated flag are those of the first Clip that opened in the run (the
 * lowest index among Segments with a clip id). A run whose opening Segment was
 * lost has an empty id and is not a Clip. The grouping also collapses rows
 * duplicated by at-least-once delivery. Its columns have other names than the
 * table's, because an output alias that equals a column name is read as the
 * alias inside the same query.
 *
 * A Clip starts within REACH of a record, and its Segments are looked for
 * within REACH after its start, as the reader does.
 */
function clipsSql(recordings: string, bounds: TimeBounds): string {
  return `
    SELECT
      opened_id AS clip_id,
      run_stream AS clip_stream,
      run_session AS clip_session,
      run_service AS clip_service,
      opened_trigger AS clip_trigger,
      opened_truncated AS clip_truncated,
      run_start AS clip_start,
      run_end AS clip_end
    FROM (
      SELECT
        argMinIf(clip_id, segment_index, clip_id != '') AS opened_id,
        stream_id AS run_stream,
        any(session_id) AS run_session,
        any(ServiceName) AS run_service,
        argMinIf(trigger, segment_index, clip_id != '') AS opened_trigger,
        toUInt8(argMinIf(truncated, segment_index, clip_id != '')) AS opened_truncated,
        toDateTime64(clip_start, 9) AS run_start,
        toDateTime64(max(segment_end), 9) AS run_end
      FROM ${recordings}
      WHERE Timestamp BETWEEN (${bounds.from}) - ${REACH} AND (${bounds.to}) + ${REACH} + ${REACH}
      GROUP BY stream_id, clip_start
      HAVING opened_id != '' AND run_stream != '' AND run_session != '' AND run_service != ''
        AND opened_trigger IN (${CLIP_TRIGGERS.map((t) => `'${t}'`).join(", ")})
        AND run_start BETWEEN (${bounds.from}) - ${REACH} AND (${bounds.to}) + ${REACH}
    )
    ORDER BY clip_start ASC
    LIMIT 1 BY clip_id`;
}

const CLIP_COLUMNS =
  "c.clip_id, c.clip_stream, c.clip_session, c.clip_service, c.clip_trigger, c.clip_truncated, c.clip_start, c.clip_end";

/** (span, Clip) pairs. `spanWhere` picks the spans and keeps their starts within `bounds`. */
function spanClipPairsSql(
  { traces, recordings }: CoverageTables,
  spanWhere: string,
  bounds: TimeBounds,
): string {
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
    INNER JOIN (${clipsSql(recordings, bounds)}) AS c ON s.span_stream = c.clip_stream
    WHERE s.span_start <= c.clip_end AND s.span_end >= c.clip_start
      AND c.clip_start BETWEEN s.span_start - ${REACH} AND s.span_start + ${REACH}`;
}

/** (log instant, Clip) pairs. `logsSql` yields `log_stream` and `log_ts` within `bounds`. */
function logClipPairsSql(recordings: string, logsSql: string, bounds: TimeBounds): string {
  return `
    SELECT
      l.log_stream AS log_stream,
      l.log_ts AS log_ts,
      ${CLIP_COLUMNS},
      l.log_ts AS focus_start,
      l.log_ts AS focus_end
    FROM (${logsSql}) AS l
    INNER JOIN (${clipsSql(recordings, bounds)}) AS c ON l.log_stream = c.clip_stream
    WHERE l.log_ts BETWEEN c.clip_start AND c.clip_end
      AND c.clip_start >= l.log_ts - ${REACH}`;
}

/**
 * The ids of recorded traces among spans that start within `bounds`, for
 * `TraceId IN (...)`. `onlyTraces`, a TraceId subquery, narrows the span scan.
 */
export function recordedTraceIdsSql(
  tables: CoverageTables,
  bounds: TimeBounds,
  onlyTraces?: string,
): string {
  validateTableName(tables.traces);
  validateTableName(tables.recordings);
  const spanWhere = `Timestamp BETWEEN ${bounds.from} AND ${bounds.to}${
    onlyTraces ? ` AND TraceId IN (${onlyTraces})` : ""
  }`;
  return `SELECT DISTINCT trace_id FROM (${spanClipPairsSql(tables, spanWhere, bounds)})`;
}

/**
 * A predicate over one exception log row in `tables.logs`, true when a Clip
 * covers it. `exceptionFilter` narrows the inner scans to exception logs.
 *
 * Its TypeScript half is `clipSubjectOfOccurrence`; both test the stream id
 * against '' so a key present with an empty value takes the trace path in both.
 */
export function recordedLogPredicateSql(
  tables: CoverageTables & { logs: string },
  bounds: TimeBounds,
  exceptionFilter: string,
): string {
  validateTableName(tables.traces);
  validateTableName(tables.recordings);
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
      SELECT log_stream, log_ts FROM (${logClipPairsSql(tables.recordings, ownLogs, bounds)})
    ))
    OR (${stream} = '' AND TraceId != '' AND TraceId IN (
      ${recordedTraceIdsSql(tables, traceBounds, streamlessTraces)}
    ))
  )`;
}

/** The Clips covering one subject: one row per Clip, earliest first, at most 10. */
export function coveringClipsQuery(
  tables: CoverageTables,
  subject: ClipSubject,
): { sql: string; params: Record<string, unknown> } {
  validateTableName(tables.traces);
  validateTableName(tables.recordings);
  let pairs: string;
  let params: Record<string, unknown>;
  switch (subject.kind) {
    case "trace": {
      // The window getTrace reads, from the TraceId-sorted lookup table.
      const lookup = `${tables.traces}_trace_id_ts`;
      const from = `(SELECT toDateTime64(min(Start), 9) FROM ${lookup} WHERE TraceId = {traceId:String})`;
      const to = `(SELECT toDateTime64(max(End), 9) + INTERVAL 1 SECOND FROM ${lookup} WHERE TraceId = {traceId:String})`;
      pairs = spanClipPairsSql(
        tables,
        `TraceId = {traceId:String} AND Timestamp >= ${from} AND Timestamp < ${to}`,
        { from, to },
      );
      params = { traceId: subject.traceId };
      break;
    }
    case "log": {
      const at = "parseDateTime64BestEffort({at:String}, 9)";
      pairs = logClipPairsSql(
        tables.recordings,
        `SELECT {streamId:String} AS log_stream, ${at} AS log_ts`,
        {
          from: at,
          to: at,
        },
      );
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
