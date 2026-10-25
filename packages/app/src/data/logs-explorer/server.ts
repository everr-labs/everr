import {
  LogAttributeKeysInputSchema,
  LogAttributeValuesInputSchema,
  LogHistogramInputSchema,
  LogIdentitySchema,
  LogsExplorerInputSchema,
  LogsRepository,
  LogsTotalsInputSchema,
  type SqlClient,
} from "@everr/telemetry-explorer/logs";
import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new LogsRepository(client);
}

export const getLogsExplorer = createAuthenticatedServerFn({ method: "GET" })
  .validator(LogsExplorerInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).explorer(data));

export const getLogsTotals = createAuthenticatedServerFn({ method: "GET" })
  .validator(LogsTotalsInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).totals(data));

export const getLogDetail = createAuthenticatedServerFn({ method: "GET" })
  .validator(LogIdentitySchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).detail(data));

export const getLogsHistogram = createAuthenticatedServerFn({ method: "GET" })
  .validator(LogHistogramInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).histogram(data));

export const getLogFilterOptions = createAuthenticatedServerFn({
  method: "GET",
})
  .validator(z.object({ timeRange: TimeRangeSchema }))
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).filterOptions(data));

export const getLogAttributeKeys = createAuthenticatedServerFn({
  method: "GET",
})
  .validator(LogAttributeKeysInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).attributeKeys(data));

export const getLogAttributeValues = createAuthenticatedServerFn({
  method: "GET",
})
  .validator(LogAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );
