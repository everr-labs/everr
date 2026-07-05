import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";
import { composeMiddleware, type FunctionMiddlewareHandler } from "./lib/test-middleware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: Shared test harness needs a loose function signature.
type AnyFn = (...args: any[]) => any;

/** Build a fluent chain where handler(fn) wraps fn with `wrapHandler`. */
function makeServerFnChain(wrapHandler: (fn: AnyFn) => AnyFn) {
  // Run the registered validator like production does, so handlers see parsed
  // input (zod defaults applied, invalid input rejected) instead of raw data.
  let validate: ((input: unknown) => unknown) | undefined;
  const chain: Record<string, unknown> = {
    middleware: () => makeServerFnChain(wrapHandler),
    inputValidator: (schema: unknown) => {
      validate =
        typeof schema === "function"
          ? (input) => schema(input)
          : // oxlint-disable-next-line typescript/consistent-type-assertions -- inputValidator receives either a function or a Zod-like schema; the non-function branch is always the latter, which TS can't infer from `unknown`.
            (input) => (schema as { parse: (input: unknown) => unknown }).parse(input);
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

vi.mock("@/lib/clickhouse", () => {
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

vi.mock("@/lib/serverFn", async () => {
  const { query } = await import("@/lib/clickhouse");
  const { auth } = await import("@/lib/auth.server");

  // requireOrgMiddleware: active org guaranteed + ClickHouse bound to it.
  const makeAuthChain = () =>
    makeServerFnChain((fn) => async (opts?: { data?: unknown }) => {
      return fn({
        data: opts?.data,
        context: {
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
    createAuthenticatedServerFn: vi.fn(makeAuthChain),
    createPartiallyAuthenticatedServerFn: vi.fn(makePartialAuthChain),
  };
});

// ---------------------------------------------------------------------------
// @/lib/auth.server — prevent env/db access at import time.
// Individual tests can override specific methods.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth.server", () => ({
  auth: {
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
