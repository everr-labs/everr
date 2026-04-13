import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

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
    const makeMiddleware = (
      handlers: Array<
        (args: {
          request?: Request;
          context?: Record<string, unknown>;
          next: (args?: unknown) => Promise<unknown>;
        }) => Promise<unknown>
      > = [],
    ) => ({
      middleware: (
        definitions: Array<{
          __handler?: (args: {
            request?: Request;
            context?: Record<string, unknown>;
            next: (args?: unknown) => Promise<unknown>;
          }) => Promise<unknown>;
        }>,
      ) =>
        makeMiddleware([
          ...handlers,
          ...definitions
            .map((definition) => definition.__handler)
            .filter((handler): handler is NonNullable<typeof handler> =>
              Boolean(handler),
            ),
        ]),
      server: vi.fn((handler) => ({
        __handler: handlers.reduceRight<typeof handler>(
          (nextHandler, middlewareHandler) =>
            async ({ request, context, next }) =>
              middlewareHandler({
                request,
                context,
                next: (args?: unknown) =>
                  nextHandler({
                    request,
                    context:
                      typeof args === "object" && args !== null
                        ? {
                            ...context,
                            ...((args as { context?: Record<string, unknown> })
                              .context ?? {}),
                          }
                        : context,
                    next,
                  }),
              }),
          handler,
        ),
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

  return {
    createAuthenticatedServerFn: vi.fn(() =>
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
      }),
    ),
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
afterEach(() => {
  cleanup();
});
