import {
  GetTraceInputSchema,
  ListServiceIdentitiesInputSchema,
  SearchTracesInputSchema,
  type SqlClient,
  TraceAttributeKeysInputSchema,
  TraceAttributeValuesInputSchema,
  TracesRepository,
} from "@everr/telemetry-explorer/traces";
import { observeTraceDetail } from "#app/server/organizations/consultation-completion.ts";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new TracesRepository(client);
}

export const searchTraces = createAuthenticatedServerFn({ method: "GET" })
  .validator(SearchTracesInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).search(data));

export const getTrace = createAuthenticatedServerFn({ method: "GET" })
  .validator(GetTraceInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).getTrace(data));

export const listServiceIdentities = createAuthenticatedServerFn({
  method: "GET",
})
  .validator(ListServiceIdentitiesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).listServiceIdentities(data),
  );

export const getTraceAttributeKeys = createAuthenticatedServerFn({
  method: "GET",
})
  .validator(TraceAttributeKeysInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).attributeKeys(data));

export const getTraceAttributeValues = createAuthenticatedServerFn({
  method: "GET",
})
  .validator(TraceAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );

/** Explicit trace navigation. Shared getTrace remains an unobserved refresh read. */
export const consultTrace = createAuthenticatedServerFn({ method: "GET" })
  .validator(GetTraceInputSchema)
  .handler(async ({ data, context: { clickhouse, consultationPrincipal } }) => {
    const rows = await repoFromContext(clickhouse).getTrace(data);
    observeTraceDetail({ principal: consultationPrincipal, rows });
    return rows;
  });
