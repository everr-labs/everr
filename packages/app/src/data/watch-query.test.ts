import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import { getWatchStatus } from "./watch";

const mockedQuery = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-06T10:02:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getWatchStatus", () => {
  it("returns pending when no matching runs exist", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as Awaited<
      ReturnType<typeof mockedQuery>
    >);

    const result = await getWatchStatus({
      tenantId: 42,
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("sha = $4");
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual([
      42,
      "everr-labs/everr",
      "feature/watch-short-commit",
      "7f14b13",
    ]);
    expect(result).toEqual({
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
          {
            runId: "100",
            traceId: "trace-100",
            workflowName: "CI",
            status: "completed",
            conclusion: "success",
            startedAt: "2026-03-05T10:00:00Z",
            completedAt: "2026-03-05T10:01:58Z",
            lastEventAt: "2026-03-05T10:01:58Z",
            attempts: 1,
          },
          {
            runId: "101",
            traceId: "trace-101",
            workflowName: "CI",
            status: "completed",
            conclusion: "success",
            startedAt: "2026-03-04T10:00:00Z",
            completedAt: "2026-03-04T10:01:58Z",
            lastEventAt: "2026-03-04T10:01:58Z",
            attempts: 1,
          },
          {
            runId: "102",
            traceId: "trace-102",
            workflowName: "CI",
            status: "completed",
            conclusion: "success",
            startedAt: "2026-03-03T10:00:00Z",
            completedAt: "2026-03-03T10:01:58Z",
            lastEventAt: "2026-03-03T10:01:58Z",
            attempts: 1,
          },
        ],
      } as Awaited<ReturnType<typeof mockedQuery>>)
      .mockResolvedValueOnce({
        rows: [
          { traceId: "trace-42", jobName: "lint", status: "queued" },
          { traceId: "trace-42", jobName: "test", status: "in_progress" },
          { traceId: "trace-42", jobName: "build", status: "completed" },
        ],
      } as Awaited<ReturnType<typeof mockedQuery>>);

    const result = await getWatchStatus({
      tenantId: 42,
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
    });

    expect(mockedQuery).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      state: "running",
      active: [
        {
          runId: "42",
          workflowName: "CI",
          conclusion: null,
          startedAt: "2026-03-06T10:00:00.000Z",
          durationSeconds: null,
          expectedDurationSeconds: 118,
          activeJobs: ["lint", "test"],
        },
      ],
      completed: [
        {
          runId: "41",
          workflowName: "Lint",
          conclusion: "success",
          startedAt: "2026-03-06T09:58:01.000Z",
          durationSeconds: 59,
          expectedDurationSeconds: null,
          activeJobs: [],
        },
      ],
    });
  });

  it("keeps only the latest attempt per run and returns completed state", async () => {
    mockedQuery
      .mockResolvedValueOnce({
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
      } as Awaited<ReturnType<typeof mockedQuery>>)
      .mockResolvedValueOnce({
        rows: [],
      } as Awaited<ReturnType<typeof mockedQuery>>);

    const result = await getWatchStatus({
      tenantId: 42,
      repo: "everr-labs/everr",
      branch: "main",
      commit: "abc123",
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      state: "completed",
      active: [],
      completed: [
        {
          runId: "88",
          workflowName: "CI",
          conclusion: "success",
          startedAt: "2026-03-06T10:00:00.000Z",
          durationSeconds: 61,
          expectedDurationSeconds: null,
          activeJobs: [],
        },
      ],
    });
  });
});
