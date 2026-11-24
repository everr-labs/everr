export type ClickHouseSeedParams = Readonly<Record<string, string | number>>;

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
 * per existing ClickHouse user. It is the default export of
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

/**
 * The migrations in one directory, from its `import.meta.glob` results:
 * the `*.sql` files as raw text and the `*.seed.ts` default exports.
 */
export function clickHouseMigrationFiles(
  sqlFiles: Readonly<Record<string, string>>,
  seedFiles: Readonly<Record<string, unknown>>,
): ClickHouseMigration[] {
  return withClickHouseSeeds(
    Object.entries(sqlFiles).map(([path, sql]) => ({ name: fileName(path), sql })),
    Object.fromEntries(Object.entries(seedFiles).map(([path, seed]) => [fileName(path), seed])),
  );
}

/**
 * The files every product applies: the schema and the grants on it. They
 * assume the `otel` and `app` databases and the service users exist.
 */
export const sharedClickHouseMigrations: readonly ClickHouseMigration[] = clickHouseMigrationFiles(
  import.meta.glob<string>("../../clickhouse/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  import.meta.glob("../../clickhouse/*.seed.ts", { import: "default", eager: true }),
);

export { sqlStatements } from "./clickhouse-statements.ts";

/** File-name order, the order migrations apply in. */
export const byMigrationName = (a: ClickHouseMigration, b: ClickHouseMigration) =>
  a.name < b.name ? -1 : 1;
