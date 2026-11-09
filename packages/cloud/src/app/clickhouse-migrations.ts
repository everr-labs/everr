import {
  clickHouseMigrationsFrom,
  migrateClickHouse,
  sharedClickHouseMigrations,
} from "@everr/app/db/clickhouse-migrations";
import { env } from "@everr/app/env";
import { clickhouseMigrationEnv } from "@everr/app/env/clickhouse-migration";

// Tenant row policies and the grants per-organization provisioning needs.
const cloudMigrations = clickHouseMigrationsFrom(
  import.meta.glob<string>("../../clickhouse/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

export function migrateCloudClickHouse() {
  return migrateClickHouse([...sharedClickHouseMigrations, ...cloudMigrations], {
    collector_rw_password: clickhouseMigrationEnv.CLICKHOUSE_COLLECTOR_PASSWORD,
    app_ro_password: env.CLICKHOUSE_PASSWORD,
    web_app_admin_password: env.CLICKHOUSE_ADMIN_PASSWORD,
  });
}
