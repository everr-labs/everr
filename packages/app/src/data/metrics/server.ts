import {
  MetricAttributeKeysInputSchema,
  MetricAttributeValuesInputSchema,
  MetricCatalogInputSchema,
  MetricExemplarsInputSchema,
  MetricExportIntervalInputSchema,
  MetricFilterOptionsInputSchema,
  MetricMetadataInputSchema,
  MetricNamesInputSchema,
  MetricSeriesInputSchema,
  MetricSummaryQuantilesInputSchema,
  MetricsRepository,
} from "@everr/telemetry-explorer/metrics";
import type { SqlClient } from "@everr/telemetry-explorer/traces";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new MetricsRepository(client);
}

export const getMetricCatalog = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricCatalogInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).catalog(data));

export const getMetricMetadata = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricMetadataInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).metadata(data));

export const getMetricNames = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricNamesInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).names(data));

export const getMetricKinds = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricNamesInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).kinds(data));

export const getMetricSeries = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricSeriesInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).series(data));

export const getMetricExemplars = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricExemplarsInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).exemplars(data));

export const getMetricAttributeKeys = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricAttributeKeysInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).attributeKeys(data));

export const getMetricAttributeValues = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );

export const getMetricServices = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricFilterOptionsInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).services(data));

export const getMetricEnvironments = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricFilterOptionsInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).environments(data));

export const getMetricSummaryQuantiles = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricSummaryQuantilesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).summaryQuantiles(data),
  );

export const getMetricExportInterval = createAuthenticatedServerFn({ method: "GET" })
  .validator(MetricExportIntervalInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).exportInterval(data));
