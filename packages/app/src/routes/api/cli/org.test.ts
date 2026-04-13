import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./org";

type GetHandler = (args: {
  request: Request;
  context: {
    session: {
      session: { activeOrganizationId: string; userId: string };
      user: { id: string };
    };
  };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for /api/cli/org.");
  return handler;
}

const context = {
  session: {
    session: { activeOrganizationId: "org_xyz", userId: "user_abc" },
    user: { id: "user_abc" },
  },
};

async function mockGetFullOrganization(result: unknown) {
  const { auth } = await import("@/lib/auth.server");
  vi.mocked(auth.api.getFullOrganization).mockResolvedValueOnce(
    result as never,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/org", () => {
  it("returns org name and isOnlyMember true when user is the only member", async () => {
    await mockGetFullOrganization({
      name: "Test Org",
      members: [{ userId: "user_abc", role: "admin" }],
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "Test Org",
      isOnlyMember: true,
    });
  });

  it("returns isOnlyMember false when another member exists", async () => {
    await mockGetFullOrganization({
      name: "Test Org",
      members: [
        { userId: "user_abc", role: "admin" },
        { userId: "user_def", role: "member" },
      ],
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ isOnlyMember: false });
  });

  it("returns isOnlyMember false when the user is not the only member", async () => {
    await mockGetFullOrganization({
      name: "Test Org",
      members: [
        { userId: "user_abc", role: "admin" },
        { userId: "user_def", role: "admin" },
      ],
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(await response.json()).toMatchObject({ isOnlyMember: false });
  });
});
