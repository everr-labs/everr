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

const repo = new MetricsRepository({
  async execute<T>(sql: string, params: Record<string, unknown> = {}) {
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
    })),
  );
  // Exemplars on the latency histogram: two in the 12:00 interval, one in
  // 12:01, and one with no trace, which can't link anywhere.
  insert("metrics_histogram", [
    {
      MetricName: "http.request.duration",
      MetricUnit: "s",
      TimeUnix: "2026-01-01 12:03:30",
      ExplicitBounds: [0.1, 0.5, 1],
      AggregationTemporality: 2,
      "Exemplars.FilteredAttributes": [{}, {}, {}, {}],
      "Exemplars.TimeUnix": [
        "2026-01-01 12:00:20",
        "2026-01-01 12:00:40",
        "2026-01-01 12:01:20",
        "2026-01-01 12:01:50",
      ],
      "Exemplars.Value": [0.08, 0.3, 0.4, 0.9],
      "Exemplars.SpanId": ["s1", "s2", "s3", ""],
      "Exemplars.TraceId": ["t1", "t2", "t3", ""],
    },
  ]);
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
      { name: "checkout.duration", type: "histogram", unit: "s", isMonotonic: false },
      { name: "deploys.started", type: "sum", unit: "", isMonotonic: true },
      { name: "gc.pause", type: "summary", unit: "s", isMonotonic: false },
      {
        name: "http.request.duration",
        type: "histogram",
        unit: "s",
        isMonotonic: false,
      },
      { name: "http.requests", type: "sum", unit: "{request}", isMonotonic: true },
      { name: "jobs.completed", type: "sum", unit: "", isMonotonic: true },
      { name: "queue.depth", type: "gauge", unit: "{item}", isMonotonic: false },
      { name: "queue.wait", type: "histogram", unit: "s", isMonotonic: false },
      {
        name: "rpc.duration",
        type: "exponential_histogram",
        unit: "s",
        isMonotonic: false,
      },
      { name: "sparse.duration", type: "histogram", unit: "s", isMonotonic: false },
      { name: "sparse.jobs", type: "sum", unit: "", isMonotonic: true },
      { name: "sparse.requests", type: "sum", unit: "", isMonotonic: true },
      { name: "worker.load", type: "gauge", unit: "1", isMonotonic: false },
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
      "deploys.started",
      "http.requests",
      "jobs.completed",
      "sparse.jobs",
      "sparse.requests",
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
      "deploys.started",
      "http.requests",
      "jobs.completed",
      "queue.depth",
      "sparse.jobs",
      "sparse.requests",
      "worker.load",
    ]);
    // Every sum in the fixtures is monotonic.
    expect(await names(["updown"])).toEqual([]);
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
    const wide = { from: "2026-01-01T11:00:00Z", to: "2026-01-01T12:10:00Z" };
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
    ]);
    expect(result.series[0]?.values).toEqual([null, null, null, null, 1]);
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

  it("keeps the highest exemplar with a trace in each interval", async () => {
    const exemplars = await repo.exemplars({
      timeRange,
      metric: "http.request.duration",
      type: "histogram",
    });
    expect(
      exemplars.map(({ time, value, traceId, spanId }) => ({ time, value, traceId, spanId })),
    ).toEqual([
      { time: "2026-01-01 12:01:20", value: 0.4, traceId: "t3", spanId: "s3" },
      { time: "2026-01-01 12:00:40", value: 0.3, traceId: "t2", spanId: "s2" },
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

  it("charts a summary's reported quantiles, average and rate", async () => {
    const read = async (aggregation: "p99" | "avg" | "rate") =>
      repo.series({ timeRange, metric: "gc.pause", type: "summary", aggregation });
    expect(await repo.summaryQuantiles({ timeRange, metric: "gc.pause" })).toEqual([0.5, 0.99]);
    // Quantiles can't be combined, so the line is the slower instance's.
    const p99 = await read("p99");
    expect(p99.series[0]?.values.slice(0, 3)).toEqual([0.3, 0.2, null]);
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
