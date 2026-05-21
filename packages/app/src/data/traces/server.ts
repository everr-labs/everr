import {
  GetTraceInputSchema,
  ListServiceIdentitiesInputSchema,
  SearchTracesInputSchema,
  type SqlClient,
  TracesRepository,
} from "@everr/telemetry-explorer/traces";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new TracesRepository(client);
}

export const searchTraces = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(SearchTracesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).search(data),
  );

export const getTrace = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(GetTraceInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).getTrace(data),
  );

export const listServiceIdentities = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(ListServiceIdentitiesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).listServiceIdentities(data),
  );
