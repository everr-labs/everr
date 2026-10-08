// @vitest-environment node
import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    pool: { query: vi.fn(), options: { host: "database", max: 10 } },
    organizationPool: {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      end: vi.fn().mockResolvedValue(undefined),
    },
    poolOptions: [] as unknown[],
    runners: [] as { stop: ReturnType<typeof vi.fn> }[],
    previewsCronItems: [{ task: "previews/retention" }],
    previewsTaskList: { "previews/retention": vi.fn() },
    run: vi.fn(async (options: MockRunOptions) => {
      runOptions.push(options);
      const runner = {
        events: options.events,
        promise: new Promise<void>(() => {}),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      runtimeMocks.runners.push(runner);
      return runner;
    }),
    runOptions,
    serverLoggerError: vi.fn(),
    serverLoggerInfo: vi.fn(),
  };
});

vi.mock("pg", () => ({
  Pool: class {
    query = runtimeMocks.organizationPool.query;
    end = runtimeMocks.organizationPool.end;
    constructor(options: unknown) {
      runtimeMocks.poolOptions.push(options);
    }
  },
}));

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
  databasePoolConfig: {
    host: "database",
    password: "test-password",
    connectionTimeoutMillis: 10_000,
  },
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

let activeRuntime:
  | Awaited<ReturnType<typeof import("./runtime")["startWorkerRuntime"]>>
  | undefined;
afterEach(async () => {
  await activeRuntime?.stop();
  activeRuntime = undefined;
});

async function loadRuntime() {
  vi.resetModules();
  // The runner handle deliberately lives on the hot-singleton registry on
  // globalThis to survive HMR module replacement; tests need each import to
  // start from a clean slate.
  delete (globalThis as { __everrHotSingletons?: unknown })
    .__everrHotSingletons;
  runtimeMocks.run.mockClear();
  runtimeMocks.runOptions.length = 0;
  runtimeMocks.runners.length = 0;
  runtimeMocks.poolOptions.length = 0;
  runtimeMocks.organizationPool.query.mockClear();
  runtimeMocks.organizationPool.end.mockClear();
  runtimeMocks.serverLoggerError.mockClear();
  runtimeMocks.serverLoggerInfo.mockClear();
  const runtime = await import("./runtime");
  return {
    startWorkerRuntime: async () => {
      activeRuntime = await runtime.startWorkerRuntime();
      return activeRuntime;
    },
  };
}

describe("worker runtime", () => {
  it("reserves a separate runner and database pool for organization lifecycle jobs", async () => {
    const runtime = await loadRuntime();

    expect(runtimeMocks.run).not.toHaveBeenCalled();

    await runtime.startWorkerRuntime();

    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.runOptions[0]).toMatchObject({
      concurrency: 2,
      noHandleSignals: true,
      pgPool: runtimeMocks.pool,
      parsedCronItems: expect.arrayContaining([
        expect.objectContaining({ task: "alerts/scan" }),
        expect.objectContaining({ task: "alerts/retention" }),
        ...runtimeMocks.previewsCronItems,
      ]),
    });
    expect(Object.keys(runtimeMocks.runOptions[0].taskList).sort()).toEqual([
      "alerts/evaluate",
      "alerts/flush-group",
      "alerts/process-event",
      "alerts/project-lifecycle",
      "alerts/retention",
      "alerts/scan",
      "alerts/send-delivery",
      "github-events/collector",
      "github-events/status",
      "previews/retention",
    ]);
    expect(runtimeMocks.runOptions[1]).toMatchObject({
      concurrency: 2,
      noHandleSignals: true,
      pgPool: runtimeMocks.organizationPool,
      parsedCronItems: [
        expect.objectContaining({
          task: "clickhouse/scan-pending-organizations",
        }),
      ],
    });
    expect(Object.keys(runtimeMocks.runOptions[1].taskList).sort()).toEqual([
      "clickhouse/deprovision-organization",
      "clickhouse/provision-organization",
      "clickhouse/scan-pending-organizations",
    ]);
    expect(runtimeMocks.poolOptions).toEqual([
      {
        host: "database",
        password: "test-password",
        connectionTimeoutMillis: 10_000,
        max: 4,
      },
    ]);
    expect(runtimeMocks.organizationPool.query).toHaveBeenCalledOnce();
  });

  it("memoizes the runner across calls", async () => {
    const runtime = await loadRuntime();

    const first = await runtime.startWorkerRuntime();
    const second = await runtime.startWorkerRuntime();

    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
    expect(second).toBeDefined();
    expect(first).toBeDefined();
  });

  it("stops both runners and closes the reserved pool", async () => {
    const runtime = await loadRuntime();
    const handle = await runtime.startWorkerRuntime();
    await handle.stop();
    for (const runner of runtimeMocks.runners)
      expect(runner.stop).toHaveBeenCalledOnce();
    expect(runtimeMocks.organizationPool.end).toHaveBeenCalledOnce();
  });

  it("keeps the organization worker alive when the general worker cannot start", async () => {
    const runtime = await loadRuntime();
    runtimeMocks.run.mockRejectedValueOnce(
      new Error("Shared worker unavailable"),
    );
    await runtime.startWorkerRuntime();
    expect(runtimeMocks.serverLoggerError).toHaveBeenCalledWith(
      "worker.runtime.failed",
      expect.objectContaining({
        "exception.message": "Shared worker unavailable",
        "everr.worker.pool": "everrGeneralWorker",
      }),
    );
    expect(runtimeMocks.runners[0].stop).not.toHaveBeenCalled();
    expect(runtimeMocks.organizationPool.end).not.toHaveBeenCalled();
  });

  it("keeps both workers alive if recovery of old retry schedules fails", async () => {
    const runtime = await loadRuntime();
    runtimeMocks.organizationPool.query.mockRejectedValueOnce(
      new Error("Could not recover retries"),
    );
    await runtime.startWorkerRuntime();
    await Promise.resolve();
    expect(runtimeMocks.serverLoggerError).toHaveBeenCalledWith(
      "clickhouse.organization.retry_recovery.failed",
      expect.objectContaining({
        "exception.message": "Could not recover retries",
      }),
    );
    for (const runner of runtimeMocks.runners)
      expect(runner.stop).not.toHaveBeenCalled();
    expect(runtimeMocks.organizationPool.end).not.toHaveBeenCalled();
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
