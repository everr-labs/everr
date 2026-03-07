import { describe, expect, it, vi } from "vitest";

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
  finalized:
    | {
        eventId: number;
        attempts: number;
        result: "done" | "dead" | "failed";
        errorClass?: string;
        lastError?: string;
      }
    | undefined;
  persistedTenantId: number | undefined;

  async enqueueEvent(
    _args: Parameters<WebhookEventStore["enqueueEvent"]>[0],
  ): ReturnType<WebhookEventStore["enqueueEvent"]> {
    return "inserted";
  }

  async claimEvents() {
    return [];
  }

  async persistTenantId(_eventId: number, tenantId: number) {
    this.persistedTenantId = tenantId;
  }

  async finalizeEvent(args: {
    eventId: number;
    attempts: number;
    result: "done" | "dead" | "failed";
    errorClass?: string;
    lastError?: string;
  }) {
    this.finalized = args;
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
    tenantId: null,
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
  it("marks collector deliveries done and persists tenant id", async () => {
    const store = new StubStore();
    let collectorCalls = 0;

    await processWebhookEvent(buildEvent(topicCollector), {
      store,
      tenantResolver: new StubTenantResolver(42) as never,
      replayCollector: async () => {
        collectorCalls += 1;
      },
    });

    expect(store.finalized).toMatchObject({ result: "done" });
    expect(store.persistedTenantId).toBe(42);
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

    expect(store.finalized).toMatchObject({
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

    expect(store.finalized).toMatchObject({
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

    expect(store.finalized).toMatchObject({
      result: "failed",
      errorClass: "retryable",
    });
  });
});
