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

type PatchHandler = GetHandler;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for /api/cli/org.");
  return handler;
}

function patchHandler(): PatchHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { PATCH?: PatchHandler } };
  };
  const handler = routeOptions.server?.handlers?.PATCH;
  if (!handler) throw new Error("Missing PATCH handler for /api/cli/org.");
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
      onboardingCompleted: false,
      role: "admin",
    });
  });

  it("returns onboardingCompleted true when the active org metadata has it", async () => {
    await mockGetFullOrganization({
      name: "Test Org",
      members: [{ userId: "user_abc", role: "admin" }],
      metadata: { onboardingCompleted: true },
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "Test Org",
      isOnlyMember: true,
      onboardingCompleted: true,
      role: "admin",
    });
  });

  it("parses metadata when better-auth returns it as a JSON string", async () => {
    await mockGetFullOrganization({
      name: "Test Org",
      members: [{ userId: "user_abc", role: "admin" }],
      metadata: JSON.stringify({ onboardingCompleted: true }),
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ onboardingCompleted: true });
  });

  it("returns the current user's role in the active org", async () => {
    await mockGetFullOrganization({
      name: "Test Org",
      members: [
        { userId: "user_other", role: "owner" },
        { userId: "user_abc", role: "member" },
      ],
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "member" });
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

  it("marks active org onboarding complete", async () => {
    await mockGetFullOrganization({
      name: "Test Org",
      members: [{ userId: "user_abc", role: "admin" }],
      metadata: { plan: "free", onboardingCompleted: false },
    });
    const { auth } = await import("@/lib/auth.server");

    const response = await patchHandler()({
      request: new Request("http://localhost/api/cli/org", {
        method: "PATCH",
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(auth.api.updateOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        organizationId: "org_xyz",
        data: {
          metadata: { plan: "free", onboardingCompleted: true },
        },
      },
    });
  });

  it("preserves existing metadata keys when better-auth returns it as a JSON string", async () => {
    await mockGetFullOrganization({
      name: "Test Org",
      members: [{ userId: "user_abc", role: "admin" }],
      metadata: JSON.stringify({ plan: "free", onboardingCompleted: false }),
    });
    const { auth } = await import("@/lib/auth.server");

    await patchHandler()({
      request: new Request("http://localhost/api/cli/org", {
        method: "PATCH",
      }),
      context,
    });

    expect(auth.api.updateOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        organizationId: "org_xyz",
        data: {
          metadata: { plan: "free", onboardingCompleted: true },
        },
      },
    });
  });
});
