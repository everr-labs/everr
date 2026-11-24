import { migrateClickHouse } from "@everr/app/db/clickhouse-migrations";
import { cloudClickHouseMigrations } from "./clickhouse-migration-files";

export function migrateCloudClickHouse() {
  return migrateClickHouse(cloudClickHouseMigrations);
}
