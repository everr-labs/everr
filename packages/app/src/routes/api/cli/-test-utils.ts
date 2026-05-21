type RouteLike = {
  options: unknown;
};

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
