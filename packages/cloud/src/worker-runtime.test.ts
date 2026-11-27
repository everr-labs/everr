import type * as RuntimeTypes from "@everr/app/server/worker/runtime";
import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

type MockRunOptions = {
  concurrency: number;
  events: EventEmitter;
  noHandleSignals: boolean;
  pgPool: { end: ReturnType<typeof vi.fn> };
  taskList: Record<string, unknown>;
};

const runtimeMocks = vi.hoisted(() => {
  const runOptions: MockRunOptions[] = [];
  return {
    pool: { query: vi.fn(), options: { host: "database", max: 10 } },
    poolQuery: vi.fn().mockResolvedValue({ rows: [] }),
    pools: [] as { end: ReturnType<typeof vi.fn>; options: unknown }[],
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
    serverLoggerInfo: vi.fn(),
  };
});

vi.mock("./clickhouse/provisioning", () => ({
  provisionSqlApiOrgUser: vi.fn(),
  deprovisionSqlApiOrgUser: vi.fn(),
}));

vi.mock("@everr/app/lib/clickhouse-writer", () => ({ insertRows: vi.fn() }));

vi.mock("pg", () => ({
  Pool: class {
    query = runtimeMocks.poolQuery;
    end = vi.fn().mockResolvedValue(undefined);
    constructor(public options: unknown) {
      runtimeMocks.pools.push(this);
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
    info: runtimeMocks.serverLoggerInfo,
  },
}));

let activeRuntime: Awaited<ReturnType<(typeof RuntimeTypes)["startWorkerRuntime"]>> | undefined;
afterEach(async () => {
  await activeRuntime?.stop();
  activeRuntime = undefined;
  vi.unstubAllEnvs();
});

async function loadRuntime(apiKey?: string) {
  vi.stubEnv("EVERR_GITHUB_ENABLED", "false");
  vi.stubEnv("CRM_BREVO_API_KEY", apiKey);
  vi.resetModules();
  // The runner handle deliberately lives on the hot-singleton registry on
  // globalThis to survive HMR module replacement; tests need each import to
  // start from a clean slate.
  delete (globalThis as { __everrHotSingletons?: unknown }).__everrHotSingletons;
  runtimeMocks.run.mockClear();
  runtimeMocks.runOptions.length = 0;
  runtimeMocks.runners.length = 0;
  runtimeMocks.pools.length = 0;
  runtimeMocks.poolQuery.mockClear();
  runtimeMocks.serverLoggerError.mockClear();
  runtimeMocks.serverLoggerInfo.mockClear();
  const runtime = await import("@everr/app/server/worker/runtime");
  return {
    startWorkerRuntime: async () => {
      activeRuntime = await runtime.startWorkerRuntime();
      await vi.dynamicImportSettled();
      return activeRuntime;
    },
  };
}

function runnerWithTask(identifier: string) {
  const runner = runtimeMocks.runOptions.find((options) => identifier in options.taskList);
  if (!runner) throw new Error(`Missing worker runner for ${identifier}`);
  return runner;
}

describe("worker runtime", () => {
  it("publishes readiness without CRM admission or diagnostics", async () => {
    await loadRuntime("fixture");
    const { runtime: composition } = await import("./app/composition/runtime");
    const { createEventPublisher } = await import("@everr/app/server/events/publisher");
    expect(composition.events).toHaveLength(12);
    expect(
      composition.events.find(({ definition }) => definition.type === "organization.provisioned"),
    ).toBeUndefined();
    const diagnostics = runtimeMocks.serverLoggerError;
    diagnostics.mockClear();
    const events = createEventPublisher({ routes: composition.events });
    await events.publish({
      type: "organization.provisioned",
      version: 1,
      subjectId: "org",
      data: { organizationId: "org" },
    });
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it("reserves a third runner with one independent CRM execution slot", async () => {
    const runtime = await loadRuntime("fixture");
    await runtime.startWorkerRuntime();
    expect(runtimeMocks.serverLoggerInfo).toHaveBeenCalledWith("crm.integration.status", {
      "everr.crm.enabled": true,
    });
    expect(runtimeMocks.run).toHaveBeenCalledTimes(3);
    const integration = runtimeMocks.runOptions.find((options) =>
      Object.keys(options.taskList).includes("crm/sync-user"),
    );
    expect(integration).toMatchObject({ concurrency: 1, noHandleSignals: true });
    expect(Object.keys(integration!.taskList).sort()).toEqual([
      "crm/full-sync",
      "crm/sync-membership",
      "crm/sync-organization",
      "crm/sync-user",
    ]);
    expect(integration).not.toHaveProperty("parsedCronItems");
    expect(runtimeMocks.pools).toHaveLength(3);
    await activeRuntime!.stop();
    for (const pool of runtimeMocks.pools) expect(pool.end).toHaveBeenCalledOnce();
  });

  // Blank-key normalization is covered in app/env.test.ts.
  it("disables CRM admission and consumption without a key", async () => {
    const runtime = await loadRuntime();
    await runtime.startWorkerRuntime();
    expect(runtimeMocks.run).toHaveBeenCalledTimes(2);
    const { runtime: composition } = await import("./app/composition/runtime");
    expect(composition.events).toHaveLength(0);
    expect(runtimeMocks.serverLoggerInfo).toHaveBeenCalledWith("crm.integration.status", {
      "everr.crm.enabled": false,
    });
    expect(runtimeMocks.runOptions.every((options) => !("crm/sync-user" in options.taskList))).toBe(
      true,
    );
  });

  it("rolls back only CRM startup when its runner fails", async () => {
    const runtime = await loadRuntime("fixture");
    const start = runtimeMocks.run.getMockImplementation()!;
    runtimeMocks.run.mockImplementation(async (options) => {
      if ("crm/sync-user" in options.taskList) throw new Error("CRM runner unavailable");
      return start(options);
    });
    try {
      await runtime.startWorkerRuntime();
      const runningPools = runtimeMocks.runOptions.map((options) => options.pgPool);
      for (const pool of runtimeMocks.pools)
        expect(pool.end).toHaveBeenCalledTimes(runningPools.includes(pool) ? 0 : 1);
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
    const general = runnerWithTask("alerts/evaluate");
    const organizations = runnerWithTask("clickhouse/provision-organization");
    expect(general).toMatchObject({ concurrency: 2, noHandleSignals: true });
    // Graphile's LISTEN client must never be a connection opened by app code.
    expect(general.pgPool).not.toBe(runtimeMocks.pool);
    expect(organizations.pgPool).not.toBe(runtimeMocks.pool);
    expect(organizations.pgPool).not.toBe(general.pgPool);
    expect(organizations).toMatchObject({
      concurrency: 2,
      noHandleSignals: true,
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
    const poolOptions = {
      host: "database",
      password: "test-password",
      connectionTimeoutMillis: 10_000,
      max: 4,
    };
    expect(runtimeMocks.pools.map((pool) => pool.options)).toEqual([poolOptions, poolOptions]);
    expect(runtimeMocks.poolQuery).toHaveBeenCalledOnce();
  });

  it("drains both runners and closes the reserved pool even if cleanup fails", async () => {
    const runtime = await loadRuntime();
    const handle = await runtime.startWorkerRuntime();
    const error = new Error("Runner cleanup failed");
    runtimeMocks.runners[0].stop.mockRejectedValueOnce(error);
    await expect(handle.stop()).rejects.toMatchObject({ errors: [error] });
    for (const runner of runtimeMocks.runners) expect(runner.stop).toHaveBeenCalledOnce();
    for (const pool of runtimeMocks.pools) expect(pool.end).toHaveBeenCalledOnce();
    activeRuntime = undefined;
  });

  it("keeps the organization worker alive when the general worker cannot start", async () => {
    const runtime = await loadRuntime();
    const start = runtimeMocks.run.getMockImplementation();
    if (!start) throw new Error("Missing worker implementation");
    runtimeMocks.run.mockImplementation(async (options) => {
      if ("alerts/evaluate" in options.taskList) throw new Error("Shared worker unavailable");
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
    expect(runnerWithTask("clickhouse/provision-organization").pgPool.end).not.toHaveBeenCalled();
    runtimeMocks.run.mockImplementation(start);
  });

  it("keeps both workers alive if recovery of old retry schedules fails", async () => {
    const runtime = await loadRuntime();
    runtimeMocks.poolQuery.mockRejectedValueOnce(new Error("Could not recover retries"));
    await runtime.startWorkerRuntime();
    await Promise.resolve();
    expect(runtimeMocks.serverLoggerError).toHaveBeenCalledWith(
      "clickhouse.organization.retry_recovery.failed",
      expect.objectContaining({
        "exception.message": "Could not recover retries",
      }),
    );
    for (const runner of runtimeMocks.runners) expect(runner.stop).not.toHaveBeenCalled();
    for (const pool of runtimeMocks.pools) expect(pool.end).not.toHaveBeenCalled();
  });
});
