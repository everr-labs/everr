import { migrateClickHouse } from "#app/db/clickhouse-migrations.ts";
import { selfHostedClickHouseMigrations } from "./clickhouse-migration-files.ts";

// Installation-wide SQL API access, without tenant row policies. The
// deployment creates the databases and users first.
export function migrateInstallationClickHouse() {
  return migrateClickHouse(selfHostedClickHouseMigrations);
}
