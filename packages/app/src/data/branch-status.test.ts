import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import { getBranchStatus } from "./branch-status";

const mockedQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-06T10:02:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getBranchStatus", () => {
  it("returns pending when no matching runs exist", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as Awaited<
      ReturnType<typeof mockedQuery>
    >);

    const result = await getBranchStatus({
      tenantId: 42,
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("sha = $3");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("ref = $4");
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual([
      42,
      "everr-labs/everr",
      "7f14b13",
      "feature/watch-short-commit",
    ]);
    expect(result).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
      state: "pending",
      active: [],
      completed: [],
    });
  });

  it("returns running runs with active jobs for the given commit SHA", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            runId: "42",
            traceId: "trace-42",
            workflowName: "CI",
            status: "in_progress",
            conclusion: null,
            startedAt: "2026-03-06T10:00:00Z",
            completedAt: null,
            lastEventAt: "2026-03-06T10:01:00Z",
            attempts: 2,
          },
          {
            runId: "41",
            traceId: "trace-41",
            workflowName: "Lint",
            status: "completed",
            conclusion: "success",
            startedAt: "2026-03-06T09:58:01Z",
            completedAt: "2026-03-06T09:59:00Z",
            lastEventAt: "2026-03-06T09:59:00Z",
            attempts: 1,
          },
        ],
      } as Awaited<ReturnType<typeof mockedQuery>>)
      .mockResolvedValueOnce({
        rows: [
          { traceId: "trace-42", jobName: "lint", status: "queued" },
          { traceId: "trace-42", jobName: "test", status: "in_progress" },
        ],
      } as Awaited<ReturnType<typeof mockedQuery>>);

    const result = await getBranchStatus({
      tenantId: 42,
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const jobsQuerySql = mockedQuery.mock.calls[1]?.[0] as string;
    expect(jobsQuerySql).toContain("status != 'completed'");
    expect(result).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
      state: "running",
      active: [
        {
          traceId: "trace-42",
          runId: "42",
          workflowName: "CI",
          conclusion: null,
          startedAt: "2026-03-06T10:00:00.000Z",
          durationSeconds: null,
          activeJobs: ["lint", "test"],
          failingJobs: [],
        },
      ],
      completed: [
        {
          traceId: "trace-41",
          runId: "41",
          workflowName: "Lint",
          conclusion: "success",
          startedAt: "2026-03-06T09:58:01.000Z",
          durationSeconds: 59,
          activeJobs: [],
          failingJobs: [],
        },
      ],
    });
  });

  it("filters by attempt when provided", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as Awaited<
      ReturnType<typeof mockedQuery>
    >);

    await getBranchStatus({
      tenantId: 42,
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
      attempt: 2,
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("attempts = $5");
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual([
      42,
      "everr-labs/everr",
      "abc123",
      "main",
      2,
    ]);
  });

  it("keeps only the latest attempt per run and returns completed state", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          runId: "88",
          traceId: "trace-88-attempt-2",
          workflowName: "CI",
          status: "completed",
          conclusion: "success",
          startedAt: "2026-03-06T10:00:00Z",
          completedAt: "2026-03-06T10:01:01Z",
          lastEventAt: "2026-03-06T10:01:01Z",
          attempts: 2,
        },
        {
          runId: "88",
          traceId: "trace-88-attempt-1",
          workflowName: "CI",
          status: "completed",
          conclusion: "failure",
          startedAt: "2026-03-06T09:00:00Z",
          completedAt: "2026-03-06T09:01:00Z",
          lastEventAt: "2026-03-06T09:01:00Z",
          attempts: 1,
        },
      ],
    } as Awaited<ReturnType<typeof mockedQuery>>);

    const result = await getBranchStatus({
      tenantId: 42,
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
      state: "completed",
      active: [],
      completed: [
        {
          traceId: "trace-88-attempt-2",
          runId: "88",
          workflowName: "CI",
          conclusion: "success",
          startedAt: "2026-03-06T10:00:00.000Z",
          durationSeconds: 61,
          activeJobs: [],
          failingJobs: [],
        },
      ],
    });
  });
});
