import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.INGRESS_SOURCE = "github";
  process.env.INGRESS_COLLECTOR_URL = "http://localhost:8080/webhook/github";
  process.env.INGRESS_WORKER_COUNT = "2";
  process.env.INGRESS_WORKER_BATCH_SIZE = "10";
  process.env.INGRESS_MAX_ATTEMPTS = "10";
  process.env.INGRESS_POLL_INTERVAL = "2000ms";
  process.env.INGRESS_LOCK_DURATION = "120000ms";
  process.env.INGRESS_REPLAY_TIMEOUT = "30000ms";
  process.env.INGRESS_TENANT_CACHE_TTL = "60000ms";
  process.env.INGRESS_RETENTION_DONE_DAYS = "7";
  process.env.INGRESS_RETENTION_DEAD_DAYS = "30";
  process.env.INGRESS_CLEANUP_INTERVAL = "3600000ms";
  process.env.CDEVENTS_CLICKHOUSE_URL = "http://localhost:8123";
  process.env.CDEVENTS_CLICKHOUSE_USERNAME = "app_cdevents_rw";
  process.env.CDEVENTS_CLICKHOUSE_PASSWORD = "app-cdevents-dev";
  process.env.CDEVENTS_CLICKHOUSE_DATABASE = "app";
  process.env.CDEVENTS_BATCH_SIZE = "100";
  process.env.CDEVENTS_FLUSH_INTERVAL = "5000ms";
});

vi.mock("@/data/tenants", () => ({
  setGithubInstallationStatus: vi.fn(),
}));

vi.mock("./queue-store", () => ({
  getWebhookEventStore: () => {
    throw new Error("getWebhookEventStore should not be used in tests");
  },
}));

import type { WebhookEventStore } from "./queue-store";
import type { WebhookTopic } from "./types";
import { handleGitHubWebhookRequest } from "./webhook";

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

class StubStore implements WebhookEventStore {
  enqueueCalls: Array<{
    source: string;
    eventId: string;
    bodySha256: string;
    topics: readonly WebhookTopic[];
  }> = [];

  constructor(
    private readonly status: "inserted" | "duplicate" | "conflict" = "inserted",
  ) {}

  async enqueueEvent(args: {
    source: string;
    eventId: string;
    bodySha256: string;
    topics: readonly WebhookTopic[];
  }) {
    this.enqueueCalls.push(args);
    return this.status;
  }

  async claimEvents() {
    return [];
  }

  async renewEventLock() {
    return true;
  }

  async finalizeEvent() {
    return true;
  }

  async cleanup() {}
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleGitHubWebhookRequest", () => {
  it("rejects invalid signatures", async () => {
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "super-secret-value-1234567890");

    const response = await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "workflow_run",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": "sha256=bad",
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("enqueues workflow events for collector and cdevents", async () => {
    const secret = "super-secret-value-1234567890";
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({ action: "requested" });
    const store = new StubStore("inserted");

    const response = await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "workflow_run",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
      { store },
    );

    expect(response.status).toBe(202);
    expect(store.enqueueCalls[0]?.topics).toEqual(["collector", "cdevents"]);
  });

  it("returns 200 for duplicate workflow events", async () => {
    const secret = "super-secret-value-1234567890";
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({ action: "requested" });

    const response = await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "workflow_run",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
      { store: new StubStore("duplicate") },
    );

    expect(response.status).toBe(200);
  });

  it("returns 409 for conflicting workflow events", async () => {
    const secret = "super-secret-value-1234567890";
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({ action: "requested" });

    const response = await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "workflow_run",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
      { store: new StubStore("conflict") },
    );

    expect(response.status).toBe(409);
  });

  it("handles installation events inline without enqueueing", async () => {
    const secret = "super-secret-value-1234567890";
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "deleted",
      installation: { id: 123 },
    });
    const store = new StubStore("inserted");
    const installHandler = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));

    const response = await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "installation",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
      {
        store,
        installHandler,
      },
    );

    expect(response.status).toBe(202);
    expect(installHandler).toHaveBeenCalledTimes(1);
    expect(store.enqueueCalls).toHaveLength(0);
  });

  it("accepts ignored events without enqueueing", async () => {
    const secret = "super-secret-value-1234567890";
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({ zen: "keep it logically awesome." });
    const store = new StubStore("inserted");

    const response = await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "ping",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
      { store },
    );

    expect(response.status).toBe(202);
    expect(store.enqueueCalls).toHaveLength(0);
  });
});
