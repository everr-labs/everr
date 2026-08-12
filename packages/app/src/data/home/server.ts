import {
  ERROR_FINGERPRINT_SQL,
  EXCEPTION_LOG_FILTER_SQL,
} from "@everr/telemetry-explorer/errors";
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import {
  nonEmptyResourceAttribute,
  resourceAttribute,
} from "@/data/run-query-helpers";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { bucketExpr, bucketGrid, getBucketGranularity } from "@/lib/time-range";

export interface HomeService {
  name: string;
  logCount: number;
  /** Distinct traces the service participated in. */
  traceCount: number;
  /** Distinct error issues among the service's logs. */
  errorCount: number;
}

interface HomeOverview {
  logs: { total: number; series: number[] };
  traces: { total: number; series: number[] };
  services: HomeService[];
  errors: { issues: number; series: number[] };
  ci: { totalRuns: number; prMedianTotalTimeMs: number; series: number[] };
}

const MAX_SERVICES = 10;

function fillSeries<Row extends { bucket: string }>(
  grid: string[],
  rows: Row[],
  value: (row: Row) => string,
): number[] {
  const byBucket = new Map(rows.map((r) => [r.bucket, Number(value(r))]));
  return grid.map((bucket) => byBucket.get(bucket) ?? 0);
}

/**
 * WITH ROLLUP appends a summary row with an empty bucket whose aggregates run
 * over the whole range; distinct counts and quantiles can't be combined from
 * per-bucket rows, so that row is the only exact source for range-wide values.
 */
const ROLLUP_TOTAL_BUCKET = "";

export const getHomeOverview = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange }, context: { clickhouse } }) => {
    const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(timeRange);
    const granularity = getBucketGranularity(fromDate, toDate);
    const grid = bucketGrid(fromDate, toDate, granularity);
    const params = { fromTime: fromISO, toTime: toISO };
    const timeFilter = `Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}`;
    // The logs table is ordered and partitioned on TimestampTime; filtering on
    // it (not Timestamp) keeps primary-index and partition pruning engaged.
    const logsTimeFilter = `TimestampTime >= parseDateTimeBestEffort({fromTime:String}) AND TimestampTime <= parseDateTimeBestEffort({toTime:String})`;

    const logsSeriesSql = `
      SELECT ${bucketExpr("TimestampTime", granularity)} AS bucket, count() AS logCount
      FROM logs
      WHERE ${logsTimeFilter}
      GROUP BY bucket
    `;

    const tracesSql = `
      SELECT
        ${bucketExpr("Timestamp", granularity)} AS bucket,
        uniqIf(TraceId, TraceId != '') AS traceCount
      FROM traces
      WHERE ${timeFilter}
      GROUP BY bucket WITH ROLLUP
    `;

    const traceServicesSql = `
      SELECT
        ServiceName AS service,
        uniqIf(TraceId, TraceId != '') AS traceCount
      FROM traces
      WHERE ${timeFilter} AND ServiceName != ''
      GROUP BY service
    `;

    const logServicesSql = `
      SELECT
        ServiceName AS service,
        count() AS logCount,
        uniqIf(${ERROR_FINGERPRINT_SQL}, ${EXCEPTION_LOG_FILTER_SQL}) AS errorCount
      FROM logs
      WHERE ${logsTimeFilter} AND ServiceName != ''
      GROUP BY service
    `;

    const errorsSql = `
      SELECT
        ${bucketExpr("TimestampTime", granularity)} AS bucket,
        uniq(${ERROR_FINGERPRINT_SQL}) AS issueCount
      FROM logs
      WHERE ${logsTimeFilter}
        AND ${EXCEPTION_LOG_FILTER_SQL}
      GROUP BY bucket WITH ROLLUP
    `;

    const ciSql = `
      SELECT
        ${bucketExpr("lastTimestamp", granularity)} AS bucket,
        count() AS runCount
      FROM (
        SELECT
          ${resourceAttribute("cicd.pipeline.run.id")} AS run_id,
          max(Timestamp) AS lastTimestamp
        FROM traces
        WHERE ${timeFilter}
          AND ${nonEmptyResourceAttribute("cicd.pipeline.run.id")}
          AND ${nonEmptyResourceAttribute("cicd.pipeline.task.run.result")}
        GROUP BY run_id
      )
      GROUP BY bucket WITH ROLLUP
    `;

    // The PR url and the task result live on different spans of a run, so this
    // groups whole runs first (no result filter) and lets max() surface the PR
    // url from whichever span carries it. Total CI time per PR, median across PRs.
    const prTimeSql = `
      SELECT quantile(0.5)(prTotalMs) AS prMedianTotalTimeMs
      FROM (
        SELECT pr, sum(runDurationMs) AS prTotalMs
        FROM (
          SELECT
            ${resourceAttribute("cicd.pipeline.run.id")} AS run_id,
            max(${resourceAttribute("everr.git.pull_requests.url")}) AS pr,
            max(Duration) / 1000000 AS runDurationMs
          FROM traces
          WHERE ${timeFilter}
            AND ${nonEmptyResourceAttribute("cicd.pipeline.run.id")}
          GROUP BY run_id
        )
        WHERE pr != ''
        GROUP BY pr
      )
    `;

    const [
      logsRows,
      tracesRows,
      traceServiceRows,
      logServiceRows,
      errorsRows,
      ciRows,
      prTimeRows,
    ] = await Promise.all([
      clickhouse.query<{ bucket: string; logCount: string }>(
        logsSeriesSql,
        params,
      ),
      clickhouse.query<{ bucket: string; traceCount: string }>(
        tracesSql,
        params,
      ),
      clickhouse.query<{ service: string; traceCount: string }>(
        traceServicesSql,
        params,
      ),
      clickhouse.query<{
        service: string;
        logCount: string;
        errorCount: string;
      }>(logServicesSql, params),
      clickhouse.query<{ bucket: string; issueCount: string }>(
        errorsSql,
        params,
      ),
      clickhouse.query<{ bucket: string; runCount: string }>(ciSql, params),
      clickhouse.query<{ prMedianTotalTimeMs: string }>(prTimeSql, params),
    ]);

    const rollupTotal = <Row extends { bucket: string }>(rows: Row[]) =>
      rows.find((r) => r.bucket === ROLLUP_TOTAL_BUCKET);

    const services = new Map<string, HomeService>();
    for (const row of traceServiceRows) {
      services.set(row.service, {
        name: row.service,
        logCount: 0,
        traceCount: Number(row.traceCount),
        errorCount: 0,
      });
    }
    for (const row of logServiceRows) {
      const entry = services.get(row.service) ?? {
        name: row.service,
        logCount: 0,
        traceCount: 0,
        errorCount: 0,
      };
      entry.logCount = Number(row.logCount);
      entry.errorCount = Number(row.errorCount);
      services.set(row.service, entry);
    }

    const serviceList = Array.from(services.values())
      .sort((a, b) => b.logCount + b.traceCount - (a.logCount + a.traceCount))
      .slice(0, MAX_SERVICES);

    const logsSeries = fillSeries(grid, logsRows, (r) => r.logCount);
    const totalRuns = Number(rollupTotal(ciRows)?.runCount ?? 0);

    return {
      logs: {
        total: logsSeries.reduce((sum, v) => sum + v, 0),
        series: logsSeries,
      },
      traces: {
        total: Number(rollupTotal(tracesRows)?.traceCount ?? 0),
        series: fillSeries(grid, tracesRows, (r) => r.traceCount),
      },
      services: serviceList,
      errors: {
        issues: Number(rollupTotal(errorsRows)?.issueCount ?? 0),
        series: fillSeries(grid, errorsRows, (r) => r.issueCount),
      },
      ci: {
        totalRuns,
        prMedianTotalTimeMs: Number(prTimeRows[0]?.prMedianTotalTimeMs ?? 0),
        series: fillSeries(grid, ciRows, (r) => r.runCount),
      },
    } satisfies HomeOverview;
  });
