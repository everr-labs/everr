import {
  ProfileAttributeValuesInputSchema,
  ProfileExampleTracesInputSchema,
  ProfileFilterInputSchema,
  ProfileHistogramInputSchema,
  ProfiledSpansInputSchema,
  ProfileServicesInputSchema,
  ProfileSpanTimelineInputSchema,
  ProfileStacksInputSchema,
  ProfilesRepository,
  RuntimeMetricsInputSchema,
  RuntimeMetricsRepository,
  type SqlClient,
} from "@everr/telemetry-explorer/profiles";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  const client: SqlClient = {
    execute: (sql, params) => clickhouse.query(sql, params),
  };
  return new ProfilesRepository(client);
}

export const listProfileServices = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileServicesInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).listServices(data));

export const listProfileSampleTypes = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileFilterInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).listSampleTypes(data),
  );

export const getProfileStacks = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileStacksInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).stacks(data));

export const getProfileHistogram = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileHistogramInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).histogram(data));

export const getProfileSpanTimeline = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileSpanTimelineInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).spanTimeline(data));

export const listProfiledSpans = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfiledSpansInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).profiledSpans(data));

export const getProfileAttributeKeys = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileServicesInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).attributeKeys(data));

export const getProfileAttributeValues = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileAttributeValuesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).attributeValues(data),
  );

export const listProfileVersions = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileFilterInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).listVersions(data));

export const getProfileExampleTraces = createAuthenticatedServerFn({ method: "GET" })
  .validator(ProfileExampleTracesInputSchema)
  .handler(({ data, context: { clickhouse } }) => repoFromContext(clickhouse).exampleTraces(data));

export const getProfileRuntimeMetrics = createAuthenticatedServerFn({ method: "GET" })
  .validator(RuntimeMetricsInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    new RuntimeMetricsRepository({
      execute: (sql, params) => clickhouse.query(sql, params),
    }).runtime(data),
  );
