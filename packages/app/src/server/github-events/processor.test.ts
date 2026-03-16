// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const processorMocks = vi.hoisted(() => ({
  store: null as {
    enqueueEvent?: unknown;
    claimEvents?: unknown;
    renewEventLock?: unknown;
    finalizeEvent?: unknown;
    cleanup?: unknown;
  } | null,
  tenantResolver: {
    resolveTenantId: vi.fn(),
  },
  replayCollector: vi.fn(),
  handleStatusEvent: vi.fn(),
  sleep: vi.fn(),
  db: {},
}));

vi.hoisted(() => {
  process.env.INGRESS_SOURCE = "github";
  process.env.INGRESS_COLLECTOR_URL = "http://localhost:8080/webhook/github";
});

vi.mock("./queue-store", () => ({
  getWebhookEventStore: () => {
    if (!processorMocks.store) {
      throw new Error(
        "getWebhookEventStore should not be used without a test store",
      );
    }

    return processorMocks.store;
  },
}));

vi.mock("./tenant-resolver", () => ({
  getTenantResolver: () => processorMocks.tenantResolver,
}));

vi.mock("./collector", () => ({
  replayWebhookToCollector: processorMocks.replayCollector,
}));

vi.mock("./status-writer", () => ({
  handleStatusEvent: processorMocks.handleStatusEvent,
}));

vi.mock("./sleep", () => ({
  sleep: processorMocks.sleep,
}));

vi.mock("@/db/client", () => ({
  db: processorMocks.db,
}));

import { processWebhookEvent } from "./processor";
import type { WebhookEventStore } from "./queue-store";
import type { WebhookEventRecord } from "./types";
import { topicCollector, topicStatus } from "./types";

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

function buildEvent(
  topic: typeof topicCollector | typeof topicStatus,
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

beforeEach(() => {
  processorMocks.store = null;
  processorMocks.tenantResolver.resolveTenantId
    .mockReset()
    .mockResolvedValue(42);
  processorMocks.replayCollector.mockReset().mockResolvedValue(undefined);
  processorMocks.handleStatusEvent.mockReset().mockResolvedValue(undefined);
  processorMocks.sleep.mockReset().mockResolvedValue(undefined);
});

describe("processWebhookEvent", () => {
  it("marks collector deliveries done after resolving the tenant", async () => {
    const store = new StubStore();
    processorMocks.store = store;

    await processWebhookEvent(buildEvent(topicCollector));

    expect(store.finalizeCalls.at(-1)).toMatchObject({ result: "done" });
    expect(processorMocks.replayCollector).toHaveBeenCalledTimes(1);
  });

  it("marks collector failures retryable", async () => {
    const store = new StubStore();
    processorMocks.store = store;
    processorMocks.replayCollector.mockRejectedValue(new Error("unavailable"));

    await processWebhookEvent(buildEvent(topicCollector));

    expect(store.finalizeCalls.at(-1)).toMatchObject({
      result: "failed",
      errorClass: "retryable",
    });
  });

  it("marks status deliveries done on success", async () => {
    const store = new StubStore();
    processorMocks.store = store;

    await processWebhookEvent(buildEvent(topicStatus));

    expect(store.finalizeCalls.at(-1)).toMatchObject({ result: "done" });
    expect(processorMocks.handleStatusEvent).toHaveBeenCalledTimes(1);
    expect(processorMocks.handleStatusEvent.mock.calls[0]?.[1]).toBe(42);
  });

  it("marks status failures retryable", async () => {
    const store = new StubStore();
    processorMocks.store = store;
    processorMocks.handleStatusEvent.mockRejectedValue(new Error("db error"));

    await processWebhookEvent(buildEvent(topicStatus));

    expect(store.finalizeCalls.at(-1)).toMatchObject({
      result: "failed",
      errorClass: "retryable",
    });
  });

  it("retries finalization after a transient store failure without replaying the side effect", async () => {
    const store = new StubStore();
    store.finalizeResults = [new Error("db unavailable"), true];
    processorMocks.store = store;

    await processWebhookEvent(buildEvent(topicCollector));

    expect(processorMocks.replayCollector).toHaveBeenCalledTimes(1);
    expect(store.finalizeCalls).toHaveLength(2);
    expect(store.renewCalls).toEqual([{ eventId: 1, attempts: 1 }]);
    expect(processorMocks.sleep).toHaveBeenCalledTimes(1);
  });

  it("stops finalization retries when the claim has already been lost", async () => {
    const store = new StubStore();
    store.finalizeResults = [new Error("db unavailable"), false];
    store.renewResults = [false];
    processorMocks.store = store;

    await processWebhookEvent(buildEvent(topicCollector));

    expect(processorMocks.replayCollector).toHaveBeenCalledTimes(1);
    expect(store.finalizeCalls).toHaveLength(1);
    expect(store.renewCalls).toEqual([{ eventId: 1, attempts: 1 }]);
    expect(processorMocks.sleep).not.toHaveBeenCalled();
  });
});
