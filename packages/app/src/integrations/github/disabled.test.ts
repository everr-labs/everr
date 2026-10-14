import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("./configuration", () => ({ getGithubConfiguration: () => undefined }));
vi.mock("./events/enqueue", () => ({ enqueueWebhookEvent: vi.fn() }));

import { auth } from "@/lib/auth.server";
import {
  getGithubAppInstallStatus,
  getGithubAvailability,
  getInstallationRepos,
} from "./data";
import { enqueueWebhookEvent } from "./events/enqueue";
import { handleGitHubWebhookRequest } from "./events/webhook";
import { handleInstallCallback } from "./install-callback";
import { handleInstallStart } from "./install-start";

describe("disabled GitHub integration", () => {
  it("exposes only its availability", async () => {
    expect(await getGithubAvailability()).toEqual({ enabled: false });
  });
  it.each([
    handleInstallStart,
    handleInstallCallback,
    handleGitHubWebhookRequest,
  ])("rejects HTTP entrypoints before doing integration work", async (handle) => {
    vi.clearAllMocks();
    const result = await handle(new Request("http://localhost/github"));
    expect(result.status).toBe(404);
    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(enqueueWebhookEvent).not.toHaveBeenCalled();
  });
  it.each([
    getGithubAppInstallStatus,
    getInstallationRepos,
  ])("rejects integration data requests", async (request) => {
    await expect(request()).rejects.toMatchObject({ isNotFound: true });
  });
});
