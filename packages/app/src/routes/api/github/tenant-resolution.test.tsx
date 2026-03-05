import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/tenants", () => ({
  getActiveTenantForGithubInstallation: vi.fn(),
}));

import { getActiveTenantForGithubInstallation } from "@/data/tenants";

const mockedGetActiveTenantForGithubInstallation = vi.mocked(
  getActiveTenantForGithubInstallation,
);

type TestHandler = (args: { request: Request }) => Promise<Response>;

function sign(
  secret: string,
  timestamp: string,
  method: string,
  requestURI: string,
): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${method}.${requestURI}`).digest("hex")}`;
}

function resolveGet(routeOptions: any): TestHandler {
  const routeMiddlewares = routeOptions.server?.middleware ?? [];
  const rawHandlers = routeOptions.server?.handlers;
  const handlers =
    typeof rawHandlers === "function"
      ? rawHandlers({ createHandlers: (value: unknown) => value })
      : rawHandlers;
  const getConfig = handlers?.GET;

  const handler: TestHandler =
    typeof getConfig === "function" ? getConfig : getConfig?.handler;

  if (!handler) {
    throw new Error("Missing GET handler for tenant resolution route.");
  }

  return async ({ request }) => {
    let index = 0;

    const run = async (): Promise<Response> => {
      if (index >= routeMiddlewares.length) {
        return handler({ request });
      }

      const middlewareServer = routeMiddlewares[index]?.options?.server;
      index += 1;
      if (!middlewareServer) {
        return run();
      }

      const result = await middlewareServer({
        request,
        pathname: "/api/github/tenant-resolution",
        context: {},
        next: async () => {
          const response = await run();
          return {
            request,
            pathname: "/api/github/tenant-resolution",
            context: {},
            response,
          };
        },
      });

      return result instanceof Response ? result : result.response;
    };

    return run();
  };
}

async function getHandler(secret: string) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "https://example.com/db");
  vi.stubEnv(
    "GITHUB_APP_INSTALL_URL",
    "https://github.com/apps/example/installations/new",
  );
  vi.stubEnv("GITHUB_APP_STATE_SECRET", "x".repeat(32));
  vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "y".repeat(32));
  vi.stubEnv("INGRESS_TENANT_RESOLUTION_SECRET", secret);

  const { Route } = await import("./tenant-resolution");
  return resolveGet(Route.options);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/github/tenant-resolution", () => {
  it("returns 401 when signature is invalid", async () => {
    const handler = await getHandler("top-secret-value");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await handler({
      request: new Request(
        "http://localhost/api/github/tenant-resolution?installation_id=123",
        {
          method: "GET",
          headers: {
            "x-everr-ingress-timestamp": timestamp,
            "x-everr-ingress-signature-256": "sha256=bad",
          },
        },
      ),
    });

    expect(response.status).toBe(401);
    expect(mockedGetActiveTenantForGithubInstallation).not.toHaveBeenCalled();
  });

  it("returns 401 when signature timestamp is stale", async () => {
    const handler = await getHandler("top-secret-value");
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    const requestURI = "/api/github/tenant-resolution?installation_id=123";

    const response = await handler({
      request: new Request(`http://localhost${requestURI}`, {
        method: "GET",
        headers: {
          "x-everr-ingress-timestamp": timestamp,
          "x-everr-ingress-signature-256": sign(
            "top-secret-value",
            timestamp,
            "GET",
            requestURI,
          ),
        },
      }),
    });

    expect(response.status).toBe(401);
    expect(mockedGetActiveTenantForGithubInstallation).not.toHaveBeenCalled();
  });

  it("returns 404 when mapping does not exist", async () => {
    mockedGetActiveTenantForGithubInstallation.mockResolvedValueOnce(null);
    const handler = await getHandler("top-secret-value");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const requestURI = "/api/github/tenant-resolution?installation_id=123";

    const response = await handler({
      request: new Request(`http://localhost${requestURI}`, {
        method: "GET",
        headers: {
          "x-everr-ingress-timestamp": timestamp,
          "x-everr-ingress-signature-256": sign(
            "top-secret-value",
            timestamp,
            "GET",
            requestURI,
          ),
        },
      }),
    });

    expect(response.status).toBe(404);
    expect(mockedGetActiveTenantForGithubInstallation).toHaveBeenCalledWith(
      123,
    );
  });

  it("returns tenant id when mapping exists", async () => {
    mockedGetActiveTenantForGithubInstallation.mockResolvedValueOnce(55);
    const handler = await getHandler("top-secret-value");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const requestURI = "/api/github/tenant-resolution?installation_id=123";

    const response = await handler({
      request: new Request(`http://localhost${requestURI}`, {
        method: "GET",
        headers: {
          "x-everr-ingress-timestamp": timestamp,
          "x-everr-ingress-signature-256": sign(
            "top-secret-value",
            timestamp,
            "GET",
            requestURI,
          ),
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tenant_id: 55 });
    expect(mockedGetActiveTenantForGithubInstallation).toHaveBeenCalledWith(
      123,
    );
  });
});
