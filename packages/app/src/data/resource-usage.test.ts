import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: vi.fn(() => {
    const chain = {
      inputValidator: () => chain,
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    };
    return chain;
  }),
}));

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import {
  emptyRunResourceUsage,
  getJobResourceUsage,
  getRunResourceUsage,
} from "./resource-usage";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

function buildMetricRows(params: {
  checkRunId?: string;
  jobName: string;
  timestamp: number;
  cpuUtilization: number;
  memoryUsed: number;
  memoryLimit: number;
  filesystemUsed: number;
  filesystemLimit: number;
  networkReceive: number;
  networkTransmit: number;
}) {
  const checkRunId = params.checkRunId ?? "";
  const common = {
    cpuLogicalNumber: "",
    memoryState: "",
    filesystemState: "",
    networkDirection: "",
    networkInterface: "",
    checkRunId,
    jobName: params.jobName,
    timestamp: String(params.timestamp),
  };

  return [
    {
      ...common,
      metricName: "system.cpu.utilization",
      value: String(params.cpuUtilization / 100),
      cpuLogicalNumber: "0",
    },
    {
      ...common,
      metricName: "system.memory.limit",
      value: String(params.memoryLimit),
    },
    {
      ...common,
      metricName: "system.memory.usage",
      value: String(params.memoryUsed),
      memoryState: "used",
    },
    {
      ...common,
      metricName: "system.filesystem.limit",
      value: String(params.filesystemLimit),
    },
    {
      ...common,
      metricName: "system.filesystem.usage",
      value: String(params.filesystemUsed),
      filesystemState: "used",
    },
    {
      ...common,
      metricName: "system.network.io",
      value: String(params.networkReceive),
      networkDirection: "receive",
      networkInterface: "eth0",
    },
    {
      ...common,
      metricName: "system.network.io",
      value: String(params.networkTransmit),
      networkDirection: "transmit",
      networkInterface: "eth0",
    },
  ];
}

describe("getRunResourceUsage", () => {
  it("uses check run ids to keep duplicate job names isolated and derives step summaries", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          jobId: "job-a",
          jobName: "test",
          checkRunId: "100",
        },
        {
          jobId: "job-b",
          jobName: "test",
          checkRunId: "200",
        },
      ])
      .mockResolvedValueOnce([
        ...buildMetricRows({
          checkRunId: "100",
          jobName: "test",
          timestamp: 1_000,
          cpuUtilization: 40,
          memoryUsed: 400,
          memoryLimit: 1_000,
          filesystemUsed: 10,
          filesystemLimit: 100,
          networkReceive: 10,
          networkTransmit: 5,
        }),
        ...buildMetricRows({
          checkRunId: "100",
          jobName: "test",
          timestamp: 2_000,
          cpuUtilization: 60,
          memoryUsed: 600,
          memoryLimit: 1_000,
          filesystemUsed: 20,
          filesystemLimit: 100,
          networkReceive: 20,
          networkTransmit: 15,
        }),
        ...buildMetricRows({
          checkRunId: "200",
          jobName: "test",
          timestamp: 1_000,
          cpuUtilization: 20,
          memoryUsed: 200,
          memoryLimit: 900,
          filesystemUsed: 5,
          filesystemLimit: 90,
          networkReceive: 3,
          networkTransmit: 2,
        }),
        ...buildMetricRows({
          checkRunId: "200",
          jobName: "test",
          timestamp: 2_000,
          cpuUtilization: 30,
          memoryUsed: 300,
          memoryLimit: 900,
          filesystemUsed: 9,
          filesystemLimit: 90,
          networkReceive: 8,
          networkTransmit: 6,
        }),
      ]);

    const result = await getRunResourceUsage({
      traceId: "trace-1",
      runId: "run-1",
      runAttempt: 7,
      stepsByJobId: {
        "job-a": [
          {
            stepNumber: "1",
            name: "setup",
            conclusion: "success",
            duration: 500,
            startTime: 900,
            endTime: 1_500,
          },
          {
            stepNumber: "2",
            name: "test",
            conclusion: "success",
            duration: 500,
            startTime: 1_600,
            endTime: 2_100,
          },
          {
            stepNumber: "3",
            name: "cleanup",
            conclusion: "success",
            duration: 100,
            startTime: 1_200,
            endTime: 1_300,
          },
        ],
        "job-b": [
          {
            stepNumber: "1",
            name: "all",
            conclusion: "success",
            duration: 1_100,
            startTime: 900,
            endTime: 2_100,
          },
        ],
      },
    });

    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "ResourceAttributes['everr.github.workflow_run.run_attempt'] = {runAttempt:String}",
    );
    expect(mockedQuery.mock.calls[1]?.[1]).toMatchObject({
      runId: "run-1",
      runAttempt: "7",
    });

    expect(result.jobs["job-a"]).toEqual({
      sampleCount: 2,
      sampleIntervalSeconds: 1,
      summary: {
        cpuAvg: 50,
        cpuPeak: 60,
        memoryPeak: 600,
        memoryLimit: 1_000,
        filesystemIoAvg: 10,
        filesystemIoMax: 10,
        networkIoAvg: 20,
        networkIoMax: 20,
      },
    });
    expect(result.jobs["job-b"]).toEqual({
      sampleCount: 2,
      sampleIntervalSeconds: 1,
      summary: {
        cpuAvg: 25,
        cpuPeak: 30,
        memoryPeak: 300,
        memoryLimit: 900,
        filesystemIoAvg: 4,
        filesystemIoMax: 4,
        networkIoAvg: 9,
        networkIoMax: 9,
      },
    });

    expect(result.steps["job-a"]).toEqual({
      "1": {
        sampleCount: 1,
        summary: {
          cpuAvg: 40,
          cpuPeak: 40,
          memoryPeak: 400,
          memoryLimit: 1_000,
          filesystemIoAvg: 0,
          filesystemIoMax: 0,
          networkIoAvg: 0,
          networkIoMax: 0,
        },
      },
      "2": {
        sampleCount: 1,
        summary: {
          cpuAvg: 60,
          cpuPeak: 60,
          memoryPeak: 600,
          memoryLimit: 1_000,
          filesystemIoAvg: 10,
          filesystemIoMax: 10,
          networkIoAvg: 20,
          networkIoMax: 20,
        },
      },
    });
    expect(result.steps["job-b"]).toEqual({
      "1": {
        sampleCount: 2,
        summary: {
          cpuAvg: 25,
          cpuPeak: 30,
          memoryPeak: 300,
          memoryLimit: 900,
          filesystemIoAvg: 4,
          filesystemIoMax: 4,
          networkIoAvg: 9,
          networkIoMax: 9,
        },
      },
    });
    expect(result.steps["job-a"]?.["3"]).toBeUndefined();
  });

  it("falls back to job names when check run ids are missing", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          jobId: "job-a",
          jobName: "build",
          checkRunId: "",
        },
      ])
      .mockResolvedValueOnce([
        ...buildMetricRows({
          jobName: "build",
          timestamp: 1_000,
          cpuUtilization: 50,
          memoryUsed: 256,
          memoryLimit: 512,
          filesystemUsed: 10,
          filesystemLimit: 100,
          networkReceive: 4,
          networkTransmit: 3,
        }),
      ]);

    const result = await getRunResourceUsage({
      traceId: "trace-1",
      runId: "run-1",
      runAttempt: 2,
      stepsByJobId: {},
    });

    expect(result).toEqual({
      jobs: {
        "job-a": {
          sampleCount: 1,
          sampleIntervalSeconds: 5,
          summary: {
            cpuAvg: 50,
            cpuPeak: 50,
            memoryPeak: 256,
            memoryLimit: 512,
            filesystemIoAvg: 0,
            filesystemIoMax: 0,
            networkIoAvg: 0,
            networkIoMax: 0,
          },
        },
      },
      steps: {},
    });
  });

  it("drops ambiguous name-based fallback matches", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          jobId: "job-a",
          jobName: "build",
          checkRunId: "",
        },
        {
          jobId: "job-b",
          jobName: "build",
          checkRunId: "",
        },
      ])
      .mockResolvedValueOnce([
        ...buildMetricRows({
          jobName: "build",
          timestamp: 1_000,
          cpuUtilization: 50,
          memoryUsed: 256,
          memoryLimit: 512,
          filesystemUsed: 10,
          filesystemLimit: 100,
          networkReceive: 4,
          networkTransmit: 3,
        }),
      ]);

    const result = await getRunResourceUsage({
      traceId: "trace-1",
      runId: "run-1",
      runAttempt: 2,
      stepsByJobId: {},
    });

    expect(result).toEqual(emptyRunResourceUsage());
  });

  it("returns empty usage when no metrics exist for the run", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          jobId: "job-a",
          jobName: "build",
          checkRunId: "100",
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getRunResourceUsage({
      traceId: "trace-1",
      runId: "run-1",
      runAttempt: 2,
      stepsByJobId: {},
    });

    expect(result).toEqual(emptyRunResourceUsage());
  });

  it("assigns a boundary sample to the next step and keeps step network totals local", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          jobId: "job-a",
          jobName: "build",
          checkRunId: "100",
        },
      ])
      .mockResolvedValueOnce([
        ...buildMetricRows({
          checkRunId: "100",
          jobName: "build",
          timestamp: 1_000,
          cpuUtilization: 20,
          memoryUsed: 200,
          memoryLimit: 1_000,
          filesystemUsed: 10,
          filesystemLimit: 100,
          networkReceive: 10,
          networkTransmit: 6,
        }),
        ...buildMetricRows({
          checkRunId: "100",
          jobName: "build",
          timestamp: 1_500,
          cpuUtilization: 80,
          memoryUsed: 300,
          memoryLimit: 1_000,
          filesystemUsed: 20,
          filesystemLimit: 100,
          networkReceive: 15,
          networkTransmit: 10,
        }),
      ]);

    const result = await getRunResourceUsage({
      traceId: "trace-1",
      runId: "run-1",
      runAttempt: 3,
      stepsByJobId: {
        "job-a": [
          {
            stepNumber: "1",
            name: "setup",
            conclusion: "success",
            duration: 500,
            startTime: 900,
            endTime: 1_500,
          },
          {
            stepNumber: "2",
            name: "test",
            conclusion: "success",
            duration: 500,
            startTime: 1_500,
            endTime: 2_000,
          },
        ],
      },
    });

    expect(result.steps["job-a"]).toEqual({
      "1": {
        sampleCount: 1,
        summary: {
          cpuAvg: 20,
          cpuPeak: 20,
          memoryPeak: 200,
          memoryLimit: 1_000,
          filesystemIoAvg: 0,
          filesystemIoMax: 0,
          networkIoAvg: 0,
          networkIoMax: 0,
        },
      },
      "2": {
        sampleCount: 1,
        summary: {
          cpuAvg: 80,
          cpuPeak: 80,
          memoryPeak: 300,
          memoryLimit: 1_000,
          filesystemIoAvg: 20,
          filesystemIoMax: 20,
          networkIoAvg: 18,
          networkIoMax: 18,
        },
      },
    });
  });
});

describe("getJobResourceUsage", () => {
  it("uses check run ids when they are available on the trace", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          runId: "run-1",
          runAttempt: "4",
          jobName: "build",
          checkRunId: "101",
        },
      ])
      .mockResolvedValueOnce([
        ...buildMetricRows({
          checkRunId: "101",
          jobName: "build",
          timestamp: 1_000,
          cpuUtilization: 75,
          memoryUsed: 300,
          memoryLimit: 1_024,
          filesystemUsed: 20,
          filesystemLimit: 100,
          networkReceive: 12,
          networkTransmit: 8,
        }),
      ]);

    const result = await getJobResourceUsage({
      data: { traceId: "trace-1", jobId: "job-1" },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "ResourceAttributes['everr.github.workflow_run.run_attempt'] = {runAttempt:String}",
    );
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "Attributes['everr.resource_usage.check_run_id'] = {checkRunId:String}",
    );
    expect(mockedQuery.mock.calls[1]?.[1]).toMatchObject({
      runId: "run-1",
      runAttempt: "4",
      checkRunId: "101",
    });
    expect(result).toEqual({
      points: [
        {
          timestamp: 1_000,
          cpuAvg: 75,
          cpuMax: 75,
          memoryUsed: 300,
          memoryLimit: 1_024,
          memoryUtilization: 0,
          filesystemUsed: 20,
          filesystemLimit: 100,
          filesystemUtilization: 0,
          networkReceive: 12,
          networkTransmit: 8,
        },
      ],
      sampleIntervalSeconds: 5,
      summary: {
        cpuAvg: 75,
        cpuPeak: 75,
        memoryPeak: 300,
        memoryLimit: 1_024,
        filesystemIoAvg: 0,
        filesystemIoMax: 0,
        networkIoAvg: 0,
        networkIoMax: 0,
      },
    });
  });
});
