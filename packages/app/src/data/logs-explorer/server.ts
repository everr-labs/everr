import {
  LogHistogramInputSchema,
  LogIdentitySchema,
  LogsExplorerInputSchema,
  LogsRepository,
  LogsTotalsInputSchema,
  type SqlClient,
  TimeRangeSchema,
} from "@everr/telemetry-explorer/logs";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new LogsRepository(client);
}

export const getLogsExplorer = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogsExplorerInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).explorer(data),
  );

export const getLogsTotals = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogsTotalsInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).totals(data),
  );

export const getLogDetail = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogIdentitySchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).detail(data),
  );

export const getLogsHistogram = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(LogHistogramInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).histogram(data),
  );

export const getLogFilterOptions = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ timeRange: TimeRangeSchema }))
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).filterOptions(data),
  );
