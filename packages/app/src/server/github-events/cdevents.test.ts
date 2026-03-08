import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.INGRESS_SOURCE = "github";
  process.env.INGRESS_COLLECTOR_URL = "http://localhost:8080/webhook/github";
  process.env.CDEVENTS_CLICKHOUSE_URL = "http://localhost:8123";
  process.env.CDEVENTS_CLICKHOUSE_USERNAME = "app_cdevents_rw";
  process.env.CDEVENTS_CLICKHOUSE_PASSWORD = "app-cdevents-dev";
  process.env.CDEVENTS_CLICKHOUSE_DATABASE = "app";
});

import {
  BufferedCDEventsWriter,
  type CDEventInserter,
  type CDEventRow,
  formatClickHouseDateTime64,
  transformToCDEventRows,
} from "./cdevents";
import { getGitHubEventsConfig } from "./config";

function readFixture(relativePath: string): Buffer {
  return readFileSync(new URL(relativePath, import.meta.url));
}

describe("transformToCDEventRows", () => {
  it("formats Date values for ClickHouse DateTime64 input", () => {
    expect(
      formatClickHouseDateTime64(new Date("2026-03-07T18:01:02.123Z")),
    ).toBe("2026-03-07 18:01:02.123");
  });

  it("transforms workflow_run completed payloads", () => {
    const rows = transformToCDEventRows({
      eventType: "workflow_run",
      deliveryId: "delivery-1",
      tenantId: 42,
      body: readFixture(
        "../../../../../collector/receiver/githubactionsreceiver/testdata/completed/8_workflow_run_completed.json",
      ),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventKind: "pipelinerun",
      eventPhase: "finished",
      tenantId: 42,
      subjectId: "6454805877",
      outcome: "success",
    });
    expect(rows[0]?.cdeventJson).toContain(
      "dev.cdevents.pipelinerun.finished.0.2.0",
    );
  });

  it("transforms workflow_job completed payloads", () => {
    const rows = transformToCDEventRows({
      eventType: "workflow_job",
      deliveryId: "delivery-2",
      tenantId: 7,
      body: readFixture(
        "../../../../../collector/receiver/githubactionsreceiver/testdata/completed/9_workflow_job_completed.json",
      ),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventKind: "taskrun",
      eventPhase: "finished",
      pipelineRunId: "6454805877",
      subjectName: "test",
    });
  });

  it("transforms workflow_run requested payloads", () => {
    const rows = transformToCDEventRows({
      eventType: "workflow_run",
      deliveryId: "delivery-3",
      tenantId: 9,
      body: Buffer.from(`{
        "action":"requested",
        "installation":{"id":123},
        "workflow_run":{
          "id":123,
          "name":"Tests",
          "html_url":"https://github.com/acme/repo/actions/runs/123",
          "head_branch":"main",
          "head_sha":"abc123",
          "created_at":"2026-03-05T10:00:00Z"
        },
        "repository":{"full_name":"acme/repo","html_url":"https://github.com/acme/repo"}
      }`),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventPhase).toBe("queued");
  });

  it("ignores queued workflow_job payloads", () => {
    const rows = transformToCDEventRows({
      eventType: "workflow_job",
      deliveryId: "delivery-4",
      tenantId: 1,
      body: readFixture(
        "../../../../../collector/receiver/githubactionsreceiver/testdata/queued/1_workflow_job_queued.json",
      ),
    });

    expect(rows).toEqual([]);
  });
});

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

class FakeInserter implements CDEventInserter {
  readonly batches: CDEventRow[][] = [];
  readonly pending = [] as ReturnType<typeof createDeferred<void>>[];

  constructor(private readonly autoResolve = true) {}

  insert = vi.fn(async (rows: CDEventRow[]) => {
    this.batches.push([...rows]);

    if (this.autoResolve) {
      return;
    }

    const deferred = createDeferred<void>();
    this.pending.push(deferred);
    return deferred.promise;
  });
}

function createTestConfig(
  overrides: Partial<ReturnType<typeof getGitHubEventsConfig>> = {},
) {
  return {
    ...getGitHubEventsConfig(),
    cdeventsBatchSize: 2,
    cdeventsFlushIntervalMs: 20,
    ...overrides,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.resolve();
});

describe("BufferedCDEventsWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("flushes on batch size only after the insert succeeds", async () => {
    const inserter = new FakeInserter(false);
    const writer = new BufferedCDEventsWriter(inserter, createTestConfig());

    const firstWrite = writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    let firstSettled = false;
    void firstWrite.finally(() => {
      firstSettled = true;
    });
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(inserter.batches).toHaveLength(0);

    const secondWrite = writer.writeRows([{ deliveryId: "2" } as CDEventRow]);
    let secondSettled = false;
    void secondWrite.finally(() => {
      secondSettled = true;
    });

    await vi.waitFor(() => {
      expect(inserter.batches).toHaveLength(1);
    });
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    inserter.pending[0]?.resolve();

    await expect(firstWrite).resolves.toBeUndefined();
    await expect(secondWrite).resolves.toBeUndefined();
    expect(inserter.batches[0]?.map((row) => row.deliveryId)).toEqual([
      "1",
      "2",
    ]);

    await writer.close();
  });

  it("keeps the batch-size-triggering write pending and propagates insert failures", async () => {
    const inserter = new FakeInserter(false);
    const writer = new BufferedCDEventsWriter(inserter, createTestConfig());

    const firstWrite = writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    const secondWrite = writer.writeRows([{ deliveryId: "2" } as CDEventRow]);
    let secondSettled = false;
    void secondWrite.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );

    await vi.waitFor(() => {
      expect(inserter.batches).toHaveLength(1);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    inserter.pending[0]?.reject(new Error("temporary failure"));

    await expect(firstWrite).rejects.toThrow("temporary failure");
    await expect(secondWrite).rejects.toThrow("temporary failure");
    await writer.close();
  });

  it("flushes on timer only after the insert succeeds", async () => {
    const inserter = new FakeInserter(false);
    const writer = new BufferedCDEventsWriter(
      inserter,
      createTestConfig({ cdeventsBatchSize: 10 }),
    );

    const writePromise = writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    let settled = false;
    void writePromise.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(19);
    expect(inserter.batches).toHaveLength(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(inserter.batches).toHaveLength(1);
    expect(settled).toBe(false);

    inserter.pending[0]?.resolve();

    await expect(writePromise).resolves.toBeUndefined();
    await writer.close();
  });

  it("batches concurrent writes into a single timer flush", async () => {
    const inserter = new FakeInserter(false);
    const writer = new BufferedCDEventsWriter(
      inserter,
      createTestConfig({ cdeventsBatchSize: 10 }),
    );

    const firstWrite = writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    const secondWrite = writer.writeRows([{ deliveryId: "2" } as CDEventRow]);

    await vi.advanceTimersByTimeAsync(20);

    expect(inserter.batches).toHaveLength(1);
    expect(inserter.batches[0]?.map((row) => row.deliveryId)).toEqual([
      "1",
      "2",
    ]);

    inserter.pending[0]?.resolve();

    await expect(firstWrite).resolves.toBeUndefined();
    await expect(secondWrite).resolves.toBeUndefined();
    await writer.close();
  });

  it("keeps writes queued during an in-flight flush for the next flush", async () => {
    const inserter = new FakeInserter(false);
    const writer = new BufferedCDEventsWriter(inserter, createTestConfig());

    const firstWrite = writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    const secondWrite = writer.writeRows([{ deliveryId: "2" } as CDEventRow]);
    await vi.waitFor(() => {
      expect(inserter.batches).toHaveLength(1);
    });

    const thirdWrite = writer.writeRows([{ deliveryId: "3" } as CDEventRow]);
    await vi.advanceTimersByTimeAsync(20);
    expect(inserter.batches).toHaveLength(1);

    inserter.pending[0]?.resolve();
    await expect(firstWrite).resolves.toBeUndefined();
    await expect(secondWrite).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(0);
    expect(inserter.batches).toHaveLength(2);
    expect(inserter.batches[1]?.map((row) => row.deliveryId)).toEqual(["3"]);

    inserter.pending[1]?.resolve();
    await expect(thirdWrite).resolves.toBeUndefined();
    await writer.close();
  });

  it("rejects failed flushes without re-buffering them", async () => {
    const inserter = new FakeInserter(false);
    const writer = new BufferedCDEventsWriter(
      inserter,
      createTestConfig({ cdeventsBatchSize: 10 }),
    );

    const firstWrite = writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    const secondWrite = writer.writeRows([{ deliveryId: "2" } as CDEventRow]);

    await vi.advanceTimersByTimeAsync(20);
    expect(inserter.batches).toHaveLength(1);

    inserter.pending[0]?.reject(new Error("temporary failure"));

    await expect(firstWrite).rejects.toThrow("temporary failure");
    await expect(secondWrite).rejects.toThrow("temporary failure");

    await vi.advanceTimersByTimeAsync(100);
    expect(inserter.batches).toHaveLength(1);
    await writer.close();
  });

  it("flushes pending rows on close", async () => {
    const inserter = new FakeInserter(false);
    const writer = new BufferedCDEventsWriter(
      inserter,
      createTestConfig({ cdeventsBatchSize: 10 }),
    );

    const writePromise = writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    const closePromise = writer.close();

    await vi.waitFor(() => {
      expect(inserter.batches).toHaveLength(1);
    });

    inserter.pending[0]?.resolve();

    await expect(writePromise).resolves.toBeUndefined();
    await expect(closePromise).resolves.toBeUndefined();
  });

  it("propagates close flush failures", async () => {
    const inserter = new FakeInserter(false);
    const writer = new BufferedCDEventsWriter(
      inserter,
      createTestConfig({ cdeventsBatchSize: 10 }),
    );

    const writePromise = writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    const closePromise = writer.close();

    await vi.waitFor(() => {
      expect(inserter.batches).toHaveLength(1);
    });

    inserter.pending[0]?.reject(new Error("temporary failure"));

    await expect(writePromise).rejects.toThrow("temporary failure");
    await expect(closePromise).rejects.toThrow("temporary failure");
  });
});
