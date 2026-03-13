import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import type { Step } from "./runs";

const DEFAULT_SAMPLE_INTERVAL_SECONDS = 5;
const RESOURCE_USAGE_GAUGE_METRICS = [
  "system.cpu.utilization",
  "system.memory.utilization",
  "system.filesystem.utilization",
] as const;
const RESOURCE_USAGE_SUM_METRICS = [
  "system.memory.limit",
  "system.memory.usage",
  "system.filesystem.limit",
  "system.filesystem.usage",
  "system.network.io",
] as const;

export interface ResourceUsagePoint {
  timestamp: number; // Unix ms
  cpuAvg: number; // 0-100
  cpuMax: number; // 0-100
  memoryUsed: number; // bytes
  memoryLimit: number; // bytes
  memoryUtilization: number; // 0-100
  filesystemUsed: number; // bytes
  filesystemLimit: number; // bytes
  filesystemUtilization: number; // 0-100
  networkReceive: number; // cumulative bytes
  networkTransmit: number; // cumulative bytes
}

export interface ResourceUsageSummary {
  cpuAvg: number;
  cpuPeak: number;
  memoryPeak: number;
  memoryLimit: number;
  filesystemIoAvg: number;
  filesystemIoMax: number;
  networkIoAvg: number;
  networkIoMax: number;
}

export interface JobResourceUsage {
  points: ResourceUsagePoint[];
  summary: ResourceUsageSummary;
  sampleIntervalSeconds: number;
}

export interface ResourceUsageAggregate {
  sampleCount: number;
  summary: ResourceUsageSummary;
}

export interface RunJobResourceUsage extends ResourceUsageAggregate {
  sampleIntervalSeconds: number;
}

export interface RunResourceUsage {
  jobs: Record<string, RunJobResourceUsage>;
  steps: Record<string, Record<string, ResourceUsageAggregate>>;
}

interface RawMetricRow {
  metricName: string;
  timestamp: string;
  value: string;
  cpuLogicalNumber: string;
  memoryState: string;
  filesystemState: string;
  networkDirection: string;
  networkInterface: string;
  checkRunId: string;
  jobName: string;
}

interface JobIdentifier {
  runId: string;
  runAttempt?: number;
  jobName: string;
  checkRunId?: string;
}

interface RunJobResourceLocator {
  jobId: string;
  jobName: string;
  checkRunId?: string;
}

interface ResourceMetricFilters {
  runAttempt?: string;
  checkRunId?: string;
  jobName?: string;
}

interface MetricRowMatchLookup {
  byCheckRunId: Map<string, string>;
  uniqueFallbackJobIdByName: Map<string, string | null>;
}

function emptySummary(): ResourceUsageSummary {
  return {
    cpuAvg: 0,
    cpuPeak: 0,
    memoryPeak: 0,
    memoryLimit: 0,
    filesystemIoAvg: 0,
    filesystemIoMax: 0,
    networkIoAvg: 0,
    networkIoMax: 0,
  };
}

export function emptyRunResourceUsage(): RunResourceUsage {
  return {
    jobs: {},
    steps: {},
  };
}

function resolveJobIdentifiers(
  rows: {
    runId: string;
    runAttempt: string;
    jobName: string;
    checkRunId: string;
  }[],
): JobIdentifier | null {
  if (rows.length === 0) return null;

  const runAttempt = Number(rows[0].runAttempt);

  return {
    runId: rows[0].runId,
    runAttempt:
      Number.isFinite(runAttempt) && runAttempt > 0 ? runAttempt : undefined,
    jobName: rows[0].jobName,
    checkRunId: rows[0].checkRunId || undefined,
  };
}

export function aggregatePoints(rows: RawMetricRow[]): ResourceUsagePoint[] {
  const byTimestamp = new Map<
    number,
    {
      cpuValues: number[];
      memoryUsed: number;
      memoryLimit: number;
      memoryUtilization: number;
      filesystemUsed: number;
      filesystemLimit: number;
      filesystemUtilization: number;
      networkByInterface: Map<string, { receive: number; transmit: number }>;
    }
  >();

  for (const row of rows) {
    const ts = Number(row.timestamp);
    if (!byTimestamp.has(ts)) {
      byTimestamp.set(ts, {
        cpuValues: [],
        memoryUsed: 0,
        memoryLimit: 0,
        memoryUtilization: 0,
        filesystemUsed: 0,
        filesystemLimit: 0,
        filesystemUtilization: 0,
        networkByInterface: new Map(),
      });
    }

    const bucket = byTimestamp.get(ts);
    if (!bucket) continue;

    const value = Number(row.value);

    switch (row.metricName) {
      case "system.cpu.utilization":
        bucket.cpuValues.push(value * 100);
        break;
      case "system.memory.usage":
        if (row.memoryState === "used") bucket.memoryUsed = value;
        break;
      case "system.memory.limit":
        bucket.memoryLimit = value;
        break;
      case "system.memory.utilization":
        bucket.memoryUtilization = value * 100;
        break;
      case "system.filesystem.usage":
        if (row.filesystemState === "used") bucket.filesystemUsed = value;
        break;
      case "system.filesystem.limit":
        bucket.filesystemLimit = value;
        break;
      case "system.filesystem.utilization":
        bucket.filesystemUtilization = value * 100;
        break;
      case "system.network.io": {
        const iface = row.networkInterface || "unknown";
        if (!bucket.networkByInterface.has(iface)) {
          bucket.networkByInterface.set(iface, {
            receive: 0,
            transmit: 0,
          });
        }
        const networkValues = bucket.networkByInterface.get(iface);
        if (networkValues) {
          if (row.networkDirection === "receive") {
            networkValues.receive = value;
          } else if (row.networkDirection === "transmit") {
            networkValues.transmit = value;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const sortedTimestamps = [...byTimestamp.keys()].sort((a, b) => a - b);

  return sortedTimestamps.flatMap((ts) => {
    const bucket = byTimestamp.get(ts);
    if (!bucket) return [];

    const cpuAvg =
      bucket.cpuValues.length > 0
        ? bucket.cpuValues.reduce((a, b) => a + b, 0) / bucket.cpuValues.length
        : 0;
    const cpuMax =
      bucket.cpuValues.length > 0 ? Math.max(...bucket.cpuValues) : 0;

    let networkReceive = 0;
    let networkTransmit = 0;
    for (const networkValues of bucket.networkByInterface.values()) {
      networkReceive += networkValues.receive;
      networkTransmit += networkValues.transmit;
    }

    return {
      timestamp: ts,
      cpuAvg,
      cpuMax,
      memoryUsed: bucket.memoryUsed,
      memoryLimit: bucket.memoryLimit,
      memoryUtilization: bucket.memoryUtilization,
      filesystemUsed: bucket.filesystemUsed,
      filesystemLimit: bucket.filesystemLimit,
      filesystemUtilization: bucket.filesystemUtilization,
      networkReceive,
      networkTransmit,
    };
  });
}

export function deriveSummary(
  points: ResourceUsagePoint[],
  options?: {
    baselinePoint?: ResourceUsagePoint;
  },
): ResourceUsageSummary {
  if (points.length === 0) {
    return emptySummary();
  }

  let cpuSum = 0;
  let cpuPeak = 0;
  let memoryPeak = 0;
  let filesystemIoSum = 0;
  let filesystemIoMax = 0;
  let networkIoSum = 0;
  let networkIoMax = 0;
  let ioSampleCount = 0;
  let previousPoint = options?.baselinePoint;

  for (const point of points) {
    cpuSum += point.cpuAvg;
    cpuPeak = Math.max(cpuPeak, point.cpuMax);
    memoryPeak = Math.max(memoryPeak, point.memoryUsed);
    if (previousPoint) {
      const dtSeconds = (point.timestamp - previousPoint.timestamp) / 1000;
      if (dtSeconds > 0) {
        const filesystemIo =
          Math.max(0, point.filesystemUsed - previousPoint.filesystemUsed) /
          dtSeconds;
        const networkIo =
          (Math.max(0, point.networkReceive - previousPoint.networkReceive) +
            Math.max(
              0,
              point.networkTransmit - previousPoint.networkTransmit,
            )) /
          dtSeconds;

        filesystemIoSum += filesystemIo;
        filesystemIoMax = Math.max(filesystemIoMax, filesystemIo);
        networkIoSum += networkIo;
        networkIoMax = Math.max(networkIoMax, networkIo);
        ioSampleCount += 1;
      }
    }
    previousPoint = point;
  }

  return {
    cpuAvg: cpuSum / points.length,
    cpuPeak,
    memoryPeak,
    memoryLimit: points[points.length - 1]?.memoryLimit ?? 0,
    filesystemIoAvg: ioSampleCount > 0 ? filesystemIoSum / ioSampleCount : 0,
    filesystemIoMax,
    networkIoAvg: ioSampleCount > 0 ? networkIoSum / ioSampleCount : 0,
    networkIoMax,
  };
}

function deriveSampleInterval(points: ResourceUsagePoint[]): number {
  if (points.length < 2) return DEFAULT_SAMPLE_INTERVAL_SECONDS;

  const intervals: number[] = [];
  for (let index = 1; index < Math.min(points.length, 10); index++) {
    intervals.push(
      (points[index].timestamp - points[index - 1].timestamp) / 1000,
    );
  }

  return Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
}

function buildUsageAggregate(
  points: ResourceUsagePoint[],
  options?: {
    baselinePoint?: ResourceUsagePoint;
  },
): ResourceUsageAggregate {
  return {
    sampleCount: points.length,
    summary: deriveSummary(points, options),
  };
}

function buildJobUsageAggregate(
  points: ResourceUsagePoint[],
): RunJobResourceUsage {
  return {
    ...buildUsageAggregate(points),
    sampleIntervalSeconds: deriveSampleInterval(points),
  };
}

function buildMetricFilterClause(filters?: ResourceMetricFilters): string {
  const clauses: string[] = [];

  if (filters?.runAttempt !== undefined) {
    clauses.push(
      "AND ResourceAttributes['everr.github.workflow_run.run_attempt'] = {runAttempt:String}",
    );
  }

  if (filters?.checkRunId) {
    clauses.push(
      "AND Attributes['everr.resource_usage.check_run_id'] = {checkRunId:String}",
    );
  }
  if (filters?.jobName) {
    clauses.push(
      "AND Attributes['cicd.pipeline.task.name'] = {jobName:String}",
    );
  }

  return clauses.join("\n        ");
}

async function loadResourceMetricRows(
  runId: string,
  filters?: ResourceMetricFilters,
): Promise<RawMetricRow[]> {
  const filterClause = buildMetricFilterClause(filters);
  const sql = `
      SELECT
        MetricName as metricName,
        toUnixTimestamp64Milli(TimeUnix) as timestamp,
        Value as value,
        Attributes['cpu.logical_number'] as cpuLogicalNumber,
        Attributes['system.memory.state'] as memoryState,
        Attributes['system.filesystem.state'] as filesystemState,
        Attributes['network.io.direction'] as networkDirection,
        Attributes['network.interface.name'] as networkInterface,
        Attributes['everr.resource_usage.check_run_id'] as checkRunId,
        Attributes['cicd.pipeline.task.name'] as jobName
      FROM metrics_gauge
      WHERE ResourceAttributes['cicd.pipeline.run.id'] = {runId:String}
        ${filterClause}
        AND MetricName IN (${RESOURCE_USAGE_GAUGE_METRICS.map((metric) => `'${metric}'`).join(", ")})

      UNION ALL

      SELECT
        MetricName as metricName,
        toUnixTimestamp64Milli(TimeUnix) as timestamp,
        Value as value,
        '' as cpuLogicalNumber,
        Attributes['system.memory.state'] as memoryState,
        Attributes['system.filesystem.state'] as filesystemState,
        Attributes['network.io.direction'] as networkDirection,
        Attributes['network.interface.name'] as networkInterface,
        Attributes['everr.resource_usage.check_run_id'] as checkRunId,
        Attributes['cicd.pipeline.task.name'] as jobName
      FROM metrics_sum
      WHERE ResourceAttributes['cicd.pipeline.run.id'] = {runId:String}
        ${filterClause}
        AND MetricName IN (${RESOURCE_USAGE_SUM_METRICS.map((metric) => `'${metric}'`).join(", ")})

      ORDER BY timestamp
    `;

  return query<RawMetricRow>(sql, {
    runId,
    runAttempt: filters?.runAttempt,
    checkRunId: filters?.checkRunId,
    jobName: filters?.jobName,
  });
}

async function getRunJobResourceLocators(
  traceId: string,
): Promise<RunJobResourceLocator[]> {
  const sql = `
      SELECT
        ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
        anyLast(ResourceAttributes['cicd.pipeline.task.name']) as jobName,
        anyLast(ResourceAttributes['everr.github.workflow_job.check_run_id']) as checkRunId
      FROM traces
      WHERE TraceId = {traceId:String}
        AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
      GROUP BY jobId
    `;

  const rows = await query<{
    jobId: string;
    jobName: string;
    checkRunId: string;
  }>(sql, { traceId });

  return rows.map((row) => ({
    jobId: row.jobId,
    jobName: row.jobName,
    checkRunId: row.checkRunId || undefined,
  }));
}

function buildMetricRowMatchLookup(
  locators: RunJobResourceLocator[],
): MetricRowMatchLookup {
  const byCheckRunId = new Map<string, string>();
  const uniqueFallbackJobIdByName = new Map<string, string | null>();

  for (const locator of locators) {
    if (locator.checkRunId) {
      byCheckRunId.set(locator.checkRunId, locator.jobId);
      continue;
    }

    const existing = uniqueFallbackJobIdByName.get(locator.jobName);
    if (existing === undefined) {
      uniqueFallbackJobIdByName.set(locator.jobName, locator.jobId);
    } else if (existing !== locator.jobId) {
      uniqueFallbackJobIdByName.set(locator.jobName, null);
    }
  }

  return {
    byCheckRunId,
    uniqueFallbackJobIdByName,
  };
}

function resolveMetricRowJobId(
  row: RawMetricRow,
  lookup: MetricRowMatchLookup,
): string | null {
  if (row.checkRunId) {
    const matchedJobId = lookup.byCheckRunId.get(row.checkRunId);
    if (matchedJobId) {
      return matchedJobId;
    }
  }

  if (!row.jobName) {
    return null;
  }

  return lookup.uniqueFallbackJobIdByName.get(row.jobName) ?? null;
}

function buildStepResourceUsage(
  points: ResourceUsagePoint[],
  steps: Step[],
): Record<string, ResourceUsageAggregate> {
  const usageByStep: Record<string, ResourceUsageAggregate> = {};
  const sortedSteps = [...steps].sort((left, right) => {
    if (left.startTime !== right.startTime) {
      return left.startTime - right.startTime;
    }

    const leftStepNumber = Number(left.stepNumber);
    const rightStepNumber = Number(right.stepNumber);
    if (!Number.isNaN(leftStepNumber) && !Number.isNaN(rightStepNumber)) {
      return leftStepNumber - rightStepNumber;
    }

    return left.stepNumber.localeCompare(right.stepNumber);
  });

  for (const [index, step] of sortedSteps.entries()) {
    const nextStep = sortedSteps[index + 1];
    const stepPoints = points.filter(
      (point) =>
        point.timestamp >= step.startTime &&
        point.timestamp <= step.endTime &&
        (!nextStep || point.timestamp < nextStep.startTime),
    );

    if (stepPoints.length === 0) {
      continue;
    }

    const baselinePoint = [...points]
      .reverse()
      .find((point) => point.timestamp < step.startTime);

    usageByStep[step.stepNumber] = buildUsageAggregate(stepPoints, {
      baselinePoint,
    });
  }

  return usageByStep;
}

export async function getRunResourceUsage(input: {
  traceId: string;
  runId: string;
  runAttempt: number;
  stepsByJobId: Record<string, Step[]>;
}): Promise<RunResourceUsage> {
  const locators = await getRunJobResourceLocators(input.traceId);
  if (locators.length === 0) {
    return emptyRunResourceUsage();
  }

  const metricRows = await loadResourceMetricRows(input.runId, {
    runAttempt: input.runAttempt > 0 ? String(input.runAttempt) : undefined,
  });
  if (metricRows.length === 0) {
    return emptyRunResourceUsage();
  }

  const lookup = buildMetricRowMatchLookup(locators);
  const rowsByJobId = new Map<string, RawMetricRow[]>();

  for (const row of metricRows) {
    const jobId = resolveMetricRowJobId(row, lookup);
    if (!jobId) {
      continue;
    }

    if (!rowsByJobId.has(jobId)) {
      rowsByJobId.set(jobId, []);
    }

    rowsByJobId.get(jobId)?.push(row);
  }

  const resourceUsage = emptyRunResourceUsage();

  for (const locator of locators) {
    const rows = rowsByJobId.get(locator.jobId);
    if (!rows) {
      continue;
    }

    const points = aggregatePoints(rows);
    if (points.length === 0) {
      continue;
    }

    resourceUsage.jobs[locator.jobId] = buildJobUsageAggregate(points);

    const stepUsage = buildStepResourceUsage(
      points,
      input.stepsByJobId[locator.jobId] ?? [],
    );

    if (Object.keys(stepUsage).length > 0) {
      resourceUsage.steps[locator.jobId] = stepUsage;
    }
  }

  return resourceUsage;
}

export const getJobResourceUsage = createServerFn({
  method: "GET",
})
  .inputValidator(z.object({ traceId: z.string(), jobId: z.string() }))
  .handler(
    async ({ data: { traceId, jobId } }): Promise<JobResourceUsage | null> => {
      const identifierSql = `
      SELECT
        anyLast(ResourceAttributes['cicd.pipeline.run.id']) as runId,
        anyLast(toUInt32OrZero(ResourceAttributes['everr.github.workflow_job.run_attempt'])) as runAttempt,
        anyLast(ResourceAttributes['cicd.pipeline.task.name']) as jobName,
        anyLast(ResourceAttributes['everr.github.workflow_job.check_run_id']) as checkRunId
      FROM traces
      WHERE TraceId = {traceId:String}
        AND ResourceAttributes['cicd.pipeline.task.run.id'] = {jobId:String}
    `;

      const identifierRows = await query<{
        runId: string;
        runAttempt: string;
        jobName: string;
        checkRunId: string;
      }>(identifierSql, { traceId, jobId });

      const identifiers = resolveJobIdentifiers(identifierRows);
      if (!identifiers || !identifiers.runId || !identifiers.jobName) {
        return null;
      }

      const metricRows = await loadResourceMetricRows(
        identifiers.runId,
        identifiers.checkRunId
          ? {
              runAttempt:
                identifiers.runAttempt !== undefined
                  ? String(identifiers.runAttempt)
                  : undefined,
              checkRunId: identifiers.checkRunId,
            }
          : {
              runAttempt:
                identifiers.runAttempt !== undefined
                  ? String(identifiers.runAttempt)
                  : undefined,
              jobName: identifiers.jobName,
            },
      );
      if (metricRows.length === 0) {
        return null;
      }

      const points = aggregatePoints(metricRows);
      if (points.length === 0) {
        return null;
      }

      return {
        points,
        summary: deriveSummary(points),
        sampleIntervalSeconds: deriveSampleInterval(points),
      };
    },
  );

export const jobResourceUsageOptions = (input: {
  traceId: string;
  jobId: string;
}) =>
  queryOptions({
    queryKey: ["runs", "jobResourceUsage", input.traceId, input.jobId],
    queryFn: () => getJobResourceUsage({ data: input }),
    staleTime: 60_000,
  });
