import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { TracesRepository } from "../../packages/telemetry-explorer/src/traces/data/repository";
import type { SearchTracesInput } from "../../packages/telemetry-explorer/src/traces/data/schemas";

// Throwaway experiment: production queries are captured from the repository.
// Alternative SQL deliberately lives here, outside the application path.
const require = createRequire(import.meta.url);
if (!process.env.BENCH_BASELINE_MODULE)
  throw new Error("Run trace-search.sh to build the baseline");
const BaselineRepository: typeof TracesRepository = (
  await import(process.env.BENCH_BASELINE_MODULE)
).TracesRepository;
const live = process.argv.includes("--live");
const repeats = Number(process.env.BENCH_REPEATS ?? 7);
const spanCount = Number(process.env.BENCH_SPANS ?? 1_000_000);
if (
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  !Number.isInteger(spanCount) ||
  spanCount < 10
) {
  throw new Error(
    "BENCH_REPEATS must be a positive integer; BENCH_SPANS must be an integer >= 10",
  );
}
const out = process.env.BENCH_OUT ?? "/tmp/everr-trace-search-benchmark.json";
const quote = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(quote).join(",")}]`
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const bind = (sql: string, params: Record<string, unknown>) =>
  sql.replace(/\{(\w+):[^}]+\}/g, (_, key) => {
    if (!(key in params)) throw new Error(`Missing parameter ${key}`);
    return quote(params[key]);
  });
const scratch = live
  ? undefined
  : mkdtempSync(join(tmpdir(), "trace-search-bench-"));
const db = live
  ? undefined
  : new (require(process.env.CHDB_MODULE ?? "chdb").Session)(scratch);
function query(sql: string) {
  const start = performance.now();
  if (live) {
    const rows = JSON.parse(
      execFileSync("everr-dev", ["local", "query", sql, "--format", "json"], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }),
    );
    return {
      rows,
      ms: performance.now() - start,
      readRows: null,
      readBytes: null,
    };
  }
  const body = JSON.parse(db.query(sql, "JSON"));
  return {
    rows: body.data,
    ms: performance.now() - start,
    readRows: body.statistics?.rows_read,
    readBytes: body.statistics?.bytes_read,
  };
}
function setup() {
  db.query("SET session_timezone = 'UTC'");
  db.query(`CREATE TABLE traces (
    tenant_id LowCardinality(String), Timestamp DateTime64(9), TraceId String,
    SpanId String, ParentSpanId String, SpanName LowCardinality(String),
    ServiceName LowCardinality(String), Duration UInt64, StatusCode LowCardinality(String),
    ResourceAttributes JSON, SpanAttributes JSON,
    ResourceAttributesKeys Array(LowCardinality(String)), SpanAttributesKeys Array(LowCardinality(String)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_keys ResourceAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_keys SpanAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1
  ) ENGINE=MergeTree PARTITION BY toDate(Timestamp)
    ORDER BY (tenant_id, ServiceName, Timestamp) SETTINGS index_granularity=8192`);
  // The production row policy supplies tenant equality. A view reproduces that
  // filter without introducing access-management differences in embedded chDB.
  db.query(
    "CREATE VIEW scoped_traces AS SELECT * FROM traces WHERE tenant_id = 'bench'",
  );
  db.query(`CREATE TABLE traces_trace_id_ts (
    tenant_id LowCardinality(String), TraceId String, Start DateTime, End DateTime
  ) ENGINE=MergeTree PARTITION BY toStartOfMonth(Start)
    ORDER BY (tenant_id, TraceId, Start) SETTINGS index_granularity=256`);
  db.query(`CREATE MATERIALIZED VIEW trace_windows TO traces_trace_id_ts AS
    SELECT tenant_id, TraceId, min(Timestamp) AS Start, max(Timestamp) AS End
    FROM traces GROUP BY tenant_id, TraceId`);
  // Ten spans per trace, across three services. Hash IDs intentionally decouple
  // lexical ordering from nanosecond ordering within the same second.
  // Splitting by span position produces multiple ingestion batches per trace.
  for (let batch = 0; batch < 2; batch++) {
    db.query(`INSERT INTO traces
      WITH intDiv(number, 10) AS tid, number % 10 AS pos,
        addNanoseconds(toDateTime64('2026-09-08 12:00:00', 9),
          toInt64(tid * (604800000000000 / ${Math.ceil(spanCount / 10)}) + pos * 10000000)) AS ts
      SELECT 'bench', ts, lower(hex(cityHash64(tid))), toString(number),
        if(pos = 0, '', toString(tid * 10)), if(pos = 0, 'GET /orders', 'db query'),
        concat('service-', toString((tid % 20 + pos % 3) % 20)),
        toUInt64(if(pos = 0, 100000000 + tid % 100 * 10000000, 1000000)),
        if(tid % 20 = 0 AND pos = 5, 'Error', 'Unset'),
        CAST('{"service.namespace":"bench"}', 'JSON'),
        CAST(if(pos = 0 AND tid % 3 != 0, '{"http.response.status_code":200,"http.route":"/orders"}', '{}'), 'JSON'),
        ['service.namespace'], if(pos = 0 AND tid % 3 != 0, ['http.response.status_code','http.route'], [])
      FROM numbers(${spanCount}) WHERE intDiv(pos, 5) = ${batch}`);
  }
  // More than a page of roots within one second exposes lookup precision loss.
  db.query(`INSERT INTO traces SELECT 'bench',
    addNanoseconds(toDateTime64('2026-09-15 11:59:59',9), toInt64(number * 1000000)),
    concat('tie-', lower(hex(cityHash64(number)))), concat('tie-', toString(number)),
    '', 'GET /orders', 'service-1', 1000000, 'Unset',
    CAST('{}','JSON'), CAST('{}','JSON'), [], [] FROM numbers(75)`);
}
async function capture(
  input: SearchTracesInput,
  Repository = TracesRepository,
) {
  let captured = "";
  const repo = new Repository(
    {
      execute: async <T>(
        sql: string,
        params?: Record<string, unknown>,
      ): Promise<T[]> => {
        captured = bind(sql, params ?? {});
        return [];
      },
    },
    { tableName: live ? "traces" : "scoped_traces" },
  );
  await repo.search(input);
  return captured;
}
function alternatives(
  original: string,
  implementation: string,
  input: SearchTracesInput,
) {
  const from = original.indexOf("        FROM ");
  const tailEnd = original.indexOf("\n      )", from);
  if (from < 0 || tailEnd < 0)
    throw new Error("Repository query shape changed");
  const window = `Timestamp BETWEEN parseDateTime64BestEffort(${quote(input.fromTs)}, 9) AND parseDateTime64BestEffort(${quote(input.cursorStartTs ?? input.toTs)}, 9)`;
  const fullSummary = (ids: string) =>
    original.slice(0, from) +
    ` FROM ${live ? "traces" : "scoped_traces"} WHERE ${window} AND TraceId IN (${ids})
      GROUP BY TraceId ORDER BY startTsRaw DESC, TraceId DESC LIMIT ${input.limit}` +
    original.slice(tailEnd);
  const variants: Record<string, string> = {
    current: original,
    two_stage: implementation,
  };
  if (
    !input.service.length &&
    input.status === "all" &&
    !input.attributes?.length &&
    !input.cursorStartTs &&
    !input.minDurationNs
  ) {
    // Intentionally naive hypothesis, tested for equality rather than assumed
    // correct. Whole-second Start cannot safely reproduce precise pagination.
    const lookup = `SELECT TraceId FROM traces_trace_id_ts WHERE
      ${live ? "" : "tenant_id = 'bench' AND "}
      End >= parseDateTimeBestEffort(${quote(input.fromTs)})
      AND Start <= parseDateTimeBestEffort(${quote(input.toTs)})
      GROUP BY TraceId ORDER BY min(Start) DESC, TraceId DESC LIMIT ${input.limit}`;
    variants.lookup = fullSummary(lookup);
  }
  return variants;
}
function canonical(rows: Record<string, unknown>[]) {
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]),
      ),
    ),
  );
}
const results: unknown[] = [];
try {
  if (!live) setup();
  const anchor = live
    ? query("SELECT max(Timestamp) AS ts FROM traces LIMIT 1").rows[0].ts
    : "2026-09-15 12:00:00.000000000";
  const date = new Date(String(anchor).replace(" ", "T").slice(0, 23) + "Z");
  const base = {
    fromTs: new Date(date.getTime() - 7 * 86400000).toISOString(),
    toTs: String(anchor),
    namespace: [],
    service: [],
    name: "",
    status: "all",
    attributes: [],
    limit: 50,
  } as SearchTracesInput;
  console.log(
    JSON.stringify({
      mode: live ? "local_collector" : "synthetic_chdb",
      version: query("SELECT version() AS version LIMIT 1").rows,
      spans: query(
        `SELECT count() AS spans, uniqExact(TraceId) AS traces FROM ${live ? "traces" : "scoped_traces"} WHERE Timestamp BETWEEN parseDateTime64BestEffort(${quote(base.fromTs)},9) AND parseDateTime64BestEffort(${quote(base.toTs)},9) LIMIT 1`,
      ).rows,
      repeats,
      anchor,
    }),
  );
  const firstPage = query(await capture(base, BaselineRepository)).rows;
  const last = firstPage.at(-1);
  const scenarios: [string, SearchTracesInput][] = [
    ["7d_all", base],
    [
      "1h_all",
      { ...base, fromTs: new Date(date.getTime() - 3600000).toISOString() },
    ],
    [
      "7d_service",
      { ...base, service: [live ? "everr-dev-app-web" : "service-1"] },
    ],
    ["7d_error", { ...base, status: "error" }],
    ["7d_duration", { ...base, minDurationNs: "500000000" }],
    [
      "7d_missing_attribute",
      {
        ...base,
        attributes: [
          { source: "span", key: "http.route", op: "missing", values: [] },
        ],
      },
    ],
    ...(last
      ? [
          [
            "7d_page2",
            {
              ...base,
              cursorStartTs: last.startTs,
              cursorTraceId: last.traceId,
            },
          ] as [string, SearchTracesInput],
        ]
      : []),
  ];
  for (const [scenario, input] of scenarios) {
    const variants = alternatives(
      await capture(input, BaselineRepository),
      await capture(input),
      input,
    );
    const expected = canonical(query(variants.current).rows);
    const samples: Record<string, ReturnType<typeof query>[]> = {};
    const matches: Record<string, boolean> = {};
    for (const [name, sql] of Object.entries(variants)) {
      samples[name] = [];
      matches[name] = canonical(query(sql).rows) === expected;
    }
    // Deterministic shuffled order, warm-up above is excluded.
    let seed = 42;
    for (let run = 0; run < repeats; run++) {
      const names = Object.keys(variants);
      for (let i = names.length - 1; i > 0; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = seed % (i + 1);
        [names[i], names[j]] = [names[j], names[i]];
      }
      for (const name of names) {
        const sample = query(variants[name]);
        matches[name] &&= canonical(sample.rows) === expected;
        samples[name].push(sample);
      }
    }
    for (const name of Object.keys(variants)) {
      const times = samples[name].map((s) => s.ms).sort((a, b) => a - b);
      const result = {
        scenario,
        variant: name,
        matches: matches[name],
        resultRows: samples[name][0].rows.length,
        medianMs: Math.round(times[Math.floor(times.length / 2)] * 10) / 10,
        minMs: Math.round(times[0] * 10) / 10,
        maxMs: Math.round(times.at(-1)! * 10) / 10,
        readRows: samples[name][0].readRows,
        readBytes: samples[name][0].readBytes,
      };
      results.push({ ...result, sql: variants[name], samplesMs: times });
      console.log(JSON.stringify(result));
    }
    if (!matches.two_stage)
      throw new Error(`Two-stage results differ in ${scenario}`);
  }
  writeFileSync(
    out,
    JSON.stringify(
      { live, spanCount: live ? null : spanCount, repeats, anchor, results },
      null,
      2,
    ),
  );
  console.log(`Results: ${out}`);
} finally {
  db?.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
