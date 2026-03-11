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
import { getRunSpans } from "./runs";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("ResourceAttributes['everr.test.framework']");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("ResourceAttributes['everr.test.language']");
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
