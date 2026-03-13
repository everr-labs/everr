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
import { getRunDetails, getRunJobs, getRunSpans, getStepLogs } from "./runs";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRunJobs", () => {
  it("uses a Float64 zero for skipped job durations", async () => {
    mockedQuery.mockResolvedValue([
      {
        jobId: "job-1",
        name: "build",
        conclusion: "success",
        runnerName: "",
        runnerLabels: "",
        duration: "1200",
      },
    ]);

    const result = await getRunJobs({ data: "trace-1" });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("toFloat64(0)");
    expect(result).toEqual([
      {
        jobId: "job-1",
        name: "build",
        conclusion: "success",
        duration: 1200,
        runnerName: undefined,
        runnerLabels: undefined,
        runnerTier: "Unknown",
      },
    ]);
  });
});

describe("getRunSpans", () => {
  it("maps the isSuite attribute when present", async () => {
    mockedQuery.mockResolvedValue([
      {
        spanId: "suite-span",
        parentSpanId: "step-span",
        name: "formatDuration",
        startTime: "1000",
        endTime: "2000",
        duration: "1000",
        conclusion: "",
        jobId: "job-1",
        jobName: "test",
        stepNumber: "3",
        createdAt: "",
        startedAt: "",
        headBranch: "",
        headSha: "",
        runnerName: "",
        labels: "",
        sender: "",
        runAttempt: "",
        htmlUrl: "",
        testName: "src/test.ts > formatDuration",
        testResult: "pass",
        testDuration: "1",
        testFramework: "vitest",
        testLanguage: "typescript",
        isSubtest: "1",
        isSuite: "true",
      },
    ]);

    const result = await getRunSpans({ data: "trace-1" });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("everr.test.is_suite");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "ResourceAttributes['everr.test.framework']",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "ResourceAttributes['everr.test.language']",
    );
    expect(result).toEqual([
      {
        spanId: "suite-span",
        parentSpanId: "step-span",
        name: "formatDuration",
        startTime: 1000,
        endTime: 2000,
        duration: 1000,
        conclusion: "success",
        jobId: "job-1",
        jobName: "test",
        stepNumber: "3",
        queueTime: undefined,
        headBranch: undefined,
        headSha: undefined,
        runnerName: undefined,
        labels: undefined,
        sender: undefined,
        runAttempt: undefined,
        htmlUrl: undefined,
        testName: "src/test.ts > formatDuration",
        testResult: "pass",
        testDuration: 1,
        testFramework: "vitest",
        testLanguage: "typescript",
        isSubtest: true,
        isSuite: true,
      },
    ]);
  });
});

describe("getRunJobs", () => {
  it("adds runner metadata and tier information to job summaries", async () => {
    mockedQuery.mockResolvedValue([
      {
        jobId: "job-1",
        name: "build",
        conclusion: "success",
        runnerName: "GitHub Actions 4",
        runnerLabels: "ubuntu-latest,linux",
        duration: "1200",
      },
      {
        jobId: "job-2",
        name: "deploy",
        conclusion: "success",
        runnerName: "",
        runnerLabels: "",
        duration: "800",
      },
    ]);

    const result = await getRunJobs({ data: "trace-1" });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("toFloat64(0)");
    expect(result).toEqual([
      {
        jobId: "job-1",
        name: "build",
        conclusion: "success",
        duration: 1200,
        runnerName: "GitHub Actions 4",
        runnerLabels: "ubuntu-latest,linux",
        runnerTier: "Linux 2-core",
      },
      {
        jobId: "job-2",
        name: "deploy",
        conclusion: "success",
        duration: 800,
        runnerName: undefined,
        runnerLabels: undefined,
        runnerTier: "Unknown",
      },
    ]);
  });
});

describe("getRunDetails", () => {
  it("prefers workflow run attempt and falls back to job attempt semantics in SQL", async () => {
    mockedQuery.mockResolvedValue([
      {
        run_id: "run-123",
        run_attempt: "4",
        repo: "everr-labs/everr",
        branch: "main",
        conclusion: "success",
        workflowName: "Build",
        timestamp: "2026-03-11 16:15:13.000000000",
      },
    ]);

    const result = await getRunDetails({ data: "trace-1" });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "everr.github.workflow_run.run_attempt",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "everr.github.workflow_job.run_attempt",
    );
    expect(result).toEqual({
      traceId: "trace-1",
      runId: "run-123",
      runAttempt: 4,
      repo: "everr-labs/everr",
      branch: "main",
      conclusion: "success",
      workflowName: "Build",
      timestamp: "2026-03-11 16:15:13.000000000",
    });
  });
});

describe("getStepLogs", () => {
  it("normalizes full log timestamps to timezone-aware UTC ISO strings", async () => {
    mockedQuery.mockResolvedValue([
      {
        timestamp: "2026-03-09 12:00:00.123",
        body: "Starting build",
      },
      {
        timestamp: "2026-03-09T12:00:01",
        body: "Compiling",
      },
    ]);

    const result = await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
        fullLogs: true,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        timestamp: "2026-03-09T12:00:00.123Z",
        body: "Starting build",
      },
      {
        timestamp: "2026-03-09T12:00:01.000Z",
        body: "Compiling",
      },
    ]);
  });

  it("normalizes focused failing log timestamps before returning them", async () => {
    mockedQuery.mockResolvedValueOnce([{ count: "1" }]).mockResolvedValueOnce([
      {
        timestamp: "2026-03-09 12:00:02",
        body: "##[error]Build failed",
      },
    ]);

    const result = await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
        fullLogs: false,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      {
        timestamp: "2026-03-09T12:00:02.000Z",
        body: "##[error]Build failed",
      },
    ]);
  });
});
