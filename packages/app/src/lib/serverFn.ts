import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { auth } from "@/lib/auth.server";
import { getExceptionAttributes } from "@/telemetry/shared";
import { createClickhouseQuery } from "./clickhouse";

// Server function handler errors are caught by the framework and returned as a
// failed RPC, so they never hit process-level uncaughtException/unhandledRejection
// instrumentation. Wrap the handler to emit an exception log before rethrowing,
// so backend failures land in telemetry (and the Errors UI).
const errorTelemetryMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    const attributes = getExceptionAttributes(error);
    logs.getLogger("everr-web-server-fn-errors").emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body:
        typeof attributes["exception.message"] === "string"
          ? attributes["exception.message"]
          : "Server function error",
      attributes: {
        ...attributes,
        "error.source": "server-fn",
        "exception.escaped": true,
      },
    });
    throw error;
  }
});

const authMiddleware = createMiddleware().server(async ({ request, next }) => {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.session || !session?.user) {
    throw new Error("Unauthenticated");
  }

  return next({
    context: {
      session,
    },
  });
});

export const requireOrgMiddleware = createMiddleware()
  .middleware([authMiddleware])
  .server(async ({ next, context: { session } }) => {
    const activeOrgId = session.session.activeOrganizationId;
    if (!activeOrgId) {
      throw new Error("No active organization");
    }

    return next({
      context: {
        session: {
          session: {
            ...session.session,
            activeOrganizationId: activeOrgId,
          },
          user: session.user,
        },
        clickhouse: {
          query: createClickhouseQuery(activeOrgId),
        },
      },
    });
  });

export const createAuthenticatedServerFn = createServerFn().middleware([
  requireOrgMiddleware,
  errorTelemetryMiddleware,
]);

/**
 * A server function that is authenticated but not necessarily has an active organization.
 * This is useful for routes or function that need to be authenticated but not necessarily have an
 * active organization yet, such as the onboarding flow.
 */
export const createPartiallyAuthenticatedServerFn = createServerFn().middleware(
  [authMiddleware, errorTelemetryMiddleware],
);
