import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeMiddleware,
  type FunctionMiddlewareHandler,
} from "./test-middleware";

const mocked = vi.hoisted(() => ({
  handler: null as FunctionMiddlewareHandler | null,
  middlewareDefinition: null as {
    options: { type: string };
    __handler: FunctionMiddlewareHandler;
  } | null,
  allDefinitions: [] as Array<{
    options: { type: string };
    __handler: FunctionMiddlewareHandler;
  }>,
  createServerFnMiddleware: vi.fn(),
  createServerFnResult: {},
  getRequest: vi.fn(),
  getActiveMemberRole: vi.fn(),
  getSession: vi.fn(),
}));

function getHandler(): FunctionMiddlewareHandler {
  if (!mocked.handler) {
    throw new Error("Expected function middleware handler to be registered.");
  }

  return mocked.handler;
}

function getRequireOrgHandler(): FunctionMiddlewareHandler {
  const definition = mocked.allDefinitions[1];
  if (!definition) {
    throw new Error("Expected organization middleware to be registered.");
  }
  return definition.__handler;
}

function getAuthHandler(): FunctionMiddlewareHandler {
  const definition = mocked.allDefinitions[0];
  if (!definition) {
    throw new Error("Expected authentication middleware to be registered.");
  }
  return definition.__handler;
}

beforeEach(() => {
  vi.resetModules();
  mocked.handler = null;
  mocked.middlewareDefinition = null;
  mocked.allDefinitions = [];
  mocked.createServerFnMiddleware.mockReset();
  mocked.createServerFnMiddleware.mockReturnValue(mocked.createServerFnResult);
  mocked.getRequest.mockReset();
  mocked.getActiveMemberRole.mockReset();
  mocked.getActiveMemberRole.mockResolvedValue({ role: "owner" });
  mocked.getSession.mockReset();
});

async function loadModule() {
  function makeMiddleware(handlers: FunctionMiddlewareHandler[] = []) {
    return {
      middleware: (
        definitions: Array<{ __handler?: FunctionMiddlewareHandler }>,
      ) =>
        makeMiddleware([
          ...handlers,
          ...definitions
            .map((definition) => definition.__handler)
            .filter((handler): handler is FunctionMiddlewareHandler =>
              Boolean(handler),
            ),
        ]),
      server: (handler: FunctionMiddlewareHandler) => {
        const composed = composeMiddleware(handlers, handler);

        const definition = {
          options: { type: "function" },
          __handler: composed,
        };
        mocked.handler = composed;
        mocked.middlewareDefinition = definition;
        mocked.allDefinitions.push(definition);
        return definition;
      },
    };
  }

  vi.doMock("@tanstack/react-start", () => ({
    createMiddleware: vi.fn(() => makeMiddleware()),
    createServerFn: vi.fn(() => ({
      middleware: mocked.createServerFnMiddleware,
    })),
  }));
  vi.doMock("@tanstack/react-start/server", () => ({
    getRequest: mocked.getRequest,
  }));
  vi.doMock("./auth.server", () => ({
    auth: {
      api: {
        getActiveMemberRole: mocked.getActiveMemberRole,
        getSession: mocked.getSession,
      },
    },
  }));

  return vi.importActual<typeof import("./serverFn")>("./serverFn");
}

describe("createAuthenticatedServerFn", () => {
  it("wires the auth middleware into createServerFn", async () => {
    const { createAuthenticatedServerFn } = await loadModule();

    // allDefinitions order: [authMiddleware, requireOrgMiddleware]
    const [, requireOrgDef] = mocked.allDefinitions;
    expect(createAuthenticatedServerFn).toBe(mocked.createServerFnResult);
    expect(mocked.createServerFnMiddleware).toHaveBeenCalledWith([
      requireOrgDef,
    ]);
  });
});

describe("createOrganizationAdminServerFn", () => {
  it("wires the organization admin middleware into createServerFn", async () => {
    const { createOrganizationAdminServerFn } = await loadModule();

    const [, , requireOrganizationAdminDef] = mocked.allDefinitions;
    expect(createOrganizationAdminServerFn).toBe(mocked.createServerFnResult);
    expect(mocked.createServerFnMiddleware).toHaveBeenLastCalledWith([
      expect.objectContaining({
        options: requireOrganizationAdminDef?.options,
        __handler: expect.any(Function),
      }),
    ]);
  });

  it.each(["admin", "owner"])("allows an %s", async (role) => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const nextResult = new Response(null, { status: 204 });
    const next = vi.fn().mockResolvedValue(nextResult);
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: "org_123" },
    });
    mocked.getActiveMemberRole.mockResolvedValue({ role });

    const response = await getHandler()({ request, next });

    expect(response).toBe(nextResult);
    expect(mocked.getActiveMemberRole).toHaveBeenCalledWith({
      headers: request.headers,
    });
  });

  it("rejects an ordinary member", async () => {
    const { NotOrganizationAdminError } = await loadModule();
    const request = new Request("http://localhost/_server");
    const next = vi.fn();
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: "org_123" },
    });
    mocked.getActiveMemberRole.mockResolvedValue({ role: "member" });

    await expect(getHandler()({ request, next })).rejects.toBeInstanceOf(
      NotOrganizationAdminError,
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe("authMiddleware", () => {
  it("exposes request cancellation to downstream handlers", async () => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const next = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: "org_123" },
    });

    await getAuthHandler()({ request, next });

    expect(next).toHaveBeenCalledWith({
      context: {
        requestSignal: request.signal,
        session: {
          user: { id: "user_123" },
          session: { id: "session_123", activeOrganizationId: "org_123" },
        },
      },
    });
  });

  it("authenticates via better-auth session and populates context", async () => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const nextResult = new Response(null, { status: 204 });
    const next = vi.fn().mockResolvedValue(nextResult);
    mocked.getRequest.mockReturnValue(request);
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: "org_123" },
    });

    const response = await getRequireOrgHandler()({ request, next });

    expect(response).toBe(nextResult);
    expect(next).toHaveBeenCalledWith({
      context: {
        session: {
          user: { id: "user_123" },
          session: {
            id: "session_123",
            activeOrganizationId: "org_123",
          },
        },
        clickhouse: {
          query: expect.any(Function),
        },
      },
    });
  });

  it("throws when session is not available", async () => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const next = vi.fn();
    mocked.getRequest.mockReturnValue(request);
    mocked.getSession.mockResolvedValue(null);

    await expect(getRequireOrgHandler()({ request, next })).rejects.toThrow(
      "Unauthenticated",
    );

    expect(next).not.toHaveBeenCalled();
  });

  it("throws when no active organization", async () => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const next = vi.fn();
    mocked.getRequest.mockReturnValue(request);
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: null },
    });

    await expect(getRequireOrgHandler()({ request, next })).rejects.toThrow(
      "No active organization",
    );

    expect(next).not.toHaveBeenCalled();
  });
});
