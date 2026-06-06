// @vitest-environment node
import type { QueryResultRow } from "pg";
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

const SCANNER_BATCH_SIZE = 5_000;
const DUE_ALERT_COUNT = 5_000;

const scaleMocks = vi.hoisted(() => {
  const workHandlers = new Map<string, WorkHandler>();
  const pgBossInstances: MockBoss[] = [];
  const poolQuery = vi.fn();

  return {
    evaluateAlertJob: vi.fn(),
    pgBossInstances,
    poolQuery,
    serverLoggerError: vi.fn(),
    serverLoggerInfo: vi.fn(),
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
  PgBoss: scaleMocks.PgBoss,
}));

vi.mock("@/db/client", () => ({
  pool: {
    query: scaleMocks.poolQuery,
  },
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
    error: scaleMocks.serverLoggerError,
    info: scaleMocks.serverLoggerInfo,
  },
}));

vi.mock("./evaluator", () => ({
  evaluateAlertJob: scaleMocks.evaluateAlertJob,
}));

function resetScaleMocks() {
  scaleMocks.PgBoss.mockClear();
  scaleMocks.evaluateAlertJob.mockReset().mockResolvedValue(undefined);
  scaleMocks.pgBossInstances.length = 0;
  scaleMocks.poolQuery.mockReset();
  scaleMocks.serverLoggerError.mockClear();
  scaleMocks.serverLoggerInfo.mockClear();
  scaleMocks.workHandlers.clear();
}

function bossInstance(): MockBoss {
  const boss = scaleMocks.pgBossInstances[0];
  if (!boss) {
    throw new Error("missing pg-boss instance");
  }
  return boss;
}

async function loadRuntime() {
  vi.resetModules();
  vi.doUnmock("@/server/alerts/runtime");

  return await import("./runtime");
}

async function runWorker<TData>(queue: string, jobs: MockJob<TData>[]) {
  const handler = scaleMocks.workHandlers.get(queue);
  if (!handler) {
    throw new Error(`missing ${queue} worker`);
  }

  await handler(jobs as MockJob<unknown>[]);
}

function dueAlertRows(count: number, scheduledFor: Date): QueryResultRow[] {
  return Array.from({ length: count }, (_, index) => ({
    alertDefinitionId: index + 1,
    organizationId: "org1",
    scheduledFor,
  }));
}

beforeEach(() => {
  resetScaleMocks();
});

describe("alert runtime scale behavior", () => {
  it("claims and enqueues one configured scanner batch for 5k due alerts", async () => {
    const scheduledFor = new Date("2026-06-06T12:00:00.000Z");
    scaleMocks.poolQuery.mockResolvedValueOnce({
      rows: dueAlertRows(DUE_ALERT_COUNT, scheduledFor),
      rowCount: DUE_ALERT_COUNT,
    });
    const runtime = await loadRuntime();

    await runtime.startAlertRuntime();
    await runWorker("alert-scan", [{ id: "scan-job", data: {} }]);

    const [sql, values] = scaleMocks.poolQuery.mock.calls[0] ?? [];
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("LIMIT $2");
    expect(values?.[1]).toBe(SCANNER_BATCH_SIZE);

    expect(bossInstance().send).toHaveBeenCalledTimes(SCANNER_BATCH_SIZE);
    expect(bossInstance().send).toHaveBeenNthCalledWith(
      1,
      "alert-evaluate",
      {
        alertDefinitionId: 1,
        scheduledFor: "2026-06-06T12:00:00.000Z",
      },
      expect.objectContaining({
        id: "alert:1:2026-06-06T12:00:00.000Z",
        singletonKey: "alert:1",
      }),
    );
    expect(bossInstance().send).toHaveBeenLastCalledWith(
      "alert-evaluate",
      {
        alertDefinitionId: 5000,
        scheduledFor: "2026-06-06T12:00:00.000Z",
      },
      expect.objectContaining({
        id: "alert:5000:2026-06-06T12:00:00.000Z",
        singletonKey: "alert:5000",
      }),
    );
  });

  it("uses deterministic job ids when duplicate scanner results appear", async () => {
    const scheduledFor = new Date("2026-06-06T12:00:00.000Z");
    const row = dueAlertRows(1, scheduledFor);
    scaleMocks.poolQuery
      .mockResolvedValueOnce({ rows: row, rowCount: 1 })
      .mockResolvedValueOnce({ rows: row, rowCount: 1 });
    const runtime = await loadRuntime();

    await runtime.startAlertRuntime();
    await runWorker("alert-scan", [{ id: "scan-a", data: {} }]);
    await runWorker("alert-scan", [{ id: "scan-b", data: {} }]);

    expect(bossInstance().send).toHaveBeenCalledTimes(2);
    for (const call of bossInstance().send.mock.calls) {
      expect(call[2]).toEqual(
        expect.objectContaining({
          id: "alert:1:2026-06-06T12:00:00.000Z",
          singletonKey: "alert:1",
        }),
      );
    }
  });
});
