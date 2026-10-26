import type * as ServerFnTypes from "./serverFn";
import { storage } from "@composition/storage";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { StorageNotReadyError } from "#app/common/storage-readiness.ts";
import { composeMiddleware, type FunctionMiddlewareHandler } from "./test-middleware";

const { assertStorageReady } = storage;
vi.mock("@composition/storage", () => ({
  storage: { assertStorageReady: vi.fn() },
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
  vi.mocked(assertStorageReady).mockReset();
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
      { id: "org_123", metadata: null, membershipId: "membership_123", memberRole: "owner" },
    ]);
});

async function loadModule() {
  function makeMiddleware(handlers: FunctionMiddlewareHandler[] = []) {
    return {
      middleware: (definitions: Array<{ __handler?: FunctionMiddlewareHandler }>) =>
        makeMiddleware([
          ...handlers,
          ...definitions
            .map((definition) => definition.__handler)
            .filter((handler): handler is FunctionMiddlewareHandler => Boolean(handler)),
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
  vi.doMock("#app/identity/server.ts", () => ({
    auth: {
      api: {
        getActiveMemberRole: mocked.getActiveMemberRole,
        getSession: mocked.getSession,
      },
    },
  }));

  vi.doMock("#app/db/client.ts", () => ({
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
  return vi.importActual<typeof ServerFnTypes>("./serverFn");
}

describe("createAuthenticatedServerFn", () => {
  it("wires the auth middleware into createServerFn", async () => {
    const { createAuthenticatedServerFn } = await loadModule();

    // Data functions require both membership and completed provisioning.
    const [, , requireOrgDef] = mocked.allDefinitions;
    expect(createAuthenticatedServerFn).toBe(mocked.createServerFnResult);
    expect(mocked.createServerFnMiddleware).toHaveBeenCalledWith([requireOrgDef]);
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
      { id: "org_123", metadata: null, membershipId: "membership_123", memberRole: role },
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
      { id: "org_123", metadata: null, membershipId: "membership_123", memberRole: "member" },
    ]);

    await expect(getHandler()({ request, next })).rejects.toBeInstanceOf(NotOrganizationAdminError);
    expect(next).not.toHaveBeenCalled();
    expect(mocked.getOrganization).toHaveBeenCalledOnce();
    expect(mocked.getActiveMemberRole).not.toHaveBeenCalled();
  });
});

describe("authMiddleware", () => {
  it("authenticates and populates context with the active organization", async () => {
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
        organization: { id: "org_123", metadata: null },
        memberRole: "owner",
        consultationPrincipal: {
          kind: "member",
          organizationId: "org_123",
          userId: "user_123",
          membershipId: "membership_123",
        },
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

    await expect(getRequireOrgHandler()({ request, next })).rejects.toThrow("Unauthenticated");

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
  it.each([null, { clickhouseReady: true }])(
    "allows ready/legacy data access and resolves the organization once",
    async (metadata) => {
      await loadModule();
      mocked.getSession.mockResolvedValue({
        user: { id: "u" },
        session: { activeOrganizationId: "org" },
      });
      mocked.getOrganization.mockResolvedValue([
        { id: "org", metadata, membershipId: "membership_123", memberRole: "owner" },
      ]);
      const next = vi.fn().mockResolvedValue("ok");
      await mocked.allDefinitions[2]?.__handler({
        request: new Request("http://localhost/_server"),
        next,
      });
      expect(next).toHaveBeenCalledOnce();
      expect(mocked.getOrganization).toHaveBeenCalledOnce();
      expect(assertStorageReady).toHaveBeenCalledWith(metadata);
      const { context } = next.mock.calls[0][0];
      const { querySqlApi } = await import("./clickhouse");
      await context.sql.query("SELECT {value:UInt8}", { value: 1 });
      expect(querySqlApi).toHaveBeenLastCalledWith("SELECT {value:UInt8}", "org", { value: 1 });
    },
  );
  it("blocks pending data functions while allowing organization access", async () => {
    await loadModule();
    vi.mocked(assertStorageReady).mockImplementationOnce(() => {
      throw new StorageNotReadyError();
    });
    mocked.getSession.mockResolvedValue({
      user: { id: "u" },
      session: { activeOrganizationId: "org" },
    });
    mocked.getOrganization.mockResolvedValue([
      {
        id: "org",
        metadata: { clickhouseReady: false },
        membershipId: "membership_123",
        memberRole: "owner",
      },
    ]);
    const args = {
      request: new Request("http://localhost/_server"),
      next: vi.fn(),
    };
    await expect(mocked.allDefinitions[2]?.__handler(args)).rejects.toMatchObject({
      name: "StorageNotReadyError",
    });
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
