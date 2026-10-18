// @vitest-environment node
import type { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

type MockRunOptions = {
  events: EventEmitter;
  taskList: Record<string, unknown>;
};
const runtimeMocks = vi.hoisted(() => ({
  githubEnabled: true,
  githubEventsTaskList: {
    "github-events/collector": vi.fn(),
    "github-events/status": vi.fn(),
  },
  previewsCronItems: [{ task: "previews/retention" }],
  previewsTaskList: { "previews/retention": vi.fn() },
  pool: {},
  runOptions: [] as MockRunOptions[],
  serverLoggerError: vi.fn(),
  serverLoggerInfo: vi.fn(),
}));
vi.mock("@composition/server", () => ({
  server: { startAppWorkers: vi.fn(), stopAppWorkers: vi.fn() },
}));
vi.mock("#app/db/client.ts", () => ({ db: {}, pool: runtimeMocks.pool }));
vi.mock("#app/lib/clickhouse-writer.ts", () => ({ insertRows: vi.fn() }));
vi.mock("graphile-worker", () => ({
  parseCronItems: (items: unknown[]) => items,
  run: vi.fn(async (options: MockRunOptions) => {
    runtimeMocks.runOptions.push(options);
    return {
      events: options.events,
      promise: new Promise<void>(() => {}),
      stop: vi.fn(),
    };
  }),
}));
vi.mock("#app/integrations/github/configuration.ts", () => ({
  getGithubConfiguration: () => (runtimeMocks.githubEnabled ? {} : undefined),
}));
vi.mock("#app/server/github-events/tasks.ts", () => ({
  githubEventsTaskList: runtimeMocks.githubEventsTaskList,
}));

vi.mock("#app/server/previews/00-runtime.ts", () => ({
  previewsCronItems: runtimeMocks.previewsCronItems,
  previewsTaskList: runtimeMocks.previewsTaskList,
}));

vi.mock("#app/telemetry/logger.ts", () => ({
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
  delete (globalThis as { __everrHotSingletons?: unknown })
    .__everrHotSingletons;
  runtimeMocks.runOptions.length = 0;
  runtimeMocks.serverLoggerError.mockClear();
  runtimeMocks.serverLoggerInfo.mockClear();
  const runtime = await import("./runtime");
  return {
    startWorkerRuntime: async () => {
      activeRuntime = await runtime.startWorkerRuntime();
      await vi.dynamicImportSettled();
      return activeRuntime;
    },
  };
}
it.each([
  true,
  false,
])("registers scheduled tasks with optional GitHub jobs (enabled: %s)", async (enabled) => {
  runtimeMocks.githubEnabled = enabled;
  const runtime = await loadRuntime();
  expect(runtimeMocks.runOptions).toHaveLength(0);
  await runtime.startWorkerRuntime();
  expect(runtimeMocks.runOptions).toHaveLength(1);
  const [general] = runtimeMocks.runOptions;
  expect(general).toMatchObject({
    concurrency: 2,
    noHandleSignals: true,
    pgPool: runtimeMocks.pool,
    parsedCronItems: expect.arrayContaining([
      expect.objectContaining({ task: "alerts/scan" }),
      expect.objectContaining({ task: "alerts/retention" }),
      ...runtimeMocks.previewsCronItems,
    ]),
  });
  expect(Object.keys(general.taskList).sort()).toEqual([
    "alerts/evaluate",
    "alerts/flush-group",
    "alerts/process-event",
    "alerts/project-lifecycle",
    "alerts/retention",
    "alerts/scan",
    "alerts/send-delivery",
    ...(enabled ? Object.keys(runtimeMocks.githubEventsTaskList) : []),
    "previews/retention",
  ]);
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
