import { createClient } from "@clickhouse/client";
import { env } from "@/env";

export const clickhouse = createClient({
  url: `http://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
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
  });

  return result.json<T>();
}
