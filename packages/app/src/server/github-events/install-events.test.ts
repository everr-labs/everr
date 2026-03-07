import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/tenants", () => ({
  setGithubInstallationStatus: vi.fn(),
}));

import { setGithubInstallationStatus } from "@/data/tenants";
import { handleInstallationEvent } from "./install-events";

const mockedSetGithubInstallationStatus = vi.mocked(
  setGithubInstallationStatus,
);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleInstallationEvent", () => {
  it("returns 400 for invalid JSON", async () => {
    const response = await handleInstallationEvent({
      eventType: "installation",
      bodyText: "{",
    });

    expect(response.status).toBe(400);
    expect(mockedSetGithubInstallationStatus).not.toHaveBeenCalled();
  });

  it("marks installation uninstalled for deleted installations", async () => {
    const response = await handleInstallationEvent({
      eventType: "installation",
      bodyText: JSON.stringify({
        action: "deleted",
        installation: { id: 456 },
      }),
    });

    expect(response.status).toBe(202);
    expect(mockedSetGithubInstallationStatus).toHaveBeenCalledWith(
      456,
      "uninstalled",
    );
  });

  it("marks installation suspended for suspended installations", async () => {
    const response = await handleInstallationEvent({
      eventType: "installation",
      bodyText: JSON.stringify({
        action: "suspend",
        installation: { id: 456 },
      }),
    });

    expect(response.status).toBe(202);
    expect(mockedSetGithubInstallationStatus).toHaveBeenCalledWith(
      456,
      "suspended",
    );
  });

  it("marks installation active for unsuspend installations", async () => {
    const response = await handleInstallationEvent({
      eventType: "installation",
      bodyText: JSON.stringify({
        action: "unsuspend",
        installation: { id: 456 },
      }),
    });

    expect(response.status).toBe(202);
    expect(mockedSetGithubInstallationStatus).toHaveBeenCalledWith(
      456,
      "active",
    );
  });

  it("accepts installation_repositories as a no-op", async () => {
    const response = await handleInstallationEvent({
      eventType: "installation_repositories",
      bodyText: JSON.stringify({
        action: "added",
        installation: { id: 456 },
      }),
    });

    expect(response.status).toBe(202);
    expect(mockedSetGithubInstallationStatus).not.toHaveBeenCalled();
  });

  it("ignores unrelated event types", async () => {
    const response = await handleInstallationEvent({
      eventType: "workflow_job",
      bodyText: JSON.stringify({}),
    });

    expect(response.status).toBe(202);
    expect(mockedSetGithubInstallationStatus).not.toHaveBeenCalled();
  });
});
