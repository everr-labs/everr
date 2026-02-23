import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: vi.fn(),
}));

vi.mock("@/lib/github-install-state", () => ({
  parseInstallState: vi.fn(),
}));

vi.mock("@/data/tenants", () => {
  class MockGithubInstallationAlreadyLinkedError extends Error {
    constructor() {
      super("already linked");
      this.name = "GithubInstallationAlreadyLinkedError";
    }
  }

  return {
    ensureTenantForOrganizationId: vi.fn(),
    linkGithubInstallationToTenant: vi.fn(),
    GithubInstallationAlreadyLinkedError:
      MockGithubInstallationAlreadyLinkedError,
  };
});

import { getAuth } from "@workos/authkit-tanstack-react-start";
import {
  ensureTenantForOrganizationId,
  GithubInstallationAlreadyLinkedError,
  linkGithubInstallationToTenant,
} from "@/data/tenants";
import { parseInstallState } from "@/lib/github-install-state";
import { Route } from "./callback";

const mockedGetAuth = vi.mocked(getAuth);
const mockedEnsureTenantForOrganizationId = vi.mocked(
  ensureTenantForOrganizationId,
);
const mockedLinkGithubInstallationToTenant = vi.mocked(
  linkGithubInstallationToTenant,
);
const mockedParseInstallState = vi.mocked(parseInstallState);

function getHandler() {
  const routeOptions = Route.options as unknown as {
    server?: {
      handlers?: {
        GET?: (args: { request: Request }) => Promise<Response>;
      };
    };
  };

  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) {
    throw new Error("Missing GET handler for install callback route.");
  }

  return handler as (args: { request: Request }) => Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAuth.mockResolvedValue({
    user: { id: "user_1" },
    organizationId: "org_1",
  } as never);
  mockedParseInstallState.mockReturnValue({
    userId: "user_1",
    organizationId: "org_1",
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  mockedEnsureTenantForOrganizationId.mockResolvedValue(11);
});

describe("/api/github/install/callback", () => {
  it("redirects with already_linked when installation belongs to another tenant", async () => {
    mockedLinkGithubInstallationToTenant.mockRejectedValue(
      new GithubInstallationAlreadyLinkedError(),
    );

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/github/install/callback?installation_id=123&state=ok",
      ),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost/dashboard?github_install=error&reason=already_linked",
    );
  });
});
