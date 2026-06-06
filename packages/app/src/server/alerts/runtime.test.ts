// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockJob<TData> = {
  id: string;
  data: TData;
};

type WorkHandler = (jobs: MockJob<unknown>[]) => Promise<void>;

type MockBoss = {
  createQueue: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  schedule: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  work: ReturnType<typeof vi.fn>;
};

const runtimeMocks = vi.hoisted(() => {
  const workHandlers = new Map<string, WorkHandler>();
  const pgBossInstances: MockBoss[] = [];

  return {
    claimDueAlertDefinitions: vi.fn(),
    evaluateAlertJob: vi.fn(),
    migrate: vi.fn(),
    pgBossInstances,
    recordTelemetryError: vi.fn(),
    serverLoggerError: vi.fn(),
    serverLoggerInfo: vi.fn(),
    startAlertRuntime: vi.fn(),
    workHandlers,
    PgBoss: vi.fn(function PgBoss() {
      const instance: MockBoss = {
        createQueue: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        schedule: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue("job-id"),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        work: vi.fn(
          (queue: string, _options: unknown, handler: WorkHandler) => {
            workHandlers.set(queue, handler);
            return Promise.resolve(`${queue}-worker`);
          },
        ),
      };
      pgBossInstances.push(instance);
      return instance;
    }),
  };
});

vi.mock("pg-boss", () => ({
  PgBoss: runtimeMocks.PgBoss,
}));

vi.mock("@/db/client", () => ({
  db: {},
  pool: { query: vi.fn() },
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    return {
      "exception.message": error.message,
      "exception.type": error.name,
    };
  },
  serverLogger: {
    error: runtimeMocks.serverLoggerError,
    info: runtimeMocks.serverLoggerInfo,
  },
}));

vi.mock("@/telemetry/node", () => ({
  getTelemetryTracer: () => ({
    startActiveSpan: async (
      _name: string,
      _options: unknown,
      run: (span: { end: () => void }) => Promise<unknown>,
    ) => run({ end: vi.fn() }),
  }),
  recordTelemetryError: runtimeMocks.recordTelemetryError,
  SpanKind: { INTERNAL: 0 },
}));

vi.mock("./repository", () => ({
  claimDueAlertDefinitions: runtimeMocks.claimDueAlertDefinitions,
}));

vi.mock("./evaluator", () => ({
  evaluateAlertJob: runtimeMocks.evaluateAlertJob,
}));

const alertQueueOptions = {
  deleteAfterSeconds: 7 * 24 * 60 * 60,
  expireInSeconds: 60,
  heartbeatSeconds: 30,
  retentionSeconds: 7 * 24 * 60 * 60,
  retryBackoff: true,
  retryLimit: 3,
};

async function loadRuntime() {
  vi.resetModules();
  vi.doUnmock("@/env/alerts");
  vi.doUnmock("@/server/alerts/runtime");
  resetRuntimeMocks();

  return await import("./runtime");
}

function resetRuntimeMocks() {
  runtimeMocks.PgBoss.mockClear();
  runtimeMocks.claimDueAlertDefinitions.mockReset().mockResolvedValue([]);
  runtimeMocks.evaluateAlertJob.mockReset().mockResolvedValue(undefined);
  runtimeMocks.migrate.mockReset().mockResolvedValue(undefined);
  runtimeMocks.pgBossInstances.length = 0;
  runtimeMocks.recordTelemetryError.mockReset();
  runtimeMocks.serverLoggerError.mockClear();
  runtimeMocks.serverLoggerInfo.mockClear();
  runtimeMocks.startAlertRuntime.mockReset().mockResolvedValue(undefined);
  runtimeMocks.workHandlers.clear();
}

function bossInstance(): MockBoss {
  const boss = runtimeMocks.pgBossInstances[0];
  if (!boss) {
    throw new Error("missing pg-boss instance");
  }
  return boss;
}

async function runWorker<TData>(queue: string, jobs: MockJob<TData>[]) {
  const handler = runtimeMocks.workHandlers.get(queue);
  if (!handler) {
    throw new Error(`missing ${queue} worker`);
  }

  await handler(jobs as MockJob<unknown>[]);
}

async function importServerWithAlerts(enabled: boolean) {
  vi.resetModules();
  resetRuntimeMocks();

  vi.doMock("@/env/alerts", () => ({
    alertEnv: { EVERR_ALERTS_ENABLED: enabled },
  }));
  vi.doMock("@/server/alerts/runtime", () => ({
    startAlertRuntime: runtimeMocks.startAlertRuntime,
  }));
  vi.doMock("drizzle-orm/node-postgres/migrator", () => ({
    migrate: runtimeMocks.migrate,
  }));
  vi.doMock("@tanstack/react-start/server", () => ({
    createStartHandler: vi.fn(() => vi.fn()),
    defaultStreamHandler: vi.fn(),
    defineHandlerCallback: vi.fn((handler) => handler),
  }));
  vi.doMock("@/telemetry/server", () => ({
    instrumentServerFetch: vi.fn((_request, run) => run()),
  }));

  await import("@/server");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("alert runtime", () => {
  it("creates scan, evaluation, and dead-letter queues with retention options", async () => {
    const runtime = await loadRuntime();

    await runtime.startAlertRuntime();

    const boss = bossInstance();
    expect(boss.createQueue).toHaveBeenCalledWith(
      "alert-dead-letter",
      expect.objectContaining(alertQueueOptions),
    );
    expect(boss.createQueue).toHaveBeenCalledWith(
      "alert-scan",
      expect.objectContaining({
        ...alertQueueOptions,
        deadLetter: "alert-dead-letter",
      }),
    );
    expect(boss.createQueue).toHaveBeenCalledWith(
      "alert-evaluate",
      expect.objectContaining({
        ...alertQueueOptions,
        deadLetter: "alert-dead-letter",
      }),
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      "alert-scan",
      "* * * * *",
      {},
      expect.objectContaining({
        key: "default",
        singletonKey: "alert-scan",
      }),
    );
  });

  it("scanner claims due alerts and enqueues one evaluation job per claim", async () => {
    const runtime = await loadRuntime();
    const scheduledFor = new Date("2026-06-06T12:00:00.000Z");
    runtimeMocks.claimDueAlertDefinitions.mockResolvedValue([
      { alertDefinitionId: 11, organizationId: "org-1", scheduledFor },
      { alertDefinitionId: 12, organizationId: "org-1", scheduledFor },
    ]);

    await runtime.startAlertRuntime();
    await runWorker("alert-scan", [{ id: "scan-job", data: {} }]);

    expect(runtimeMocks.claimDueAlertDefinitions).toHaveBeenCalledWith({
      limit: expect.any(Number),
      now: expect.any(Date),
    });
    expect(bossInstance().send).toHaveBeenCalledTimes(2);
    expect(bossInstance().send).toHaveBeenCalledWith(
      "alert-evaluate",
      {
        alertDefinitionId: 11,
        scheduledFor: "2026-06-06T12:00:00.000Z",
      },
      expect.objectContaining({
        ...alertQueueOptions,
        singletonKey: "alert:11",
      }),
    );
    expect(bossInstance().send).toHaveBeenCalledWith(
      "alert-evaluate",
      {
        alertDefinitionId: 12,
        scheduledFor: "2026-06-06T12:00:00.000Z",
      },
      expect.objectContaining({
        ...alertQueueOptions,
        singletonKey: "alert:12",
      }),
    );
  });

  it("evaluation worker evaluates alert jobs", async () => {
    const runtime = await loadRuntime();
    const jobData = {
      alertDefinitionId: 99,
      scheduledFor: "2026-06-06T12:00:00.000Z",
    };

    await runtime.startAlertRuntime();
    await runWorker("alert-evaluate", [{ id: "evaluate-job", data: jobData }]);

    expect(runtimeMocks.evaluateAlertJob).toHaveBeenCalledWith(jobData);
  });

  it("starts idempotently", async () => {
    const runtime = await loadRuntime();

    const first = await runtime.startAlertRuntime();
    const second = await runtime.startAlertRuntime();

    expect(first).toBe(second);
    expect(runtimeMocks.PgBoss).toHaveBeenCalledOnce();
  });

  it("does not start from server startup when alerts are disabled", async () => {
    await importServerWithAlerts(false);

    expect(runtimeMocks.migrate).toHaveBeenCalledOnce();
    expect(runtimeMocks.startAlertRuntime).not.toHaveBeenCalled();
  });

  it("starts from server startup when alerts are enabled", async () => {
    await importServerWithAlerts(true);

    expect(runtimeMocks.migrate).toHaveBeenCalledOnce();
    expect(runtimeMocks.startAlertRuntime).toHaveBeenCalledOnce();
  });
});
