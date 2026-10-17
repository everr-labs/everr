import { server } from "@composition/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageNotReadyError } from "@/common/storage-readiness";
import {
  composeMiddleware,
  type FunctionMiddlewareHandler,
} from "./test-middleware";

const { assertStorageReady } = server;
vi.mock("@composition/server", () => ({
  server: { assertStorageReady: vi.fn() },
}));

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
  getOrganization: vi.fn(),
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

beforeEach(() => {
  vi.resetModules();
  mocked.handler = null;
  mocked.middlewareDefinition = null;
  mocked.allDefinitions = [];
  mocked.createServerFnMiddleware.mockReset();
  mocked.createServerFnMiddleware.mockReturnValue(mocked.createServerFnResult);
  mocked.getRequest.mockReset();
  mocked.getActiveMemberRole.mockReset();
  mocked.getSession.mockReset();
  mocked.getOrganization
    .mockReset()
    .mockResolvedValue([
      { id: "org_123", metadata: null, memberRole: "owner" },
    ]);
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

  vi.doMock("@/db/client", () => ({
    db: {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: mocked.getOrganization }),
          }),
        }),
      }),
    },
  }));
  return vi.importActual<typeof import("./serverFn")>("./serverFn");
}

describe("createAuthenticatedServerFn", () => {
  it("wires the auth middleware into createServerFn", async () => {
    const { createAuthenticatedServerFn } = await loadModule();

    // Data functions require both membership and completed provisioning.
    const [, , requireOrgDef] = mocked.allDefinitions;
    expect(createAuthenticatedServerFn).toBe(mocked.createServerFnResult);
    expect(mocked.createServerFnMiddleware).toHaveBeenCalledWith([
      requireOrgDef,
    ]);
  });
});

describe("createOrganizationAdminServerFn", () => {
  it("wires the organization admin middleware into createServerFn", async () => {
    const { createOrganizationAdminServerFn } = await loadModule();

    const [, , , requireOrganizationAdminDef] = mocked.allDefinitions;
    expect(createOrganizationAdminServerFn).toBe(mocked.createServerFnResult);
    expect(mocked.createServerFnMiddleware).toHaveBeenLastCalledWith([
      expect.objectContaining({
        options: requireOrganizationAdminDef?.options,
        __handler: expect.any(Function),
      }),
    ]);
  });

  it.each(["admin", "owner", "member, admin"])("allows an %s", async (role) => {
    await loadModule();
    const request = new Request("http://localhost/_server");
    const nextResult = new Response(null, { status: 204 });
    const next = vi.fn().mockResolvedValue(nextResult);
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: "org_123" },
    });
    mocked.getOrganization.mockResolvedValue([
      { id: "org_123", metadata: null, memberRole: role },
    ]);

    const response = await getHandler()({ request, next });

    expect(response).toBe(nextResult);
    expect(mocked.getOrganization).toHaveBeenCalledOnce();
    expect(mocked.getActiveMemberRole).not.toHaveBeenCalled();
  });

  it("rejects an ordinary member", async () => {
    const { NotOrganizationAdminError } = await loadModule();
    const request = new Request("http://localhost/_server");
    const next = vi.fn();
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: "org_123" },
    });
    mocked.getOrganization.mockResolvedValue([
      { id: "org_123", metadata: null, memberRole: "member" },
    ]);

    await expect(getHandler()({ request, next })).rejects.toBeInstanceOf(
      NotOrganizationAdminError,
    );
    expect(next).not.toHaveBeenCalled();
    expect(mocked.getOrganization).toHaveBeenCalledOnce();
    expect(mocked.getActiveMemberRole).not.toHaveBeenCalled();
  });
});

describe("authMiddleware", () => {
  it.each([
    undefined,
    "org_123",
  ])("authenticates and populates context with expected organization %s", async (expectedOrganization) => {
    await loadModule();
    const request = new Request("http://localhost/_server", {
      headers: expectedOrganization
        ? { "x-everr-organization-id": expectedOrganization }
        : undefined,
    });
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
        organization: { id: "org_123", metadata: null },
        memberRole: "owner",
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

  it("rejects a profile organization mismatch before querying or invoking the handler", async () => {
    await loadModule();
    const next = vi.fn();
    mocked.getSession.mockResolvedValue({
      user: { id: "user_123" },
      session: { id: "session_123", activeOrganizationId: "org_123" },
    });
    const request = new Request("http://localhost/api/cli/resources", {
      headers: { "x-everr-organization-id": "org_other" },
    });
    await expect(
      getRequireOrgHandler()({ request, next }),
    ).rejects.toMatchObject({ status: 409 });
    expect(next).not.toHaveBeenCalled();
    expect(mocked.getOrganization).not.toHaveBeenCalled();
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

describe("organization readiness boundary", () => {
  it.each([
    null,
    { clickhouseReady: true },
  ])("allows ready/legacy data access and resolves the organization once", async (metadata) => {
    await loadModule();
    mocked.getSession.mockResolvedValue({
      user: { id: "u" },
      session: { activeOrganizationId: "org" },
    });
    mocked.getOrganization.mockResolvedValue([
      { id: "org", metadata, memberRole: "owner" },
    ]);
    const next = vi.fn().mockResolvedValue("ok");
    await mocked.allDefinitions[2]?.__handler({
      request: new Request("http://localhost/_server"),
      next,
    });
    expect(next).toHaveBeenCalledOnce();
    expect(mocked.getOrganization).toHaveBeenCalledOnce();
  });
  it("blocks pending data functions while allowing organization access", async () => {
    vi.mocked(assertStorageReady).mockImplementationOnce(() => {
      throw new StorageNotReadyError();
    });
    await loadModule();
    mocked.getSession.mockResolvedValue({
      user: { id: "u" },
      session: { activeOrganizationId: "org" },
    });
    mocked.getOrganization.mockResolvedValue([
      {
        id: "org",
        metadata: { clickhouseReady: false },
        memberRole: "owner",
      },
    ]);
    const args = {
      request: new Request("http://localhost/_server"),
      next: vi.fn(),
    };
    await expect(
      mocked.allDefinitions[2]?.__handler(args),
    ).rejects.toMatchObject({ name: "StorageNotReadyError" });
    expect(args.next).not.toHaveBeenCalled();
    await getRequireOrgHandler()(args);
    expect(args.next).toHaveBeenCalledOnce();
    args.next.mockClear();
    await getHandler()(args);
    expect(args.next).toHaveBeenCalledOnce();
  });
  it("does not run the handler after membership rejection", async () => {
    await loadModule();
    mocked.getSession.mockResolvedValue({
      user: { id: "u" },
      session: { activeOrganizationId: "org" },
    });
    mocked.getOrganization.mockRejectedValue(new Error("Not a member"));
    const args = {
      request: new Request("http://localhost/_server"),
      next: vi.fn(),
    };
    await expect(getRequireOrgHandler()(args)).rejects.toThrow("Not a member");
    expect(args.next).not.toHaveBeenCalled();
  });
});
