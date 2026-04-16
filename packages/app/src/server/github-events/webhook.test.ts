// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { webhookSecret, webhookMocks } = vi.hoisted(() => {
  const webhookSecret = "super-secret-value-1234567890-ab";
  process.env.INGRESS_SOURCE = "github";
  process.env.INGRESS_COLLECTOR_URL = "http://localhost:8080/webhook/github";
  process.env.GITHUB_APP_WEBHOOK_SECRET = webhookSecret;
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_PRIVATE_KEY = "test-key";

  return {
    webhookSecret,
    webhookMocks: {
      enqueueWebhookEvent: vi.fn(),
    },
  };
});

vi.mock("./runtime", () => ({
  enqueueWebhookEvent: webhookMocks.enqueueWebhookEvent,
}));

vi.mock("@/db/client", () => {
  const set = vi
    .fn()
    .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  return {
    db: {
      update: vi.fn().mockReturnValue({ set }),
    },
  };
});

vi.mock("@/db/schema", () => ({
  githubInstallationOrganizations: {
    githubInstallationId: "github_installation_id",
  },
}));

import { db } from "@/db/client";
import { handleGitHubWebhookRequest } from "./webhook";

const mockedDb = vi.mocked(db);

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

beforeEach(() => {
  webhookMocks.enqueueWebhookEvent.mockReset().mockResolvedValue(undefined);
  vi.clearAllMocks();
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

  it("enqueues workflow events via enqueueWebhookEvent", async () => {
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
    expect(webhookMocks.enqueueWebhookEvent).toHaveBeenCalledOnce();
    expect(webhookMocks.enqueueWebhookEvent).toHaveBeenCalledWith(
      "delivery-1",
      {
        headers: expect.objectContaining({
          "x-github-event": ["workflow_run"],
        }),
        body: expect.any(String),
      },
    );
  });

  it("passes the eventId as deduplication id", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "requested",
      installation: { id: 123 },
      workflow_run: { id: 456, run_attempt: 1, name: "Tests" },
    });

    await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "workflow_run",
          "x-github-delivery": "delivery-abc",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
    );

    const eventId = webhookMocks.enqueueWebhookEvent.mock.calls[0][0];
    expect(eventId).toBe("delivery-abc");
  });

  it("handles installation deleted events inline without enqueueing", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "deleted",
      installation: { id: 123 },
    });
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
    expect(mockedDb.update).toHaveBeenCalled();
    expect(webhookMocks.enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("handles installation suspended events inline", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "suspend",
      installation: { id: 456 },
    });

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
    expect(mockedDb.update).toHaveBeenCalled();
    expect(webhookMocks.enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("handles installation_repositories events inline as no-op", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "added",
      installation: { id: 789 },
    });
    const response = await handleGitHubWebhookRequest(
      new Request("http://localhost/webhook/github", {
        method: "POST",
        headers: {
          "x-github-event": "installation_repositories",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
    );

    expect(response.status).toBe(202);
    expect(mockedDb.update).not.toHaveBeenCalled();
    expect(webhookMocks.enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("accepts ignored events without enqueueing", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({ zen: "keep it logically awesome." });

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
    expect(webhookMocks.enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("enqueues workflow_job events", async () => {
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
    expect(webhookMocks.enqueueWebhookEvent).toHaveBeenCalledOnce();
  });
});
