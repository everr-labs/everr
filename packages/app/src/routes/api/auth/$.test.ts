import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
}));
vi.mock("#app/identity/server.ts", () => ({
  auth: { handler: mocks.handler },
}));

import { Route } from "./$";

type AuthHandler = (args: { request: Request }) => Response | Promise<Response>;

function getHandler(method: "GET" | "POST") {
  const routeOptions = Route.options as {
    server?: { handlers?: Partial<Record<"GET" | "POST", AuthHandler>> };
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
      request: new Request("http://localhost:5173/api/auth/error?error=email_doesn%27t_match"),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/error?error=email_doesn%27t_match");
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"] as const)("hands any other %s request to Better Auth", async (method) => {
    const handled = new Response("ok");
    mocks.handler.mockResolvedValue(handled);
    const request = new Request("http://localhost:5173/api/auth/get-session", { method });

    expect(await getHandler(method)({ request })).toBe(handled);
    expect(mocks.handler).toHaveBeenCalledWith(request);
  });
});
