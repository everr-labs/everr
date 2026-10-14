import { env } from "@/env";
import { createClient } from "@/lib/clickhouse-client";
import { instrumentClickhouseOperation } from "@/telemetry/clickhouse";

const clickhouseAdmin = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_ADMIN_USERNAME,
  password: env.CLICKHOUSE_ADMIN_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
  keep_alive: { idle_socket_ttl: 8000 },
});

export type AdminCommandOptions = Omit<
  Parameters<typeof clickhouseAdmin.command>[0],
  "query"
>;

export function adminCommand(query: string, options: AdminCommandOptions = {}) {
  return instrumentClickhouseOperation(
    { client: "admin", operation: "QUERY" },
    () =>
      clickhouseAdmin.command({
        query,
        ...options,
      }),
  );
}
