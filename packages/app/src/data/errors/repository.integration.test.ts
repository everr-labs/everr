// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorsRepository } from "@everr/telemetry-explorer/errors";
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

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "everr-error-trend-"));
  session = new Session(dataDir);
  run(template("create_error_message_template_function.sql"));
  run(template("create_error_fingerprint_function.sql"));
  run(
    template("logs_json_table.sql")
      .replace("{{ident .Database}}", '"default"')
      .replace("{{ident .TableName}}", '"logs"')
      .replace(/\{\{[^}]*\}\}/g, (tag) => (tag === "{{.Engine}}" ? "MergeTree()" : "")),
  );
});

afterAll(() => {
  session?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const repo = new ErrorsRepository({
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
});

function insertError(timestamp: string) {
  run(
    `INSERT INTO logs FORMAT JSONEachRow\n${JSON.stringify({
      Timestamp: timestamp,
      SeverityNumber: 17,
      ServiceName: "api",
      Body: "boom",
      ResourceAttributes: { "service.name": "api" },
      ResourceAttributesKeys: ["service.name"],
      LogAttributes: { "exception.type": "Error", "exception.message": "boom" },
      LogAttributesKeys: ["exception.type", "exception.message"],
    })}`,
  );
}

describe("Error trend against ClickHouse", () => {
  it("puts each occurrence in the bucket of its position in the range", async () => {
    // 24 hours, so a bucket is one hour.
    const fromTs = "2026-01-01 00:00:00.000000000";
    const toTs = "2026-01-02 00:00:00.000000000";
    insertError(fromTs); // first instant: bucket 0
    insertError("2026-01-01 00:59:59.999000000"); // end of the first hour: bucket 0
    insertError("2026-01-01 01:00:00.000000000"); // start of the second hour: bucket 1
    insertError("2026-01-01 12:30:00.000000000"); // bucket 12
    insertError(toTs); // last instant, included by the range: bucket 23
    insertError("2026-01-02 00:00:00.001000000"); // after the range: not counted

    const { issues } = await repo.searchIssues({
      fromTs,
      toTs,
      q: "",
      service: [],
      fingerprint: "",
      sort: "lastSeen",
      limit: 50,
      offset: 0,
      attributes: [],
    });

    expect(issues).toHaveLength(1);
    const trend = issues[0]?.trend ?? [];
    expect(trend).toHaveLength(24);
    expect(trend[0]).toBe(2);
    expect(trend[1]).toBe(1);
    expect(trend[12]).toBe(1);
    expect(trend[23]).toBe(1);
    expect(trend.reduce((sum, count) => sum + count, 0)).toBe(5);
    expect(issues[0]?.occurrenceCount).toBe(5);
  });
});
