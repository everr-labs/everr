import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getRunsList: vi.fn(),
  getRunDetails: vi.fn(),
  getRunJobs: vi.fn(),
  getAllJobsSteps: vi.fn(),
  getStepLogs: vi.fn(),
}));

vi.mock("@/data/runs-list", () => ({
  getRunsList: mocked.getRunsList,
}));

vi.mock("@/data/runs", () => ({
  getRunDetails: mocked.getRunDetails,
  getRunJobs: mocked.getRunJobs,
  getAllJobsSteps: mocked.getAllJobsSteps,
  getStepLogs: mocked.getStepLogs,
}));

import { registerRunsTools } from "./runs";

function createServerMock() {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const server = {
    registerTool: vi.fn((name: string, ...rest: unknown[]) => {
      const handler = rest[rest.length - 1];
      if (typeof handler === "function") {
        handlers.set(name, handler as (...args: any[]) => Promise<any>);
      }
    }),
  };
  return { server, handlers };
}

describe("registerRunsTools:get_step_logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps output shape and defaults to filtered mode", async () => {
    const { server, handlers } = createServerMock();
    mocked.getStepLogs.mockResolvedValue([
      { timestamp: "2026-02-24T00:00:00.000Z", body: "line one" },
    ]);

    registerRunsTools(server as never);

    const handler = handlers.get("get_step_logs");
    expect(handler).toBeDefined();

    const result = await handler?.({
      traceId: "trace-1",
      jobName: "build",
      stepNumber: "3",
    });

    expect(mocked.getStepLogs).toHaveBeenCalledWith({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "3",
        fullLogs: undefined,
      },
    });
    expect(result?.isError).toBeUndefined();
    expect(JSON.parse(result?.content?.[0]?.text ?? "[]")).toEqual([
      { timestamp: "2026-02-24T00:00:00.000Z", body: "line one" },
    ]);
  });

  it("passes fullLogs override through to data layer", async () => {
    const { server, handlers } = createServerMock();
    mocked.getStepLogs.mockResolvedValue([]);

    registerRunsTools(server as never);

    const handler = handlers.get("get_step_logs");
    await handler?.({
      traceId: "trace-2",
      jobName: "test",
      stepNumber: "7",
      fullLogs: true,
    });

    expect(mocked.getStepLogs).toHaveBeenCalledWith({
      data: {
        traceId: "trace-2",
        jobName: "test",
        stepNumber: "7",
        fullLogs: true,
      },
    });
  });
});
