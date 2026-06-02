import {
  ErrorAttributeKeysInputSchema,
  ErrorAttributeValuesInputSchema,
  ErrorsRepository,
  GetErrorIssueInputSchema,
  ListErrorServicesInputSchema,
  SearchErrorIssuesInputSchema,
  type SqlClient,
} from "@everr/telemetry-explorer/errors";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new ErrorsRepository(client, { tableName: "app.logs" });
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
