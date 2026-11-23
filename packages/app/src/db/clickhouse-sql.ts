export type ClickHouseSeedParams = Readonly<Record<string, unknown>>;

/**
 * What a seed works with: the connection its migration runs on. Pass a value
 * that comes from the server as a parameter, not as part of `sql`.
 */
export interface ClickHouseSeedContext {
  query<Row>(this: void, sql: string, params?: ClickHouseSeedParams): Promise<Row[]>;
  command(this: void, sql: string, params?: ClickHouseSeedParams): Promise<void>;
}

/**
 * Work a migration needs that SQL alone cannot express, such as one statement
 * per existing organization. It is the default export of
 * `NNNN-<name>.seed.ts`, next to `NNNN-<name>.sql`, and runs once with
 * that file, after its statements. A migration that fails runs again from its
 * first statement, so a seed must be safe to repeat.
 */
export type ClickHouseSeed = (context: ClickHouseSeedContext) => Promise<void>;

/**
 * One SQL file. Its file name orders it and keys it in the journal. It is
 * immutable once applied: changing it stops startup.
 */
export interface ClickHouseMigration {
  readonly name: string;
  readonly sql: string;
  readonly seed?: ClickHouseSeed;
}

const TARGETS = ["self-hosted", "cloud"] as const;

/** The product a deployment runs as. Each has its own ClickHouse server. */
export type ClickHouseMigrationTarget = (typeof TARGETS)[number];

/**
 * The one product a file applies to, from the tag after its number
 * (`0012-cloud-apply-rls.sql`). A file without a tag applies to both.
 */
export function clickHouseMigrationTarget(name: string): ClickHouseMigrationTarget | undefined {
  const afterNumber = name.replace(/^\d+-/, "");
  return TARGETS.find((target) => afterNumber.startsWith(`${target}-`));
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const isClickHouseSeed = (exported: unknown): exported is ClickHouseSeed =>
  typeof exported === "function";

/**
 * Give each migration the seed named after it. Throws for a seed
 * without a migration, which would never run.
 */
export function withClickHouseSeeds(
  migrations: readonly ClickHouseMigration[],
  seedExports: Readonly<Record<string, unknown>>,
): ClickHouseMigration[] {
  const unmatched = new Map(Object.entries(seedExports));
  const joined = migrations.map((migration) => {
    const name = migration.name.replace(/\.sql$/, ".seed.ts");
    if (!unmatched.has(name)) return migration;
    const seed = unmatched.get(name);
    unmatched.delete(name);
    if (!isClickHouseSeed(seed)) {
      throw new Error(`ClickHouse seed ${name} needs a function as its default export`);
    }
    return { ...migration, seed };
  });
  if (unmatched.size > 0) {
    throw new Error(
      `ClickHouse seeds without a migration: ${[...unmatched.keys()].sort().join(", ")}`,
    );
  }
  return joined;
}

/** Every migration file, for both products. */
export const clickHouseMigrations: readonly ClickHouseMigration[] = withClickHouseSeeds(
  Object.entries(
    import.meta.glob<string>("../../clickhouse/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([path, sql]) => ({ name: fileName(path), sql })),
  Object.fromEntries(
    Object.entries(
      import.meta.glob("../../clickhouse/*.seed.ts", {
        import: "default",
        eager: true,
      }),
    ).map(([path, seed]) => [fileName(path), seed]),
  ),
);

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
