import "@testing-library/jest-dom/vitest";
import "@everr/ui/testing/jsdom-shims";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";
import { composeMiddleware, type FunctionMiddlewareHandler } from "./lib/test-middleware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// oxlint-disable-next-line typescript/no-explicit-any -- one alias covers both the handler (called with { data, context }) and the server-fn invoker (called with { data }); `unknown` params are contravariantly incompatible with both and break the mock chain.
type AnyFn = (...args: any[]) => any;

/** Build a fluent chain where handler(fn) wraps fn with `wrapHandler`. */
function makeServerFnChain(wrapHandler: (fn: AnyFn) => AnyFn) {
  // Run the registered validator like production does, so handlers see parsed
  // input (zod defaults applied, invalid input rejected) instead of raw data.
  let validate: ((input: unknown) => unknown) | undefined;
  const chain: Record<string, unknown> = {
    middleware: () => makeServerFnChain(wrapHandler),
    validator: (schema: unknown) => {
      validate =
        typeof schema === "function"
          ? (input) => schema(input)
          : (input) => (schema as { parse: (input: unknown) => unknown }).parse(input);
      return chain;
    },
    handler: (fn: AnyFn) =>
      wrapHandler((args: { data?: unknown }) =>
        fn(validate ? { ...args, data: validate(args.data) } : args),
      ),
  };
  // The chain itself is callable: createAuthenticatedServerFn({ method: "GET" })
  return Object.assign(() => chain, chain);
}

// ---------------------------------------------------------------------------
// @tanstack/react-start — passthrough: handler(fn) → (opts) → fn({ data })
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: vi.fn(() => {
    const makeMiddleware = (handlers: FunctionMiddlewareHandler[] = []) => ({
      middleware: (definitions: Array<{ __handler?: FunctionMiddlewareHandler }>) =>
        makeMiddleware([
          ...handlers,
          ...definitions
            .map((definition) => definition.__handler)
            .filter((handler): handler is FunctionMiddlewareHandler => Boolean(handler)),
        ]),
      server: vi.fn((handler: FunctionMiddlewareHandler) => ({
        __handler: composeMiddleware(handlers, handler),
      })),
    });

    return makeMiddleware();
  }),
  createServerFn: vi.fn(() =>
    makeServerFnChain((fn) => async (opts?: { data?: unknown }) => fn({ data: opts?.data })),
  ),
  createStart: vi.fn(() => ({})),
  getGlobalStartContext: vi.fn(),
}));

// ---------------------------------------------------------------------------
// ClickHouse — default test double so jsdom tests never import the real server
// client and trigger env access. Individual tests can override this mock.
// ---------------------------------------------------------------------------

vi.mock("#app/lib/clickhouse.ts", () => {
  const query = vi.fn();
  const querySqlApi = vi.fn();

  return {
    query,
    querySqlApi,
    createClickhouseQuery: vi.fn(
      (tenantId: number) => (sql: string, params?: Record<string, unknown>) =>
        query(sql, params, tenantId),
    ),
  };
});

// ---------------------------------------------------------------------------
// @/lib/serverFn — authenticated server functions get auth context injected
// from getAuth(), with the same guards as the real authMiddleware.
// ---------------------------------------------------------------------------

vi.mock("#app/lib/serverFn.ts", async () => {
  const { query, querySqlApi } = await import("#app/lib/clickhouse.ts");
  const { auth } = await import("#app/identity/server.ts");

  // requireOrgMiddleware: active org guaranteed + ClickHouse bound to it.
  const makeAuthChain = (withSql = false) =>
    makeServerFnChain((fn) => async (opts?: { data?: unknown }) => {
      return fn({
        data: opts?.data,
        context: {
          consultationPrincipal: {
            kind: "member",
            organizationId: "test_org",
            userId: "test_user",
            membershipId: "test_membership",
          },
          session: {
            session: {
              userId: "test_user",
              activeOrganizationId: "test_org",
              id: "test_session",
            },
            user: {
              id: "test_user",
              email: "test@example.com",
              name: "Test User",
              image: null,
            },
          },
          ...(withSql
            ? {
                sql: {
                  query: <T>(sql: string, params?: Record<string, unknown>) =>
                    querySqlApi<T>(sql, "test_org", params),
                },
              }
            : {}),
          clickhouse: {
            query: <T>(sql: string, params?: Record<string, unknown>) =>
              query<T>(sql, "42", params),
          },
        },
      });
    });

  // authMiddleware only: pass through whatever auth.api.getSession() returned
  // (the same source the real middleware reads), apply the same unauthenticated
  // guard, and add NO `clickhouse` and NO active-org guarantee. Deriving from
  // the mock — rather than hardcoding activeOrganizationId: undefined — means the
  // default exercises the active-org path (getSession returns "test_org"), while
  // a test that wants the no-org branch just overrides auth.api.getSession.
  const makePartialAuthChain = () =>
    makeServerFnChain((fn) => async (opts?: { data?: unknown }) => {
      const session = await auth.api.getSession({ headers: new Headers() });
      if (!session?.session || !session?.user) {
        throw new Error("Unauthenticated");
      }
      return fn({
        data: opts?.data,
        context: { session },
      });
    });

  return {
    requireOrgMiddleware: { __handler: vi.fn() },
    createAuthenticatedServerFn: vi.fn(() => makeAuthChain(true)),
    createOrganizationAdminServerFn: vi.fn(() => makeAuthChain()),
    createPartiallyAuthenticatedServerFn: vi.fn(makePartialAuthChain),
  };
});

// ---------------------------------------------------------------------------
// #app/identity/server.ts — prevent env/db access at import time.
// Individual tests can override specific methods.
// ---------------------------------------------------------------------------

vi.mock("#app/identity/server.ts", () => ({
  auth: {
    deleteAccount: vi.fn(),
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: "test_user",
          email: "test@example.com",
          name: "Test User",
          image: null,
        },
        session: { id: "test_session", activeOrganizationId: "test_org" },
      }),
      getFullOrganization: vi.fn(),
      getActiveMemberRole: vi.fn(),
      createApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
      createOrganization: vi.fn(),
      deleteOrganization: vi.fn(),
      deleteUser: vi.fn(),
      updateOrganization: vi.fn(),
      setActiveOrganization: vi.fn(),
      listOrganizations: vi.fn(),
    },
  },
}));

// Completed-read tests observe the capability without starting the server runtime.
// Focused consultation tests supply their own observer to verify classification.
vi.mock("#app/server/organizations/consultations.ts", () => ({
  consultations: { observe: vi.fn(), stop: vi.fn(async () => {}) },
}));

// ---------------------------------------------------------------------------
if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    writable: true,
    value() {},
  });
}

// ---------------------------------------------------------------------------
afterEach(() => {
  cleanup();
});

// Consumer tests use the configured auth double. Session recovery has database-backed tests.
vi.mock("#app/lib/session.server.ts", async () => {
  const { auth } = await import("#app/identity/server.ts");
  return {
    getSession: (options: { headers: Headers }) => auth.api.getSession(options),
  };
});
