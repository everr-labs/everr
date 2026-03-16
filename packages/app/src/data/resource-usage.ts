import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

export interface ResourceUsagePoint {
  timestamp: number; // Unix ms
  cpuAvg: number; // 0–100
  cpuMax: number; // 0–100
  memoryUsed: number; // bytes
  memoryLimit: number; // bytes
  memoryUtilization: number; // 0–100
  filesystemUsed: number; // bytes
  filesystemLimit: number; // bytes
  filesystemUtilization: number; // 0–100
  networkReceive: number; // cumulative bytes
  networkTransmit: number; // cumulative bytes
}

export interface ResourceUsageSummary {
  cpuAvg: number;
  cpuPeak: number;
  memoryPeak: number;
  memoryLimit: number;
  filesystemPeak: number;
  filesystemLimit: number;
  networkTotalReceive: number;
  networkTotalTransmit: number;
}

export interface JobResourceUsage {
  points: ResourceUsagePoint[];
  summary: ResourceUsageSummary;
  sampleIntervalSeconds: number;
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
}

function resolveJobIdentifiers(
  rows: { runId: string; jobName: string }[],
): { runId: string; jobName: string } | null {
  if (rows.length === 0) return null;
  return { runId: rows[0].runId, jobName: rows[0].jobName };
}

function aggregatePoints(rows: RawMetricRow[]): ResourceUsagePoint[] {
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
        const net = bucket.networkByInterface.get(iface);
        if (net) {
          if (row.networkDirection === "receive") net.receive = value;
          else if (row.networkDirection === "transmit") net.transmit = value;
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
    for (const net of bucket.networkByInterface.values()) {
      networkReceive += net.receive;
      networkTransmit += net.transmit;
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

function deriveSummary(points: ResourceUsagePoint[]): ResourceUsageSummary {
  if (points.length === 0) {
    return {
      cpuAvg: 0,
      cpuPeak: 0,
      memoryPeak: 0,
      memoryLimit: 0,
      filesystemPeak: 0,
      filesystemLimit: 0,
      networkTotalReceive: 0,
      networkTotalTransmit: 0,
    };
  }

  let cpuSum = 0;
  let cpuPeak = 0;
  let memoryPeak = 0;
  let filesystemPeak = 0;

  for (const p of points) {
    cpuSum += p.cpuAvg;
    cpuPeak = Math.max(cpuPeak, p.cpuMax);
    memoryPeak = Math.max(memoryPeak, p.memoryUsed);
    filesystemPeak = Math.max(filesystemPeak, p.filesystemUsed);
  }

  const last = points[points.length - 1];

  return {
    cpuAvg: cpuSum / points.length,
    cpuPeak,
    memoryPeak,
    memoryLimit: last.memoryLimit,
    filesystemPeak,
    filesystemLimit: last.filesystemLimit,
    networkTotalReceive: last.networkReceive,
    networkTotalTransmit: last.networkTransmit,
  };
}

function deriveSampleInterval(points: ResourceUsagePoint[]): number {
  if (points.length < 2) return 5;
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(points.length, 10); i++) {
    intervals.push((points[i].timestamp - points[i - 1].timestamp) / 1000);
  }
  return Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
}

export const getJobResourceUsage = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ traceId: z.string(), jobId: z.string() }))
  .handler(
    async ({
      data: { traceId, jobId },
      context: { clickhouse },
    }): Promise<JobResourceUsage | null> => {
      const identifierSql = `
      SELECT
        anyLast(ResourceAttributes['cicd.pipeline.run.id']) as runId,
        anyLast(ResourceAttributes['cicd.pipeline.task.name']) as jobName
      FROM traces
      WHERE TraceId = {traceId:String}
        AND ResourceAttributes['cicd.pipeline.task.run.id'] = {jobId:String}
    `;

      const identifierRows = await clickhouse.query<{
        runId: string;
        jobName: string;
      }>(identifierSql, { traceId, jobId });

      const ids = resolveJobIdentifiers(identifierRows);
      if (!ids || !ids.runId || !ids.jobName) return null;

      const metricsSql = `
      SELECT
        MetricName as metricName,
        toUnixTimestamp64Milli(TimeUnix) as timestamp,
        Value as value,
        Attributes['cpu.logical_number'] as cpuLogicalNumber,
        Attributes['system.memory.state'] as memoryState,
        Attributes['system.filesystem.state'] as filesystemState,
        Attributes['network.io.direction'] as networkDirection,
        Attributes['network.interface.name'] as networkInterface
      FROM metrics_gauge
      WHERE ResourceAttributes['cicd.pipeline.run.id'] = {runId:String}
        AND Attributes['cicd.pipeline.task.name'] = {jobName:String}
        AND MetricName IN ('system.cpu.utilization', 'system.memory.utilization', 'system.filesystem.utilization')

      UNION ALL

      SELECT
        MetricName as metricName,
        toUnixTimestamp64Milli(TimeUnix) as timestamp,
        Value as value,
        '' as cpuLogicalNumber,
        Attributes['system.memory.state'] as memoryState,
        Attributes['system.filesystem.state'] as filesystemState,
        Attributes['network.io.direction'] as networkDirection,
        Attributes['network.interface.name'] as networkInterface
      FROM metrics_sum
      WHERE ResourceAttributes['cicd.pipeline.run.id'] = {runId:String}
        AND Attributes['cicd.pipeline.task.name'] = {jobName:String}
        AND MetricName IN ('system.memory.limit', 'system.memory.usage', 'system.filesystem.limit', 'system.filesystem.usage', 'system.network.io')

      ORDER BY timestamp
    `;

      const metricRows = await clickhouse.query<RawMetricRow>(metricsSql, {
        runId: ids.runId,
        jobName: ids.jobName,
      });

      if (metricRows.length === 0) return null;

      const points = aggregatePoints(metricRows);
      const summary = deriveSummary(points);
      const sampleIntervalSeconds = deriveSampleInterval(points);

      return { points, summary, sampleIntervalSeconds };
    },
  );

export const jobResourceUsageOptions = (input: {
  traceId: string;
  jobId: string;
}) =>
  queryOptions({
    queryKey: ["runs", "jobResourceUsage", input.traceId, input.jobId],
    queryFn: () => getJobResourceUsage({ data: input }),
  });
