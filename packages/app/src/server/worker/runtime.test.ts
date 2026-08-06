// @vitest-environment node
import type { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

type MockRunOptions = {
  concurrency: number;
  events: EventEmitter;
  noHandleSignals: boolean;
  pgPool: unknown;
  taskList: Record<string, unknown>;
};

const runtimeMocks = vi.hoisted(() => {
  const runOptions: MockRunOptions[] = [];
  return {
    githubEventsTaskList: {
      "github-events/collector": vi.fn(),
      "github-events/status": vi.fn(),
    },
    pool: { query: vi.fn() },
    previewsCronItems: [{ task: "previews/retention" }],
    previewsTaskList: { "previews/retention": vi.fn() },
    run: vi.fn(async (options: MockRunOptions) => {
      runOptions.push(options);
      return {
        events: options.events,
        promise: Promise.resolve(),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    }),
    runOptions,
    serverLoggerError: vi.fn(),
    serverLoggerInfo: vi.fn(),
  };
});

vi.mock("graphile-worker", () => ({
  parseCronItems: (items: unknown[]) => items,
  run: runtimeMocks.run,
}));

vi.mock("@/server/github-events/tasks", () => ({
  githubEventsTaskList: runtimeMocks.githubEventsTaskList,
}));

vi.mock("@/server/previews/00-runtime", () => ({
  previewsCronItems: runtimeMocks.previewsCronItems,
  previewsTaskList: runtimeMocks.previewsTaskList,
}));

vi.mock("@/db/client", () => ({
  db: {},
  pool: runtimeMocks.pool,
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    return {
      "exception.message": error.message,
      "exception.type": error.name,
    };
  },
  errorMessage: (reason: unknown) =>
    reason instanceof Error ? reason.message : String(reason),
  serverLogger: {
    error: runtimeMocks.serverLoggerError,
    info: runtimeMocks.serverLoggerInfo,
  },
}));

async function loadRuntime() {
  vi.resetModules();
  // The runner handle deliberately lives on the hot-singleton registry on
  // globalThis to survive HMR module replacement; tests need each import to
  // start from a clean slate.
  delete (globalThis as { __everrHotSingletons?: unknown })
    .__everrHotSingletons;
  runtimeMocks.run.mockClear();
  runtimeMocks.runOptions.length = 0;
  runtimeMocks.serverLoggerError.mockClear();
  runtimeMocks.serverLoggerInfo.mockClear();
  return import("./runtime");
}

describe("worker runtime", () => {
  it("starts the Graphile Worker runner with the composed task list", async () => {
    const runtime = await loadRuntime();

    expect(runtimeMocks.run).not.toHaveBeenCalled();

    await runtime.startWorkerRuntime();

    expect(runtimeMocks.serverLoggerInfo).toHaveBeenCalledWith(
      "worker.runtime.start",
    );
    expect(runtimeMocks.run).toHaveBeenCalledOnce();
    expect(runtimeMocks.runOptions[0]).toMatchObject({
      concurrency: 2,
      noHandleSignals: true,
      pgPool: runtimeMocks.pool,
      parsedCronItems: expect.arrayContaining([
        expect.objectContaining({ task: "alerts/scan" }),
        ...runtimeMocks.previewsCronItems,
      ]),
    });
    expect(Object.keys(runtimeMocks.runOptions[0].taskList).sort()).toEqual([
      "alerts/evaluate",
      "alerts/evaluate-slo",
      "alerts/flush-group",
      "alerts/process-event",
      "alerts/scan",
      "alerts/send-delivery",
      "github-events/collector",
      "github-events/status",
      "previews/retention",
    ]);
  });

  it("memoizes the runner across calls", async () => {
    const runtime = await loadRuntime();

    const first = await runtime.startWorkerRuntime();
    const second = await runtime.startWorkerRuntime();

    expect(runtimeMocks.run).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  it("logs meaningful Graphile Worker runner failures", async () => {
    const runtime = await loadRuntime();
    await runtime.startWorkerRuntime();

    const error = new Error("listen failed");
    runtimeMocks.runOptions[0].events.emit("pool:listen:error", {
      client: {},
      error,
      workerPool: {},
    });

    expect(runtimeMocks.serverLoggerError).toHaveBeenCalledWith(
      "worker.jobs.pool_listen_error",
      expect.objectContaining({
        "exception.message": "listen failed",
        "exception.type": "Error",
      }),
    );
  });

  it("logs successful worker jobs with duration", async () => {
    const runtime = await loadRuntime();
    await runtime.startWorkerRuntime();

    const worker = { workerId: "worker-test" };
    const job = {
      attempts: 1,
      id: "18001",
      max_attempts: 25,
      task_identifier: "github-events/collector",
    };

    runtimeMocks.runOptions[0].events.emit("job:start", { job, worker });
    runtimeMocks.runOptions[0].events.emit("job:success", { job, worker });

    expect(runtimeMocks.serverLoggerInfo).toHaveBeenLastCalledWith(
      "worker.jobs.job_completed",
      expect.objectContaining({
        "graphile_worker.job.attempts": 1,
        "graphile_worker.job.duration_ms": expect.any(Number),
        "graphile_worker.job.id": "18001",
        "graphile_worker.job.max_attempts": 25,
        "graphile_worker.job.name": "github-events/collector",
        "graphile_worker.task.identifier": "github-events/collector",
        "graphile_worker.worker.id": "worker-test",
      }),
    );
  });
});
