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

function clip(row: {
  traceId: string;
  clipId: string;
  stream: string;
  start: string;
  seconds: number;
  trigger: string;
  truncated?: boolean;
}) {
  span({
    TraceId: row.traceId,
    SpanId: `${row.traceId}-root`,
    SpanName: "recording",
    Timestamp: row.start,
    Duration: row.seconds * 1e9,
    SpanAttributes: {
      "session.id": "session-1",
      "everr.recording.clip.id": row.clipId,
      "everr.recording.stream.id": row.stream,
      "everr.recording.trigger": row.trigger,
      ...(row.truncated ? { "everr.recording.clip.truncated": "true" } : {}),
    },
  });
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

  // The Clip [10:00:00, 10:01:10] on STREAM, delivered twice.
  for (let i = 0; i < 2; i++) {
    clip({
      traceId: "rec-error",
      clipId: "clip-error",
      stream: STREAM,
      start: "2026-11-15 10:00:00",
      seconds: 70,
      trigger: "error",
    });
  }
  // An idle page: the Clip starts more than an hour before what it overlaps.
  clip({
    traceId: "rec-idle",
    clipId: "clip-idle",
    stream: IDLE_STREAM,
    start: "2026-11-15 07:00:00",
    seconds: 3 * 3600,
    trigger: "manual",
    truncated: true,
  });
  clip({
    traceId: "rec-odd",
    clipId: "clip-odd",
    stream: ODD_STREAM,
    start: "2026-11-15 10:00:00",
    seconds: 70,
    trigger: "from-a-future-sdk",
  });

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

  // Trace "paged" starts before the Clip's root Span, and its recorded Span starts after it.
  clip({
    traceId: "rec-paged",
    clipId: "clip-paged",
    stream: PAGED_STREAM,
    start: "2026-11-15 10:10:03",
    seconds: 70,
    trigger: "error",
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

async function listedTraceIds(): Promise<string[]> {
  const rows = await traces.search({
    ...window,
    namespace: [],
    service: [],
    name: "",
    status: "all",
    attributes: [],
    withRecording: true,
    limit: 500,
  });
  return rows.map((row) => row.traceId).sort();
}

async function pagedTraceIds(limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: { cursorStartTs: string; cursorTraceId: string } | undefined;
  for (;;) {
    const rows = await traces.search({
      ...window,
      namespace: [],
      service: [],
      name: "",
      status: "all",
      attributes: [],
      withRecording: true,
      limit,
      ...cursor,
    });
    const last = rows.at(-1);
    if (!last) return ids.sort();
    ids.push(...rows.map((row) => row.traceId));
    cursor = { cursorStartTs: last.startTs, cursorTraceId: last.traceId };
  }
}

async function searchIssues(withRecording: boolean) {
  const { issues } = await errors.searchIssues({
    ...window,
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
      "paged",
      "rec-error",
      "rec-idle",
      "rec-paged",
      "t-in",
      "t-overlap",
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
    expect(byOccurrence).toHaveLength(8);
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
      "Mixed at 2026-11-15 10:00:40.000000000",
    ]);
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
    expect(await recordings.coveringClips({ kind: "trace", traceId: "rec-idle" })).toMatchObject([
      { clipId: "clip-idle", trigger: "manual", truncated: true },
    ]);
  });
});
