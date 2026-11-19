import { bucketSeconds } from "@everr/ui/lib/bucket";
import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { attributesField } from "../../attribute-filter/schemas";
import { validateTableName } from "../../sql/table";
import { bucketMs, bucketStarts } from "./buckets";
import type { SqlClient } from "./client";
import { refetchInterval } from "./options";
import { PROFILE_HISTOGRAM_BUCKETS } from "./schemas";
import { attributeClause } from "./where";

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

type DelayRow = { bucket: string; p99: number | null; max: number | null };
type GcRow = { bucket: string; gcType: string; seconds: number };

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

// Metrics carry the same `ResourceAttributes` map as profiles, and the input
// accepts only resource filters.
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
    const clause = attributeClause(filter, index, params);
    if (clause) clauses.push(clause);
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
function fillRuntimeBuckets(
  delayRows: DelayRow[],
  gcRows: GcRow[],
  fromDate: Date,
  toDate: Date,
  intervalSeconds: number,
): RuntimeMetrics {
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

  const buckets = bucketStarts(fromDate, toDate, intervalSeconds).map(
    ({ ms, timestamp, endTimestamp }): RuntimeMetricsBucket => {
      const delay = delays.get(ms);
      return {
        timestamp,
        endTimestamp,
        eventLoopDelayP99: delay ? nullableNumber(delay.p99) : null,
        eventLoopDelayMax: delay ? nullableNumber(delay.max) : null,
        gc: gc.get(ms) ?? emptyGc(),
      };
    },
  );
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
  return queryOptions({
    queryKey: ["profiles", "runtime", input] as const,
    queryFn: () => repo.runtime(input),
    refetchInterval: refetchInterval(refresh),
    placeholderData: keepPreviousData,
  });
}
