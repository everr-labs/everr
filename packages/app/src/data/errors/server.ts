import {
  CreateErrorInvestigationInputSchema,
  CreateErrorStatusEventInputSchema,
  DeleteErrorInvestigationInputSchema,
  ErrorAttributeKeysInputSchema,
  ErrorAttributeValuesInputSchema,
  ErrorsRepository,
  GetErrorIssueInputSchema,
  ListErrorServicesInputSchema,
  ListErrorTriageEventsInputSchema,
  SearchErrorIssuesInputSchema,
  type SqlClient,
  UpdateErrorInvestigationInputSchema,
} from "@everr/telemetry-explorer/errors";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  createInvestigation,
  createStatusEvent,
  deleteInvestigation,
  editInvestigation,
  INVESTIGATION_NOT_FOUND,
} from "@/server/errors/triage-events";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  // The cloud has the triage events table, so summaries carry derived Status.
  return new ErrorsRepository(client, { triageEvents: true });
}

export const searchErrorIssues = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(SearchErrorIssuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).searchIssues(data),
  );

export const getErrorIssue = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(GetErrorIssueInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).getIssue(data),
  );

export const listErrorTriageEvents = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(ListErrorTriageEventsInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    // Dynamic import keeps the Postgres client (server-only env) out of the
    // client import graph; this module is imported by route components.
    const { resolveAuthors } = await import("@/server/errors/resolve-authors");
    return resolveAuthors(
      await repoFromContext(clickhouse).listTriageEvents(data),
    );
  });

// Storage details stay in server telemetry; the client gets a stable message
// it can show as-is. The author-only not-found error passes through.
async function sanitizeWriteFailure<T>(
  action: string,
  ref:
    | { "everr.error.fingerprint": string }
    | { "everr.error.event_id": string },
  write: () => Promise<T>,
  clientMessage = "Failed to save the Investigation. Try again.",
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof Error && error.message === INVESTIGATION_NOT_FOUND) {
      throw error;
    }
    serverLogger.error(`errors.${action}_failed`, {
      ...exceptionAttributes(error),
      ...ref,
      "error.handled": true,
    });
    throw new Error(clientMessage);
  }
}

// Tenant and author come from the session: write inputs carry only the
// fingerprint or entry id plus the markdown body, so neither can be spoofed.
export const createErrorInvestigation = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateErrorInvestigationInputSchema)
  .handler(({ data, context: { session } }) =>
    sanitizeWriteFailure(
      "investigation.create",
      { "everr.error.fingerprint": data.fingerprint },
      () =>
        createInvestigation({
          tenantId: session.session.activeOrganizationId,
          fingerprint: data.fingerprint,
          body: data.body,
          authorId: session.user.id,
        }),
    ),
  );

export const updateErrorInvestigation = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(UpdateErrorInvestigationInputSchema)
  .handler(({ data, context: { session, clickhouse } }) =>
    sanitizeWriteFailure(
      "investigation.update",
      { "everr.error.event_id": data.eventId },
      () =>
        editInvestigation({
          query: clickhouse.query,
          tenantId: session.session.activeOrganizationId,
          eventId: data.eventId,
          authorId: session.user.id,
          body: data.body,
        }),
    ),
  );

export const deleteErrorInvestigation = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(DeleteErrorInvestigationInputSchema)
  .handler(({ data, context: { session, clickhouse } }) =>
    sanitizeWriteFailure(
      "investigation.delete",
      { "everr.error.event_id": data.eventId },
      () =>
        deleteInvestigation({
          query: clickhouse.query,
          tenantId: session.session.activeOrganizationId,
          eventId: data.eventId,
          authorId: session.user.id,
        }),
    ),
  );

export const createErrorStatusEvent = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateErrorStatusEventInputSchema)
  .handler(({ data, context: { session } }) =>
    sanitizeWriteFailure(
      "status.create",
      { "everr.error.fingerprint": data.fingerprint },
      () =>
        createStatusEvent({
          tenantId: session.session.activeOrganizationId,
          fingerprint: data.fingerprint,
          type: data.type,
          body: data.body,
          authorId: session.user.id,
        }),
      "Failed to save the status change. Try again.",
    ),
  );

export const listErrorServices = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(ListErrorServicesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).listServices(data),
  );

export const getErrorAttributeKeys = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(ErrorAttributeKeysInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeKeys(data),
  );

export const getErrorAttributeValues = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(ErrorAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );
