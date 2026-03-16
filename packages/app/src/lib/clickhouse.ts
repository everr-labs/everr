import { createClient } from "@clickhouse/client";
import { env } from "@/env";
import { requireEverrSession } from "./auth";

export const clickhouse = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USERNAME,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
});

export async function query<T>(
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const result = await clickhouse.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
    clickhouse_settings: {
      SQL_everr_tenant_id: requireEverrSession().tenantId,
    },
  });

  return result.json<T>();
}
