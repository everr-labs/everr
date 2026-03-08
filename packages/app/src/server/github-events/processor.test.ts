import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.INGRESS_SOURCE = "github";
  process.env.INGRESS_COLLECTOR_URL = "http://localhost:8080/webhook/github";
  process.env.CDEVENTS_CLICKHOUSE_URL = "http://localhost:8123";
  process.env.CDEVENTS_CLICKHOUSE_USERNAME = "app_cdevents_rw";
  process.env.CDEVENTS_CLICKHOUSE_PASSWORD = "app-cdevents-dev";
  process.env.CDEVENTS_CLICKHOUSE_DATABASE = "app";
});

vi.mock("./queue-store", () => ({
  getWebhookEventStore: () => {
    throw new Error("getWebhookEventStore should not be used in tests");
  },
}));

vi.mock("./tenant-resolver", () => ({
  getTenantResolver: () => {
    throw new Error("getTenantResolver should not be used in tests");
  },
}));

import { processWebhookEvent } from "./processor";
import type { WebhookEventStore } from "./queue-store";
import type { WebhookEventRecord } from "./types";
import { topicCDEvents, topicCollector } from "./types";

class StubStore implements WebhookEventStore {
  finalizeCalls: Array<{
    eventId: number;
    attempts: number;
    result: "done" | "dead" | "failed";
    errorClass?: string;
    lastError?: string;
  }> = [];
  renewCalls: Array<{ eventId: number; attempts: number }> = [];
  finalizeResults: Array<boolean | Error> = [true];
  renewResults: Array<boolean | Error> = [true];

  async enqueueEvent(
    _args: Parameters<WebhookEventStore["enqueueEvent"]>[0],
  ): ReturnType<WebhookEventStore["enqueueEvent"]> {
    return "inserted";
  }

  async claimEvents() {
    return [];
  }

  async renewEventLock(args: { eventId: number; attempts: number }) {
    this.renewCalls.push(args);
    const next = this.renewResults.shift() ?? true;
    if (next instanceof Error) {
      throw next;
    }

    return next;
  }

  async finalizeEvent(args: {
    eventId: number;
    attempts: number;
    result: "done" | "dead" | "failed";
    errorClass?: string;
    lastError?: string;
  }) {
    this.finalizeCalls.push(args);
    const next = this.finalizeResults.shift() ?? true;
    if (next instanceof Error) {
      throw next;
    }

    return next;
  }

  async cleanup() {}
}

class StubTenantResolver {
  constructor(
    private readonly tenantId: number,
    private readonly error?: Error,
  ) {}

  async resolveTenantId() {
    if (this.error) {
      throw this.error;
    }

    return this.tenantId;
  }
}

function buildEvent(
  topic: typeof topicCollector | typeof topicCDEvents,
): WebhookEventRecord {
  return {
    id: 1,
    source: "github",
    eventId: "delivery-1",
    topic,
    attempts: 1,
    headers: {
      "x-github-event": ["workflow_run"],
    },
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
  };
}

describe("processWebhookEvent", () => {
  it("marks collector deliveries done after resolving the tenant", async () => {
    const store = new StubStore();
    let collectorCalls = 0;

    await processWebhookEvent(buildEvent(topicCollector), {
      store,
      tenantResolver: new StubTenantResolver(42) as never,
      replayCollector: async () => {
        collectorCalls += 1;
      },
    });

    expect(store.finalizeCalls.at(-1)).toMatchObject({ result: "done" });
    expect(collectorCalls).toBe(1);
  });

  it("marks collector failures retryable", async () => {
    const store = new StubStore();

    await processWebhookEvent(buildEvent(topicCollector), {
      store,
      tenantResolver: new StubTenantResolver(42) as never,
      replayCollector: async () => {
        throw new Error("unavailable");
      },
    });

    expect(store.finalizeCalls.at(-1)).toMatchObject({
      result: "failed",
      errorClass: "retryable",
    });
  });

  it("marks cdevents 4xx responses terminal", async () => {
    const store = new StubStore();

    await processWebhookEvent(buildEvent(topicCDEvents), {
      store,
      tenantResolver: new StubTenantResolver(42) as never,
      handleCDEvents: async () => new Response("bad request", { status: 400 }),
    });

    expect(store.finalizeCalls.at(-1)).toMatchObject({
      result: "dead",
      errorClass: "terminal",
    });
  });

  it("marks cdevents 5xx responses retryable", async () => {
    const store = new StubStore();

    await processWebhookEvent(buildEvent(topicCDEvents), {
      store,
      tenantResolver: new StubTenantResolver(42) as never,
      handleCDEvents: async () => new Response("unavailable", { status: 503 }),
    });

    expect(store.finalizeCalls.at(-1)).toMatchObject({
      result: "failed",
      errorClass: "retryable",
    });
  });

  it("retries finalization after a transient store failure without replaying the side effect", async () => {
    const store = new StubStore();
    store.finalizeResults = [new Error("db unavailable"), true];
    let collectorCalls = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);

    await processWebhookEvent(buildEvent(topicCollector), {
      store,
      tenantResolver: new StubTenantResolver(42) as never,
      replayCollector: async () => {
        collectorCalls += 1;
      },
      sleep,
    });

    expect(collectorCalls).toBe(1);
    expect(store.finalizeCalls).toHaveLength(2);
    expect(store.renewCalls).toEqual([{ eventId: 1, attempts: 1 }]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("stops finalization retries when the claim has already been lost", async () => {
    const store = new StubStore();
    store.finalizeResults = [new Error("db unavailable"), false];
    store.renewResults = [false];
    let collectorCalls = 0;
    const sleep = vi.fn().mockResolvedValue(undefined);

    await processWebhookEvent(buildEvent(topicCollector), {
      store,
      tenantResolver: new StubTenantResolver(42) as never,
      replayCollector: async () => {
        collectorCalls += 1;
      },
      sleep,
    });

    expect(collectorCalls).toBe(1);
    expect(store.finalizeCalls).toHaveLength(1);
    expect(store.renewCalls).toEqual([{ eventId: 1, attempts: 1 }]);
    expect(sleep).not.toHaveBeenCalled();
  });
});
