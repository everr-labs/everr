/**
 * One SQL file. Its file name orders it and keys it in the journal. It is
 * immutable once applied: changing it stops startup.
 */
export interface ClickHouseMigration {
  readonly name: string;
  readonly sql: string;
}

const TARGETS = ["self-hosted", "cloud"] as const;

/** The product a deployment runs as. Each has its own ClickHouse server. */
export type ClickHouseMigrationTarget = (typeof TARGETS)[number];

/**
 * The one product a file applies to, from the tag after its number
 * (`20-cloud-apply-rls.sql`). A file without a tag applies to both.
 */
export function clickHouseMigrationTarget(name: string): ClickHouseMigrationTarget | undefined {
  const afterNumber = name.replace(/^\d+-/, "");
  return TARGETS.find((target) => afterNumber.startsWith(`${target}-`));
}

/** Every migration file, for both products. */
export const clickHouseMigrations: readonly ClickHouseMigration[] = Object.entries(
  import.meta.glob<string>("../../clickhouse/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
).map(([path, sql]) => ({ name: path.slice(path.lastIndexOf("/") + 1), sql }));

/** The files one product applies: the untagged ones and its own. */
export function clickHouseMigrationsFor(
  target: ClickHouseMigrationTarget,
  migrations: readonly ClickHouseMigration[] = clickHouseMigrations,
): ClickHouseMigration[] {
  return migrations.filter(({ name }) => (clickHouseMigrationTarget(name) ?? target) === target);
}

export { sqlStatements } from "./clickhouse-statements.ts";

/** File-name order, the order migrations apply in. */
export const byMigrationName = (a: ClickHouseMigration, b: ClickHouseMigration) =>
  a.name < b.name ? -1 : 1;
