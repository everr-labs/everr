import { migrateClickHouse } from "@everr/app/db/clickhouse-migrations";

// Tenant row policies and the grants per-organization provisioning needs.
export function migrateCloudClickHouse() {
  return migrateClickHouse(
    import.meta.glob<string>("../../clickhouse/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  );
}
