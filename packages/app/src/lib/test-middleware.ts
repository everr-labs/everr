// Shared test-only helper for composing TanStack Start function middleware
// handlers into a single handler. Used by both the global vitest setup and
// targeted tests that mock `@tanstack/react-start`.

export type FunctionMiddlewareHandler = (args: {
  request?: Request;
  context?: Record<string, unknown>;
  next: (args?: unknown) => Promise<unknown>;
}) => Promise<unknown>;

// The `context` a middleware forwards through `next(...)`, if it passed an
// object carrying one. Kept as `object | undefined` so it can be spread as-is.
function nextContext(args: unknown): object | undefined {
  if (typeof args === "object" && args !== null && "context" in args) {
    const ctx = args.context;
    if (typeof ctx === "object" && ctx !== null) return ctx;
  }
  return undefined;
}

/**
 * Compose an ordered list of middleware handlers around a final handler,
 * mirroring TanStack Start's runtime semantics: each middleware receives a
 * `next` that invokes the subsequent middleware (or the final handler),
 * merging any `context` provided by the caller of `next`.
 */
export function composeMiddleware(
  handlers: FunctionMiddlewareHandler[],
  finalHandler: FunctionMiddlewareHandler,
): FunctionMiddlewareHandler {
  return handlers.reduceRight<FunctionMiddlewareHandler>(
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
                      ...nextContext(args),
                    }
                  : context,
              next,
            }),
        }),
    finalHandler,
  );
}
