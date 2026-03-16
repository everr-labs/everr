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
      send: vi.fn(),
      setInstallationStatus: vi.fn(),
    },
  };
});

vi.mock("./runtime", () => ({
  getBoss: () => ({ send: webhookMocks.send }),
}));

vi.mock("@/data/tenants", () => ({
  setGithubInstallationStatus: webhookMocks.setInstallationStatus,
}));

import { handleGitHubWebhookRequest } from "./webhook";

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

beforeEach(() => {
  webhookMocks.send.mockReset().mockResolvedValue("job-id");
  webhookMocks.setInstallationStatus.mockReset();
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

  it("enqueues workflow events to gh-collector and gh-status", async () => {
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
    expect(webhookMocks.send).toHaveBeenCalledTimes(2);
    const queues = webhookMocks.send.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0] as string,
    );
    expect(queues).toContain("gh-collector");
    expect(queues).toContain("gh-status");
  });

  it("uses eventId-scoped deduplication ids", async () => {
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

    const ids = webhookMocks.send.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => (c[2] as { id: string }).id,
    );
    expect(ids).toContain("delivery-abc:gh-collector");
    expect(ids).toContain("delivery-abc:gh-status");
  });

  it("returns 200 when all sends return null (all deduplicated)", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    webhookMocks.send.mockResolvedValue(null);
    const payload = JSON.stringify({
      action: "requested",
      installation: { id: 123 },
      workflow_run: { id: 456, run_attempt: 1, name: "Tests" },
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

    expect(response.status).toBe(200);
  });

  it("returns 202 when at least one send is new (non-null)", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    webhookMocks.send
      .mockResolvedValueOnce("job-id-1")
      .mockResolvedValueOnce(null);
    const payload = JSON.stringify({
      action: "requested",
      installation: { id: 123 },
      workflow_run: { id: 456, run_attempt: 1, name: "Tests" },
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
  });

  it("handles installation deleted events inline without enqueueing", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "deleted",
      installation: { id: 123 },
    });
    webhookMocks.setInstallationStatus.mockResolvedValue(undefined);

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
    expect(webhookMocks.setInstallationStatus).toHaveBeenCalledWith(
      123,
      "uninstalled",
    );
    expect(webhookMocks.send).not.toHaveBeenCalled();
  });

  it("handles installation suspended events inline", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "suspend",
      installation: { id: 456 },
    });
    webhookMocks.setInstallationStatus.mockResolvedValue(undefined);

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
    expect(webhookMocks.setInstallationStatus).toHaveBeenCalledWith(
      456,
      "suspended",
    );
    expect(webhookMocks.send).not.toHaveBeenCalled();
  });

  it("handles installation_repositories events inline as no-op", async () => {
    const secret = webhookSecret;
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
      action: "added",
      installation: { id: 789 },
    });
    webhookMocks.setInstallationStatus.mockResolvedValue(undefined);

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
    expect(webhookMocks.setInstallationStatus).not.toHaveBeenCalled();
    expect(webhookMocks.send).not.toHaveBeenCalled();
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
    expect(webhookMocks.send).not.toHaveBeenCalled();
  });

  it("enqueues workflow_job events to both queues", async () => {
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
    expect(webhookMocks.send).toHaveBeenCalledTimes(2);
  });
});
