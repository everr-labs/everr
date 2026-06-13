import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { getBucketGranularity } from "@/lib/time-range";
import type { SignalCounts } from "./pricing";
import type {
  CurrentPeriodUsage,
  RangeUsage,
  UsageBucket,
  UsageHistory,
} from "./schemas";

const HISTORY_MONTHS = 12;

const METRIC_TABLES = [
  "metrics_gauge",
  "metrics_sum",
  "metrics_histogram",
  "metrics_exponential_histogram",
  "metrics_summary",
] as const;

type Signal = keyof SignalCounts;

/**
 * ClickHouse DateTime literal without fractional seconds — `logs.TimestampTime`
 * is a plain DateTime, which rejects strings carrying milliseconds.
 */
function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Counts ingested rows per bucket per signal. One row per signal in each
 * source table is exactly one billable item: a log record, a span, or a
 * metric datapoint — the five metric tables fold into a single "metrics"
 * signal. Tenant scoping comes from the row-level policy; no tenant filter
 * here. Bucket columns are chosen to hit each table's partition key.
 */
type BucketFn = "toStartOfHour" | "toStartOfDay" | "toStartOfMonth";

function ingestCountsSql(bucketFn: BucketFn): string {
  const format =
    bucketFn === "toStartOfHour" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%dT00:00:00Z";
  const bucket = (column: string) =>
    `formatDateTime(${bucketFn}(${column}), '${format}')`;
  const range = (column: string) =>
    `${column} >= {fromTime:String} AND ${column} < {toTime:String}`;

  const parts = [
    `SELECT ${bucket("TimestampTime")} AS bucket, 'logs' AS signal, count() AS c
       FROM logs WHERE ${range("TimestampTime")} GROUP BY bucket`,
    `SELECT ${bucket("Timestamp")} AS bucket, 'spans' AS signal, count() AS c
       FROM traces WHERE ${range("Timestamp")} GROUP BY bucket`,
    ...METRIC_TABLES.map(
      (table) =>
        `SELECT ${bucket("TimeUnix")} AS bucket, 'metrics' AS signal, count() AS c
           FROM ${table} WHERE ${range("TimeUnix")} GROUP BY bucket`,
    ),
  ];

  return `
    SELECT bucket, signal, sum(c) AS count
    FROM (${parts.join(" UNION ALL ")})
    GROUP BY bucket, signal
    ORDER BY bucket ASC
  `;
}

interface CountRow {
  bucket: string;
  signal: string;
  count: string;
}

function emptyCounts(): SignalCounts {
  return { logs: 0, spans: 0, metrics: 0 };
}

function isSignal(value: string): value is Signal {
  return value === "logs" || value === "spans" || value === "metrics";
}

/** Bucket key matching the SQL's formatDateTime output for `bucketFn`. */
function bucketKey(d: Date, bucketFn: BucketFn): string {
  return bucketFn === "toStartOfHour"
    ? `${d.toISOString().slice(0, 13)}:00:00Z`
    : `${d.toISOString().slice(0, 10)}T00:00:00Z`;
}

/** Zero-filled buckets covering [start, end), advanced by `step`. */
function foldBuckets(
  rows: CountRow[],
  start: Date,
  end: Date,
  bucketFn: BucketFn,
  step: (d: Date) => void,
): UsageBucket[] {
  const byBucket = new Map<string, UsageBucket>();
  for (const d = new Date(start); d < end; step(d)) {
    const key = bucketKey(d, bucketFn);
    byBucket.set(key, { bucket: key, ...emptyCounts() });
  }
  for (const row of rows) {
    const entry = byBucket.get(row.bucket);
    if (!entry || !isSignal(row.signal)) continue;
    entry[row.signal] += Number(row.count);
  }
  return [...byBucket.values()];
}

function sumBuckets(buckets: UsageBucket[]): SignalCounts {
  const totals = emptyCounts();
  for (const bucket of buckets) {
    totals.logs += bucket.logs;
    totals.spans += bucket.spans;
    totals.metrics += bucket.metrics;
  }
  return totals;
}

export const getUsageForRange = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(
    async ({
      data: { timeRange },
      context: { clickhouse },
    }): Promise<RangeUsage> => {
      const { fromDate, toDate } = resolveTimeRange(timeRange);
      const granularity = getBucketGranularity(fromDate, toDate);
      const bucketFn =
        granularity === "hour" ? "toStartOfHour" : "toStartOfDay";

      const rows = await clickhouse.query<CountRow>(ingestCountsSql(bucketFn), {
        fromTime: toClickHouseDateTime(fromDate),
        toTime: toClickHouseDateTime(toDate),
      });

      const firstBucket = new Date(fromDate);
      firstBucket.setUTCMinutes(0, 0, 0);
      if (granularity === "day") firstBucket.setUTCHours(0);
      const buckets = foldBuckets(rows, firstBucket, toDate, bucketFn, (d) =>
        granularity === "hour"
          ? d.setUTCHours(d.getUTCHours() + 1)
          : d.setUTCDate(d.getUTCDate() + 1),
      );

      return {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        granularity,
        totals: sumBuckets(buckets),
        buckets,
      };
    },
  );

export const getUsageCurrentPeriod = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { clickhouse } }): Promise<CurrentPeriodUsage> => {
  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  const rows = await clickhouse.query<CountRow>(
    ingestCountsSql("toStartOfDay"),
    {
      fromTime: toClickHouseDateTime(periodStart),
      toTime: toClickHouseDateTime(periodEnd),
    },
  );

  const endOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const daily = foldBuckets(
    rows,
    periodStart,
    endOfToday,
    "toStartOfDay",
    (d) => d.setUTCDate(d.getUTCDate() + 1),
  );

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    now: now.toISOString(),
    totals: sumBuckets(daily),
    daily,
  };
});

export const getUsageHistory = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { clickhouse } }): Promise<UsageHistory> => {
  const now = new Date();
  const firstMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (HISTORY_MONTHS - 1), 1),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  const rows = await clickhouse.query<CountRow>(
    ingestCountsSql("toStartOfMonth"),
    {
      fromTime: toClickHouseDateTime(firstMonth),
      toTime: toClickHouseDateTime(periodEnd),
    },
  );

  const months = foldBuckets(
    rows,
    firstMonth,
    periodEnd,
    "toStartOfMonth",
    (d) => d.setUTCMonth(d.getUTCMonth() + 1),
  );

  return { months };
});
