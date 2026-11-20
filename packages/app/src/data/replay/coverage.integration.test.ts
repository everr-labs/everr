// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ErrorOccurrence, ErrorsRepository } from "@everr/telemetry-explorer/errors";
import {
  type ClipSubject,
  clipSubjectOfOccurrence,
  RecordingsRepository,
  type SqlClient,
} from "@everr/telemetry-explorer/recordings";
import { TracesRepository } from "@everr/telemetry-explorer/traces";
import { Session } from "chdb";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

let session: Session;
let dataDir: string;

function run(sql: string) {
  return String(session.query(sql, "JSONEachRow") ?? "").trim();
}

function migration(file: string) {
  return readFileSync(new URL(`../../../clickhouse/${file}`, import.meta.url), "utf8");
}

// The statements of a migration: its comments and the grants on Cloud's users
// are not part of what these tests need.
function statements(sql: string) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "" && !statement.startsWith("GRANT"));
}

function template(file: string) {
  return readFileSync(
    new URL(
      `../../../../../collector/exporter/chdbexporter/internal/sqltemplates/${file}`,
      import.meta.url,
    ),
    "utf8",
  );
}

function fill(text: string, values: string[]) {
  return text.replace(/%[qs]/g, () => values.shift() ?? "");
}

const client: SqlClient = {
  async execute<T>(sql: string, params: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(params)) {
      const text = Array.isArray(value)
        ? JSON.stringify(value).replace(/"/g, "'")
        : String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      run(`SET param_${key} = '${text}'`);
    }
    const rows = run(sql);
    return (rows ? rows.split("\n").map((line) => JSON.parse(line)) : []) as T[];
  },
};

const traces = new TracesRepository(client);
const errors = new ErrorsRepository(client);
const recordings = new RecordingsRepository(client);

const STREAM = "a".repeat(16);
const OTHER_STREAM = "b".repeat(16);
const IDLE_STREAM = "c".repeat(16);
const ODD_STREAM = "d".repeat(16);
const PAGED_STREAM = "e".repeat(16);
const LONG_TRACE_STREAM = "f".repeat(16);
const MANUAL_STREAM = "1".repeat(16);
const RUN_STREAM = "2".repeat(16);
const LOST_STREAM = "3".repeat(16);
const FROM_TS = "2026-11-15 06:00:00";
const TO_TS = "2026-11-15 12:00:00";
const ms = (civil: string) => Date.parse(`${civil.replace(" ", "T")}Z`);

// The collector fills the *AttributesKeys columns; a raw insert must too, or
// every has() on them is false.
function withKeys(row: Record<string, unknown>, columns: string[]) {
  for (const column of columns) {
    row[`${column}Keys`] = Object.keys((row[column] as Record<string, unknown>) ?? {});
  }
  return row;
}

function span(row: Record<string, unknown>) {
  const full = withKeys(
    {
      ServiceName: "web",
      Duration: 1_000_000,
      ResourceAttributes: { "service.name": "web" },
      ...row,
    },
    ["SpanAttributes", "ResourceAttributes"],
  );
  run(`INSERT INTO traces FORMAT JSONEachRow\n${JSON.stringify(full)}`);
}

// A Segment row, as the collector stores it: the materialized columns of the
// real table are computed from these attributes at insert.
function segment(row: {
  stream: string;
  index: number;
  at: string;
  end: string;
  start: string;
  session?: string;
  clipId?: string;
  trigger?: string;
  truncated?: boolean;
}) {
  const full = {
    Timestamp: row.at,
    ServiceName: "web",
    Body: "[]",
    ResourceAttributes: {
      "service.name": "web",
      "everr.tenant.id": "",
      "everr.retention.days": "3650",
    },
    LogAttributes: {
      "session.id": row.session ?? "session-1",
      "everr.recording.stream.id": row.stream,
      "everr.recording.segment.index": String(row.index),
      "everr.recording.segment.end": String(ms(row.end)),
      "everr.recording.clip.start": String(ms(row.start)),
      ...(row.clipId === undefined
        ? {}
        : {
            "everr.recording.clip.id": row.clipId,
            "everr.recording.trigger": row.trigger ?? "error",
            ...(row.truncated ? { "everr.recording.clip.truncated": "true" } : {}),
          }),
    },
  };
  run(`INSERT INTO recordings FORMAT JSONEachRow\n${JSON.stringify(full)}`);
}

// One Clip as the SDK sends it: the Segment that opens it, and an empty Segment
// that closes it. The opening Segment says its Stream is complete only up to
// its own start, so the Clip reaches its end through the closing Segment.
function clip(row: {
  clipId: string;
  stream: string;
  start: string;
  end: string;
  trigger: string;
  truncated?: boolean;
}) {
  segment({
    stream: row.stream,
    index: 0,
    at: row.start,
    end: row.start,
    start: row.start,
    clipId: row.clipId,
    trigger: row.trigger,
    truncated: row.truncated,
  });
  segment({ stream: row.stream, index: 1, at: row.end, end: row.end, start: row.start });
}

function exceptionLog(row: {
  type: string;
  at: string;
  traceId?: string;
  stream?: string;
  service?: string;
}) {
  const service = row.service ?? "web";
  const full = withKeys(
    {
      Timestamp: row.at,
      SeverityNumber: 17,
      ServiceName: service,
      Body: row.type,
      TraceId: row.traceId ?? "",
      ResourceAttributes: { "service.name": service },
      LogAttributes: {
        "exception.type": row.type,
        "exception.message": "boom",
        ...(row.stream === undefined ? {} : { "everr.recording.stream.id": row.stream }),
      },
    },
    ["LogAttributes", "ResourceAttributes"],
  );
  run(`INSERT INTO logs FORMAT JSONEachRow\n${JSON.stringify(full)}`);
}

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "everr-recording-coverage-"));
  session = new Session(dataDir);
  run("SET session_timezone = 'UTC'");
  run(fill(template("traces_json_table.sql"), ['"default"', '"traces"', "", "MergeTree()", ""]));
  run(
    fill(template("traces_id_ts_lookup_table.sql"), ["default", "traces", "", "MergeTree()", ""]),
  );
  run(
    fill(template("traces_id_ts_lookup_mv.sql"), [
      "default",
      "traces",
      "",
      "default",
      "traces",
      "default",
      "traces",
    ]),
  );
  run(template("create_error_fingerprint_function.sql"));
  run(
    template("logs_json_table.sql")
      .replace("{{ident .Database}}", '"default"')
      .replace("{{ident .TableName}}", '"logs"')
      .replace(/\{\{[^}]*\}\}/g, (tag) => (tag === "{{.Engine}}" ? "MergeTree()" : "")),
  );

  // The real recordings table, as the migrations create it (the collector's
  // retention function comes first).
  const retention = migration("0005-create-retention-functions.sql").match(
    /CREATE OR REPLACE FUNCTION everrRetentionDaysJson[^;]*/,
  )?.[0];
  for (const statement of [
    retention ?? "",
    ...statements(migration("0013-create-recordings.sql")).map((statement) =>
      statement.replace("app.recordings", "recordings"),
    ),
  ]) {
    run(statement);
  }

  // The Clip [10:00:00, 10:01:10] on STREAM, with every Segment delivered twice.
  for (let i = 0; i < 2; i++) {
    clip({
      clipId: "clip-error",
      stream: STREAM,
      start: "2026-11-15 10:00:00",
      end: "2026-11-15 10:01:10",
      trigger: "error",
    });
  }
  // An idle page: the Clip starts more than an hour before what it overlaps.
  clip({
    clipId: "clip-idle",
    stream: IDLE_STREAM,
    start: "2026-11-15 07:00:00",
    end: "2026-11-15 10:00:00",
    trigger: "manual",
    truncated: true,
  });
  clip({
    clipId: "clip-odd",
    stream: ODD_STREAM,
    start: "2026-11-15 10:00:00",
    end: "2026-11-15 10:01:10",
    trigger: "from-a-future-sdk",
  });
  clip({
    clipId: "clip-manual",
    stream: MANUAL_STREAM,
    start: "2026-11-15 11:00:00",
    end: "2026-11-15 11:00:20",
    trigger: "manual",
    truncated: true,
  });
  span({
    TraceId: "t-manual",
    SpanId: "manual",
    SpanName: "GET /manual",
    Timestamp: "2026-11-15 11:00:05",
    SpanAttributes: { "everr.recording.stream.id": MANUAL_STREAM },
  });

  // Two Clips opened in one run: they share clip_start, and the first id wins.
  segment({
    stream: RUN_STREAM,
    index: 0,
    at: "2026-11-15 08:30:00",
    end: "2026-11-15 08:30:00",
    start: "2026-11-15 08:30:00",
    clipId: "clip-run-first",
    trigger: "error",
  });
  segment({
    stream: RUN_STREAM,
    index: 1,
    at: "2026-11-15 08:30:20",
    end: "2026-11-15 08:30:20",
    start: "2026-11-15 08:30:00",
    clipId: "clip-run-second",
    trigger: "manual",
    truncated: true,
  });
  segment({
    stream: RUN_STREAM,
    index: 2,
    at: "2026-11-15 08:31:00",
    end: "2026-11-15 08:31:00",
    start: "2026-11-15 08:30:00",
  });
  span({
    TraceId: "t-run",
    SpanId: "run",
    SpanName: "GET /run",
    Timestamp: "2026-11-15 08:30:40",
    SpanAttributes: { "everr.recording.stream.id": RUN_STREAM },
  });
  exceptionLog({ type: "RunInside", at: "2026-11-15 08:30:45", stream: RUN_STREAM });

  // A run whose opening Segment was lost: no Clip, so nothing in it is recorded.
  for (const index of [3, 4]) {
    segment({
      stream: LOST_STREAM,
      index,
      at: `2026-11-15 08:50:${index * 10}`,
      end: `2026-11-15 08:51:${index * 10}`,
      start: "2026-11-15 08:50:00",
    });
  }
  span({
    TraceId: "t-lost",
    SpanId: "lost",
    SpanName: "GET /lost",
    Timestamp: "2026-11-15 08:50:45",
    SpanAttributes: { "everr.recording.stream.id": LOST_STREAM },
  });
  exceptionLog({ type: "LostRun", at: "2026-11-15 08:50:45", stream: LOST_STREAM });

  span({
    TraceId: "t-in",
    SpanId: "fetch",
    SpanName: "GET /checkout",
    Timestamp: "2026-11-15 10:00:30",
    SpanAttributes: { "everr.recording.stream.id": STREAM, "session.id": "session-1" },
  });
  span({
    TraceId: "t-in",
    SpanId: "server",
    ParentSpanId: "fetch",
    SpanName: "POST /checkout",
    ServiceName: "api",
    ResourceAttributes: { "service.name": "api" },
    Timestamp: "2026-11-15 10:00:30.100",
    SpanAttributes: {},
  });
  span({
    TraceId: "t-overlap",
    SpanId: "load",
    SpanName: "documentLoad",
    Timestamp: "2026-11-15 09:59:59",
    Duration: 2e9,
    SpanAttributes: { "everr.recording.stream.id": STREAM },
  });
  // The last Segment ends at 10:01:10 (the closing Segment), the opening one at 10:00:00.
  span({
    TraceId: "t-close",
    SpanId: "close",
    SpanName: "GET /close",
    Timestamp: "2026-11-15 10:01:09",
    SpanAttributes: { "everr.recording.stream.id": STREAM },
  });
  span({
    TraceId: "t-past",
    SpanId: "past",
    SpanName: "GET /past",
    Timestamp: "2026-11-15 10:01:11",
    SpanAttributes: { "everr.recording.stream.id": STREAM },
  });
  span({
    TraceId: "t-after",
    SpanId: "late",
    SpanName: "GET /later",
    Timestamp: "2026-11-15 10:05:00",
    SpanAttributes: { "everr.recording.stream.id": STREAM },
  });
  span({
    TraceId: "t-other-stream",
    SpanId: "other",
    SpanName: "GET /other",
    Timestamp: "2026-11-15 10:00:30",
    SpanAttributes: { "everr.recording.stream.id": OTHER_STREAM },
  });
  span({
    TraceId: "t-idle",
    SpanId: "idle",
    SpanName: "GET /idle",
    Timestamp: "2026-11-15 09:30:00",
    SpanAttributes: { "everr.recording.stream.id": IDLE_STREAM },
  });
  span({
    TraceId: "t-odd",
    SpanId: "odd",
    SpanName: "GET /odd",
    Timestamp: "2026-11-15 10:00:30",
    SpanAttributes: { "everr.recording.stream.id": ODD_STREAM },
  });

  // Trace "paged" starts before the trace "paged-edge", and its recorded Span starts after it.
  clip({
    clipId: "clip-paged",
    stream: PAGED_STREAM,
    start: "2026-11-15 10:10:03",
    end: "2026-11-15 10:11:13",
    trigger: "error",
  });
  span({
    TraceId: "paged-edge",
    SpanId: "paged-edge",
    SpanName: "GET /paged-edge",
    Timestamp: "2026-11-15 10:10:03",
    SpanAttributes: { "everr.recording.stream.id": PAGED_STREAM },
  });
  span({
    TraceId: "paged",
    SpanId: "paged-load",
    SpanName: "documentLoad",
    Timestamp: "2026-11-15 10:10:00",
    SpanAttributes: {},
  });
  span({
    TraceId: "paged",
    SpanId: "paged-fetch",
    ParentSpanId: "paged-load",
    SpanName: "GET /paged",
    Timestamp: "2026-11-15 10:10:04",
    SpanAttributes: { "everr.recording.stream.id": PAGED_STREAM },
  });

  // A backend error 90 minutes after the recorded browser Span of its trace.
  clip({
    clipId: "clip-long",
    stream: LONG_TRACE_STREAM,
    start: "2026-11-15 08:00:00",
    end: "2026-11-15 08:01:00",
    trigger: "error",
  });
  span({
    TraceId: "long",
    SpanId: "long-fetch",
    SpanName: "POST /job",
    Timestamp: "2026-11-15 08:00:10",
    SpanAttributes: { "everr.recording.stream.id": LONG_TRACE_STREAM },
  });
  span({
    TraceId: "long",
    SpanId: "long-job",
    ParentSpanId: "long-fetch",
    SpanName: "job",
    ServiceName: "api",
    ResourceAttributes: { "service.name": "api" },
    Timestamp: "2026-11-15 08:00:11",
    Duration: 2 * 3600e9,
    SpanAttributes: {},
  });
  exceptionLog({ type: "LateBackend", at: "2026-11-15 09:30:00", service: "api", traceId: "long" });

  exceptionLog({ type: "BrowserInside", at: "2026-11-15 10:00:50.123456789", stream: STREAM });
  exceptionLog({ type: "BrowserAfter", at: "2026-11-15 10:09:00", stream: STREAM });
  exceptionLog({
    type: "BackendRecordedTrace",
    at: "2026-11-15 10:00:30.150",
    service: "api",
    traceId: "t-in",
  });
  exceptionLog({
    type: "BackendUnrecordedTrace",
    at: "2026-11-15 10:05:00.050",
    service: "api",
    traceId: "t-after",
  });
  exceptionLog({ type: "BackendNoTrace", at: "2026-11-15 10:00:40", service: "api" });
  exceptionLog({
    type: "EmptyStreamRecordedTrace",
    at: "2026-11-15 10:00:30.200",
    stream: "",
    traceId: "t-in",
  });
  exceptionLog({ type: "Mixed", at: "2026-11-15 10:00:40", stream: STREAM });
  exceptionLog({ type: "Mixed", at: "2026-11-15 10:20:00", stream: STREAM });
});

afterAll(() => {
  session?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const window = { fromTs: FROM_TS, toTs: TO_TS };

const searchTraces = (page: { limit: number; cursorStartTs?: string; cursorTraceId?: string }) =>
  traces.search({
    ...window,
    namespace: [],
    service: [],
    name: "",
    status: "all",
    attributes: [],
    withRecording: true,
    ...page,
  });

async function listedTraceIds(): Promise<string[]> {
  const rows = await searchTraces({ limit: 500 });
  return rows.map((row) => row.traceId).sort();
}

async function pagedTraceIds(limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: { cursorStartTs: string; cursorTraceId: string } | undefined;
  for (;;) {
    const rows = await searchTraces({ limit, ...cursor });
    const last = rows.at(-1);
    if (!last) return ids.sort();
    ids.push(...rows.map((row) => row.traceId));
    cursor = { cursorStartTs: last.startTs, cursorTraceId: last.traceId };
  }
}

async function searchIssues(
  withRecording: boolean,
  range: { fromTs: string; toTs: string } = window,
) {
  const { issues } = await errors.searchIssues({
    ...range,
    q: "",
    service: [],
    fingerprint: "",
    sort: "lastSeen",
    limit: 500,
    offset: 0,
    attributes: [],
    withRecording,
  });
  return issues;
}

function getIssue(fingerprint: string, withRecording: boolean) {
  return errors.getIssue({
    ...window,
    fingerprint,
    service: [],
    withRecording,
    occurrenceLimit: 200,
  });
}

async function allOccurrences(): Promise<ErrorOccurrence[]> {
  const issues = await searchIssues(false);
  const details = await Promise.all(issues.map((issue) => getIssue(issue.fingerprint, false)));
  return details.flatMap((detail) => detail.occurrences);
}

async function covered(subject: ClipSubject | undefined): Promise<boolean> {
  return subject !== undefined && (await recordings.coveringClips(subject)).length > 0;
}

describe("session recording coverage against ClickHouse", () => {
  it("lists a trace with the switch on exactly when its detail finds a Clip", async () => {
    const listed = new Set(await listedTraceIds());
    const ids = run("SELECT DISTINCT TraceId AS id FROM traces ORDER BY id")
      .split("\n")
      .map((line) => (JSON.parse(line) as { id: string }).id);

    const byTrace = await Promise.all(
      ids.map(async (traceId) => ({
        traceId,
        listed: listed.has(traceId),
        playable: await covered({ kind: "trace", traceId }),
      })),
    );
    for (const row of byTrace) {
      expect(row.listed, row.traceId).toBe(row.playable);
    }
    expect([...listed].sort()).toEqual([
      "long",
      "paged",
      "paged-edge",
      "t-close",
      "t-in",
      "t-manual",
      "t-overlap",
      "t-run",
    ]);
  });

  it("pages the recorded traces to the same list as one unpaged search", async () => {
    expect(await pagedTraceIds(1)).toEqual(await listedTraceIds());
  });

  it("lists an exception log with the switch on exactly when its detail finds a Clip", async () => {
    const occurrences = await allOccurrences();
    const listedIssues = new Set((await searchIssues(true)).map((issue) => issue.fingerprint));

    const byOccurrence = await Promise.all(
      occurrences.map(async (occurrence) => {
        const scoped = listedIssues.has(occurrence.fingerprint)
          ? (await getIssue(occurrence.fingerprint, true)).occurrences
          : [];
        return {
          error: `${occurrence.exceptionType} at ${occurrence.timestamp}`,
          listed: scoped.some((o) => o.timestamp === occurrence.timestamp),
          playable: await covered(clipSubjectOfOccurrence(occurrence)),
        };
      }),
    );
    expect(byOccurrence).toHaveLength(11);
    for (const row of byOccurrence) {
      expect(row.listed, row.error).toBe(row.playable);
    }
    expect(
      byOccurrence
        .filter((row) => row.listed)
        .map((row) => row.error)
        .sort(),
    ).toEqual([
      "BackendRecordedTrace at 2026-11-15 10:00:30.150000000",
      "BrowserInside at 2026-11-15 10:00:50.123456789",
      "EmptyStreamRecordedTrace at 2026-11-15 10:00:30.200000000",
      "LateBackend at 2026-11-15 09:30:00.000000000",
      "Mixed at 2026-11-15 10:00:40.000000000",
      "RunInside at 2026-11-15 08:30:45.000000000",
    ]);
  });

  it("lists a streamless error when its trace was recorded long before the searched window", async () => {
    const issues = await searchIssues(true, {
      fromTs: "2026-11-15 09:29:00",
      toTs: "2026-11-15 09:31:00",
    });
    expect(issues.map((issue) => issue.exceptionType)).toEqual(["LateBackend"]);
    expect(await covered({ kind: "trace", traceId: "long" })).toBe(true);
  });

  it("scopes an Error's detail to its recorded occurrences", async () => {
    const mixed = (await searchIssues(true)).find((issue) => issue.exceptionType === "Mixed");
    expect(mixed?.occurrenceCount).toBe(1);

    const detail = await getIssue(mixed?.fingerprint ?? "", true);
    expect(detail.summary.occurrenceCount).toBe(1);
    expect(detail.occurrences.map((o) => o.timestamp)).toEqual(["2026-11-15 10:00:40.000000000"]);
    expect(detail.latest.timestamp).toBe("2026-11-15 10:00:40.000000000");

    const unscoped = await getIssue(mixed?.fingerprint ?? "", false);
    expect(unscoped.summary.occurrenceCount).toBe(2);
  });

  it("returns one Clip per clip id with the subject's part of it as the focus", async () => {
    const errorClip = {
      clipId: "clip-error",
      streamId: STREAM,
      sessionId: "session-1",
      serviceName: "web",
      trigger: "error",
      truncated: false,
      startMs: ms("2026-11-15 10:00:00"),
      endMs: ms("2026-11-15 10:01:10"),
    };

    expect(await recordings.coveringClips({ kind: "trace", traceId: "t-in" })).toEqual([
      {
        ...errorClip,
        focus: { startMs: ms("2026-11-15 10:00:30"), endMs: ms("2026-11-15 10:00:30.001") },
      },
    ]);
    expect(await recordings.coveringClips({ kind: "trace", traceId: "t-overlap" })).toEqual([
      {
        ...errorClip,
        focus: { startMs: ms("2026-11-15 10:00:00"), endMs: ms("2026-11-15 10:00:01") },
      },
    ]);
    expect(
      await recordings.coveringClips({
        kind: "log",
        streamId: STREAM,
        at: "2026-11-15 10:00:50.123456789",
      }),
    ).toEqual([
      {
        ...errorClip,
        focus: { startMs: ms("2026-11-15 10:00:50.123"), endMs: ms("2026-11-15 10:00:50.123") },
      },
    ]);
    expect(await recordings.coveringClips({ kind: "trace", traceId: "t-manual" })).toMatchObject([
      { clipId: "clip-manual", trigger: "manual", truncated: true },
    ]);
  });

  it("collapses Segments delivered twice into one Clip", async () => {
    const stored = run(`SELECT count() AS n FROM recordings WHERE stream_id = '${STREAM}'`);
    expect(JSON.parse(stored)).toEqual({ n: 4 });
    expect(await recordings.coveringClips({ kind: "trace", traceId: "t-in" })).toHaveLength(1);
  });

  it("reads a run with two Clips opened in it as one Clip, with the first id and trigger", async () => {
    expect(await recordings.coveringClips({ kind: "trace", traceId: "t-run" })).toMatchObject([
      {
        clipId: "clip-run-first",
        streamId: RUN_STREAM,
        trigger: "error",
        truncated: false,
        startMs: ms("2026-11-15 08:30:00"),
        endMs: ms("2026-11-15 08:31:00"),
      },
    ]);
  });

  it("reads a run whose opening Segment was lost as no Clip", async () => {
    expect(await covered({ kind: "trace", traceId: "t-lost" })).toBe(false);
    expect(await covered({ kind: "log", streamId: LOST_STREAM, at: "2026-11-15 08:50:45" })).toBe(
      false,
    );
    expect(await listedTraceIds()).not.toContain("t-lost");
  });

  it("covers up to the close time, which only the closing Segment says, and not past it", async () => {
    expect(await covered({ kind: "trace", traceId: "t-close" })).toBe(true);
    expect(await covered({ kind: "trace", traceId: "t-past" })).toBe(false);
    expect(await listedTraceIds()).toContain("t-close");
    expect(await listedTraceIds()).not.toContain("t-past");
  });
});
