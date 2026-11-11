import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { bucketSeconds } from "@everr/ui/lib/bucket";
import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { attributesField } from "../../attribute-filter/schemas";
import { normalizeTimestampToUtc } from "../../logs/util/timestamp";
import { validateTableName } from "../../sql/table";
import type { SqlClient } from "./client";
import { PROFILE_HISTOGRAM_BUCKETS } from "./schemas";

/** The `v8js.gc.type` values semconv defines, in stack order. */
export const GC_TYPES = ["minor", "major", "incremental", "weakcb"] as const;
export type GcType = (typeof GC_TYPES)[number];

export const RuntimeMetricsInputSchema = z.object({
  timeRange: TimeRangeSchema,
  services: z.array(z.string()).default([]),
  // Metrics share only the resource with profiles, so sample filters do not apply.
  attributes: attributesField(["resource"]),
  buckets: z.number().int().positive().max(500).default(PROFILE_HISTOGRAM_BUCKETS),
});
export type RuntimeMetricsInput = z.input<typeof RuntimeMetricsInputSchema>;

export type RuntimeMetricsBucket = {
  timestamp: string;
  endTimestamp: string;
  /** Worst `nodejs.eventloop.delay.p99` reported in the bucket, in seconds; null when none was. */
  eventLoopDelayP99: number | null;
  /** Worst `nodejs.eventloop.delay.max` reported in the bucket, in seconds. */
  eventLoopDelayMax: number | null;
  /** `v8js.gc.duration` accrued in the bucket per GC type, in seconds, summed across instances. */
  gc: Record<GcType, number>;
};

export type RuntimeMetrics = {
  buckets: RuntimeMetricsBucket[];
  hasEventLoopDelay: boolean;
  hasGc: boolean;
};

const DELAY_P99 = "nodejs.eventloop.delay.p99";
const DELAY_MAX = "nodejs.eventloop.delay.max";
const GC_DURATION = "v8js.gc.duration";

// OTLP AggregationTemporality.
const DELTA = 1;

/**
 * Cumulative points before the range give the first in-range point a baseline,
 * so its increase is not lost. Node exports every 60s by default.
 */
const CUMULATIVE_LOOKBACK_SECONDS = 300;

export type DelayRow = { bucket: string; p99: number | null; max: number | null };
export type GcRow = { bucket: string; gcType: string; seconds: number };

export class RuntimeMetricsRepository {
  private readonly gaugeTable: string;
  private readonly histogramTable: string;

  constructor(
    private readonly client: SqlClient,
    options: { gaugeTable?: string; histogramTable?: string } = {},
  ) {
    this.gaugeTable = options.gaugeTable ?? "metrics_gauge";
    this.histogramTable = options.histogramTable ?? "metrics_histogram";
    validateTableName(this.gaugeTable);
    validateTableName(this.histogramTable);
  }

  /** Node.js event-loop delay and GC time per histogram bucket. */
  async runtime(input: RuntimeMetricsInput): Promise<RuntimeMetrics> {
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(input.timeRange);
    const intervalSeconds = bucketSeconds(
      fromDate,
      toDate,
      input.buckets ?? PROFILE_HISTOGRAM_BUCKETS,
    );
    const filter = resourceWhere(input.services ?? [], input.attributes ?? []);
    const params = { ...filter.params, fromTime: fromISO, toTime: toISO };
    const bucketSql = `toStartOfInterval(TimeUnix, INTERVAL ${intervalSeconds} SECOND)`;

    const [delayRows, gcRows] = await Promise.all([
      this.client.execute<DelayRow>(
        /* sql */ `
        SELECT
          ${bucketSql} AS bucket,
          maxIfOrNull(Value, MetricName = '${DELAY_P99}') AS p99,
          maxIfOrNull(Value, MetricName = '${DELAY_MAX}') AS max
        FROM ${this.gaugeTable}
        WHERE MetricName IN ('${DELAY_P99}', '${DELAY_MAX}')
          AND TimeUnix >= parseDateTimeBestEffort({fromTime:String})
          AND TimeUnix <= parseDateTimeBestEffort({toTime:String})${filter.clause}
        GROUP BY bucket
        ORDER BY bucket
      `,
        params,
      ),
      // Delta points carry their own increase. A cumulative series is one
      // (resource, attributes, start time) run, so a restart begins a new one;
      // its increase is the change from the previous point, or the whole sum
      // when the run starts inside the scanned window.
      this.client.execute<GcRow>(
        /* sql */ `
        SELECT
          ${bucketSql} AS bucket,
          gcType,
          sum(increase) AS seconds
        FROM (
          SELECT
            TimeUnix,
            Attributes['v8js.gc.type'] AS gcType,
            if(
              AggregationTemporality = ${DELTA},
              Sum,
              if(
                row_number() OVER run = 1,
                if(StartTimeUnix >= parseDateTimeBestEffort({fromTime:String}) - INTERVAL ${CUMULATIVE_LOOKBACK_SECONDS} SECOND, Sum, 0),
                greatest(Sum - lagInFrame(Sum) OVER run, 0)
              )
            ) AS increase
          FROM ${this.histogramTable}
          WHERE MetricName = '${GC_DURATION}'
            AND TimeUnix >= parseDateTimeBestEffort({fromTime:String}) - INTERVAL ${CUMULATIVE_LOOKBACK_SECONDS} SECOND
            AND TimeUnix <= parseDateTimeBestEffort({toTime:String})${filter.clause}
          WINDOW run AS (
            PARTITION BY ServiceName, cityHash64(ResourceAttributes), cityHash64(Attributes), StartTimeUnix
            ORDER BY TimeUnix
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
        )
        WHERE TimeUnix >= parseDateTimeBestEffort({fromTime:String})
        GROUP BY bucket, gcType
        ORDER BY bucket
      `,
        params,
      ),
    ]);

    return fillRuntimeBuckets(delayRows, gcRows, fromDate, toDate, intervalSeconds);
  }
}

export type RuntimeMetricsRepositoryLike = Pick<RuntimeMetricsRepository, "runtime">;

function resourceWhere(
  services: string[],
  attributes: NonNullable<RuntimeMetricsInput["attributes"]>,
): { clause: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (services.length > 0) {
    clauses.push("ServiceName IN {services:Array(String)}");
    params.services = services;
  }
  attributes.forEach((filter, index) => {
    if (filter.source !== "resource") return;
    const key = `attrKey${index}`;
    const vals = `attrVals${index}`;
    const exists = `mapContains(ResourceAttributes, {${key}:String})`;
    const value = `ResourceAttributes[{${key}:String}]`;
    const values = filter.values ?? [];
    if ((filter.op === "in" || filter.op === "not_in") && values.length === 0) return;
    params[key] = filter.key;
    if (filter.op === "in" || filter.op === "not_in") params[vals] = values;
    clauses.push(
      filter.op === "in"
        ? `${exists} AND ${value} IN {${vals}:Array(String)}`
        : filter.op === "not_in"
          ? `(${exists} AND ${value} NOT IN {${vals}:Array(String)})`
          : filter.op === "exists"
            ? exists
            : `NOT ${exists}`,
    );
  });
  return {
    clause: clauses.map((clause) => `\n          AND ${clause}`).join(""),
    params,
  };
}

const GC_TYPE_SET: ReadonlySet<string> = new Set(GC_TYPES);

function isGcType(value: string): value is GcType {
  return GC_TYPE_SET.has(value);
}

/** Every bucket of the range, aligned with the samples histogram, gaps kept. */
export function fillRuntimeBuckets(
  delayRows: DelayRow[],
  gcRows: GcRow[],
  fromDate: Date,
  toDate: Date,
  intervalSeconds: number,
): RuntimeMetrics {
  const intervalMs = intervalSeconds * 1000;
  const startMs = Math.floor(fromDate.getTime() / intervalMs) * intervalMs;
  const endMs = Math.floor(toDate.getTime() / intervalMs) * intervalMs;
  const bucketMs = (bucket: string) => new Date(normalizeTimestampToUtc(bucket)).getTime();
  const nullableNumber = (value: number | string | null) => (value === null ? null : Number(value));

  const delays = new Map(delayRows.map((row) => [bucketMs(row.bucket), row]));
  const gc = new Map<number, Record<GcType, number>>();
  for (const row of gcRows) {
    // A runtime that reports a type semconv does not name still spent the time.
    const type = isGcType(row.gcType) ? row.gcType : "major";
    const ms = bucketMs(row.bucket);
    const entry = gc.get(ms) ?? emptyGc();
    entry[type] += Number(row.seconds);
    gc.set(ms, entry);
  }

  const buckets: RuntimeMetricsBucket[] = [];
  for (let ms = startMs; ms <= endMs; ms += intervalMs) {
    const delay = delays.get(ms);
    buckets.push({
      timestamp: new Date(ms).toISOString(),
      endTimestamp: new Date(ms + intervalMs).toISOString(),
      eventLoopDelayP99: delay ? nullableNumber(delay.p99) : null,
      eventLoopDelayMax: delay ? nullableNumber(delay.max) : null,
      gc: gc.get(ms) ?? emptyGc(),
    });
  }
  return {
    buckets,
    hasEventLoopDelay: buckets.some(
      (bucket) => bucket.eventLoopDelayP99 !== null || bucket.eventLoopDelayMax !== null,
    ),
    hasGc: gcRows.length > 0,
  };
}

function emptyGc(): Record<GcType, number> {
  return { minor: 0, major: 0, incremental: 0, weakcb: 0 };
}

export function runtimeMetricsOptions({
  repo,
  refresh,
  input,
}: {
  repo: RuntimeMetricsRepositoryLike;
  refresh: string;
  input: RuntimeMetricsInput;
}) {
  const refreshMs = getRefreshIntervalMs(refresh);
  return queryOptions({
    queryKey: ["profiles", "runtime", input] as const,
    queryFn: () => repo.runtime(input),
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
    placeholderData: keepPreviousData,
  });
}
