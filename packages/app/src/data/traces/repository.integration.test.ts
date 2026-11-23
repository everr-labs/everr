import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttributeOp } from "@everr/telemetry-explorer/filters";
import { TracesRepository } from "@everr/telemetry-explorer/traces";
import { Session } from "chdb";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

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
    run(template("traces_json_table.sql", ['"default"', `"${table}"`, "", "MergeTree()", ""]));
    run(template("traces_id_ts_lookup_table.sql", ["default", table, "", "MergeTree()", ""]));
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

// A query parameter as ClickHouse reads it from text: arrays as ['a','b'].
function paramText(value: unknown): string {
  if (!Array.isArray(value)) return String(value);
  const quote = (item: unknown) => `'${String(item).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return `[${value.map(quote).join(",")}]`;
}

function repo(tableName = "traces") {
  return new TracesRepository(
    {
      async execute<T>(sql: string, params: Record<string, unknown> = {}) {
        for (const [key, value] of Object.entries(params)) {
          const text = paramText(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          run(`SET param_${key} = '${text}'`);
        }
        const rows = run(sql);
        return (rows ? rows.split("\n").map((line) => JSON.parse(line)) : []) as T[];
      },
    },
    { tableName },
  );
}

function insert(table: string, traceId: string, spanId: string, timestamp: string) {
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
    expect((await repository.getTrace({ traceId: "growing" })).map((span) => span.spanId)).toEqual([
      "middle",
    ]);
    insert("traces", "growing", "earlier", "2026-01-01 12:00:00");
    insert("traces", "growing", "later", "2026-01-03 12:00:00");
    expect((await repository.getTrace({ traceId: "growing" })).map((span) => span.spanId)).toEqual([
      "earlier",
      "middle",
      "later",
    ]);
  });

  it("uses the matching lookup table for a configured local table", async () => {
    insert("otel_traces", "local", "local-span", "2026-01-01 12:00:00.999999999");
    const spans = await repo("default.otel_traces").getTrace({
      traceId: "local",
    });
    expect(spans.map((span) => span.spanId)).toEqual(["local-span"]);
  });
});

describe("attribute operators against ClickHouse", () => {
  function span(traceId: string, attributes: Record<string, string | number>) {
    run(
      `INSERT INTO traces FORMAT JSONEachRow\n${JSON.stringify({
        TraceId: traceId,
        SpanId: `${traceId}-span`,
        Timestamp: "2026-02-01 12:00:00",
        SpanName: "GET",
        ServiceName: "shop",
        Duration: 1000000,
        SpanAttributes: attributes,
        // The collector fills the keys array on insert; the filters test it.
        SpanAttributesKeys: Object.keys(attributes),
        ResourceAttributes: { "service.name": "shop" },
      })}`,
    );
  }

  beforeAll(() => {
    span("checkout-failed", { "url.path": "/checkout/pay", "http.response.status_code": 503 });
    span("home-ok", { "url.path": "/home", "http.response.status_code": 200 });
  });

  async function tracesWhere(op: AttributeOp, key: string, value: string) {
    const traces = await repo().search({
      fromTs: "2026-02-01 00:00:00",
      toTs: "2026-02-02 00:00:00",
      namespace: [],
      service: [],
      name: "",
      status: "all",
      attributes: [{ source: "span", key, op, values: [value] }],
      limit: 50,
    });
    return traces.map((trace) => trace.traceId).sort();
  }

  it("compares numbers", async () => {
    expect(await tracesWhere("gt", "http.response.status_code", "499")).toEqual([
      "checkout-failed",
    ]);
    expect(await tracesWhere("lte", "http.response.status_code", "200")).toEqual(["home-ok"]);
  });

  it("matches text by substring, its absence and a regular expression", async () => {
    expect(await tracesWhere("contains", "url.path", "CHECKOUT")).toEqual(["checkout-failed"]);
    expect(await tracesWhere("not_contains", "url.path", "checkout")).toEqual(["home-ok"]);
    expect(await tracesWhere("matches", "url.path", "^/h")).toEqual(["home-ok"]);
  });

  it("ignores a comparison whose value is not a number", async () => {
    expect(await tracesWhere("gt", "http.response.status_code", "fast")).toEqual([
      "checkout-failed",
      "home-ok",
    ]);
  });
});
