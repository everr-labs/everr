import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/tenants", () => ({
  unlinkGithubInstallation: vi.fn(),
}));

import { unlinkGithubInstallation } from "@/data/tenants";

const mockedUnlinkGithubInstallation = vi.mocked(unlinkGithubInstallation);

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

type TestMiddleware = {
  options?: {
    server?: (args: {
      request: Request;
      pathname: string;
      context: Record<string, unknown>;
      next: (options?: { context?: Record<string, unknown> }) => Promise<{
        request: Request;
        pathname: string;
        context: Record<string, unknown>;
        response: Response;
      }>;
    }) => Promise<
      | Response
      | {
          request: Request;
          pathname: string;
          context: Record<string, unknown>;
          response: Response;
        }
    >;
  };
};

type TestPostHandler = (args: {
  request: Request;
  context?: Record<string, unknown>;
}) => Promise<Response>;

function resolvePost(routeOptions: any): {
  middlewares: TestMiddleware[];
  handler: TestPostHandler;
} {
  const routeMiddlewares = (routeOptions.server?.middleware ??
    []) as TestMiddleware[];
  const rawHandlers = routeOptions.server?.handlers;
  const handlers =
    typeof rawHandlers === "function"
      ? rawHandlers({ createHandlers: (value: unknown) => value })
      : rawHandlers;
  const postConfig = handlers?.POST;

  if (typeof postConfig === "function") {
    return { middlewares: routeMiddlewares, handler: postConfig };
  }

  if (postConfig?.handler) {
    return {
      middlewares: [
        ...routeMiddlewares,
        ...((postConfig.middleware ?? []) as TestMiddleware[]),
      ],
      handler: postConfig.handler as TestPostHandler,
    };
  }

  throw new Error("Missing POST handler for install events route.");
}

async function executePost(
  middlewares: TestMiddleware[],
  handler: TestPostHandler,
  request: Request,
): Promise<Response> {
  const pathname = "/api/github/install-events";
  let middlewareContext: Record<string, unknown> = {};

  const run = async (index: number): Promise<Response> => {
    if (index >= middlewares.length) {
      return handler({ request, context: middlewareContext });
    }

    const middleware = middlewares[index]?.options?.server;
    if (!middleware) {
      return run(index + 1);
    }

    const result = await middleware({
      request,
      pathname,
      context: middlewareContext,
      next: async (options) => {
        middlewareContext = {
          ...middlewareContext,
          ...(options?.context ?? {}),
        };
        const response = await run(index + 1);
        return {
          request,
          pathname,
          context: middlewareContext,
          response,
        };
      },
    });

    return result instanceof Response ? result : result.response;
  };

  return run(0);
}

async function getHandler(secret: string) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "https://example.com/db");
  vi.stubEnv(
    "GITHUB_APP_INSTALL_URL",
    "https://github.com/apps/example/installations/new",
  );
  vi.stubEnv("GITHUB_APP_STATE_SECRET", "x".repeat(32));
  vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", secret);

  const { Route } = await import("./install-events");
  const { middlewares, handler } = resolvePost(Route.options);

  return ({ request }: { request: Request }) =>
    executePost(middlewares, handler, request);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/github/install-events", () => {
  it("returns 401 when signature is invalid for installation events", async () => {
    const handler = await getHandler("super-secret-value-super-secret-1234");
    const payload = JSON.stringify({
      action: "deleted",
      installation: { id: 123 },
    });

    const response = await handler({
      request: new Request("http://localhost/api/github/install-events", {
        method: "POST",
        headers: {
          "x-github-event": "installation",
          "x-hub-signature-256": "sha256=bad",
        },
        body: payload,
      }),
    });

    expect(response.status).toBe(401);
    expect(mockedUnlinkGithubInstallation).not.toHaveBeenCalled();
  });

  it("unlinks tenant mapping for deleted installations with a valid signature", async () => {
    const secret = "super-secret-value-super-secret-1234";
    const handler = await getHandler(secret);
    const payload = JSON.stringify({
      action: "deleted",
      installation: { id: 456 },
    });

    const response = await handler({
      request: new Request("http://localhost/api/github/install-events", {
        method: "POST",
        headers: {
          "x-github-event": "installation",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
    });

    expect(response.status).toBe(202);
    expect(mockedUnlinkGithubInstallation).toHaveBeenCalledWith(456);
  });

  it("does not unlink tenant mapping for suspended installations", async () => {
    const secret = "super-secret-value-super-secret-1234";
    const handler = await getHandler(secret);
    const payload = JSON.stringify({
      action: "suspend",
      installation: { id: 456 },
    });

    const response = await handler({
      request: new Request("http://localhost/api/github/install-events", {
        method: "POST",
        headers: {
          "x-github-event": "installation",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
    });

    expect(response.status).toBe(202);
    expect(mockedUnlinkGithubInstallation).not.toHaveBeenCalled();
  });

  it("does not unlink tenant mapping for unsuspend installations", async () => {
    const secret = "super-secret-value-super-secret-1234";
    const handler = await getHandler(secret);
    const payload = JSON.stringify({
      action: "unsuspend",
      installation: { id: 456 },
    });

    const response = await handler({
      request: new Request("http://localhost/api/github/install-events", {
        method: "POST",
        headers: {
          "x-github-event": "installation",
          "x-hub-signature-256": sign(payload, secret),
        },
        body: payload,
      }),
    });

    expect(response.status).toBe(202);
    expect(mockedUnlinkGithubInstallation).not.toHaveBeenCalled();
  });

  it("ignores non-installation events", async () => {
    const handler = await getHandler("super-secret-value-super-secret-1234");

    const response = await handler({
      request: new Request("http://localhost/api/github/install-events", {
        method: "POST",
        headers: {
          "x-github-event": "workflow_job",
        },
        body: JSON.stringify({}),
      }),
    });

    expect(response.status).toBe(202);
    expect(mockedUnlinkGithubInstallation).not.toHaveBeenCalled();
  });
});
