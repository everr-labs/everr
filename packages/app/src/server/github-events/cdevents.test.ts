import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  BufferedCDEventsWriter,
  type CDEventInserter,
  type CDEventRow,
  transformToCDEventRows,
} from "./cdevents";
import { getGitHubEventsConfig } from "./config";

function readFixture(relativePath: string): Buffer {
  return readFileSync(new URL(relativePath, import.meta.url));
}

describe("transformToCDEventRows", () => {
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

class FakeInserter implements CDEventInserter {
  readonly batches: CDEventRow[][] = [];

  constructor(private failures = 0) {}

  async insert(rows: CDEventRow[]) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("temporary failure");
    }

    this.batches.push([...rows]);
  }
}

function createTestConfig(
  overrides: Partial<ReturnType<typeof getGitHubEventsConfig>> = {},
) {
  return {
    ...getGitHubEventsConfig(),
    cdeventsBatchSize: 2,
    cdeventsFlushIntervalMs: 20,
    cdeventsFlushRetryDelayMs: 10,
    ...overrides,
  };
}

async function waitForBatches(inserter: FakeInserter, want: number) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (inserter.batches.length >= want) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`expected at least ${want} batches`);
}

afterEach(async () => {
  await Promise.resolve();
});

describe("BufferedCDEventsWriter", () => {
  it("flushes on batch size", async () => {
    const inserter = new FakeInserter();
    const writer = new BufferedCDEventsWriter(inserter, createTestConfig());

    try {
      await writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
      await writer.writeRows([{ deliveryId: "2" } as CDEventRow]);

      await waitForBatches(inserter, 1);
    } finally {
      await writer.close();
    }
  });

  it("flushes on timer", async () => {
    const inserter = new FakeInserter();
    const writer = new BufferedCDEventsWriter(
      inserter,
      createTestConfig({ cdeventsBatchSize: 10 }),
    );

    try {
      await writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
      await waitForBatches(inserter, 1);
    } finally {
      await writer.close();
    }
  });

  it("retries after transient failure", async () => {
    const inserter = new FakeInserter(1);
    const writer = new BufferedCDEventsWriter(
      inserter,
      createTestConfig({ cdeventsBatchSize: 10 }),
    );

    try {
      await writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
      await waitForBatches(inserter, 1);
    } finally {
      await writer.close();
    }
  });

  it("flushes pending rows on close", async () => {
    const inserter = new FakeInserter();
    const writer = new BufferedCDEventsWriter(
      inserter,
      createTestConfig({ cdeventsBatchSize: 10 }),
    );

    await writer.writeRows([{ deliveryId: "1" } as CDEventRow]);
    await writer.close();

    expect(inserter.batches).toHaveLength(1);
  });
});
