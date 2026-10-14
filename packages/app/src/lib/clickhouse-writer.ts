import { env } from "@/env";
import { createClient } from "@/lib/clickhouse-client";
import { instrumentClickhouseOperation } from "@/telemetry/clickhouse";

const clickhouseWriter = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_ADMIN_USERNAME,
  password: env.CLICKHOUSE_ADMIN_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
  keep_alive: { idle_socket_ttl: 8000 },
});

type InsertSettings = Parameters<
  typeof clickhouseWriter.insert
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
      clickhouseWriter.insert({
        table,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings,
      }),
  );
}
