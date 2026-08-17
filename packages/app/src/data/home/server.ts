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
import { getBucketGranularity } from "@/lib/time-range";
import { bucketExpr, bucketGrid } from "./buckets";

export interface HomeService {
  name: string;
  logCount: number;
  traceCount: number;
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
 * `GROUP BY ... WITH ROLLUP` appends one extra row per query holding the
 * range-wide total, with every grouping key defaulted. For a `String` bucket
 * key that default is the empty string, which no real bucket key can collide
 * with, so it doubles as the marker for "this is the total row".
 */
const ROLLUP_TOTAL_BUCKET = "";

/**
 * The services worth showing, ranked on both signals rather than on their sum.
 * Log volume normally runs orders of magnitude above trace count, so adding the
 * two would rank purely by logs and let one chatty service push out a
 * trace-heavy one. Taking the leaders of each ranking in turn keeps both kinds
 * of service present.
 */
function topServices(
  services: Iterable<HomeService>,
  limit: number,
): HomeService[] {
  const all = Array.from(services);
  const byLogs = [...all].sort((a, b) => b.logCount - a.logCount);
  const byTraces = [...all].sort((a, b) => b.traceCount - a.traceCount);

  const picked: HomeService[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < all.length && picked.length < limit; i++) {
    for (const ranking of [byLogs, byTraces]) {
      const candidate = ranking[i];
      if (!candidate || seen.has(candidate.name)) continue;
      if (picked.length === limit) break;
      seen.add(candidate.name);
      picked.push(candidate);
    }
  }
  return picked;
}

export const getHomeOverview = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange }, context: { clickhouse } }) => {
    const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(timeRange);
    const granularity = getBucketGranularity(fromDate, toDate);
    const grid = bucketGrid(fromDate, toDate, granularity);
    const params = { fromTime: fromISO, toTime: toISO };
    const timeFilter = `Timestamp >= parseDateTimeBestEffort({fromTime:String}) AND Timestamp <= parseDateTimeBestEffort({toTime:String})`;
    const logsTimeFilter = `TimestampTime >= parseDateTimeBestEffort({fromTime:String}) AND TimestampTime <= parseDateTimeBestEffort({toTime:String})`;

    const logsSql = `
      SELECT
        ${bucketExpr("TimestampTime", granularity)} AS bucket,
        count() AS logCount,
        uniqIf(${ERROR_FINGERPRINT_SQL}, ${EXCEPTION_LOG_FILTER_SQL}) AS issueCount
      FROM logs
      WHERE ${logsTimeFilter}
      GROUP BY bucket WITH ROLLUP
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

    /**
     * The PR url and the task result live on different spans of a run, so
     * neither can be filtered before the rows are grouped into runs. Both are
     * pulled up with `max` and filtered afterwards. Requiring a result keeps
     * this median over the same population the run count above reports, rather
     * than dragging it down with the partial duration of an in-flight run.
     */
    const prTimeSql = `
      SELECT quantile(0.5)(prTotalMs) AS prMedianTotalTimeMs
      FROM (
        SELECT pr, sum(runDurationMs) AS prTotalMs
        FROM (
          SELECT
            ${resourceAttribute("cicd.pipeline.run.id")} AS run_id,
            max(${resourceAttribute("everr.git.pull_requests.url")}) AS pr,
            max(${resourceAttribute("cicd.pipeline.task.run.result")}) AS result,
            max(Duration) / 1000000 AS runDurationMs
          FROM traces
          WHERE ${timeFilter}
            AND ${nonEmptyResourceAttribute("cicd.pipeline.run.id")}
          GROUP BY run_id
        )
        WHERE pr != '' AND result != ''
        GROUP BY pr
      )
    `;

    const [
      logsRows,
      tracesRows,
      traceServiceRows,
      logServiceRows,
      ciRows,
      prTimeRows,
    ] = await Promise.all([
      clickhouse.query<{
        bucket: string;
        logCount: string;
        issueCount: string;
      }>(logsSql, params),
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

    const serviceList = topServices(services.values(), MAX_SERVICES);

    const logsTotal = rollupTotal(logsRows);
    const totalRuns = Number(rollupTotal(ciRows)?.runCount ?? 0);

    return {
      logs: {
        total: Number(logsTotal?.logCount ?? 0),
        series: fillSeries(grid, logsRows, (r) => r.logCount),
      },
      traces: {
        total: Number(rollupTotal(tracesRows)?.traceCount ?? 0),
        series: fillSeries(grid, tracesRows, (r) => r.traceCount),
      },
      services: serviceList,
      errors: {
        issues: Number(logsTotal?.issueCount ?? 0),
        series: fillSeries(grid, logsRows, (r) => r.issueCount),
      },
      ci: {
        totalRuns,
        prMedianTotalTimeMs: Number(prTimeRows[0]?.prMedianTotalTimeMs ?? 0),
        series: fillSeries(grid, ciRows, (r) => r.runCount),
      },
    } satisfies HomeOverview;
  });
