import { env } from "#app/env/index.ts";
import { createClient } from "#app/lib/clickhouse-client.ts";
import { instrumentClickhouseOperation } from "#app/telemetry/clickhouse.ts";

const clickhouseAdmin = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_ADMIN_USERNAME,
  password: env.CLICKHOUSE_ADMIN_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
  keep_alive: { idle_socket_ttl: 8000 },
});

type InsertSettings = Parameters<
  typeof clickhouseAdmin.insert
>[0]["clickhouse_settings"];

export async function insertRows(
  table: string,
  rows: object[],
  clickhouse_settings?: InsertSettings,
): Promise<void> {
  if (rows.length === 0) return;

  await instrumentClickhouseOperation(
    { client: "admin", operation: "INSERT" },
    () =>
      clickhouseAdmin.insert({
        table,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings,
      }),
  );
}

export type AdminCommandOptions = Omit<
  Parameters<typeof clickhouseAdmin.command>[0],
  "query"
>;

export function adminCommand(query: string, options: AdminCommandOptions = {}) {
  return instrumentClickhouseOperation(
    { client: "admin", operation: "QUERY" },
    () => clickhouseAdmin.command({ query, ...options }),
  );
}
