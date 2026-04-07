import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: { options: {} },
}));

vi.mock("@/lib/workos", () => ({
  workOS: {
    userManagement: {
      getUser: vi.fn(),
    },
  },
}));

import { workOS } from "@/lib/workos";
import { Route } from "./me";

const mockedGetUser = vi.mocked(workOS.userManagement.getUser);

type GetHandler = (args: {
  request: Request;
  context: { session: { userId: string; tenantId: number } };
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
  session: { userId: "user_abc", tenantId: 42 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/me", () => {
  it("returns user profile from WorkOS", async () => {
    mockedGetUser.mockResolvedValueOnce({
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Smith",
      profilePictureUrl: "https://example.com/avatar.png",
    } as Awaited<ReturnType<typeof mockedGetUser>>);

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
    expect(mockedGetUser).toHaveBeenCalledWith("user_abc");
  });

  it("returns name from firstName only when lastName is absent", async () => {
    mockedGetUser.mockResolvedValueOnce({
      email: "alice@example.com",
      firstName: "Alice",
      lastName: null,
      profilePictureUrl: null,
    } as Awaited<ReturnType<typeof mockedGetUser>>);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/me"),
      context,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Alice");
    expect(body.profileUrl).toBe(null);
  });

  it("falls back to email as name when firstName is absent", async () => {
    mockedGetUser.mockResolvedValueOnce({
      email: "alice@example.com",
      firstName: null,
      lastName: null,
      profilePictureUrl: null,
    } as Awaited<ReturnType<typeof mockedGetUser>>);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/me"),
      context,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("alice@example.com");
  });
});
