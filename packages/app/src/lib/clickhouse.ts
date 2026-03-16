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
  sql: string,
  params?: Record<string, unknown>,
  tenantId?: number,
): Promise<T[]> {
  if (typeof tenantId !== "number") {
    throw new Error("Missing ClickHouse tenant context");
  }

  const result = await clickhouse.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
    clickhouse_settings: {
      SQL_everr_tenant_id: tenantId,
    },
  });

  return result.json<T>();
}

export function createClickhouseQuery(tenantId: number): ClickhouseQuery {
  return async <T>(sql: string, params?: Record<string, unknown>) =>
    query<T>(sql, params, tenantId);
}
