import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MetricKind, MetricsRepository } from "@everr/telemetry-explorer/metrics";
import { Session } from "chdb";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

let session: Session;
let dataDir: string;

function run(sql: string) {
  return String(session.query(sql, "JSONEachRow") ?? "").trim();
}

const quote = (value: unknown) => `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

// The local app's SQL gateway (collector/internal/localgateway/sqlhttp)
// renders only these parameter types.
const LOCAL_PARAM_TYPES = ["String", "UInt32", "UInt64", "Int32", "Int64", "Array(String)"];

const repo = new MetricsRepository({
  async execute<T>(sql: string, params: Record<string, unknown> = {}) {
    for (const [, type] of sql.matchAll(/\{\w+:([^}]+)\}/g)) {
      if (!LOCAL_PARAM_TYPES.includes(type!)) throw new Error(`The local app can't send a ${type}`);
    }
    for (const [key, value] of Object.entries(params)) {
      const literal = Array.isArray(value) ? `[${value.map(quote).join(", ")}]` : String(value);
      run(`SET param_${key} = ${quote(literal)}`);
    }
    const rows = run(sql);
    return (rows ? rows.split("\n").map((line) => JSON.parse(line)) : []) as T[];
  },
});

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "everr-metrics-"));
  session = new Session(dataDir);
  for (const [file, table] of [
    ["metrics_gauge_table.sql", "metrics_gauge"],
    ["metrics_sum_table.sql", "metrics_sum"],
    ["metrics_histogram_table.sql", "metrics_histogram"],
    ["metrics_exp_histogram_table.sql", "metrics_exponential_histogram"],
    ["metrics_summary_table.sql", "metrics_summary"],
  ]) {
    const values = ["default", table, "", "MergeTree()", ""];
    run(
      readFileSync(
        new URL(
          `../../../../../collector/exporter/chdbexporter/internal/sqltemplates/${file}`,
          import.meta.url,
        ),
        "utf8",
      ).replace(/%[qs]/g, () => values.shift() ?? ""),
    );
  }

  const point = (fields: Record<string, unknown>) => ({
    ServiceName: "api",
    ResourceAttributes: { "service.name": "api", "everr.tenant.id": "1" },
    MetricUnit: "",
    MetricDescription: "",
    Attributes: {},
    ...fields,
  });
  const insert = (table: string, rows: Record<string, unknown>[]) =>
    run(
      `INSERT INTO ${table} FORMAT JSONEachRow\n${rows.map((r) => JSON.stringify(point(r))).join("\n")}`,
    );

  // A cumulative counter whose process restarts between 12:02 and 12:03. Its
  // first point sits before the range, as the baseline for 12:00.
  insert(
    "metrics_sum",
    [
      ["11:59:30", 0],
      ["12:00:30", 60],
      ["12:01:30", 120],
      ["12:02:30", 10],
      ["12:03:30", 70],
    ].map(([time, value]) => ({
      MetricName: "http.requests",
      MetricUnit: "{request}",
      MetricDescription: "Requests served.",
      TimeUnix: `2026-01-01 ${time}`,
      Value: value,
      AggregationTemporality: 2,
      IsMonotonic: true,
    })),
  );
  insert(
    "metrics_sum",
    [
      ["12:00:10", 5],
      ["12:01:10", 7],
    ].map(([time, value]) => ({
      MetricName: "jobs.completed",
      TimeUnix: `2026-01-01 ${time}`,
      Value: value,
      AggregationTemporality: 1,
      IsMonotonic: true,
    })),
  );
  insert(
    "metrics_gauge",
    [
      ["/a", 10],
      ["/a", 20],
      ["/b", 1],
    ].map(([route, value], i) => ({
      MetricName: "queue.depth",
      MetricUnit: "{item}",
      Attributes: { "http.route": route },
      TimeUnix: `2026-01-01 12:00:${String(10 + i * 10)}`,
      Value: value,
    })),
  );
  // Twelve workers, so a group-by on worker has more groups than the chart shows.
  insert(
    "metrics_gauge",
    Array.from({ length: 12 }, (_, i) => ({
      MetricName: "worker.load",
      MetricUnit: "1",
      Attributes: { worker: `w${String(i + 1).padStart(2, "0")}` },
      TimeUnix: "2026-01-01 12:00:10",
      Value: i + 1,
    })),
  );
  // Exemplars sampled by two exports of the latency histogram below. The
  // 12:01:30 export sampled a request at 12:00:45, before the 12:01 interval
  // it's counted in, and one with no trace, which can't link anywhere.
  const exemplars = (rows: [string, number, string][]) => ({
    "Exemplars.FilteredAttributes": rows.map(() => ({})),
    "Exemplars.TimeUnix": rows.map(([time]) => `2026-01-01 ${time}`),
    "Exemplars.Value": rows.map(([, value]) => value),
    "Exemplars.SpanId": rows.map(([, , trace]) => (trace ? `s${trace.slice(1)}` : "")),
    "Exemplars.TraceId": rows.map(([, , trace]) => trace),
  });
  const EXEMPLARS: Record<string, Record<string, unknown>> = {
    "12:00:30": exemplars([
      ["12:00:20", 0.08, "t1"],
      ["12:00:25", 0.3, "t2"],
    ]),
    "12:01:30": exemplars([
      ["12:00:45", 0.4, "t3"],
      ["12:01:20", 0.9, ""],
    ]),
  };
  // A cumulative latency histogram that restarts between 12:01 and 12:02.
  // Buckets: [0, 0.1], (0.1, 0.5], (0.5, 1], above 1.
  insert(
    "metrics_histogram",
    (
      [
        ["11:59:30", [0, 0, 0, 0], 0],
        ["12:00:30", [10, 10, 0, 0], 4],
        ["12:01:30", [10, 30, 0, 0], 10],
        ["12:02:30", [0, 0, 4, 0], 3],
      ] as const
    ).map(([time, counts, sum]) => ({
      MetricName: "http.request.duration",
      MetricUnit: "s",
      TimeUnix: `2026-01-01 ${time}`,
      BucketCounts: counts,
      ExplicitBounds: [0.1, 0.5, 1],
      Count: counts.reduce((a: number, b: number) => a + b, 0),
      Sum: sum,
      AggregationTemporality: 2,
      ...EXEMPLARS[time],
    })),
  );
  // A cumulative counter in 25 pools whose SDK sends no start time, so each
  // series' first point says it started in 1970.
  insert(
    "metrics_sum",
    Array.from({ length: 25 }, (_, pool) =>
      (
        [
          ["11:59:30", 0],
          ["12:00:30", 60],
          ["12:01:30", 120],
        ] as const
      ).map(([time, value]) => ({
        MetricName: "pool.acquires",
        Attributes: { pool: `p${pool}` },
        TimeUnix: `2026-01-01 ${time}`,
        Value: value,
        AggregationTemporality: 2,
        IsMonotonic: true,
      })),
    ).flat(),
  );
  // A cumulative histogram whose bounds change at 12:01 while keeping the
  // same number of buckets: the new snapshot starts over, it isn't a change
  // from the old one.
  insert(
    "metrics_histogram",
    (
      [
        ["11:59:30", [1, 2, 3], [0, 0, 0, 0]],
        ["12:00:30", [1, 2, 3], [5, 0, 0, 0]],
        ["12:01:30", [10, 20, 30], [2, 6, 0, 0]],
      ] as const
    ).map(([time, bounds, counts]) => ({
      MetricName: "batch.size",
      TimeUnix: `2026-01-01 ${time}`,
      BucketCounts: counts,
      ExplicitBounds: bounds,
      Count: counts.reduce((a: number, b: number) => a + b, 0),
      AggregationTemporality: 2,
    })),
  );
  // A cumulative counter whose first point says its start is unknown, by
  // giving its own time as the start, as the Prometheus receiver does.
  insert(
    "metrics_sum",
    (
      [
        ["12:00:30", 5000],
        ["12:01:30", 5060],
        ["12:02:30", 5120],
      ] as const
    ).map(([time, value]) => ({
      MetricName: "scraped.requests",
      StartTimeUnix: "2026-01-01 12:00:30",
      TimeUnix: `2026-01-01 ${time}`,
      Value: value,
      AggregationTemporality: 2,
      IsMonotonic: true,
    })),
  );
  // A delta histogram whose bounds change between two exports in one minute.
  insert(
    "metrics_histogram",
    (
      [
        ["12:00:10", [10, 20], [0, 0, 5]],
        ["12:00:40", [1, 2, 3], [3, 0, 0, 0]],
      ] as const
    ).map(([time, bounds, counts]) => ({
      MetricName: "batch.wait",
      TimeUnix: `2026-01-01 ${time}`,
      BucketCounts: counts,
      ExplicitBounds: bounds,
      Count: counts.reduce((a: number, b: number) => a + b, 0),
      AggregationTemporality: 1,
    })),
  );
  // A cumulative counter deployed at 12:02, which has exported once.
  insert("metrics_sum", [
    {
      MetricName: "deploys.started",
      StartTimeUnix: "2026-01-01 12:02:00",
      TimeUnix: "2026-01-01 12:02:30",
      Value: 7,
      AggregationTemporality: 2,
      IsMonotonic: true,
    },
  ]);
  // A delta histogram: two exports in the same minute add up.
  insert(
    "metrics_histogram",
    (
      [
        ["12:00:10", [4, 0, 0, 0], 0.2],
        ["12:00:40", [0, 4, 0, 0], 1],
      ] as const
    ).map(([time, counts, sum]) => ({
      MetricName: "queue.wait",
      MetricUnit: "s",
      TimeUnix: `2026-01-01 ${time}`,
      BucketCounts: counts,
      ExplicitBounds: [0.1, 0.5, 1],
      Count: 4,
      Sum: sum,
      AggregationTemporality: 1,
    })),
  );
  // Exported every 15 minutes, less often than the chart's 1 minute step:
  // 900 requests between 11:50 and 12:05, one per second.
  insert(
    "metrics_sum",
    [
      ["11:50:00", 100],
      ["12:05:00", 1000],
    ].map(([time, value]) => ({
      MetricName: "sparse.requests",
      TimeUnix: `2026-01-01 ${time}`,
      Value: value,
      AggregationTemporality: 2,
      IsMonotonic: true,
    })),
  );
  // A delta counter exported every 10 minutes: 600 jobs since 11:55.
  insert("metrics_sum", [
    {
      MetricName: "sparse.jobs",
      StartTimeUnix: "2026-01-01 11:55:00",
      TimeUnix: "2026-01-01 12:05:00",
      Value: 600,
      AggregationTemporality: 1,
      IsMonotonic: true,
    },
  ]);
  // A cumulative histogram exported every 15 minutes: 900 requests, all in
  // (0.1, 0.5].
  insert(
    "metrics_histogram",
    (
      [
        ["11:50:00", [0, 0, 0, 0]],
        ["12:05:00", [0, 900, 0, 0]],
      ] as const
    ).map(([time, counts]) => ({
      MetricName: "sparse.duration",
      MetricUnit: "s",
      TimeUnix: `2026-01-01 ${time}`,
      BucketCounts: counts,
      ExplicitBounds: [0.1, 0.5, 1],
      Count: counts.reduce((a: number, b: number) => a + b, 0),
      Sum: 0,
      AggregationTemporality: 2,
    })),
  );
  // A cumulative exponential histogram whose SDK lowers its scale from 1 to
  // 0 between exports, as it does when the observed range widens. At scale 0
  // bucket 0 holds (1, 2] and bucket 1 holds (2, 4]; at scale 1, buckets 0
  // and 1 split (1, 2] in two.
  insert(
    "metrics_exponential_histogram",
    (
      [
        ["11:59:30", 1, [0, 0]],
        ["12:00:30", 1, [3, 1]],
        ["12:01:30", 0, [4, 6]],
      ] as const
    ).map(([time, scale, counts]) => ({
      MetricName: "rpc.duration",
      MetricUnit: "s",
      TimeUnix: `2026-01-01 ${time}`,
      Scale: scale,
      PositiveOffset: 0,
      PositiveBucketCounts: counts,
      Count: counts.reduce((a: number, b: number) => a + b, 0),
      Sum: 0,
      AggregationTemporality: 2,
    })),
  );
  // A summary from two instances reporting p50 and p99, with cumulative
  // Count and Sum. Instance b is slower.
  insert(
    "metrics_summary",
    (
      [
        ["a", "11:59:30", 0, 0, [0.01, 0.05]],
        ["a", "12:00:30", 60, 1.2, [0.02, 0.1]],
        ["a", "12:01:30", 120, 2.4, [0.02, 0.08]],
        ["b", "11:59:30", 0, 0, [0.03, 0.2]],
        ["b", "12:00:30", 30, 3, [0.05, 0.3]],
        ["b", "12:01:30", 60, 6, [0.04, 0.2]],
      ] as const
    ).map(([instance, time, count, sum, values]) => ({
      ResourceAttributes: {
        "service.name": "api",
        "service.instance.id": instance,
        "everr.tenant.id": "1",
      },
      MetricName: "gc.pause",
      MetricUnit: "s",
      TimeUnix: `2026-01-01 ${time}`,
      Count: count,
      Sum: sum,
      "ValueAtQuantiles.Quantile": [0.5, 0.99],
      "ValueAtQuantiles.Value": values,
    })),
  );
  // One latency metric from two services whose SDKs chose different bounds.
  insert("metrics_histogram", [
    {
      MetricName: "checkout.duration",
      MetricUnit: "s",
      TimeUnix: "2026-01-01 12:00:10",
      BucketCounts: [0, 10, 0],
      ExplicitBounds: [0.1, 0.5],
      Count: 10,
      Sum: 3,
      AggregationTemporality: 1,
    },
    {
      ServiceName: "web",
      ResourceAttributes: {
        "service.name": "web",
        "deployment.environment.name": "production",
        "everr.tenant.id": "1",
      },
      MetricName: "checkout.duration",
      MetricUnit: "s",
      TimeUnix: "2026-01-01 12:00:10",
      BucketCounts: [0, 10, 0],
      ExplicitBounds: [0.2, 1],
      Count: 10,
      Sum: 6,
      AggregationTemporality: 1,
    },
  ]);
  // Cumulative counters started long before the scan, so their first point is
  // only a baseline. A failed scrape writes a point flagged "no recorded
  // value" with a 0.
  const counter = (
    name: string,
    points: [time: string, value: number, extra?: Record<string, unknown>][],
  ) =>
    insert(
      "metrics_sum",
      points.map(([time, value, extra]) => ({
        MetricName: name,
        StartTimeUnix: "2026-01-01 10:00:00",
        TimeUnix: `2026-01-01 ${time}`,
        Value: value,
        AggregationTemporality: 2,
        IsMonotonic: true,
        ...extra,
      })),
    );
  counter("scrape.failures", [
    ["12:00:30", 1000],
    ["12:01:30", 1010],
    ["12:02:30", 0, { Flags: 1 }],
    ["12:03:30", 1020],
    ["12:04:30", 1030],
  ]);
  // The same counter from two instrumentation scopes, each counting 10 a minute.
  counter(
    "scoped.requests",
    (["12:00:30", "12:01:30", "12:02:30", "12:03:30"] as const).flatMap(
      (time, i): [string, number, Record<string, unknown>][] => [
        [time, 1000 + i * 10, { ScopeName: "lib.a" }],
        [time, 10 + i * 10, { ScopeName: "lib.b" }],
      ],
    ),
  );
  // Restarted at 12:02 and already above the old total by its first export.
  counter("restarted.requests", [
    ["12:00:30", 100],
    ["12:01:30", 110],
    ["12:02:30", 200, { StartTimeUnix: "2026-01-01 12:02:00" }],
    ["12:03:30", 210, { StartTimeUnix: "2026-01-01 12:02:00" }],
  ]);
  const minutes = (from: number, to: number, second: string) =>
    Array.from({ length: to - from + 1 }, (_, i) => {
      const minute = from + i;
      return `${String(11 + Math.floor(minute / 60))}:${String(minute % 60).padStart(2, "0")}:${second}`;
    });
  // Scraped every 15 s. The collector restarts at 12:02:15: that scrape's
  // start is its own time, and later scrapes report it as their start.
  counter(
    "collector.restarts",
    minutes(58, 64, "").flatMap((minute, i) =>
      ["00", "15", "30", "45"].map((second, j): [string, number, Record<string, unknown>] => {
        const time = `${minute}${second}`;
        return [
          time,
          1000 + i * 4 + j,
          time >= "12:02:15" ? { StartTimeUnix: "2026-01-01 12:02:15" } : {},
        ];
      }),
    ),
  );
  // A start derived from uptime, a second off from one export to the next.
  counter(
    "drifting.start",
    minutes(58, 64, "30").map((time, i) => [
      time,
      7000 + i * 5,
      { StartTimeUnix: `2026-01-01 10:00:0${i % 2}` },
    ]),
  );
  // A receiver's scope version is the collector's, so it changes on upgrade.
  counter(
    "upgraded.collector",
    minutes(58, 64, "30").map((time, i) => [
      time,
      5000 + i * 10,
      {
        StartTimeUnix: "2026-01-01 11:30:00",
        ScopeName: "hostmetricsreceiver",
        ScopeVersion: time < "12:03" ? "0.110.0" : "0.111.0",
      },
    ]),
  );
  // Two instances serving one request a second each: one exports every
  // minute, the other every five.
  counter(
    "steady.requests",
    minutes(55, 67, "15").map((time, i) => [time, i * 60, { Attributes: { instance: "a" } }]),
  );
  counter(
    "steady.requests",
    minutes(50, 65, "15")
      .filter((_, i) => i % 5 === 0)
      .map((time, i) => [time, i * 300, { Attributes: { instance: "b" } }]),
  );
  // A delta counter that sends no start time: 60 jobs a minute.
  insert(
    "metrics_sum",
    minutes(58, 64, "30").map((time) => ({
      MetricName: "untimed.jobs",
      TimeUnix: `2026-01-01 ${time}`,
      Value: 60,
      AggregationTemporality: 1,
      IsMonotonic: true,
    })),
  );
  // Two workers sampled every minute, at :10 and at :50.
  insert(
    "metrics_gauge",
    ["10", "50"].flatMap((second) =>
      minutes(55, 61, second).map((time) => ({
        MetricName: "staggered.load",
        Attributes: { worker: second },
        TimeUnix: `2026-01-01 ${time}`,
        Value: 1,
      })),
    ),
  );
  // Scraped every 15 s at 1/s, reset at 11:59:56. The first scrape after it
  // doesn't know the start, so it sends its own time, which later ones keep.
  counter("reset.unknown.start", [
    ...["11:59:10", "11:59:25", "11:59:40", "11:59:55"].map((time, i): [string, number] => [
      time,
      1000 + i * 15,
    ]),
    ["12:00:10", 14, { StartTimeUnix: "2026-01-01 12:00:10" }],
    ["12:00:25", 29, { StartTimeUnix: "2026-01-01 12:00:10" }],
  ]);
  // Started at 12:00, restarted at 12:00:15 inside its first minute.
  counter("early.restart", [
    ["12:00:10", 10, { StartTimeUnix: "2026-01-01 12:00:00" }],
    ["12:00:50", 35, { StartTimeUnix: "2026-01-01 12:00:15" }],
    ["12:01:50", 95, { StartTimeUnix: "2026-01-01 12:00:15" }],
  ]);
  // Scraped every 15 s at 5 a scrape. The process restarts at 12:02:10, so
  // 12:02's change is the 5 counted before the restart and 15 after it.
  const scrapes = minutes(59, 64, "").flatMap((minute) =>
    ["00", "15", "30", "45"].map((second) => `${minute}${second}`),
  );
  const restartAt = scrapes.indexOf("12:02:15");
  counter(
    "midminute.restart",
    scrapes.map((time, i): [string, number, Record<string, unknown>?] =>
      i < restartAt
        ? [time, 1000 + i * 5]
        : [time, (i - restartAt + 1) * 5, { StartTimeUnix: "2026-01-01 12:02:10" }],
    ),
  );
  // A counter with no start time on the restart, one point per insert, but
  // 12:02's first three points arrive in one late batch. It counts 1 a
  // scrape, restarts to 5 at 12:02:30, then reads 500 at 12:02:45.
  const lateValue = (i: number) =>
    i < restartAt + 1 ? 100 + i : i === restartAt + 1 ? 5 : 500 + (i - restartAt - 2) * 5;
  const late = scrapes.map((time, i): [string, number] => [time, lateValue(i)]);
  const lateBatch = ["12:02:00", "12:02:15", "12:02:30"];
  // Unmerged, so the parts are read in the order they arrived.
  run("SYSTEM STOP MERGES metrics_sum");
  for (const point of late.filter(([time]) => !lateBatch.includes(time))) {
    counter("late.restart", [point]);
  }
  counter(
    "late.restart",
    late.filter(([time]) => lateBatch.includes(time)),
  );
  // The same as a cumulative histogram: one observation a scrape in
  // (0.1, 0.5], restarting at 12:02:10 with no start time.
  insert(
    "metrics_histogram",
    scrapes.map((time, i) => {
      const count = i < restartAt ? 100 + i : i - restartAt + 1;
      return {
        MetricName: "midminute.duration",
        MetricUnit: "s",
        TimeUnix: `2026-01-01 ${time}`,
        BucketCounts: [0, count, 0, 0],
        ExplicitBounds: [0.1, 0.5, 1],
        Count: count,
        Sum: 0,
        AggregationTemporality: 2,
      };
    }),
  );
  // The same restart, coming back with new bounds.
  insert(
    "metrics_histogram",
    scrapes.map((time, i) => {
      const restarted = i >= restartAt;
      const count = restarted ? i - restartAt + 1 : 100 + i;
      return {
        MetricName: "rebounded.duration",
        MetricUnit: "s",
        TimeUnix: `2026-01-01 ${time}`,
        BucketCounts: restarted ? [0, count, 0] : [0, count, 0, 0],
        ExplicitBounds: restarted ? [0.1, 0.5] : [0.1, 0.5, 1],
        Count: count,
        Sum: 0,
        AggregationTemporality: 2,
      };
    }),
  );
  // A pod that appears at 12:02, scraped every 15 s by the Prometheus
  // receiver: its start is its first scrape's own time, so that scrape is a
  // total from before, and 12:02 counts from it.
  const newPod = ["12:02:00", "12:02:15", "12:02:30", "12:02:45", "12:03:00", "12:03:15"];
  counter(
    "new.pod",
    newPod.map((time, i) => [time, 100 + i * 10, { StartTimeUnix: "2026-01-01 12:02:00" }]),
  );
  insert(
    "metrics_histogram",
    newPod.map((time, i) => ({
      MetricName: "new.pod.duration",
      MetricUnit: "s",
      StartTimeUnix: "2026-01-01 12:02:00",
      TimeUnix: `2026-01-01 ${time}`,
      BucketCounts: [0, 100 + i * 10, 0, 0],
      ExplicitBounds: [0.1, 0.5, 1],
      Count: 100 + i * 10,
      Sum: 0,
      AggregationTemporality: 2,
    })),
  );
  // A cumulative exponential histogram whose zero count drops at 12:02:30
  // while its total doesn't: a restart that only the zero count shows.
  insert(
    "metrics_exponential_histogram",
    (
      [
        ["11:59:30", 0, 0, [0]],
        ["12:00:30", 10, 5, [5]],
        ["12:01:30", 20, 10, [10]],
        ["12:02:30", 25, 0, [25]],
      ] as const
    ).map(([time, count, zero, counts]) => ({
      MetricName: "zero.drop",
      TimeUnix: `2026-01-01 ${time}`,
      Scale: 0,
      PositiveOffset: 0,
      PositiveBucketCounts: counts,
      ZeroCount: zero,
      Count: count,
      Sum: 0,
      AggregationTemporality: 2,
    })),
  );
  // Jobs a minute, and another job that only reported 5 s into 12:02.
  insert("metrics_sum", [
    ...minutes(58, 61, "30").map((time) => ({
      MetricName: "late.jobs",
      Attributes: { queue: "steady" },
      // Each export covers the 30 s since the minute started.
      StartTimeUnix: `2026-01-01 ${time.replace(/:30$/, ":00")}`,
      TimeUnix: `2026-01-01 ${time}`,
      Value: 60,
      AggregationTemporality: 1,
      IsMonotonic: true,
    })),
    {
      MetricName: "late.jobs",
      Attributes: { queue: "late" },
      TimeUnix: "2026-01-01 12:02:05",
      Value: 600,
      AggregationTemporality: 1,
      IsMonotonic: true,
    },
  ]);
  // Sampled every 10 s until 12:00:59.
  insert(
    "metrics_gauge",
    ["12:00:39", "12:00:49", "12:00:59"].map((time) => ({
      MetricName: "stopped.gauge",
      TimeUnix: `2026-01-01 ${time}`,
      Value: 7,
    })),
  );
  // Two pods' memory: one exported every minute, the other every two.
  insert(
    "metrics_gauge",
    [
      ...minutes(60, 64, "30").map((time) => ["a", time, 10] as const),
      ...minutes(60, 64, "30")
        .filter((_, i) => i % 2 === 0)
        .map((time) => ["b", time, 100] as const),
    ].map(([pod, time, value]) => ({
      MetricName: "pod.memory",
      Attributes: { pod },
      TimeUnix: `2026-01-01 ${time}`,
      Value: value,
    })),
  );
  insert(
    "metrics_gauge",
    [
      ["12:00:10", 5],
      ["12:00:20", "nan"],
      ["12:01:10", 7],
    ].map(([time, value]) => ({
      MetricName: "temperature",
      TimeUnix: `2026-01-01 ${time}`,
      Value: value,
    })),
  );
});

afterAll(() => {
  session?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const timeRange = { from: "2026-01-01T12:00:00Z", to: "2026-01-01T12:05:00Z" };

describe("metrics explorer against ClickHouse", () => {
  it("lists each metric with its type and unit", async () => {
    const catalog = await repo.catalog({ timeRange });
    expect(
      catalog.map(({ name, type, unit, isMonotonic }) => ({ name, type, unit, isMonotonic })),
    ).toEqual([
      { name: "batch.size", type: "histogram", unit: "", isMonotonic: false },
      { name: "batch.wait", type: "histogram", unit: "", isMonotonic: false },
      { name: "checkout.duration", type: "histogram", unit: "s", isMonotonic: false },
      { name: "collector.restarts", type: "sum", unit: "", isMonotonic: true },
      { name: "deploys.started", type: "sum", unit: "", isMonotonic: true },
      { name: "drifting.start", type: "sum", unit: "", isMonotonic: true },
      { name: "early.restart", type: "sum", unit: "", isMonotonic: true },
      { name: "gc.pause", type: "summary", unit: "s", isMonotonic: false },
      {
        name: "http.request.duration",
        type: "histogram",
        unit: "s",
        isMonotonic: false,
      },
      { name: "http.requests", type: "sum", unit: "{request}", isMonotonic: true },
      { name: "jobs.completed", type: "sum", unit: "", isMonotonic: true },
      { name: "late.jobs", type: "sum", unit: "", isMonotonic: true },
      { name: "late.restart", type: "sum", unit: "", isMonotonic: true },
      { name: "midminute.duration", type: "histogram", unit: "s", isMonotonic: false },
      { name: "midminute.restart", type: "sum", unit: "", isMonotonic: true },
      { name: "new.pod", type: "sum", unit: "", isMonotonic: true },
      { name: "new.pod.duration", type: "histogram", unit: "s", isMonotonic: false },
      { name: "pod.memory", type: "gauge", unit: "", isMonotonic: false },
      { name: "pool.acquires", type: "sum", unit: "", isMonotonic: true },
      { name: "queue.depth", type: "gauge", unit: "{item}", isMonotonic: false },
      { name: "queue.wait", type: "histogram", unit: "s", isMonotonic: false },
      { name: "rebounded.duration", type: "histogram", unit: "s", isMonotonic: false },
      { name: "reset.unknown.start", type: "sum", unit: "", isMonotonic: true },
      { name: "restarted.requests", type: "sum", unit: "", isMonotonic: true },
      {
        name: "rpc.duration",
        type: "exponential_histogram",
        unit: "s",
        isMonotonic: false,
      },
      { name: "scoped.requests", type: "sum", unit: "", isMonotonic: true },
      { name: "scrape.failures", type: "sum", unit: "", isMonotonic: true },
      { name: "scraped.requests", type: "sum", unit: "", isMonotonic: true },
      { name: "sparse.duration", type: "histogram", unit: "s", isMonotonic: false },
      { name: "sparse.jobs", type: "sum", unit: "", isMonotonic: true },
      { name: "sparse.requests", type: "sum", unit: "", isMonotonic: true },
      { name: "staggered.load", type: "gauge", unit: "", isMonotonic: false },
      { name: "steady.requests", type: "sum", unit: "", isMonotonic: true },
      { name: "stopped.gauge", type: "gauge", unit: "", isMonotonic: false },
      { name: "temperature", type: "gauge", unit: "", isMonotonic: false },
      { name: "untimed.jobs", type: "sum", unit: "", isMonotonic: true },
      { name: "upgraded.collector", type: "sum", unit: "", isMonotonic: true },
      { name: "worker.load", type: "gauge", unit: "1", isMonotonic: false },
      { name: "zero.drop", type: "exponential_histogram", unit: "", isMonotonic: false },
    ]);
  });

  it("lists the same metrics by name alone, for the metric switcher", async () => {
    const catalog = await repo.catalog({ timeRange });
    expect(await repo.names({ timeRange })).toEqual(
      catalog.map(({ name, type, isMonotonic }) => ({ name, type, isMonotonic })),
    );
  });

  it("narrows the catalog by name and kind", async () => {
    expect((await repo.catalog({ timeRange, q: "QUEUE.D" })).map((m) => m.name)).toEqual([
      "queue.depth",
    ]);
    expect(
      (await repo.catalog({ timeRange, kinds: ["counter", "updown"] })).map((m) => m.name),
    ).toEqual([
      "collector.restarts",
      "deploys.started",
      "drifting.start",
      "early.restart",
      "http.requests",
      "jobs.completed",
      "late.jobs",
      "late.restart",
      "midminute.restart",
      "new.pod",
      "pool.acquires",
      "reset.unknown.start",
      "restarted.requests",
      "scoped.requests",
      "scrape.failures",
      "scraped.requests",
      "sparse.jobs",
      "sparse.requests",
      "steady.requests",
      "untimed.jobs",
      "upgraded.collector",
    ]);
  });

  it("reads one metric's unit and temporality, or nothing when it sent nothing", async () => {
    expect(await repo.metadata({ timeRange, metric: "http.requests", type: "sum" })).toMatchObject({
      unit: "{request}",
      isMonotonic: true,
    });
    expect(await repo.metadata({ timeRange, metric: "http.requests", type: "gauge" })).toBeNull();
  });

  it("narrows the catalog by kind, telling counters from UpDownCounters", async () => {
    const names = async (kinds: MetricKind[]) =>
      (await repo.catalog({ timeRange, kinds })).map((m) => m.name);
    expect(await names(["counter", "gauge"])).toEqual([
      "collector.restarts",
      "deploys.started",
      "drifting.start",
      "early.restart",
      "http.requests",
      "jobs.completed",
      "late.jobs",
      "late.restart",
      "midminute.restart",
      "new.pod",
      "pod.memory",
      "pool.acquires",
      "queue.depth",
      "reset.unknown.start",
      "restarted.requests",
      "scoped.requests",
      "scrape.failures",
      "scraped.requests",
      "sparse.jobs",
      "sparse.requests",
      "staggered.load",
      "steady.requests",
      "stopped.gauge",
      "temperature",
      "untimed.jobs",
      "upgraded.collector",
      "worker.load",
    ]);
    // Every sum in the fixtures is monotonic.
    expect(await names(["updown"])).toEqual([]);
  });

  it("charts a counter whose many series send no start time", async () => {
    const result = await repo.series({
      timeRange,
      metric: "pool.acquires",
      type: "sum",
      aggregation: "increase",
    });
    expect(result.series[0]?.values.slice(0, 3)).toEqual([25 * 60, 25 * 60, null]);
  });

  it("doesn't count the total of a first point whose start is unknown", async () => {
    const result = await repo.series({
      timeRange,
      metric: "scraped.requests",
      type: "sum",
      aggregation: "increase",
    });
    expect(result.series[0]?.values.slice(0, 3)).toEqual([null, 60, 60]);
  });

  it("keeps a delta histogram's bucket layouts apart within a step", async () => {
    const result = await repo.series({
      timeRange,
      metric: "batch.wait",
      type: "histogram",
      aggregation: "p50",
    });
    // 3 observations up to 1 and 5 above 20: the median is above 20, which
    // reports the last bound.
    expect(result.series[0]?.values[0]).toBe(20);
  });

  it("starts over when a histogram's bounds change", async () => {
    const result = await repo.series({
      timeRange,
      metric: "batch.size",
      type: "histogram",
      aggregation: "rate",
    });
    // 12:01 counts the 8 observations of the new layout, not 8 minus 5.
    expect(result.series[0]?.values[1]).toBeCloseTo(8 / 60);
  });

  it("skips a failed scrape instead of reading it as a restart", async () => {
    const result = await repo.series({
      timeRange,
      metric: "scrape.failures",
      type: "sum",
      aggregation: "increase",
    });
    // The 10 counted at 12:03:30 spreads over the two minutes since 12:01:30.
    expect(result.series[0]?.values).toEqual([null, 12.5, 5, 2.5, 10, null]);
  });

  it("keeps two scopes' series of one metric apart", async () => {
    const result = await repo.series({
      timeRange,
      metric: "scoped.requests",
      type: "sum",
      aggregation: "increase",
    });
    expect(result.series[0]?.values).toEqual([null, 20, 20, 20, null, null]);
  });

  it("starts over when a counter reports a new start time", async () => {
    const result = await repo.series({
      timeRange,
      metric: "restarted.requests",
      type: "sum",
      aggregation: "increase",
    });
    expect(result.series[0]?.values).toEqual([null, 10, 200, 10, null, null]);
  });

  it("keeps counting across a collector restart or upgrade, and a start that drifts", async () => {
    const increase = async (metric: string) =>
      (await repo.series({ timeRange, metric, type: "sum", aggregation: "increase" })).series[0]
        ?.values;
    expect(await increase("collector.restarts")).toEqual([4, 4, 4, 4, 4, null]);
    expect(await increase("drifting.start")).toEqual([5, 5, 5, 5, 5, null]);
    expect(await increase("upgraded.collector")).toEqual([10, 10, 10, 10, 10, null]);
  });

  it("holds each series' last value until its next export", async () => {
    const result = await repo.series({
      timeRange,
      metric: "pod.memory",
      type: "gauge",
      aggregation: "sum",
      minStep: 60,
    });
    expect(result.series[0]?.values).toEqual([110, 110, 110, 110, 110, 110]);
  });

  it("measures the last bucket's rate over the time its exports cover", async () => {
    // Ten hours, so 5 minute steps over a metric exported every minute.
    const result = await repo.series({
      timeRange: { from: "2026-01-01T02:07:30Z", to: "2026-01-01T12:07:30Z" },
      metric: "steady.requests",
      type: "sum",
      aggregation: "rate",
      minStep: 60,
    });
    expect(result.stepSeconds).toBe(300);
    // 1/s from each instance, though one exported only once in the last bucket.
    expect(result.series[0]?.values.slice(-2)).toEqual([2, 2]);
    // 30 s into a bucket, before every instance has exported in it, no rate yet.
    const early = await repo.series({
      timeRange: { from: "2026-01-01T02:05:30Z", to: "2026-01-01T12:05:30Z" },
      metric: "steady.requests",
      type: "sum",
      aggregation: "rate",
      minStep: 60,
    });
    expect(early.series[0]?.values.slice(-2)).toEqual([2, null]);
    // Delta points without a start cover the bucket up to the range's end:
    // 4 minutes of them by 12:04.
    const untimed = await repo.series({
      timeRange: { from: "2026-01-01T02:04:00Z", to: "2026-01-01T12:04:00Z" },
      metric: "untimed.jobs",
      type: "sum",
      aggregation: "rate",
      minStep: 60,
    });
    expect(untimed.series[0]?.values.at(-1)).toBe(1);
  });

  it("counts a restart in a series' first minute from its start", async () => {
    const result = await repo.series({
      timeRange,
      metric: "early.restart",
      type: "sum",
      aggregation: "increase",
    });
    // 10 before the restart and 35 after it.
    expect(result.series[0]?.values).toEqual([45, 60, null, null, null, null]);
  });

  it("keeps what was counted before a restart inside a bucket", async () => {
    const counted = await repo.series({
      timeRange,
      metric: "midminute.restart",
      type: "sum",
      aggregation: "increase",
    });
    expect(counted.series[0]?.values).toEqual([20, 20, 20, 20, 20, null]);
    const observed = await repo.series({
      timeRange,
      metric: "midminute.duration",
      type: "histogram",
      aggregation: "rate",
      heatmap: true,
    });
    expect(observed.series[0]?.values.slice(0, 5).map((v) => v && +v.toFixed(4))).toEqual(
      Array(5).fill(+(4 / 60).toFixed(4)),
    );
    expect(observed.heatmap?.counts[2]).toEqual([0, 4, 0, 0]);
  });

  it("finds a restart inside a bucket whose points arrived out of order", async () => {
    // One thread reads the parts in the order they were inserted.
    run("SET max_threads = 1");
    try {
      const result = await repo.series({
        timeRange,
        metric: "late.restart",
        type: "sum",
        aggregation: "increase",
      });
      // 1 + 1 before the restart, 5 at it, 495 after.
      expect(result.series[0]?.values[2]).toBe(502);
    } finally {
      run("SET max_threads = 0");
    }
  });

  it("counts a series' first bucket from its first point when that point is a total from before", async () => {
    const counted = await repo.series({
      timeRange,
      metric: "new.pod",
      type: "sum",
      aggregation: "increase",
    });
    expect(counted.series[0]?.values).toEqual([null, null, 30, 20, null, null]);
    const observed = await repo.series({
      timeRange,
      metric: "new.pod.duration",
      type: "histogram",
      aggregation: "rate",
    });
    expect(observed.series[0]?.values.slice(0, 4)).toEqual([null, null, 30 / 60, 20 / 60]);
  });

  it("keeps counting observations across a restart with new bounds", async () => {
    const result = await repo.series({
      timeRange,
      metric: "rebounded.duration",
      type: "histogram",
      aggregation: "rate",
    });
    expect(result.series[0]?.values.slice(0, 5).map((v) => v && +v.toFixed(4))).toEqual(
      Array(5).fill(+(4 / 60).toFixed(4)),
    );
  });

  it("never counts a negative zero bucket", async () => {
    const result = await repo.series({
      timeRange,
      metric: "zero.drop",
      type: "exponential_histogram",
      aggregation: "p50",
      heatmap: true,
    });
    expect(result.heatmap?.counts[2]?.every((count) => count >= 0)).toBe(true);
  });

  it("ranks only the buckets it draws", async () => {
    // 30 s into 12:02, which a rate leaves out, along with the queue that only
    // reported there.
    const result = await repo.series({
      timeRange: { from: "2026-01-01T12:00:00Z", to: "2026-01-01T12:02:30Z" },
      metric: "late.jobs",
      type: "sum",
      aggregation: "rate",
      groupBy: [{ source: "metric", key: "queue" }],
      minStep: 60,
    });
    expect(result.series.map((s) => s.labels)).toEqual([["steady"]]);
    expect(result.totalSeries).toBe(1);
  });

  it("charts a rate over a range inside one step", async () => {
    const result = await repo.series({
      timeRange: { from: "2026-01-01T12:01:05Z", to: "2026-01-01T12:01:55Z" },
      metric: "steady.requests",
      type: "sum",
      aggregation: "rate",
      minStep: 60,
    });
    expect(result.series[0]?.values[0]).toBeGreaterThan(0);
  });

  it("holds a series that hasn't exported yet in the range's last bucket", async () => {
    // Ten hours, so 5 minute steps; the last one has 30 s, before the :50 export.
    const result = await repo.series({
      timeRange: { from: "2026-01-01T02:00:30Z", to: "2026-01-01T12:00:30Z" },
      metric: "staggered.load",
      type: "gauge",
      aggregation: "sum",
      minStep: 60,
    });
    expect(result.series[0]?.values.at(-1)).toBe(2);
  });

  it("measures a reset with an unknown start from the export before it", async () => {
    const result = await repo.series({
      timeRange: { from: "2026-01-01T11:58:00Z", to: "2026-01-01T12:00:30Z" },
      metric: "reset.unknown.start",
      type: "sum",
      aggregation: "rate",
      minStep: 15,
    });
    // 29 since the reset, counted over the 30 s since 11:59:55, not the 15 s
    // since the first scrape after it.
    expect(result.series[0]?.values.at(-1)).toBeCloseTo(29 / 30);
  });

  it("holds no value past its bucket when the step is far longer than the interval", async () => {
    const result = await repo.series({
      timeRange,
      metric: "stopped.gauge",
      type: "gauge",
      aggregation: "max",
      minStep: 10,
    });
    expect(result.series[0]?.values.slice(0, 2)).toEqual([7, null]);
  });

  it("leaves NaN samples out of a gauge's average", async () => {
    const result = await repo.series({
      timeRange,
      metric: "temperature",
      type: "gauge",
      aggregation: "avg",
    });
    expect(result.series[0]?.values.slice(0, 2)).toEqual([5, 7]);
  });

  it("measures a cumulative counter's increase across a restart", async () => {
    const result = await repo.series({
      timeRange,
      metric: "http.requests",
      type: "sum",
      aggregation: "increase",
    });
    expect(result.stepSeconds).toBe(60);
    expect(result.series[0]?.values).toEqual([60, 60, 10, 60, null, null]);
  });

  it("spreads a change over the time since the previous export", async () => {
    const read = async (metric: string, type: "sum" | "histogram", aggregation: "rate" | "p50") =>
      (await repo.series({ timeRange, metric, type, aggregation })).series[0]?.values.map((v) =>
        v === null ? v : +v.toFixed(4),
      );
    // One per second in every minute, not 15 minutes' worth in one.
    expect(await read("sparse.requests", "sum", "rate")).toEqual([1, 1, 1, 1, 1, null]);
    expect(await read("sparse.jobs", "sum", "rate")).toEqual([1, 1, 1, 1, 1, null]);
    expect(await read("sparse.duration", "histogram", "rate")).toEqual([1, 1, 1, 1, 1, null]);
    expect(await read("sparse.duration", "histogram", "p50")).toEqual([
      0.3,
      0.3,
      0.3,
      0.3,
      0.3,
      null,
    ]);
  });

  it("charts no finer than the metric's export interval", async () => {
    const wide = { from: "2026-01-01T11:00:00Z", to: "2026-01-01T12:15:00Z" };
    const input = { timeRange: wide, metric: "sparse.requests", type: "sum" as const };
    expect(await repo.exportInterval(input)).toBe(900);
    // A dense metric keeps the step the range gives.
    expect(await repo.exportInterval({ timeRange, metric: "http.requests", type: "sum" })).toBe(60);
    const result = await repo.series({ ...input, aggregation: "rate", minStep: 900 });
    expect(result.stepSeconds).toBe(900);
    expect(result.stepFromExport).toBe(true);
    // 900 requests between the 11:50 and 12:05 exports, one point per export.
    expect(result.buckets).toEqual([
      "2026-01-01T11:00:00.000Z",
      "2026-01-01T11:15:00.000Z",
      "2026-01-01T11:30:00.000Z",
      "2026-01-01T11:45:00.000Z",
      "2026-01-01T12:00:00.000Z",
      "2026-01-01T12:15:00.000Z",
    ]);
    // The bucket the range ends in has no time yet, so no rate.
    expect(result.series[0]?.values).toEqual([null, null, null, null, 1, null]);
  });

  it("counts a counter that started in range from its first point", async () => {
    const result = await repo.series({
      timeRange,
      metric: "deploys.started",
      type: "sum",
      aggregation: "increase",
    });
    expect(result.series[0]?.values).toEqual([null, null, 7, null, null, null]);
  });

  it("turns a delta counter into a per-second rate", async () => {
    const result = await repo.series({
      timeRange,
      metric: "jobs.completed",
      type: "sum",
      aggregation: "rate",
    });
    expect(result.series[0]?.values.slice(0, 2)).toEqual([5 / 60, 7 / 60]);
  });

  it("reads a cumulative histogram's percentiles, average and rate per interval", async () => {
    const read = async (aggregation: "p50" | "avg" | "rate") => {
      const result = await repo.series({
        timeRange,
        metric: "http.request.duration",
        type: "histogram",
        aggregation,
        heatmap: true,
      });
      return {
        values: result.series[0]?.values.slice(0, 3).map((v) => (v === null ? v : +v.toFixed(4))),
        heatmap: result.heatmap,
      };
    };
    const p50 = await read("p50");
    // 12:02 is the restart: its snapshot counts as the interval.
    expect(p50.values).toEqual([0.1, 0.3, 0.75]);
    expect((await read("avg")).values).toEqual([0.2, 0.3, 0.75]);
    expect((await read("rate")).values).toEqual([
      +(20 / 60).toFixed(4),
      +(20 / 60).toFixed(4),
      +(4 / 60).toFixed(4),
    ]);
    expect(p50.heatmap?.bounds).toEqual([0.1, 0.5, 1]);
    expect(p50.heatmap?.counts.slice(0, 4)).toEqual([
      [10, 10, 0, 0],
      [0, 20, 0, 0],
      [0, 0, 4, 0],
      [0, 0, 0, 0],
    ]);
  });

  it("keeps the highest exemplar with a trace in each interval of its export", async () => {
    const exemplars = await repo.exemplars({
      timeRange,
      metric: "http.request.duration",
      type: "histogram",
    });
    const at = (hhmm: string) => Date.parse(`2026-01-01T${hhmm}:00Z`) / 1000;
    expect(
      exemplars.map(({ ts, time, value, traceId, spanId }) => ({
        ts,
        time,
        value,
        traceId,
        spanId,
      })),
    ).toEqual([
      // In the interval its export counts it in, not the one of its own time.
      { ts: at("12:01"), time: "2026-01-01 12:00:45", value: 0.4, traceId: "t3", spanId: "s3" },
      { ts: at("12:00"), time: "2026-01-01 12:00:25", value: 0.3, traceId: "t2", spanId: "s2" },
    ]);
  });

  it("draws an exemplar an SDK repeats on every export once, at the first", async () => {
    // Every export carries the last exemplar seen, until a new one replaces
    // it: one sampled at 10:50, long before the range, then one at 12:03:10.
    const rows = Array.from({ length: 80 }, (_, i) => {
      const time = new Date(Date.parse("2026-01-06T10:50:30Z") + i * 60_000);
      const fresh = time >= new Date("2026-01-06T12:03:30Z");
      return {
        ServiceName: "api",
        MetricName: "rpc.duration",
        TimeUnix: time.toISOString().replace("T", " ").slice(0, 19),
        ExplicitBounds: [1],
        BucketCounts: [100, 0],
        Count: 100,
        Sum: 10,
        AggregationTemporality: 2,
        "Exemplars.FilteredAttributes": [{}],
        "Exemplars.TimeUnix": [fresh ? "2026-01-06 12:03:10" : "2026-01-06 10:50:00"],
        "Exemplars.Value": [fresh ? 0.5 : 0.9],
        "Exemplars.SpanId": [fresh ? "s2" : "s1"],
        "Exemplars.TraceId": [fresh ? "fresh" : "old"],
      };
    });
    run(
      `INSERT INTO metrics_histogram FORMAT JSONEachRow\n${rows.map((r) => JSON.stringify(r)).join("\n")}`,
    );
    const exemplars = await repo.exemplars({
      timeRange: { from: "2026-01-06T12:00:00Z", to: "2026-01-06T12:10:00Z" },
      metric: "rpc.duration",
      type: "histogram",
    });
    expect(exemplars.map(({ ts, traceId }) => ({ ts, traceId }))).toEqual([
      { ts: Date.parse("2026-01-06T12:03:00Z") / 1000, traceId: "fresh" },
    ]);
    // The first hour-long interval starts at 11:00, before the range; the old
    // exemplar still isn't new there.
    const hourly = await repo.exemplars({
      timeRange: { from: "2026-01-06T11:20:00Z", to: "2026-01-06T12:10:00Z" },
      metric: "rpc.duration",
      type: "histogram",
      minStep: 3600,
    });
    expect(hourly.map(({ traceId }) => traceId)).toEqual(["fresh"]);
  });

  it("keeps an exemplar sampled before the range by its export inside it", async () => {
    // Exported every 65 s: the 12:00:02 export sampled a request at 11:58:59,
    // more than a minute before the range, after the export before it.
    const rows = [
      ["11:58:57", ""],
      ["12:00:02", "11:58:59"],
      ["12:01:07", ""],
    ].map(([time, sampled]) => ({
      ServiceName: "api",
      MetricName: "slow.export",
      TimeUnix: `2026-01-07 ${time}`,
      ExplicitBounds: [1],
      BucketCounts: [1, 0],
      Count: 1,
      Sum: 1,
      AggregationTemporality: 1,
      "Exemplars.FilteredAttributes": sampled ? [{}] : [],
      "Exemplars.TimeUnix": sampled ? [`2026-01-07 ${sampled}`] : [],
      "Exemplars.Value": sampled ? [0.7] : [],
      "Exemplars.SpanId": sampled ? ["s1"] : [],
      "Exemplars.TraceId": sampled ? ["t1"] : [],
    }));
    run(
      `INSERT INTO metrics_histogram FORMAT JSONEachRow\n${rows.map((r) => JSON.stringify(r)).join("\n")}`,
    );
    const exemplars = await repo.exemplars({
      timeRange: { from: "2026-01-07T12:00:00Z", to: "2026-01-07T12:10:00Z" },
      metric: "slow.export",
      type: "histogram",
      minStep: 65,
    });
    expect(exemplars.map(({ ts, traceId }) => ({ ts, traceId }))).toEqual([
      { ts: Date.parse("2026-01-07T12:00:00Z") / 1000, traceId: "t1" },
    ]);
  });

  it("keeps an exemplar from the first interval's exports before the range start", async () => {
    // The chart's first interval starts at 12:00, before the range, and
    // counts the 12:00:10 export.
    run(`INSERT INTO metrics_histogram FORMAT JSONEachRow
${JSON.stringify({
  ServiceName: "api",
  MetricName: "early.export",
  TimeUnix: "2026-01-08 12:00:10",
  ExplicitBounds: [1],
  BucketCounts: [1, 0],
  Count: 1,
  Sum: 1,
  AggregationTemporality: 1,
  "Exemplars.FilteredAttributes": [{}],
  "Exemplars.TimeUnix": ["2026-01-08 12:00:05"],
  "Exemplars.Value": [0.7],
  "Exemplars.SpanId": ["s1"],
  "Exemplars.TraceId": ["t1"],
})}`);
    const exemplars = await repo.exemplars({
      timeRange: { from: "2026-01-08T12:00:30Z", to: "2026-01-08T12:10:00Z" },
      metric: "early.export",
      type: "histogram",
      minStep: 60,
    });
    expect(exemplars.map(({ ts, traceId }) => ({ ts, traceId }))).toEqual([
      { ts: Date.parse("2026-01-08T12:00:00Z") / 1000, traceId: "t1" },
    ]);
  });

  it("adds up a delta histogram's exports within an interval", async () => {
    const result = await repo.series({
      timeRange,
      metric: "queue.wait",
      type: "histogram",
      aggregation: "avg",
      heatmap: true,
    });
    expect(result.series[0]?.values[0]).toBeCloseTo(1.2 / 8);
    expect(result.heatmap?.counts[0]).toEqual([4, 4, 0, 0]);
  });

  it("builds the heatmap only when asked", async () => {
    const result = await repo.series({
      timeRange,
      metric: "queue.wait",
      type: "histogram",
      aggregation: "avg",
    });
    expect(result.heatmap).toBeUndefined();
  });

  it("keeps the heatmap's last minute when a rate leaves it out", async () => {
    // 45 s into 12:02: too short for a rate, but its observations still count.
    const result = await repo.series({
      timeRange: { from: "2026-01-01T12:00:00Z", to: "2026-01-01T12:02:45Z" },
      metric: "http.request.duration",
      type: "histogram",
      aggregation: "rate",
      heatmap: true,
    });
    expect(result.series[0]?.values.at(-1)).toBeNull();
    expect(result.heatmap?.counts.at(-1)?.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("lists every kind of metric in range", async () => {
    expect(await repo.kinds({ timeRange })).toEqual([
      "gauge",
      "counter",
      "histogram",
      "exponential_histogram",
      "summary",
    ]);
  });

  it("combines series with different bucket bounds on every bound", async () => {
    const read = (aggregation: "p50" | "avg") =>
      repo.series({
        timeRange,
        metric: "checkout.duration",
        type: "histogram",
        aggregation,
        heatmap: true,
      });
    const p50 = await read("p50");
    // api's (0.1, 0.5] and web's (0.2, 1] each spread evenly over the union
    // 0.1, 0.2, 0.5, 1: the median falls two thirds into (0.2, 0.5].
    expect(p50.series[0]?.values[0]).toBeCloseTo(0.4);
    expect(p50.merged).toEqual({ merge: "interpolated", layouts: 2 });
    expect(p50.heatmap?.bounds).toEqual([0.1, 0.2, 0.5, 1]);
    expect(p50.heatmap?.counts[0]).toEqual([0, 2.5, 11.25, 6.25, 0]);
    expect((await read("avg")).series[0]?.values[0]).toBeCloseTo(9 / 20);
  });

  it("reads an exponential histogram across a change of scale", async () => {
    const read = async (aggregation: "p50" | "rate") =>
      (
        await repo.series({
          timeRange,
          metric: "rpc.duration",
          type: "exponential_histogram",
          aggregation,
        })
      ).series[0]?.values.slice(0, 3);
    // 12:00: 4 in (1, 2]. 12:01: 6 more in (2, 4], measured at scale 0.
    expect(await read("p50")).toEqual([1.5, 3, null]);
    expect(await read("rate")).toEqual([4 / 60, 6 / 60, null]);
  });

  it("charts the lowest minimum across a summary's series", async () => {
    run(`INSERT INTO metrics_summary (ServiceName, MetricName, ResourceAttributes, TimeUnix, Count, Sum, ValueAtQuantiles.Quantile, ValueAtQuantiles.Value)
      VALUES ('api', 'job.latency', map('service.instance.id', 'a'), '2026-01-04 12:00:30', 1, 1, [0, 1], [1, 4]),
             ('api', 'job.latency', map('service.instance.id', 'b'), '2026-01-04 12:00:30', 1, 1, [0, 1], [5, 9])`);
    const min = await repo.series({
      timeRange: { from: "2026-01-04T12:00:00Z", to: "2026-01-04T12:05:00Z" },
      metric: "job.latency",
      type: "summary",
      aggregation: "min",
    });
    expect(min.series[0]?.values[0]).toBe(1);
    expect(min.highestOf).toBeUndefined();
  });

  it("offers only the quantiles the filtered services report", async () => {
    run(`INSERT INTO metrics_summary (ServiceName, MetricName, TimeUnix, Count, Sum, ValueAtQuantiles.Quantile, ValueAtQuantiles.Value)
      VALUES ('api', 'job.wait', '2026-01-04 12:00:30', 1, 1, [0.5, 0.99], [1, 2]),
             ('worker', 'job.wait', '2026-01-04 12:00:30', 1, 1, [0.5, 0.9], [1, 2])`);
    expect(
      await repo.summaryQuantiles({
        timeRange: { from: "2026-01-04T12:00:00Z", to: "2026-01-04T12:05:00Z" },
        metric: "job.wait",
        service: ["worker"],
      }),
    ).toEqual([0.5, 0.9]);
  });

  it("charts a summary's reported quantiles, average and rate", async () => {
    const read = async (aggregation: "p99" | "avg" | "rate") =>
      repo.series({ timeRange, metric: "gc.pause", type: "summary", aggregation });
    expect(await repo.summaryQuantiles({ timeRange, metric: "gc.pause" })).toEqual([0.5, 0.99]);
    // Quantiles can't be combined, so the line is the slower instance's. The
    // 12:01:30 exports still hold at 12:02, within an export interval.
    const p99 = await read("p99");
    expect(p99.series[0]?.values.slice(0, 4)).toEqual([0.3, 0.2, 0.2, null]);
    expect(p99.highestOf).toBe(2);
    // Count and Sum add up across instances: 90 pauses a minute, 4.2 s of them.
    const values = async (aggregation: "avg" | "rate") =>
      (await read(aggregation)).series[0]?.values
        .slice(0, 2)
        .map((v) => (v === null ? v : +v.toFixed(4)));
    expect(await values("rate")).toEqual([1.5, 1.5]);
    expect(await values("avg")).toEqual([+(4.2 / 90).toFixed(4), +(4.2 / 90).toFixed(4)]);
  });

  it("splits a gauge by an attribute, largest series first", async () => {
    const result = await repo.series({
      timeRange,
      metric: "queue.depth",
      type: "gauge",
      aggregation: "avg",
      groupBy: [{ source: "metric", key: "http.route" }],
    });
    expect(result.series.map((s) => [s.labels, s.values[0]])).toEqual([
      [["/a"], 15],
      [["/b"], 1],
    ]);
    expect(result.totalSeries).toBe(2);
  });

  it("charts the ten largest groups and counts every group", async () => {
    const result = await repo.series({
      timeRange,
      metric: "worker.load",
      type: "gauge",
      aggregation: "avg",
      groupBy: [{ source: "metric", key: "worker" }],
    });
    expect(result.series.map((s) => s.labels[0])).toEqual([
      "w12",
      "w11",
      "w10",
      "w09",
      "w08",
      "w07",
      "w06",
      "w05",
      "w04",
      "w03",
    ]);
    expect(result.totalSeries).toBe(12);
  });

  it("keeps every interval of a histogram grouped by thousands of values", async () => {
    // Two hours of 1,666 busy groups fill all but 80 of the rows one chart
    // reads. The slow group "late" after them would get only its first 80 minutes,
    // and its high p95 would top the chart, so it's left out whole.
    const groups = (name: string, n: number, counts: string, count: number) =>
      run(`INSERT INTO metrics_histogram (ServiceName, MetricName, Attributes, TimeUnix, StartTimeUnix, ExplicitBounds, BucketCounts, Count, Sum, AggregationTemporality)
        SELECT 'api', 'busy.duration', map('g', ${name}),
          toDateTime('2026-01-02 10:00:30', 'UTC') + 60 * intDiv(number, ${n}),
          toDateTime('2026-01-02 09:59:30', 'UTC') + 60 * intDiv(number, ${n}),
          [1.0], ${counts}, ${count}, 0.5, 1
        FROM numbers(${n} * 120)`);
    groups(`concat('busy', toString(number % 1666))`, 1666, "[2, 0]", 2);
    groups(`'late'`, 1, "[0, 1]", 1);
    groups(`concat('quiet', toString(number % 200))`, 200, "[1, 0]", 1);
    const result = await repo.series({
      timeRange: { from: "2026-01-02T10:00:00Z", to: "2026-01-02T12:00:00Z" },
      metric: "busy.duration",
      type: "histogram",
      aggregation: "p95",
      groupBy: [{ source: "metric", key: "g" }],
      heatmap: true,
    });
    expect(result.series.map((s) => s.labels[0])).not.toContain("late");
    expect(result.series.every((s) => s.values.slice(0, -1).every((v) => v !== null))).toBe(true);
    expect(result.totalSeries).toBe(1867);
    expect(result.heatmap?.counts.at(-2)?.reduce((a, b) => a + b, 0)).toBe(1666 * 2 + 1 + 200);
  });

  it("counts only the groups that draw a line", async () => {
    // A group that exports but observes nothing has no p95.
    run(`INSERT INTO metrics_histogram (ServiceName, MetricName, Attributes, TimeUnix, StartTimeUnix, ExplicitBounds, BucketCounts, Count, Sum, AggregationTemporality)
      SELECT 'api', 'idle.duration', map('g', g),
        toDateTime('2026-01-03 10:00:30', 'UTC') + 60 * m, toDateTime('2026-01-03 09:00:00', 'UTC'),
        [1.0], if(g = 'idle', [0, 0], [5 + m, 0]), if(g = 'idle', 0, 5 + m), 1, 2
      FROM (SELECT arrayJoin(['busy', 'idle']) AS g) AS groups CROSS JOIN (SELECT number AS m FROM numbers(10)) AS minutes`);
    const result = await repo.series({
      timeRange: { from: "2026-01-03T10:00:00Z", to: "2026-01-03T10:10:00Z" },
      metric: "idle.duration",
      type: "histogram",
      aggregation: "p95",
      groupBy: [{ source: "metric", key: "g" }],
    });
    expect(result.series.map((s) => s.labels[0])).toEqual(["busy"]);
    expect(result.totalSeries).toBe(1);
  });

  it("offers a key only one point carries, however many points come first", async () => {
    run(`INSERT INTO metrics_gauge (ServiceName, MetricName, ResourceAttributes, Attributes, TimeUnix, Value)
      SELECT 'api', 'queue.size', map('service.name', 'api'), map('pod', toString(number % 50)),
        toDateTime('2026-01-05 10:00:00', 'UTC') + number % 3600, 1
      FROM numbers(12000)`);
    run(`INSERT INTO metrics_gauge (ServiceName, MetricName, ResourceAttributes, Attributes, TimeUnix, Value)
      VALUES ('worker', 'queue.size', map('k8s.pod.name', 'w1'), map('error.type', 'timeout'), '2026-01-05 10:30:00', 1)`);
    run("OPTIMIZE TABLE metrics_gauge FINAL");
    const keys = await repo.attributeKeys({
      timeRange: { from: "2026-01-05T10:00:00Z", to: "2026-01-05T11:00:00Z" },
      metric: "queue.size",
      type: "gauge",
    });
    expect(keys).toContainEqual({ source: "metric", key: "error.type" });
    expect(keys).toContainEqual({ source: "resource", key: "k8s.pod.name" });
  });

  it("filters series by attribute value", async () => {
    const result = await repo.series({
      timeRange,
      metric: "queue.depth",
      type: "gauge",
      aggregation: "max",
      attributes: [{ source: "metric", key: "http.route", op: "not_in", values: ["/a"] }],
    });
    expect(result.series.map((s) => s.values[0])).toEqual([1]);
  });

  it("lists the services and environments that sent metrics", async () => {
    expect(await repo.services({ timeRange })).toEqual(["api", "web"]);
    expect(await repo.environments({ timeRange })).toEqual(["production"]);
  });

  it("offers the metric's own attribute keys and values", async () => {
    const input = { timeRange, metric: "queue.depth", type: "gauge" as const };
    expect(await repo.attributeKeys(input)).toEqual([
      { source: "metric", key: "http.route" },
      { source: "resource", key: "service.name" },
    ]);
    expect(await repo.attributeValues({ ...input, source: "metric", key: "http.route" })).toEqual([
      "/a",
      "/b",
    ]);
  });
});
