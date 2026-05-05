import { createClient } from "@clickhouse/client";
import { env } from "@/env";

export const clickhouse = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USERNAME,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
});

export type ClickhouseQuery = <T>(
  sql: string,
  params?: Record<string, unknown>,
) => Promise<T[]>;

export async function query<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }

  const result = await clickhouse.query({
    query,
    query_params,
    format: "JSONEachRow",
    clickhouse_settings: {
      SQL_everr_tenant_id: organizationId,
    },
  });

  return result.json<T>();
}

export async function queryWithClickHouseSettings<T>(
  query: string,
  organizationId: string,
  clickhouseSettings: Record<string, unknown>,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }

  const result = await clickhouse.query({
    query,
    query_params,
    format: "JSONEachRow",
    clickhouse_settings: {
      ...clickhouseSettings,
      SQL_everr_tenant_id: organizationId,
    },
  });

  return result.json<T>();
}

export function createClickhouseQuery(organizationId: string) {
  return async <T>(sql: string, params?: Record<string, unknown>) =>
    query<T>(sql, organizationId, params);
}

const clickhouseRetention = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_RETENTION_USERNAME,
  password: env.CLICKHOUSE_RETENTION_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
});

export async function upsertTenantRetention(row: {
  tenantId: string;
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
}): Promise<void> {
  await clickhouseRetention.insert({
    table: "app.tenant_retention_source",
    values: [
      {
        tenant_id: row.tenantId,
        traces_days: row.tracesDays,
        logs_days: row.logsDays,
        metrics_days: row.metricsDays,
      },
    ],
    format: "JSONEachRow",
  });
}
