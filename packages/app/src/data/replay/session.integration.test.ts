// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "chdb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

const db = vi.hoisted(() => ({ run: (_sql: string): string => "" }));

vi.mock("#app/lib/clickhouse.ts", () => ({
  query: async (sql: string, _org: string, params: Record<string, unknown> = {}) => {
    for (const [key, value] of Object.entries(params)) {
      const text = String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      db.run(`SET param_${key} = '${text}'`);
    }
    const rows = db.run(sql);
    return rows ? rows.split("\n").map((line) => JSON.parse(line)) : [];
  },
  queryLines: async (sql: string, _org: string, params: Record<string, unknown> = {}) => {
    for (const [key, value] of Object.entries(params)) {
      const text = String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      db.run(`SET param_${key} = '${text}'`);
    }
    return (async function* () {
      yield* db.run(sql).split("\n").filter(Boolean);
    })();
  },
  querySqlApi: vi.fn(),
  runSqlApiQuery: vi.fn(),
}));

import { clipEvents, loadClips, segmentLines, select, windowAround } from "./session.ts";
import { ORG, STREAM } from "./test-fixtures.ts";

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

const AT = Date.UTC(2026, 10, 15, 10, 0, 0);
const civil = (ms: number) => new Date(ms).toISOString().slice(0, 23).replace("T", " ");

function clip(clipId: string, startMs: number, seconds: number, stream = STREAM) {
  const row = {
    TraceId: clipId,
    SpanId: `${clipId}-root`,
    SpanName: "recording",
    ServiceName: "web",
    Timestamp: civil(startMs),
    Duration: seconds * 1e9,
    SpanAttributes: {
      "session.id": "session-1",
      "everr.recording.clip.id": clipId,
      "everr.recording.stream.id": stream,
      "everr.recording.trigger": "manual",
    },
    ResourceAttributes: { "service.name": "web" },
    SpanAttributesKeys: [
      "session.id",
      "everr.recording.clip.id",
      "everr.recording.stream.id",
      "everr.recording.trigger",
    ],
    ResourceAttributesKeys: ["service.name"],
  };
  run(`INSERT INTO traces FORMAT JSONEachRow\n${JSON.stringify(row)}`);
}

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "everr-recording-clips-"));
  session = new Session(dataDir);
  db.run = run;
  run("SET session_timezone = 'UTC'");
  run(fill(template("traces_json_table.sql"), ['"default"', '"traces"', "", "MergeTree()", ""]));
  // The columns the reader selects, with the MATERIALIZED ones as in
  // packages/app/clickhouse/0013-create-recordings.sql.
  run(`CREATE TABLE recordings (
    Timestamp DateTime64(9),
    ServiceName LowCardinality(String),
    Body String,
    LogAttributes JSON(max_dynamic_paths = 256),
    stream_id String MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')),
    segment_index UInt32 MATERIALIZED toUInt32OrZero(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index')))
  ) ENGINE = MergeTree ORDER BY (stream_id, Timestamp, segment_index)`);
});

afterAll(() => {
  session.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the Clip that covers --at", () => {
  it("is found when more than 20 Clips of the Stream start in the window after it", async () => {
    clip("covering", AT - 10_000, 20);
    for (let i = 0; i < 25; i++) clip(`later-${i}`, AT + 30_000 + i * 1_000, 1);

    const window = windowAround(AT);
    const clips = await loadClips(ORG, STREAM, window, AT);

    expect(clips.length).toBeLessThanOrEqual(20);
    expect(select(clips, STREAM, AT, window).clipId).toBe("covering");
  });
});

// Send order is not time order when a later Clip reaches further back: Clip A
// (from Generation 5) sends Segments 0 to 2, then Clip B, opened by an error,
// sends Generation 4 as 3 to 5 (before A's start) and Generation 5 goes on as 6.
describe("Segments sent out of time order", () => {
  function segment(stream: string, index: number, atMs: number) {
    const events = [{ type: 3, timestamp: atMs, data: {} }];
    const row = {
      Timestamp: civil(atMs),
      ServiceName: "web",
      Body: JSON.stringify(events),
      LogAttributes: {
        "everr.recording.stream.id": stream,
        "everr.recording.segment.index": String(index),
      },
    };
    run(`INSERT INTO recordings FORMAT JSONEachRow\n${JSON.stringify(row)}`);
  }

  function setup(name: string, segments: [index: number, offsetMs: number][]) {
    const stream = name.padEnd(32, "0");
    const start = AT;
    clip(`clip-${name}`, start, 10, stream);
    for (const [index, offsetMs] of segments) segment(stream, index, start + offsetMs);
    return { clipId: `clip-${name}`, start, stream };
  }

  it("reports no gap when the missing indexes are Segments from before the Clip", async () => {
    const { clipId, start } = setup("a1", [
      [0, 100],
      [1, 200],
      [2, 300],
      [3, -60_000],
      [4, -50_000],
      [5, -40_000],
      [6, 400],
    ]);

    const { events, gaps } = await clipEvents(ORG, clipId, start);

    expect(gaps).toEqual([]);
    expect(events.map((e) => e.timestamp - start)).toEqual([100, 200, 300, 400]);
  });

  it("reports a gap for an index that no Segment of the Stream holds", async () => {
    const { clipId, start, stream } = setup("b1", [
      [0, 100],
      [1, 200],
      [2, 300],
      [3, -60_000],
      [5, -40_000],
      [6, 400],
    ]);

    const { gaps } = await clipEvents(ORG, clipId, start);

    expect(gaps).toEqual([{ kind: "index", streamId: stream, after: 3, missing: 1 }]);
  });

  it("looks for Segments from before the Clip an hour back and no further", async () => {
    const { clipId, start, stream } = setup("c1", [
      [0, 100],
      [1, -3_600_000 - 1_000],
      [2, 300],
      [3, -3_000_000],
      [4, 400],
      [5, 500],
    ]);

    const { gaps } = await clipEvents(ORG, clipId, start);

    // 1 is older than the bound: only that hole is reported.
    expect(gaps).toEqual([{ kind: "index", streamId: stream, after: 0, missing: 1 }]);
  });

  it("streams the Segments from before the Clip as body-less rows marked earlier, in index order", async () => {
    const { start, stream } = setup("d1", [
      [0, 100],
      [3, -60_000],
      [1, 200],
      [9, 3_000],
    ]);
    const lines = [];
    const found = (
      await segmentLines(
        ORG,
        {
          clipId: "clip-d1",
          streamId: stream,
          serviceName: "web",
          start: new Date(start),
          end: new Date(start + 10_000),
        },
        new Date(start + 1_000),
      )
    )[Symbol.asyncIterator]();
    for (let next = await found.next(); !next.done; next = await found.next())
      lines.push(JSON.parse(next.value));

    expect(lines.map((l) => [l.segment_index, l.earlier, l.Body === ""])).toEqual([
      [0, 0, false],
      [1, 0, false],
      [3, 1, true],
    ]);
  });
});
