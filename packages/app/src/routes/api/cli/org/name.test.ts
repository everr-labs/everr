import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./name";

type PatchHandler = (args: {
  request: Request;
  context: { session: { session: { activeOrganizationId: string } } };
}) => Promise<Response>;

function getHandler(): PatchHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { PATCH?: PatchHandler } };
  };
  const handler = routeOptions.server?.handlers?.PATCH;
  if (!handler) throw new Error("Missing PATCH handler for /api/cli/org/name.");
  return handler;
}

const context = { session: { session: { activeOrganizationId: "org_xyz" } } };

async function mockUpdateOrganization(result: unknown) {
  const { auth } = await import("@/lib/auth.server");
  vi.mocked(auth.api.updateOrganization).mockResolvedValueOnce(result as never);
}

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/org/name", () => {
  it("updates org name and returns ok", async () => {
    await mockUpdateOrganization({});

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
