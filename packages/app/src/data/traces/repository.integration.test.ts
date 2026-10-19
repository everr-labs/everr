// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TracesRepository } from "@everr/telemetry-explorer/traces";
import { Session } from "chdb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let session: Session;
let dataDir: string;

function run(sql: string) {
  return String(session.query(sql, "JSONEachRow") ?? "").trim();
}

function template(file: string, values: string[]) {
  return readFileSync(
    new URL(
      `../../../../../collector/exporter/chdbexporter/internal/sqltemplates/${file}`,
      import.meta.url,
    ),
    "utf8",
  ).replace(/%[qs]/g, () => values.shift() ?? "");
}

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "everr-trace-lookup-"));
  session = new Session(dataDir);
  for (const table of ["traces", "otel_traces"]) {
    run(
      template("traces_json_table.sql", [
        '"default"',
        `"${table}"`,
        "",
        "MergeTree()",
        "",
      ]),
    );
    run(
      template("traces_id_ts_lookup_table.sql", [
        "default",
        table,
        "",
        "MergeTree()",
        "",
      ]),
    );
    run(
      template("traces_id_ts_lookup_mv.sql", [
        "default",
        table,
        "",
        "default",
        table,
        "default",
        table,
      ]),
    );
  }
});

afterAll(() => {
  session?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function repo(tableName = "traces") {
  return new TracesRepository(
    {
      async execute<T>(sql: string, params: Record<string, unknown> = {}) {
        for (const [key, value] of Object.entries(params)) {
          const text = String(value)
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'");
          run(`SET param_${key} = '${text}'`);
        }
        const rows = run(sql);
        return (
          rows ? rows.split("\n").map((line) => JSON.parse(line)) : []
        ) as T[];
      },
    },
    { tableName },
  );
}

function insert(
  table: string,
  traceId: string,
  spanId: string,
  timestamp: string,
) {
  run(
    `INSERT INTO ${table} FORMAT JSONEachRow\n${JSON.stringify({
      TraceId: traceId,
      SpanId: spanId,
      Timestamp: timestamp,
      SpanName: spanId,
      ServiceName: "api",
      Duration: 1000000,
      SpanAttributes: { "http.route": "/test" },
      ResourceAttributes: { "service.name": "api" },
    })}`,
  );
}

describe("trace ID lookup against ClickHouse", () => {
  it("returns no spans for an unknown trace", async () => {
    expect(await repo().getTrace({ traceId: "missing" })).toEqual([]);
  });

  it("combines bounds from separate batches and includes the final fractional second", async () => {
    insert("traces", "batches", "first", "2026-01-01 12:00:00.123456789");
    insert("traces", "batches", "last", "2026-01-03 12:00:00.999999999");
    insert("traces", "other", "unrelated", "2026-01-02 12:00:00.000000000");
    const spans = await repo().getTrace({ traceId: "batches" });
    expect(spans.map((span) => span.spanId)).toEqual(["first", "last"]);
    expect(spans[1]?.timestampNs).toBe("1767441600999999999");
    expect(spans[0]?.spanAttributes).toEqual({ "http.route": "/test" });
  });

  it("resolves fresh bounds when more spans arrive", async () => {
    insert("traces", "growing", "middle", "2026-01-02 12:00:00");
    const repository = repo();
    expect(
      (await repository.getTrace({ traceId: "growing" })).map(
        (span) => span.spanId,
      ),
    ).toEqual(["middle"]);
    insert("traces", "growing", "earlier", "2026-01-01 12:00:00");
    insert("traces", "growing", "later", "2026-01-03 12:00:00");
    expect(
      (await repository.getTrace({ traceId: "growing" })).map(
        (span) => span.spanId,
      ),
    ).toEqual(["earlier", "middle", "later"]);
  });

  it("uses the matching lookup table for a configured local table", async () => {
    insert(
      "otel_traces",
      "local",
      "local-span",
      "2026-01-01 12:00:00.999999999",
    );
    const spans = await repo("default.otel_traces").getTrace({
      traceId: "local",
    });
    expect(spans.map((span) => span.spanId)).toEqual(["local-span"]);
  });
});
