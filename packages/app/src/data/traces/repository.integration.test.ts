import { TracesRepository } from "@everr/telemetry-explorer/traces";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { type MigratedChdbStore, openMigratedChdbStore } from "#app/testing/chdb-migrated-store.ts";

let store: MigratedChdbStore;

function run(sql: string) {
  return store.run(sql);
}

beforeAll(() => {
  store = openMigratedChdbStore("everr-trace-lookup-");
  // A second table set under another name, with its own lookup table, for the
  // test that a configured table name picks its matching lookup table.
  run("CREATE TABLE app.traces_local AS app.traces");
  run("CREATE TABLE app.traces_local_trace_id_ts AS app.traces_trace_id_ts");
});

afterAll(() => {
  store?.close();
});

function repo(tableName = "traces") {
  return new TracesRepository(
    {
      async execute<T>(sql: string, params: Record<string, unknown> = {}) {
        for (const [key, value] of Object.entries(params)) {
          const text = String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          run(`SET param_${key} = '${text}'`);
        }
        const rows = run(sql);
        return (rows ? rows.split("\n").map((line) => JSON.parse(line)) : []) as T[];
      },
    },
    { tableName },
  );
}

// Spans land in the landing table and the views fill app.traces and the
// trace ID lookup, the way the collector writes them.
function insert(traceId: string, spanId: string, timestamp: string) {
  run(
    `INSERT INTO otel.otel_traces FORMAT JSONEachRow\n${JSON.stringify({
      TraceId: traceId,
      SpanId: spanId,
      Timestamp: timestamp,
      SpanName: spanId,
      ServiceName: "api",
      Duration: 1000000,
      SpanAttributes: { "http.route": "/test" },
      ResourceAttributes: { "service.name": "api", "everr.retention.days": "14" },
    })}`,
  );
}

describe("trace ID lookup against ClickHouse", () => {
  it("returns no spans for an unknown trace", async () => {
    expect(await repo().getTrace({ traceId: "missing" })).toEqual([]);
  });

  it("combines bounds from separate batches and includes the final fractional second", async () => {
    insert("batches", "first", "2026-01-01 12:00:00.123456789");
    insert("batches", "last", "2026-01-03 12:00:00.999999999");
    insert("other", "unrelated", "2026-01-02 12:00:00.000000000");
    const spans = await repo().getTrace({ traceId: "batches" });
    expect(spans.map((span) => span.spanId)).toEqual(["first", "last"]);
    expect(spans[1]?.timestampNs).toBe("1767441600999999999");
    expect(spans[0]?.spanAttributes).toEqual({ "http.route": "/test" });
  });

  it("resolves fresh bounds when more spans arrive", async () => {
    insert("growing", "middle", "2026-01-02 12:00:00");
    const repository = repo();
    expect((await repository.getTrace({ traceId: "growing" })).map((span) => span.spanId)).toEqual([
      "middle",
    ]);
    insert("growing", "earlier", "2026-01-01 12:00:00");
    insert("growing", "later", "2026-01-03 12:00:00");
    expect((await repository.getTrace({ traceId: "growing" })).map((span) => span.spanId)).toEqual([
      "earlier",
      "middle",
      "later",
    ]);
  });

  it("uses the matching lookup table for a configured local table", async () => {
    run(
      `INSERT INTO app.traces_local FORMAT JSONEachRow\n${JSON.stringify({
        TraceId: "local",
        SpanId: "local-span",
        Timestamp: "2026-01-01 12:00:00.999999999",
        SpanName: "local-span",
        ServiceName: "api",
        Duration: 1000000,
        SpanAttributes: { "http.route": "/test" },
        ResourceAttributes: { "service.name": "api" },
      })}`,
    );
    run(
      `INSERT INTO app.traces_local_trace_id_ts FORMAT JSONEachRow\n${JSON.stringify({
        TraceId: "local",
        Start: "2026-01-01 12:00:00",
        End: "2026-01-01 12:00:00",
      })}`,
    );
    const spans = await repo("app.traces_local").getTrace({
      traceId: "local",
    });
    expect(spans.map((span) => span.spanId)).toEqual(["local-span"]);
  });
});
