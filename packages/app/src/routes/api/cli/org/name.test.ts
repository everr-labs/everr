import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: { options: {} },
}));

vi.mock("@/lib/workos", () => ({
  workOS: {
    organizations: {
      updateOrganization: vi.fn(),
    },
  },
}));

import { workOS } from "@/lib/workos";
import { Route } from "./name";

const mockedUpdateOrg = vi.mocked(workOS.organizations.updateOrganization);

type PatchHandler = (args: {
  request: Request;
  context: { session: { organizationId: string; tenantId: number } };
}) => Promise<Response>;

function getHandler(): PatchHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { PATCH?: PatchHandler } };
  };
  const handler = routeOptions.server?.handlers?.PATCH;
  if (!handler) throw new Error("Missing PATCH handler for /api/cli/org/name.");
  return handler;
}

const context = { session: { organizationId: "org_xyz", tenantId: 1 } };

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/org/name", () => {
  it("updates org name and returns ok", async () => {
    mockedUpdateOrg.mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof mockedUpdateOrg>>,
    );

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org/name", {
        method: "PATCH",
        body: JSON.stringify({ name: "New Name" }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockedUpdateOrg).toHaveBeenCalledWith({
      organization: "org_xyz",
      name: "New Name",
    });
  });

  it("returns 400 when name is missing", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org/name", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(400);
    expect(mockedUpdateOrg).not.toHaveBeenCalled();
  });

  it("returns 400 when name is empty string", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org/name", {
        method: "PATCH",
        body: JSON.stringify({ name: "" }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(400);
  });
});
