import {
  type ClickHouseMigration,
  clickHouseMigrationFiles,
  sharedClickHouseMigrations,
} from "#app/db/clickhouse-sql.ts";

/**
 * What a self-hosted installation applies: the shared files, plus the
 * installation-wide SQL API role and its grant to `sql_api`. The deployment
 * creates the databases and users first.
 */
export const selfHostedClickHouseMigrations: readonly ClickHouseMigration[] = [
  ...sharedClickHouseMigrations,
  ...clickHouseMigrationFiles(
    import.meta.glob<string>("../../clickhouse/self-hosted/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
    import.meta.glob("../../clickhouse/self-hosted/*.seed.ts", { import: "default", eager: true }),
  ),
];
