import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("#app/integrations/github/configuration.ts", () => ({
  getGithubConfiguration: () => ({
    GITHUB_APP_INSTALL_URL: "https://github.com/apps/everr/installations/new",
  }),
}));

vi.mock("#app/lib/github-install-state.ts", () => ({
  createInstallState: vi.fn(() => "signed-state"),
}));

import { auth } from "#app/identity/server.ts";
import { createInstallState } from "#app/lib/github-install-state.ts";
import { Route } from "./start";

function getHandler() {
  const routeOptions = Route.options as unknown as {
    server?: {
      handlers?: {
        GET?: (args: { request: Request }) => Promise<Response>;
      };
    };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for install start route.");
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user_1" },
    session: { activeOrganizationId: "org_1" },
  } as never);
});

describe("/api/github/install/start", () => {
  it("rejects ordinary members", async () => {
    vi.mocked(auth.api.getActiveMemberRole).mockResolvedValue({
      role: "member",
    } as never);

    const response = await getHandler()({
      request: new Request("http://localhost/api/github/install/start"),
    });

    expect(response.status).toBe(403);
    expect(createInstallState).not.toHaveBeenCalled();
  });

  it.each(["admin", "owner"])("starts installation for an %s", async (role) => {
    vi.mocked(auth.api.getActiveMemberRole).mockResolvedValue({
      role,
    } as never);

    const response = await getHandler()({
      request: new Request("http://localhost/api/github/install/start"),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://github.com/apps/everr/installations/new?state=signed-state",
    );
    expect(createInstallState).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "user_1",
    });
  });
});
