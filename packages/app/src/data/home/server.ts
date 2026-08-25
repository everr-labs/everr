import { errorIssueCountExpr } from "@everr/telemetry-explorer/errors";
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import {
  nonEmptyResourceAttribute,
  resourceAttribute,
} from "@/data/run-query-helpers";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { type BucketGranularity, getBucketGranularity } from "@/lib/time-range";
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

function fillSeries<Key extends string>(
  grid: string[],
  rows: ({ bucket: string } & Record<Key, string>)[],
  key: Key,
): number[] {
  const byBucket = new Map(rows.map((r) => [r.bucket, Number(r[key])]));
  return grid.map((bucket) => byBucket.get(bucket) ?? 0);
}

/**
 * Each query below aggregates one table at three grains at once: per bucket,
 * per second key (service, or PR), and range-wide. `GROUP BY GROUPING SETS`
 * computes exactly those three and nothing else, so the table is read once
 * instead of once per grain, and the cross product `CUBE` would add is never
 * built.
 *
 * A row's grain cannot be read off its key columns: the keys not in a set come
 * back defaulted to the empty string, which collides with the real rows whose
 * `ServiceName` or PR url is genuinely empty. `grouping()` reports whether a
 * key was aggregated away rather than grouped on, which separates the two, so
 * every query labels its own rows with it and callers match on the label.
 */
type RowKind = "bucket" | "service" | "pr" | "total";

/** Labels each row of a `(bucket) / (key) / ()` grouping set with its grain. */
function groupingKindExpr(key: "service" | "pr"): string {
  return `multiIf(grouping(bucket) = 0, 'bucket', grouping(${key}) = 0, '${key}', 'total')`;
}

function ofKind<Row extends { kind: RowKind }>(
  rows: Row[],
  kind: RowKind,
): Row[] {
  return rows.filter((r) => r.kind === kind);
}

function totalRow<Row extends { kind: RowKind }>(rows: Row[]): Row | undefined {
  return rows.find((r) => r.kind === "total");
}

/**
 * The median, interpolated between the two middle values on an even count, to
 * match the `quantile(0.5)` this used to be computed with in ClickHouse.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  const lower = sorted[Math.floor(mid)];
  const upper = sorted[Math.ceil(mid)];
  return lower + (upper - lower) * (mid - Math.floor(mid));
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

/**
 * The three statements the overview runs, built for one bucket granularity.
 *
 * Kept apart from the handler so the SQL can be read on its own, rather than
 * only in the middle of the request that runs it: these are the queries that
 * decide how fast Home loads.
 *
 * Both time filters are bound through `{fromTime:String}` / `{toTime:String}`.
 */
function buildHomeQueries(granularity: BucketGranularity): {
  logsSql: string;
  tracesSql: string;
  ciSql: string;
} {
  const timeFilter = `Timestamp >= parseDateTimeBestEffort({fromTime:String}) AND Timestamp <= parseDateTimeBestEffort({toTime:String})`;
  const logsTimeFilter = `TimestampTime >= parseDateTimeBestEffort({fromTime:String}) AND TimestampTime <= parseDateTimeBestEffort({toTime:String})`;

  const logsSql = `
      SELECT
        ${bucketExpr("TimestampTime", granularity)} AS bucket,
        ServiceName AS service,
        ${groupingKindExpr("service")} AS kind,
        count() AS logCount,
        ${errorIssueCountExpr()} AS issueCount
      FROM logs
      WHERE ${logsTimeFilter}
      GROUP BY GROUPING SETS ((bucket), (service), ())
    `;

  const tracesSql = `
      SELECT
        ${bucketExpr("Timestamp", granularity)} AS bucket,
        ServiceName AS service,
        ${groupingKindExpr("service")} AS kind,
        uniqIf(TraceId, TraceId != '') AS traceCount
      FROM traces
      WHERE ${timeFilter}
      GROUP BY GROUPING SETS ((bucket), (service), ())
    `;

  /**
   * The run id, the PR url and the task result each live on their own spans
   * of a run, so none of them can be filtered before the rows are grouped
   * into runs. Filtering the result first would leave `lastTimestamp` as the
   * last result bearing span rather than the last span of the run, and a run
   * whose closing span crosses a bucket boundary would then be counted one
   * bucket early, or fall off the end of the grid entirely. All three are
   * pulled up with `max` and filtered afterwards, which keeps the same set of
   * runs.
   *
   * The time filter is the one predicate that stays ahead of the group, and
   * it defines what a run means here: the spans it has inside the selected
   * range. A run still going at the range end is therefore counted at its
   * last span inside the range, not at the span that closes it. Moving the
   * time filter after the group would read the whole table on every load,
   * since nothing would be left to prune partitions or the primary index on.
   *
   * Run counts and PR durations sit at different grains, so the grouping
   * sets here are per bucket and per PR rather than per bucket and per
   * service. Requiring a result keeps the PR median over the same population
   * the run count reports, rather than dragging it down with the partial
   * duration of an in-flight run. The median itself is taken from the per-PR
   * rows in the handler, since an aggregate over one grouping set's rows is
   * not something the same query can also return.
   */
  const ciSql = `
      SELECT
        ${bucketExpr("lastTimestamp", granularity)} AS bucket,
        pr,
        ${groupingKindExpr("pr")} AS kind,
        count() AS runCount,
        sum(runDurationMs) AS prTotalMs
      FROM (
        SELECT
          ${resourceAttribute("cicd.pipeline.run.id")} AS run_id,
          max(${resourceAttribute("everr.git.pull_requests.url")}) AS pr,
          max(${resourceAttribute("cicd.pipeline.task.run.result")}) AS result,
          max(Timestamp) AS lastTimestamp,
          max(Duration) / 1000000 AS runDurationMs
        FROM traces
        WHERE ${timeFilter}
          AND ${nonEmptyResourceAttribute("cicd.pipeline.run.id")}
        GROUP BY run_id
      )
      WHERE result != ''
      GROUP BY GROUPING SETS ((bucket), (pr), ())
    `;

  return { logsSql, tracesSql, ciSql };
}

export const getHomeOverview = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange }, context: { clickhouse } }) => {
    const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(timeRange);
    const granularity = getBucketGranularity(fromDate, toDate);
    const grid = bucketGrid(fromDate, toDate, granularity);
    const params = { fromTime: fromISO, toTime: toISO };
    const { logsSql, tracesSql, ciSql } = buildHomeQueries(granularity);

    const [logsRows, tracesRows, ciRows] = await Promise.all([
      clickhouse.query<{
        kind: RowKind;
        bucket: string;
        service: string;
        logCount: string;
        issueCount: string;
      }>(logsSql, params),
      clickhouse.query<{
        kind: RowKind;
        bucket: string;
        service: string;
        traceCount: string;
      }>(tracesSql, params),
      clickhouse.query<{
        kind: RowKind;
        bucket: string;
        pr: string;
        runCount: string;
        prTotalMs: string;
      }>(ciSql, params),
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
    // The unnamed service was filtered out in SQL when the per-service totals
    // were their own query. It is dropped here instead, so the bucket series
    // and range totals sharing the scan keep counting every row.
    const named = <Row extends { service: string }>(rows: Row[]) =>
      rows.filter((r) => r.service !== "");

    for (const row of named(ofKind(tracesRows, "service"))) {
      service(row.service).traceCount = Number(row.traceCount);
    }
    for (const row of named(ofKind(logsRows, "service"))) {
      const entry = service(row.service);
      entry.logCount = Number(row.logCount);
      entry.errorCount = Number(row.issueCount);
    }

    const serviceList = topServices(services.values(), MAX_SERVICES);

    const logsTotal = totalRow(logsRows);
    const prTotals = ofKind(ciRows, "pr")
      .filter((r) => r.pr !== "")
      .map((r) => Number(r.prTotalMs));

    return {
      logs: {
        total: Number(logsTotal?.logCount ?? 0),
        series: fillSeries(grid, ofKind(logsRows, "bucket"), "logCount"),
      },
      traces: {
        total: Number(totalRow(tracesRows)?.traceCount ?? 0),
        series: fillSeries(grid, ofKind(tracesRows, "bucket"), "traceCount"),
      },
      services: serviceList,
      errors: {
        issues: Number(logsTotal?.issueCount ?? 0),
        series: fillSeries(grid, ofKind(logsRows, "bucket"), "issueCount"),
      },
      ci: {
        totalRuns: Number(totalRow(ciRows)?.runCount ?? 0),
        prMedianTotalTimeMs: median(prTotals),
        series: fillSeries(grid, ofKind(ciRows, "bucket"), "runCount"),
      },
    } satisfies HomeOverview;
  });
