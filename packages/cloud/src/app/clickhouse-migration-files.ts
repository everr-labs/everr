import {
  type ClickHouseMigration,
  clickHouseMigrationFiles,
  sharedClickHouseMigrations,
} from "@everr/app/db/clickhouse-sql";

/**
 * What Cloud applies: the shared files, plus the tenant row policies and the
 * grants per-organization provisioning needs. The infrastructure creates the
 * databases and service users before the app first starts.
 */
export const cloudClickHouseMigrations: readonly ClickHouseMigration[] = [
  ...sharedClickHouseMigrations,
  ...clickHouseMigrationFiles(
    import.meta.glob<string>("../../clickhouse/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
    import.meta.glob("../../clickhouse/*.seed.ts", { import: "default", eager: true }),
  ),
];
