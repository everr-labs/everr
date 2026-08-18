import { errorIssueCountExpr } from "@everr/telemetry-explorer/errors";
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import {
  nonEmptyResourceAttribute,
  resourceAttribute,
} from "@/data/run-query-helpers";
import { bucketExpr, bucketGrid } from "@/lib/buckets";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { getBucketGranularity } from "@/lib/time-range";

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

function fillSeries<Key extends string>(
  grid: string[],
  rows: ({ bucket: string } & Record<Key, string>)[],
  key: Key,
): number[] {
  const byBucket = new Map(rows.map((r) => [r.bucket, Number(r[key])]));
  return grid.map((bucket) => byBucket.get(bucket) ?? 0);
}

/**
 * `GROUP BY ... WITH ROLLUP` appends one extra row per query holding the
 * range-wide total, with every grouping key defaulted. For a `String` bucket
 * key that default is the empty string, which no real bucket key can collide
 * with, so it doubles as the marker for "this is the total row".
 */
const ROLLUP_TOTAL_BUCKET = "";

function rollupTotal<Row extends { bucket: string }>(
  rows: Row[],
): Row | undefined {
  return rows.find((r) => r.bucket === ROLLUP_TOTAL_BUCKET);
}

function* interleave<T>(a: readonly T[], b: readonly T[]): Generator<T> {
  for (let i = 0; i < a.length; i++) {
    yield a[i];
    yield b[i];
  }
}

/**
 * The services worth showing, ranked on both signals rather than on their sum.
 * Log volume normally runs orders of magnitude above trace count, so adding the
 * two would rank purely by logs and let one chatty service push out a
 * trace-heavy one. Taking the leaders of each ranking in turn keeps both kinds
 * of service present.
 *
 * The two rankings are walked lazily, so the loop stops at `limit` without
 * building the interleaved sequence first.
 */
function topServices(
  services: Iterable<HomeService>,
  limit: number,
): HomeService[] {
  const byLogs = Array.from(services);
  const byTraces = [...byLogs];
  byLogs.sort((a, b) => b.logCount - a.logCount);
  byTraces.sort((a, b) => b.traceCount - a.traceCount);

  const picked: HomeService[] = [];
  const seen = new Set<string>();
  for (const service of interleave(byLogs, byTraces)) {
    if (picked.length === limit) break;
    if (seen.has(service.name)) continue;
    seen.add(service.name);
    picked.push(service);
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
        ${errorIssueCountExpr()} AS issueCount
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
        ${errorIssueCountExpr()} AS errorCount
      FROM logs
      WHERE ${logsTimeFilter} AND ServiceName != ''
      GROUP BY service
    `;

    /**
     * The task result lives on its own spans of a run, so it cannot be
     * filtered before the rows are grouped into runs. Filtering first would
     * leave `lastTimestamp` as the last result bearing span rather than the
     * last span of the run, and a run whose closing span crosses a bucket
     * boundary would then be counted one bucket early, or fall off the end of
     * the grid entirely. The result is pulled up with `max` and filtered
     * afterwards, which keeps the same set of runs.
     *
     * The time filter is the one predicate that stays ahead of the group, and
     * it defines what a run means here: the spans it has inside the selected
     * range. A run still going at the range end is therefore counted at its
     * last span inside the range, not at the span that closes it. Moving the
     * time filter after the group would read the whole table on every load,
     * since nothing would be left to prune partitions or the primary index on.
     */
    const ciSql = `
      SELECT
        ${bucketExpr("lastTimestamp", granularity)} AS bucket,
        count() AS runCount
      FROM (
        SELECT run_id, lastTimestamp
        FROM (
          SELECT
            ${resourceAttribute("cicd.pipeline.run.id")} AS run_id,
            max(${resourceAttribute("cicd.pipeline.task.run.result")}) AS result,
            max(Timestamp) AS lastTimestamp
          FROM traces
          WHERE ${timeFilter}
            AND ${nonEmptyResourceAttribute("cicd.pipeline.run.id")}
          GROUP BY run_id
        )
        WHERE result != ''
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

    const services = new Map<string, HomeService>();
    const service = (name: string): HomeService => {
      let entry = services.get(name);
      if (!entry) {
        entry = { name, logCount: 0, traceCount: 0, errorCount: 0 };
        services.set(name, entry);
      }
      return entry;
    };
    for (const row of traceServiceRows) {
      service(row.service).traceCount = Number(row.traceCount);
    }
    for (const row of logServiceRows) {
      const entry = service(row.service);
      entry.logCount = Number(row.logCount);
      entry.errorCount = Number(row.errorCount);
    }

    const serviceList = topServices(services.values(), MAX_SERVICES);

    const logsTotal = rollupTotal(logsRows);
    const totalRuns = Number(rollupTotal(ciRows)?.runCount ?? 0);

    return {
      logs: {
        total: Number(logsTotal?.logCount ?? 0),
        series: fillSeries(grid, logsRows, "logCount"),
      },
      traces: {
        total: Number(rollupTotal(tracesRows)?.traceCount ?? 0),
        series: fillSeries(grid, tracesRows, "traceCount"),
      },
      services: serviceList,
      errors: {
        issues: Number(logsTotal?.issueCount ?? 0),
        series: fillSeries(grid, logsRows, "issueCount"),
      },
      ci: {
        totalRuns,
        prMedianTotalTimeMs: Number(prTimeRows[0]?.prMedianTotalTimeMs ?? 0),
        series: fillSeries(grid, ciRows, "runCount"),
      },
    } satisfies HomeOverview;
  });
