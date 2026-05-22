import { vi } from "vitest";

type RouteLike = {
  options: unknown;
};

type MockedDbLike = {
  select: ReturnType<typeof vi.fn>;
};

/**
 * Sets up the mocked `db.select().from().where()` chain to resolve with the
 * given installation rows. Each test file must pass its own `vi.mocked(db)`
 * so the per-file `vi.mock("@/db/client", ...)` hoisting remains intact.
 */
export function mockDbInstallations(
  mockedDb: MockedDbLike,
  installations: Array<{ installationId: number; status: string }>,
) {
  const where = vi.fn().mockResolvedValue(
    installations.map((i) => ({
      installationId: i.installationId,
      status: i.status,
    })),
  );
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(mockedDb.select).mockReturnValue({ from } as never);
}

type HandlerMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Extracts a typed route handler from a TanStack Start route's options.
 * Throws with a descriptive error if the handler is not registered.
 */
export function getRouteHandler<T>(
  route: RouteLike,
  method: HandlerMethod,
  label?: string,
): T {
  const routeOptions = route.options as unknown as {
    server?: { handlers?: Partial<Record<HandlerMethod, T>> };
  };
  const handler = routeOptions.server?.handlers?.[method];
  if (!handler) {
    throw new Error(
      `Missing ${method} handler${label ? ` for ${label}` : ""}.`,
    );
  }
  return handler;
}

/** Default organization id used across CLI route tests. */
export const CLI_TEST_ORG_ID = "org-42";

/**
 * Builds the minimal `context` object that CLI route handlers expect after
 * the auth middleware has populated the active session.
 */
export function cliSessionContext(organizationId: string = CLI_TEST_ORG_ID) {
  return {
    session: { session: { activeOrganizationId: organizationId } },
  };
}
