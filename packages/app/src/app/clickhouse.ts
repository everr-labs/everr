import type { ClickHouseSettings } from "@clickhouse/client";
import { appEnv } from "./env";

export function appQuerySettings(
  _organizationId: string,
  settings?: ClickHouseSettings,
) {
  return settings;
}

export function sqlApiAccess(_organizationId: string) {
  return {
    auth: {
      username: appEnv.CLICKHOUSE_SQL_API_USERNAME,
      password: appEnv.CLICKHOUSE_SQL_API_PASSWORD,
    },
  };
}
