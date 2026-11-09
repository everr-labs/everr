import { env } from "#app/env/index.ts";
import { clickhouseMigrationEnv } from "#app/env/clickhouse-migration.ts";
import { createClient } from "#app/lib/clickhouse-client.ts";
import { serverLogger } from "#app/telemetry/logger.ts";

/** One SQL file. The file name orders it and records it as applied. */
export interface ClickHouseMigration {
  readonly name: string;
  readonly sql: string;
}

export type ClickHouseMigrationParams = Readonly<Record<string, string | undefined>>;

const JOURNAL = "default.everr_clickhouse_migrations";
const PARAMETER = /\{(\w+):\w+\}/g;

/** Files from `import.meta.glob(..., { query: "?raw", import: "default", eager: true })`. */
export function clickHouseMigrationsFrom(files: Record<string, string>): ClickHouseMigration[] {
  return Object.entries(files).map(([path, sql]) => ({
    name: path.slice(path.lastIndexOf("/") + 1),
    sql,
  }));
}

/** Table definitions and SQL query limits that App and Cloud share. */
export const sharedClickHouseMigrations = clickHouseMigrationsFrom(
  import.meta.glob<string>("../../clickhouse/shared/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

// Strip line comments before splitting statements: comments can contain semicolons.
export function sqlStatements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** Every migration not yet applied, in file-name order across directories. */
export function pendingClickHouseMigrations(
  migrations: readonly ClickHouseMigration[],
  applied: ReadonlySet<string>,
): ClickHouseMigration[] {
  const names = new Set<string>();
  for (const { name } of migrations) {
    if (names.has(name)) throw new Error(`Duplicate ClickHouse migration ${name}`);
    names.add(name);
  }
  return [...migrations]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .filter(({ name }) => !applied.has(name));
}

/** The values a statement's `{name:Type}` placeholders need. */
export function statementParams(
  migration: string,
  statement: string,
  params: ClickHouseMigrationParams,
): Record<string, string> {
  const bound: Record<string, string> = {};
  for (const [, name] of statement.matchAll(PARAMETER)) {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`ClickHouse migration ${migration} needs the ${name} parameter`);
    }
    bound[name] = value;
  }
  return bound;
}

/**
 * Apply the migrations the journal does not list. Statements must be safe to
 * repeat: a migration that fails partway runs again from its first statement.
 * Run it under the PostgreSQL migration lock so replicas apply it once.
 */
export async function migrateClickHouse(
  migrations: readonly ClickHouseMigration[],
  params: ClickHouseMigrationParams,
): Promise<void> {
  const { CLICKHOUSE_MIGRATION_USERNAME: username, CLICKHOUSE_MIGRATION_PASSWORD: password } =
    clickhouseMigrationEnv;
  if (password === undefined) {
    serverLogger.info("clickhouse.migration.skipped", {
      "everr.clickhouse.migration.reason": "CLICKHOUSE_MIGRATION_PASSWORD is not set",
    });
    return;
  }

  const client = createClient({ url: env.CLICKHOUSE_URL, username, password });
  try {
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS ${JOURNAL} (
        name String,
        applied_at DateTime64(3) DEFAULT now64(3)
      ) ENGINE = MergeTree ORDER BY name`,
    });
    const rows = await client.query({
      query: `SELECT name FROM ${JOURNAL}`,
      format: "JSONEachRow",
    });
    const applied = new Set((await rows.json<{ name: string }>()).map(({ name }) => name));

    for (const migration of pendingClickHouseMigrations(migrations, applied)) {
      for (const statement of sqlStatements(migration.sql)) {
        await client.command({
          query: statement,
          query_params: statementParams(migration.name, statement, params),
        });
      }
      await client.insert({
        table: JOURNAL,
        values: [{ name: migration.name }],
        format: "JSONEachRow",
      });
      serverLogger.info("clickhouse.migration.applied", {
        "everr.clickhouse.migration.name": migration.name,
      });
    }
  } finally {
    await client.close();
  }
}
