import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
}));
vi.mock("#app/lib/auth.server.ts", () => ({
  auth: { handler: mocks.handler },
}));

import { Route } from "./$";

type AuthHandler = (args: { request: Request }) => Response | Promise<Response>;

function getHandler(method: "GET" | "POST") {
  const routeOptions = Route.options as {
    server?: { handlers?: { GET?: AuthHandler; POST?: AuthHandler } };
  };
  const handler = routeOptions.server?.handlers?.[method];
  if (!handler) throw new Error(`Missing ${method} handler for auth route.`);
  return handler;
}

beforeEach(() => {
  mocks.handler.mockReset();
});

describe("/api/auth/$ route", () => {
  it("redirects Better Auth error pages to the custom auth error route", async () => {
    const response = await getHandler("GET")({
      request: new Request(
        "http://localhost:5173/api/auth/error?error=email_doesn%27t_match",
      ),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:5173/auth/error?error=email_doesn%27t_match",
    );
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it.each([
    "GET",
    "POST",
  ] as const)("delegates %s to the configured auth handler", async (method) => {
    const request = new Request("http://localhost:5173/api/auth/get-session", {
      method,
    });
    const expected = new Response("auth response");
    mocks.handler.mockResolvedValue(expected);
    expect(await getHandler(method)({ request })).toBe(expected);
    expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request);
  });
});
