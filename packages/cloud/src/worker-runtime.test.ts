import type * as RuntimeTypes from "@everr/app/server/worker/runtime";
// @vitest-environment node
import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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
    pool: { query: vi.fn(), options: { host: "database", max: 10 } },
    organizationPool: {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      end: vi.fn().mockResolvedValue(undefined),
    },
    poolOptions: [] as unknown[],
    runners: [] as { stop: ReturnType<typeof vi.fn> }[],
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
  };
});

vi.mock("./clickhouse/provisioning", () => ({
  provisionSqlApiOrgUser: vi.fn(),
  deprovisionSqlApiOrgUser: vi.fn(),
}));

vi.mock("@everr/app/lib/clickhouse-writer", () => ({ insertRows: vi.fn() }));

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

vi.mock("@everr/app/db/client", () => ({
  db: {},
  databasePoolConfig: {
    host: "database",
    password: "test-password",
    connectionTimeoutMillis: 10_000,
  },
  pool: runtimeMocks.pool,
}));

vi.mock("@everr/app/telemetry/logger", () => ({
  exceptionAttributes: (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    return {
      "exception.message": error.message,
      "exception.type": error.name,
    };
  },
  errorMessage: (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
  serverLogger: {
    error: runtimeMocks.serverLoggerError,
    info: vi.fn(),
  },
}));

let activeRuntime: Awaited<ReturnType<(typeof RuntimeTypes)["startWorkerRuntime"]>> | undefined;
afterEach(async () => {
  await activeRuntime?.stop();
  activeRuntime = undefined;
  vi.unstubAllEnvs();
});

async function loadRuntime(mode = "disabled") {
  vi.stubEnv("EVERR_GITHUB_ENABLED", "false");
  vi.stubEnv("CRM_BREVO_MODE", mode);
  vi.stubEnv("CRM_BREVO_API_KEY", "fixture");
  vi.stubEnv("CRM_BREVO_DEPLOYMENT", "test");
  vi.stubEnv("CRM_BREVO_ACCOUNT_SCOPE", "test");
  vi.resetModules();
  // The runner handle deliberately lives on the hot-singleton registry on
  // globalThis to survive HMR module replacement; tests need each import to
  // start from a clean slate.
  delete (globalThis as { __everrHotSingletons?: unknown }).__everrHotSingletons;
  runtimeMocks.run.mockClear();
  runtimeMocks.runOptions.length = 0;
  runtimeMocks.runners.length = 0;
  runtimeMocks.poolOptions.length = 0;
  runtimeMocks.organizationPool.query.mockClear();
  runtimeMocks.organizationPool.end.mockClear();
  runtimeMocks.serverLoggerError.mockClear();
  const runtime = await import("@everr/app/server/worker/runtime");
  return {
    startWorkerRuntime: async () => {
      activeRuntime = await runtime.startWorkerRuntime();
      await vi.dynamicImportSettled();
      return activeRuntime;
    },
  };
}

describe("worker runtime", () => {
  it.each(["configured", "paused", "disabled"])(
    "publishes readiness and milestone facts without CRM admission or diagnostics in %s mode",
    async (mode) => {
      await loadRuntime(mode);
      const { runtime: composition } = await import("./app/composition/runtime");
      const { createEventPublisher } = await import("@everr/app/server/events/publisher");
      const excluded = [
        "organization.provisioned",
        "telemetry.first_queryable",
        "organization.activated",
      ];
      expect(composition.events).toHaveLength(mode === "disabled" ? 0 : 12);
      for (const type of excluded) {
        const registration = composition.events.find(({ definition }) => definition.type === type);
        expect(registration).toBeUndefined();
      }
      const diagnostics = runtimeMocks.serverLoggerError;
      diagnostics.mockClear();
      const events = createEventPublisher({ routes: composition.events });
      for (const type of excluded) {
        await events.publish({
          type,
          version: 1,
          subjectId: "org",
          data: {
            organizationId: "org",
            ...(type === "organization.provisioned"
              ? {}
              : { ruleVersion: 1, observedAt: "2026-10-26T12:00:00.000Z" }),
          },
        });
      }
      expect(diagnostics).not.toHaveBeenCalled();
    },
  );

  it("reserves a third runner with one independent CRM execution slot", async () => {
    const runtime = await loadRuntime("configured");
    await runtime.startWorkerRuntime();
    expect(runtimeMocks.run).toHaveBeenCalledTimes(3);
    const integration = runtimeMocks.runOptions.find((options) =>
      Object.keys(options.taskList).includes("crm/sync-user"),
    );
    expect(integration).toMatchObject({ concurrency: 1, noHandleSignals: true });
    expect(Object.keys(integration!.taskList).sort()).toEqual([
      "crm/reconcile",
      "crm/sync-membership",
      "crm/sync-organization",
      "crm/sync-user",
    ]);
    expect(integration).toMatchObject({
      parsedCronItems: [
        {
          task: "crm/reconcile",
          match: "* * * * *",
          options: {
            priority: 100,
            backfillPeriod: 0,
            maxAttempts: 3,
            jobKey: "crm-reconcile",
            jobKeyMode: "preserve_run_at",
          },
        },
      ],
    });
    expect(runtimeMocks.poolOptions).toHaveLength(2);
    await activeRuntime!.stop();
    expect(runtimeMocks.organizationPool.end).toHaveBeenCalledTimes(2);
  });

  it("pauses consumption while retaining CRM routes to preserve pending facts", async () => {
    const runtime = await loadRuntime("paused");
    await runtime.startWorkerRuntime();
    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
    const { runtime: composition } = await import("./app/composition/runtime");
    expect(composition.events).toHaveLength(12);
    expect(runtimeMocks.runOptions.every((options) => !("crm/sync-user" in options.taskList))).toBe(
      true,
    );
  });

  it("rolls back only CRM startup when its runner fails", async () => {
    const runtime = await loadRuntime("configured");
    const start = runtimeMocks.run.getMockImplementation()!;
    runtimeMocks.run.mockImplementation(async (options) => {
      if ("crm/sync-user" in options.taskList) throw new Error("CRM runner unavailable");
      return start(options);
    });
    try {
      await runtime.startWorkerRuntime();
      expect(runtimeMocks.organizationPool.end).toHaveBeenCalledOnce();
      expect(runtimeMocks.runners).toHaveLength(2);
      for (const runner of runtimeMocks.runners) expect(runner.stop).not.toHaveBeenCalled();
      expect(runtimeMocks.serverLoggerError).toHaveBeenCalledWith(
        "worker.runtime.failed",
        expect.objectContaining({ "everr.worker.pool": "everrIntegrationWorker" }),
      );
    } finally {
      runtimeMocks.run.mockImplementation(start);
    }
  });
  it("reserves a separate runner and database pool for organization lifecycle jobs", async () => {
    const runtime = await loadRuntime();

    expect(runtimeMocks.run).not.toHaveBeenCalled();

    await runtime.startWorkerRuntime();
    await runtime.startWorkerRuntime();

    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
    const general = runtimeMocks.runOptions.find((options) => options.pgPool === runtimeMocks.pool);
    const organizations = runtimeMocks.runOptions.find(
      (options) => options.pgPool !== runtimeMocks.pool,
    );
    if (!general || !organizations) throw new Error("Missing worker runner");
    expect(general).toMatchObject({
      concurrency: 2,
      noHandleSignals: true,
      pgPool: runtimeMocks.pool,
    });
    expect(organizations).toMatchObject({
      concurrency: 2,
      noHandleSignals: true,
      pgPool: runtimeMocks.organizationPool,
      parsedCronItems: [
        expect.objectContaining({
          task: "clickhouse/scan-pending-organizations",
        }),
      ],
    });
    expect(Object.keys(organizations.taskList).sort()).toEqual([
      "clickhouse/deprovision-organization",
      "clickhouse/provision-organization",
      "clickhouse/scan-pending-organizations",
    ]);
    expect(Object.keys(general.taskList)).toContain("alerts/evaluate");
    for (const identifier of Object.keys(organizations.taskList))
      expect(general.taskList).not.toHaveProperty(identifier);
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

  it("drains both runners and closes the reserved pool even if cleanup fails", async () => {
    const runtime = await loadRuntime();
    const handle = await runtime.startWorkerRuntime();
    const error = new Error("Runner cleanup failed");
    runtimeMocks.runners[0].stop.mockRejectedValueOnce(error);
    await expect(handle.stop()).rejects.toMatchObject({ errors: [error] });
    for (const runner of runtimeMocks.runners) expect(runner.stop).toHaveBeenCalledOnce();
    expect(runtimeMocks.organizationPool.end).toHaveBeenCalledOnce();
    activeRuntime = undefined;
  });

  it("keeps the organization worker alive when the general worker cannot start", async () => {
    const runtime = await loadRuntime();
    const start = runtimeMocks.run.getMockImplementation();
    if (!start) throw new Error("Missing worker implementation");
    runtimeMocks.run.mockImplementation(async (options) => {
      if (options.pgPool === runtimeMocks.pool) throw new Error("Shared worker unavailable");
      return start(options);
    });
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
    runtimeMocks.run.mockImplementation(start);
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
    for (const runner of runtimeMocks.runners) expect(runner.stop).not.toHaveBeenCalled();
    expect(runtimeMocks.organizationPool.end).not.toHaveBeenCalled();
  });
});
