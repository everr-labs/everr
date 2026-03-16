// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { webhookSecret, webhookMocks } = vi.hoisted(() => {
  const webhookSecret = "super-secret-value-1234567890-ab";
  process.env.INGRESS_SOURCE = "github";
  process.env.INGRESS_COLLECTOR_URL = "http://localhost:8080/webhook/github";
  process.env.GITHUB_APP_WEBHOOK_SECRET = webhookSecret;

  return {
    webhookSecret,
    webhookMocks: {
      store: null as {
        enqueueEvent?: unknown;
        claimEvents?: unknown;
        renewEventLock?: unknown;
        finalizeEvent?: unknown;
        cleanup?: unknown;
      } | null,
      installHandler: vi.fn(),
    },
  };
});

vi.mock("./queue-store", () => ({
  getWebhookEventStore: () => {
    if (!webhookMocks.store) {
      throw new Error(
        "getWebhookEventStore should not be used without a test store",
      );
    }

    return webhookMocks.store;
  },
}));

vi.mock("./install-events", () => ({
  handleInstallationEvent: webhookMocks.installHandler,
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
    repositoryId?: number | null;
    topics: readonly WebhookTopic[];
  }> = [];

  constructor(
    private readonly status: "inserted" | "duplicate" | "conflict" = "inserted",
  ) {}

  async enqueueEvent(args: {
    source: string;
    eventId: string;
    bodySha256: string;
    repositoryId?: number | null;
    topics: readonly WebhookTopic[];
    headers: Record<string, string[]>;
    body: Buffer;
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

beforeEach(() => {
  webhookMocks.store = null;
  webhookMocks.installHandler.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleGitHubWebhookRequest", () => {
  it("rejects invalid signatures", async () => {
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", webhookSecret);

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

  it("enqueues workflow events for collector and status", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "requested",
      installation: { id: 123 },
      repository: { id: 654321 },
      workflow_run: {
        id: 456,
        run_attempt: 2,
        name: "Tests",
      },
    });
    const store = new StubStore("inserted");
    webhookMocks.store = store;

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
    );

    expect(response.status).toBe(202);
    expect(store.enqueueCalls[0]?.topics).toEqual(["collector", "status"]);
    expect(store.enqueueCalls[0]?.repositoryId).toBe(654321);
  });

  it("extracts repository ids from workflow_job payloads", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "queued",
      installation: { id: 123 },
      repository: { id: 654321 },
      workflow_job: {
        id: 789,
        run_id: 456,
        run_attempt: 2,
        name: "test",
      },
    });
    const store = new StubStore("inserted");
    webhookMocks.store = store;

    const response = await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "workflow_job",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
    );

    expect(response.status).toBe(202);
    expect(store.enqueueCalls).toHaveLength(1);
    expect(store.enqueueCalls[0]?.repositoryId).toBe(654321);
  });

  it("accepts minimal workflow payloads without enqueueing them", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({ action: "requested" });
    const store = new StubStore("inserted");
    webhookMocks.store = store;

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
    );

    expect(response.status).toBe(202);
    expect(store.enqueueCalls).toHaveLength(0);
  });

  it("returns 200 for duplicate workflow events", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "requested",
      installation: { id: 123 },
      workflow_run: {
        id: 456,
        run_attempt: 1,
        name: "Tests",
      },
    });
    webhookMocks.store = new StubStore("duplicate");

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
    );

    expect(response.status).toBe(200);
  });

  it("returns 409 for conflicting workflow events", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "requested",
      installation: { id: 123 },
      workflow_run: {
        id: 456,
        run_attempt: 1,
        name: "Tests",
      },
    });
    webhookMocks.store = new StubStore("conflict");

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
    );

    expect(response.status).toBe(409);
  });

  it("handles installation events inline without enqueueing", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "deleted",
      installation: { id: 123 },
    });
    const store = new StubStore("inserted");
    webhookMocks.store = store;
    webhookMocks.installHandler.mockResolvedValue(
      new Response(null, { status: 202 }),
    );

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
    );

    expect(response.status).toBe(202);
    expect(webhookMocks.installHandler).toHaveBeenCalledTimes(1);
    expect(store.enqueueCalls).toHaveLength(0);
  });

  it("accepts ignored events without enqueueing", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({ zen: "keep it logically awesome." });
    const store = new StubStore("inserted");
    webhookMocks.store = store;

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
    );

    expect(response.status).toBe(202);
    expect(store.enqueueCalls).toHaveLength(0);
  });
});
