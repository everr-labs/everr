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
  it.each([
    false,
    true,
  ])("keeps cloud lookup bounds through span retention (existing table: %s)", async (existing) => {
    const table = existing ? "cloud_existing_traces" : "cloud_traces";
    run(
      template("traces_json_table.sql", [
        '"default"',
        `"${table}"`,
        "",
        "MergeTree()",
        "TTL toDate(Timestamp) + INTERVAL 7 DAY",
      ]),
    );
    const cloudDdl = readFileSync(
      new URL(
        "../../../../../clickhouse/init/10-create-mvs.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const lookupDdl = cloudDdl.match(
      /CREATE TABLE IF NOT EXISTS app\.traces_trace_id_ts\b[\s\S]*?;/,
    )?.[0];
    const updateDdl = cloudDdl.match(
      /ALTER TABLE app\.traces_trace_id_ts\s+MODIFY TTL[^;]*;/,
    )?.[0];
    if (!lookupDdl || !updateDdl)
      throw new Error("Missing cloud trace lookup DDL");
    const create = lookupDdl.replace(
      "app.traces_trace_id_ts",
      `default.${table}_trace_id_ts`,
    );
    if (existing) run(create.replace("toDate(End)", "toDate(Start)"));
    run(create);
    run(
      updateDdl.replace(
        "app.traces_trace_id_ts",
        `default.${table}_trace_id_ts`,
      ),
    );
    run(`CREATE MATERIALIZED VIEW ${table}_trace_id_ts_mv TO ${table}_trace_id_ts AS
      SELECT '' AS tenant_id, TraceId, min(Timestamp) AS Start, max(Timestamp) AS End,
        toUInt16(7) AS retention_days FROM ${table} GROUP BY TraceId`);
    const timestamps = JSON.parse(
      run(`SELECT
      toString(toDateTime(today() - 8) + INTERVAL 1 HOUR) AS expired,
      toString(toDateTime(today() - 6) + INTERVAL 1 HOUR) AS retained`),
    );
    run(`INSERT INTO ${table} (TraceId, SpanId, Timestamp) VALUES
      ('retention', 'expired', '${timestamps.expired}'),
      ('retention', 'retained', '${timestamps.retained}')`);
    run(`ALTER TABLE ${table} MATERIALIZE TTL SETTINGS mutations_sync = 2`);
    run(
      `ALTER TABLE ${table}_trace_id_ts MATERIALIZE TTL SETTINGS mutations_sync = 2`,
    );
    expect(JSON.parse(run(`SELECT count() AS c FROM ${table}`)).c).toBe(1);
    const spans = await repo(table).getTrace({ traceId: "retention" });
    expect(spans.map((span) => span.spanId)).toEqual(["retained"]);
  });

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
