import { appEnv } from "#app/app/env.ts";
import { migrateClickHouse } from "#app/db/clickhouse-migrations.ts";

// Installation-wide users and one SQL API user, without tenant row policies.
export function migrateInstallationClickHouse() {
  return migrateClickHouse(
    import.meta.glob<string>("../../clickhouse/self-hosted/**/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
    {
      sql_api_username: appEnv.CLICKHOUSE_SQL_API_USERNAME,
      sql_api_password: appEnv.CLICKHOUSE_SQL_API_PASSWORD,
    },
  );
}
