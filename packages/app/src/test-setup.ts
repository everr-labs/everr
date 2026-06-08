import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import {
  composeMiddleware,
  type FunctionMiddlewareHandler,
} from "./lib/test-middleware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: Shared test harness needs a loose function signature.
type AnyFn = (...args: any[]) => any;

/** Build a fluent chain where handler(fn) wraps fn with `wrapHandler`. */
function makeServerFnChain(wrapHandler: (fn: AnyFn) => AnyFn) {
  const chain: Record<string, unknown> = {
    middleware: () => makeServerFnChain(wrapHandler),
    inputValidator: () => chain,
    handler: (fn: AnyFn) => wrapHandler(fn),
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
      server: vi.fn((handler: FunctionMiddlewareHandler) => ({
        __handler: composeMiddleware(handlers, handler),
      })),
    });

    return makeMiddleware();
  }),
  createServerFn: vi.fn(() =>
    makeServerFnChain(
      (fn) => async (opts?: { data?: unknown }) => fn({ data: opts?.data }),
    ),
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

  return {
    query,
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
          },
          clickhouse: {
            query: <T>(sql: string, params?: Record<string, unknown>) =>
              query<T>(sql, "42", params),
          },
        },
      });
    });

  return {
    requireOrgMiddleware: { __handler: vi.fn() },
    requireOrgOrApiKeyMiddleware: { __handler: vi.fn() },
    createAuthenticatedServerFn: vi.fn(makeAuthChain),
    createPartiallyAuthenticatedServerFn: vi.fn(makeAuthChain),
    buildApplyContext: vi.fn(),
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
      createOrganization: vi.fn(),
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
