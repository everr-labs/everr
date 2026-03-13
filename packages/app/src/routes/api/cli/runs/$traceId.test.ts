import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/runs", () => ({
  getAllJobsSteps: vi.fn(),
  getRunDetails: vi.fn(),
  getRunJobs: vi.fn(),
}));

vi.mock("@/data/resource-usage", () => ({
  emptyRunResourceUsage: vi.fn(() => ({
    jobs: {},
    steps: {},
  })),
  getRunResourceUsage: vi.fn(),
}));

vi.mock("../-auth", () => ({
  cliAuthMiddleware: {
    options: {},
  },
}));

import { getRunResourceUsage } from "@/data/resource-usage";
import { getAllJobsSteps, getRunDetails, getRunJobs } from "@/data/runs";
import { Route } from "./$traceId";

const mockedGetAllJobsSteps = vi.mocked(getAllJobsSteps);
const mockedGetRunDetails = vi.mocked(getRunDetails);
const mockedGetRunJobs = vi.mocked(getRunJobs);
const mockedGetRunResourceUsage = vi.mocked(getRunResourceUsage);

type GetHandler = (args: {
  params: {
    traceId?: string;
  };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: {
      handlers?: {
        GET?: GetHandler;
      };
    };
  };

  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) {
    throw new Error("Missing GET handler for runs/$traceId route.");
  }

  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/runs/$traceId", () => {
  it("returns run details with runner metadata and aggregated resource usage", async () => {
    mockedGetRunDetails.mockResolvedValue({
      traceId: "trace-123",
      runId: "run-123",
      runAttempt: 1,
      repo: "everr-labs/everr",
      branch: "main",
      conclusion: "success",
      workflowName: "Build",
      timestamp: "2026-03-11T10:00:00.000Z",
    });
    mockedGetRunJobs.mockResolvedValue([
      {
        jobId: "job-1",
        name: "build",
        conclusion: "success",
        duration: 1_000,
        runnerName: "GitHub Actions 4",
        runnerLabels: "ubuntu-latest,linux",
        runnerTier: "Linux 2-core",
      },
    ]);
    mockedGetAllJobsSteps.mockResolvedValue({
      "job-1": [
        {
          stepNumber: "1",
          name: "Compile",
          conclusion: "success",
          duration: 500,
          startTime: 1_000,
          endTime: 1_500,
        },
      ],
    });
    mockedGetRunResourceUsage.mockResolvedValue({
      jobs: {
        "job-1": {
          sampleCount: 2,
          sampleIntervalSeconds: 5,
          summary: {
            cpuAvg: 42,
            cpuPeak: 80,
            memoryPeak: 512,
            memoryLimit: 1_024,
            filesystemIoAvg: 10,
            filesystemIoMax: 20,
            networkIoAvg: 20,
            networkIoMax: 20,
          },
        },
      },
      steps: {
        "job-1": {
          "1": {
            sampleCount: 1,
            summary: {
              cpuAvg: 42,
              cpuPeak: 80,
              memoryPeak: 512,
              memoryLimit: 1_024,
              filesystemIoAvg: 10,
              filesystemIoMax: 20,
              networkIoAvg: 20,
              networkIoMax: 20,
            },
          },
        },
      },
    });

    const response = await getHandler()({
      params: { traceId: "trace-123" },
    });

    expect(response.status).toBe(200);
    expect(mockedGetRunResourceUsage).toHaveBeenCalledWith({
      traceId: "trace-123",
      runId: "run-123",
      runAttempt: 1,
      stepsByJobId: {
        "job-1": [
          {
            stepNumber: "1",
            name: "Compile",
            conclusion: "success",
            duration: 500,
            startTime: 1_000,
            endTime: 1_500,
          },
        ],
      },
    });
    expect(await response.json()).toEqual({
      run: {
        traceId: "trace-123",
        runId: "run-123",
        runAttempt: 1,
        repo: "everr-labs/everr",
        branch: "main",
        conclusion: "success",
        workflowName: "Build",
        timestamp: "2026-03-11T10:00:00.000Z",
      },
      jobs: [
        {
          jobId: "job-1",
          name: "build",
          conclusion: "success",
          duration: 1_000,
          runnerName: "GitHub Actions 4",
          runnerLabels: "ubuntu-latest,linux",
          runnerTier: "Linux 2-core",
        },
      ],
      steps: {
        "job-1": [
          {
            stepNumber: "1",
            name: "Compile",
            conclusion: "success",
            duration: 500,
            startTime: 1_000,
            endTime: 1_500,
          },
        ],
      },
      resourceUsage: {
        jobs: {
          "job-1": {
            cpuAvg: 42,
            cpuPeak: 80,
            memoryPeak: 512,
            memoryLimit: 1_024,
            filesystemIoAvg: 10,
            filesystemIoMax: 20,
            networkIoAvg: 20,
            networkIoMax: 20,
          },
        },
        steps: {
          "job-1": {
            "1": {
              cpuAvg: 42,
              cpuPeak: 80,
              memoryPeak: 512,
              memoryLimit: 1_024,
              filesystemIoAvg: 10,
              filesystemIoMax: 20,
              networkIoAvg: 20,
              networkIoMax: 20,
            },
          },
        },
      },
    });
  });

  it("returns not found when the trace id does not resolve to a run", async () => {
    mockedGetRunDetails.mockResolvedValue(null);
    mockedGetRunJobs.mockResolvedValue([]);

    const response = await getHandler()({
      params: { traceId: "trace-404" },
    });

    expect(response.status).toBe(404);
    expect(mockedGetRunResourceUsage).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "Run not found" });
  });
});
