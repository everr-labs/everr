import {
  buildInvestigationEvent,
  CreateErrorInvestigationInputSchema,
  ErrorAttributeKeysInputSchema,
  ErrorAttributeValuesInputSchema,
  ErrorsRepository,
  GetErrorIssueInputSchema,
  ListErrorServicesInputSchema,
  ListErrorTriageEventsInputSchema,
  SearchErrorIssuesInputSchema,
  type SqlClient,
} from "@everr/telemetry-explorer/errors";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { createCloudLogEventEmitter } from "@/server/events/log-event-emitter";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new ErrorsRepository(client);
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
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).listTriageEvents(data),
  );

// Tenant and author come from the session: the input schema carries only the
// fingerprint and the markdown body, so neither can be spoofed by a client.
export const createErrorInvestigation = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CreateErrorInvestigationInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const emitter = createCloudLogEventEmitter({
      tenantId: session.session.activeOrganizationId,
    });
    try {
      await emitter.emit(
        buildInvestigationEvent({
          fingerprint: data.fingerprint,
          markdown: data.body,
          author: {
            id: session.user.id,
            name: session.user.name || session.user.email,
          },
        }),
      );
    } catch (error) {
      // Storage details stay in server telemetry; the client gets a stable
      // message it can show as-is.
      serverLogger.error("errors.investigation.write_failed", {
        ...exceptionAttributes(error),
        "everr.error.fingerprint": data.fingerprint,
        "error.handled": true,
      });
      throw new Error("Failed to record the Investigation. Try again.");
    }
  });

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
