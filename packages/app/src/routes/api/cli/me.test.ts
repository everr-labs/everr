import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./me";

type GetHandler = (args: {
  request: Request;
  context: { session: { userId: string; organizationId: string } };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for /api/cli/me.");
  return handler;
}

const context = {
  session: { userId: "user_abc", organizationId: "org-42" },
};

async function mockBetterAuthSession(session: unknown) {
  const { auth } = await import("@/lib/auth.server");
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(session as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/me", () => {
  it("returns user profile", async () => {
    await mockBetterAuthSession({
      user: {
        email: "alice@example.com",
        name: "Alice Smith",
        image: "https://example.com/avatar.png",
      },
      session: {},
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/me"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: "alice@example.com",
      name: "Alice Smith",
      profileUrl: "https://example.com/avatar.png",
    });
  });

  it("returns name from user.name when present", async () => {
    await mockBetterAuthSession({
      user: {
        email: "alice@example.com",
        name: "Alice",
        image: null,
      },
      session: {},
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/me"),
      context,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Alice");
    expect(body.profileUrl).toBe(null);
  });

  it("falls back to email as name when name is absent", async () => {
    await mockBetterAuthSession({
      user: {
        email: "alice@example.com",
        name: null,
        image: null,
      },
      session: {},
    });

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/me"),
      context,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("alice@example.com");
  });
});
