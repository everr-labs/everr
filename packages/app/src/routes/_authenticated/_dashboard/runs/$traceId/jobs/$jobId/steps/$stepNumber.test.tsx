import { describe, expect, it, vi } from "vitest";
import { stepLogsInfiniteOptions } from "./$stepNumber";

vi.mock("@/data/runs/server", () => ({
  getAllJobsSteps: vi.fn(),
  getRunDetails: vi.fn(),
  getRunJobs: vi.fn(),
  getRunSpans: vi.fn(),
  getStepLogs: vi.fn(),
}));

describe("stepLogsInfiniteOptions", () => {
  it("does not request another page when the last page is missing", () => {
    const options = stepLogsInfiniteOptions("trace-1", "build", "2");
    const getNextPageParam = options.getNextPageParam as (
      lastPage:
        | { logs: unknown[]; totalCount: number; offset: number }
        | undefined,
      allPages: { logs: unknown[]; totalCount: number; offset: number }[],
    ) => unknown;

    expect(getNextPageParam(undefined, [])).toBeUndefined();
  });
});
