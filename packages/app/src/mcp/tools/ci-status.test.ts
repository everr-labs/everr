import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getRunsList: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("@/data/runs-list", () => ({
  getRunsList: mocked.getRunsList,
}));

vi.mock("node:child_process", () => ({
  execFileSync: mocked.execFileSync,
}));

import { registerBranchStatusTools } from "./ci-status";

function createServerMock() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const server = {
    registerTool: vi.fn((name: string, ...rest: unknown[]) => {
      const handler = rest[rest.length - 1];
      if (typeof handler === "function") {
        handlers.set(name, handler as (...args: unknown[]) => Promise<unknown>);
      }
    }),
  };
  return { server, handlers };
}

describe("registerBranchStatusTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prepare_ci_status resolves context from local git", async () => {
    mocked.execFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd !== "git") {
        throw new Error("unexpected command");
      }
      if (args.join(" ") === "rev-parse --show-toplevel") {
        return "/tmp/repo\n";
      }
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
        return "feature/ci-tuning\n";
      }
      if (args.join(" ") === "config --get remote.origin.url") {
        return "git@github.com:acme/citric.git\n";
      }
      throw new Error(`unexpected args: ${args.join(" ")}`);
    });

    const { server, handlers } = createServerMock();
    registerBranchStatusTools(server as never);

    const handler = handlers.get("prepare_ci_status");
    const result = await handler?.({});
    const payload = JSON.parse(result?.content?.[0]?.text ?? "{}");

    expect(payload.ok).toBe(true);
    expect(payload.repo).toBe("acme/citric");
    expect(payload.branch).toBe("feature/ci-tuning");
    expect(payload.gitRoot).toBe("/tmp/repo");
    expect(result?.isError).toBeUndefined();
  });

  it("ci_status fails when repo/branch are unavailable", async () => {
    const { server, handlers } = createServerMock();
    registerBranchStatusTools(server as never);

    const handler = handlers.get("ci_status");
    const result = await handler?.({});
    const payload = JSON.parse(result?.content?.[0]?.text ?? "{}");

    expect(result?.isError).toBe(true);
    expect(payload.error).toContain("Missing required context");
    expect(mocked.getRunsList).not.toHaveBeenCalled();
  });

  it("reports failing pipelines from recent branch runs", async () => {
    const { server, handlers } = createServerMock();
    registerBranchStatusTools(server as never);

    mocked.getRunsList
      .mockResolvedValueOnce({
        runs: [
          {
            traceId: "t-1",
            runId: "101",
            runAttempt: 1,
            workflowName: "CI",
            repo: "acme/citric",
            branch: "feature/x",
            conclusion: "failure",
            duration: 220,
            timestamp: "2026-02-24T00:00:00.000Z",
            sender: "alice",
            jobCount: 5,
          },
        ],
        totalCount: 1,
      })
      .mockResolvedValueOnce({
        runs: [
          {
            traceId: "m-1",
            runId: "301",
            runAttempt: 1,
            workflowName: "CI",
            repo: "acme/citric",
            branch: "main",
            conclusion: "success",
            duration: 120,
            timestamp: "2026-02-24T00:00:00.000Z",
            sender: "bot",
            jobCount: 5,
          },
        ],
        totalCount: 1,
      })
      .mockResolvedValueOnce({ runs: [], totalCount: 0 });

    const handler = handlers.get("ci_status");
    const result = await handler?.({
      repo: "acme/citric",
      branch: "feature/x",
    });
    const payload = JSON.parse(result?.content?.[0]?.text ?? "{}");

    expect(payload.status).toBe("attention");
    expect(payload.failingPipelines).toHaveLength(1);
    expect(payload.failingPipelines[0].runId).toBe("101");
    expect(payload.message).toContain("failing pipeline");
  });

  it("reports slowdown when latest branch run is slower than main baselines", async () => {
    const { server, handlers } = createServerMock();
    registerBranchStatusTools(server as never);

    mocked.getRunsList
      .mockResolvedValueOnce({
        runs: [
          {
            traceId: "t-2",
            runId: "102",
            runAttempt: 1,
            workflowName: "CI",
            repo: "acme/citric",
            branch: "feature/y",
            conclusion: "success",
            duration: 240,
            timestamp: "2026-02-24T00:00:00.000Z",
            sender: "alice",
            jobCount: 5,
          },
        ],
        totalCount: 1,
      })
      .mockResolvedValueOnce({
        runs: [
          {
            traceId: "m-2",
            runId: "302",
            runAttempt: 1,
            workflowName: "CI",
            repo: "acme/citric",
            branch: "main",
            conclusion: "success",
            duration: 120,
            timestamp: "2026-02-24T00:00:00.000Z",
            sender: "bot",
            jobCount: 5,
          },
        ],
        totalCount: 1,
      })
      .mockResolvedValueOnce({
        runs: [
          {
            traceId: "m-older-1",
            runId: "303",
            runAttempt: 1,
            workflowName: "CI",
            repo: "acme/citric",
            branch: "main",
            conclusion: "success",
            duration: 100,
            timestamp: "2026-02-22T00:00:00.000Z",
            sender: "bot",
            jobCount: 5,
          },
        ],
        totalCount: 1,
      });

    const handler = handlers.get("ci_status");
    const result = await handler?.({
      repo: "acme/citric",
      branch: "feature/y",
      slowdownThresholdPct: 20,
    });
    const payload = JSON.parse(result?.content?.[0]?.text ?? "{}");

    expect(payload.status).toBe("attention");
    expect(payload.slowdown.detected).toBe(true);
    expect(payload.slowdown.slowdownVsRecentPct).toBeGreaterThan(20);
    expect(payload.message).toContain("slower");
  });

  it("returns ok and latest duration when no failures or slowdown", async () => {
    const { server, handlers } = createServerMock();
    registerBranchStatusTools(server as never);

    mocked.getRunsList
      .mockResolvedValueOnce({
        runs: [
          {
            traceId: "t-3",
            runId: "103",
            runAttempt: 1,
            workflowName: "CI",
            repo: "acme/citric",
            branch: "feature/z",
            conclusion: "success",
            duration: 110,
            timestamp: "2026-02-24T00:00:00.000Z",
            sender: "alice",
            jobCount: 5,
          },
        ],
        totalCount: 1,
      })
      .mockResolvedValueOnce({
        runs: [
          {
            traceId: "m-3",
            runId: "304",
            runAttempt: 1,
            workflowName: "CI",
            repo: "acme/citric",
            branch: "main",
            conclusion: "success",
            duration: 120,
            timestamp: "2026-02-24T00:00:00.000Z",
            sender: "bot",
            jobCount: 5,
          },
        ],
        totalCount: 1,
      })
      .mockResolvedValueOnce({
        runs: [
          {
            traceId: "m-older-2",
            runId: "305",
            runAttempt: 1,
            workflowName: "CI",
            repo: "acme/citric",
            branch: "main",
            conclusion: "success",
            duration: 115,
            timestamp: "2026-02-22T00:00:00.000Z",
            sender: "bot",
            jobCount: 5,
          },
        ],
        totalCount: 1,
      });

    const handler = handlers.get("ci_status");
    const result = await handler?.({
      repo: "acme/citric",
      branch: "feature/z",
      slowdownThresholdPct: 20,
    });
    const payload = JSON.parse(result?.content?.[0]?.text ?? "{}");

    expect(payload.status).toBe("ok");
    expect(payload.failingPipelines).toHaveLength(0);
    expect(payload.slowdown.detected).toBe(false);
    expect(payload.message).toContain("Everything looks good");
  });
});
