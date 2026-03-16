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
  createMiddleware: vi.fn(() => ({ server: vi.fn(() => ({})) })),
  createServerFn: vi.fn(() =>
    makeServerFnChain(
      (fn) => async (opts?: { data?: unknown }) => fn({ data: opts?.data }),
    ),
  ),
  createStart: vi.fn(() => ({})),
  getGlobalStartContext: vi.fn(),
}));

// ---------------------------------------------------------------------------
// @/lib/serverFn — authenticated server functions get auth context injected
// from getAuth(), with the same guards as the real authMiddleware.
// ---------------------------------------------------------------------------

vi.mock("@/lib/serverFn", () => ({
  createAuthenticatedServerFn: vi.fn(() =>
    makeServerFnChain((fn) => async (opts?: { data?: unknown }) => {
      const { getAuth } = await import("@workos/authkit-tanstack-react-start");
      const { query } = await import("@/lib/clickhouse");
      const auth = await getAuth();
      if (!auth?.user) throw new Error("Unauthenticated");
      if (!auth?.organizationId) throw new Error("Missing organization");
      return fn({
        data: opts?.data,
        context: {
          session: {
            userId: auth.user.id,
            organizationId: auth.organizationId,
            sessionId: auth.sessionId,
            tenantId: 42,
          },
          clickhouse: {
            query: <T>(sql: string, params?: Record<string, unknown>) =>
              query<T>(sql, params, 42),
          },
        },
      });
    }),
  ),
}));

// ---------------------------------------------------------------------------
// @/lib/workos — prevent env validation at import time.
// Individual tests can override specific methods.
// ---------------------------------------------------------------------------

vi.mock("@/lib/workos", () => ({
  workOS: {
    organizations: { createOrganization: vi.fn(), getOrganization: vi.fn() },
    userManagement: {
      getUser: vi.fn(),
      createOrganizationMembership: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// WorkOS authkit — default: authenticated user with org.
// Override in individual tests: vi.mocked(getAuth).mockResolvedValue(...)
// ---------------------------------------------------------------------------

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  authkitMiddleware: vi.fn(() => ({})),
  getAuth: vi.fn().mockResolvedValue({
    user: { id: "test_user" },
    organizationId: "test_org",
    sessionId: "test_session",
  }),
  getAuthAction: vi.fn(),
  getSignInUrl: vi.fn(),
  handleCallbackRoute: vi.fn(),
  switchToOrganization: vi.fn(),
}));

vi.mock("@workos/authkit-tanstack-react-start/client", () => ({
  AuthKitProvider: ({ children }: { children: unknown }) => children,
  useAuth: vi.fn(() => ({ isLoading: false, user: null })),
  useAccessToken: vi.fn(() => ({ data: null })),
}));

// ---------------------------------------------------------------------------
afterEach(() => {
  cleanup();
});
