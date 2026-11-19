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
  queryLines: vi.fn(),
  querySqlApi: vi.fn(),
  runSqlApiQuery: vi.fn(),
}));

import { loadClips, select, windowAround } from "./session.ts";
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

function clip(clipId: string, startMs: number, seconds: number) {
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
      "everr.recording.stream.id": STREAM,
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
