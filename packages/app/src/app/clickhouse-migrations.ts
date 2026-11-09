import {
  clickHouseMigrationsFrom,
  migrateClickHouse,
  sharedClickHouseMigrations,
} from "#app/db/clickhouse-migrations.ts";
import { appEnv } from "#app/app/env.ts";
import { clickhouseMigrationEnv } from "#app/env/clickhouse-migration.ts";
import { env } from "#app/env/index.ts";

// Installation-wide users and one SQL API user, without tenant row policies.
const selfHostedMigrations = clickHouseMigrationsFrom(
  import.meta.glob<string>("../../clickhouse/self-hosted/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

export function migrateInstallationClickHouse() {
  return migrateClickHouse([...sharedClickHouseMigrations, ...selfHostedMigrations], {
    collector_rw_password: clickhouseMigrationEnv.CLICKHOUSE_COLLECTOR_PASSWORD,
    app_ro_password: env.CLICKHOUSE_PASSWORD,
    web_app_admin_password: env.CLICKHOUSE_ADMIN_PASSWORD,
    sql_api_username: appEnv.CLICKHOUSE_SQL_API_USERNAME,
    sql_api_password: appEnv.CLICKHOUSE_SQL_API_PASSWORD,
  });
}
