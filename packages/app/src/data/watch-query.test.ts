import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: vi.fn(() => ({
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  })),
}));

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const orderByResults: unknown[] = [];

vi.mock("@/db/client", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...fArgs: unknown[]) => {
          mockFrom(...fArgs);
          return {
            where: (...wArgs: unknown[]) => {
              mockWhere(...wArgs);
              return {
                orderBy: (...oArgs: unknown[]) => {
                  mockOrderBy(...oArgs);
                  return Promise.resolve(orderByResults.shift() ?? []);
                },
              };
            },
          };
        },
      };
    },
  },
}));

import { getWatchStatus } from "./watch";

beforeEach(() => {
  vi.clearAllMocks();
  orderByResults.length = 0;
});

describe("getWatchStatus", () => {
  it("returns empty result when no rows match", async () => {
    const result = await getWatchStatus({
      data: {
        tenantId: 7,
        repo: "everr-labs/everr",
        branch: "feature/watch-short-commit",
        commit: "7f14b13",
      },
    });

    expect(result).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
      pipelineFound: false,
      activeRuns: [],
      completedRuns: [],
    });

    // Should make 3 queries: runs, jobs, baselines
    expect(mockSelect).toHaveBeenCalledTimes(3);
  });

  it("returns all run attempts while keeping jobs matched to their attempt", async () => {
    orderByResults.push(
      [
        {
          tenantId: 7,
          runId: 88,
          runAttempt: 1,
          workflowName: "CI",
          metadata: {
            html_url: "https://github.com/everr-labs/everr/actions/runs/88",
          },
          status: "completed",
          conclusion: "success",
          lastEventAt: new Date("2026-03-06T10:01:00Z"),
          startedAt: new Date("2026-03-06T10:00:00Z"),
          completedAt: new Date("2026-03-06T10:01:00Z"),
        },
        {
          tenantId: 7,
          runId: 88,
          runAttempt: 2,
          workflowName: "CI",
          metadata: {
            html_url: "https://github.com/everr-labs/everr/actions/runs/88",
          },
          status: "in_progress",
          conclusion: null,
          lastEventAt: new Date("2026-03-06T10:03:00Z"),
          startedAt: new Date("2026-03-06T10:02:00Z"),
          completedAt: null,
        },
      ],
      [
        {
          tenantId: 7,
          jobId: 101,
          runId: 88,
          runAttempt: 1,
          jobName: "old-test",
          metadata: {
            html_url:
              "https://github.com/everr-labs/everr/actions/runs/88/job/101",
          },
          status: "completed",
          conclusion: "success",
          lastEventAt: new Date("2026-03-06T10:01:00Z"),
          startedAt: new Date("2026-03-06T10:00:00Z"),
          completedAt: new Date("2026-03-06T10:01:00Z"),
        },
        {
          tenantId: 7,
          jobId: 102,
          runId: 88,
          runAttempt: 2,
          jobName: "new-test",
          metadata: {
            html_url:
              "https://github.com/everr-labs/everr/actions/runs/88/job/102",
          },
          status: "in_progress",
          conclusion: null,
          lastEventAt: new Date("2026-03-06T10:03:00Z"),
          startedAt: new Date("2026-03-06T10:02:15Z"),
          completedAt: null,
        },
      ],
      [
        {
          workflowName: "CI",
          lastEventAt: new Date("2026-03-06T10:04:00Z"),
          startedAt: new Date("2026-03-06T10:02:02Z"),
          completedAt: new Date("2026-03-06T10:04:00Z"),
        },
        {
          workflowName: "CI",
          lastEventAt: new Date("2026-03-05T10:02:00Z"),
          startedAt: new Date("2026-03-05T10:00:00Z"),
          completedAt: new Date("2026-03-05T10:02:00Z"),
        },
        {
          workflowName: "CI",
          lastEventAt: new Date("2026-03-04T10:01:00Z"),
          startedAt: new Date("2026-03-04T09:59:00Z"),
          completedAt: new Date("2026-03-04T10:01:00Z"),
        },
      ],
    );

    const result = await getWatchStatus({
      data: {
        tenantId: 7,
        repo: "everr-labs/everr",
        branch: "feature/watch-short-commit",
        commit: "7f14b13",
      },
    });

    expect(result.pipelineFound).toBe(true);
    expect(result.activeRuns).toHaveLength(1);
    expect(result.completedRuns).toHaveLength(1);
    expect(result.activeRuns[0]).toMatchObject({
      runId: "88",
      runAttempt: 2,
      workflowName: "CI",
      htmlUrl: "https://github.com/everr-labs/everr/actions/runs/88",
      status: "in_progress",
      conclusion: null,
      activeJobs: ["new-test"],
      usualDurationSeconds: 119,
      usualDurationSampleSize: 3,
    });
    expect(result.completedRuns[0]).toMatchObject({
      runId: "88",
      runAttempt: 1,
      workflowName: "CI",
      htmlUrl: "https://github.com/everr-labs/everr/actions/runs/88",
      status: "completed",
      conclusion: "success",
      activeJobs: [],
      usualDurationSeconds: 119,
      usualDurationSampleSize: 3,
    });
  });

  it("limits baselines to the 3 most recent completed runs per workflow", async () => {
    orderByResults.push(
      [
        {
          tenantId: 7,
          runId: 88,
          runAttempt: 2,
          workflowName: "CI",
          metadata: {
            html_url: "https://github.com/everr-labs/everr/actions/runs/88",
          },
          status: "in_progress",
          conclusion: null,
          lastEventAt: new Date("2026-03-06T10:03:00Z"),
          startedAt: new Date("2026-03-06T10:02:00Z"),
          completedAt: null,
        },
      ],
      [],
      [
        {
          workflowName: "CI",
          lastEventAt: new Date("2026-03-06T10:02:00Z"),
          startedAt: new Date("2026-03-06T10:00:00Z"),
          completedAt: new Date("2026-03-06T10:02:00Z"),
        },
        {
          workflowName: "CI",
          lastEventAt: new Date("2026-03-05T10:01:00Z"),
          startedAt: new Date("2026-03-05T10:00:00Z"),
          completedAt: new Date("2026-03-05T10:01:00Z"),
        },
        {
          workflowName: "CI",
          lastEventAt: new Date("2026-03-04T10:03:00Z"),
          startedAt: new Date("2026-03-04T10:01:00Z"),
          completedAt: new Date("2026-03-04T10:03:00Z"),
        },
        {
          workflowName: "CI",
          lastEventAt: new Date("2026-03-01T10:10:00Z"),
          startedAt: new Date("2026-03-01T09:40:00Z"),
          completedAt: new Date("2026-03-01T10:10:00Z"),
        },
      ],
    );

    const result = await getWatchStatus({
      data: {
        tenantId: 7,
        repo: "everr-labs/everr",
        branch: "feature/watch-short-commit",
        commit: "7f14b13",
      },
    });

    expect(result.activeRuns[0]).toMatchObject({
      usualDurationSeconds: 100,
      usualDurationSampleSize: 3,
    });
  });
});
