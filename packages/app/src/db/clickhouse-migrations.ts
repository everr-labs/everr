import { env } from "#app/env/index.ts";
import { clickhouseMigrationEnv } from "#app/env/clickhouse-migration.ts";
import { createClient } from "#app/lib/clickhouse-client.ts";
import { instrumentClickhouseOperation } from "#app/telemetry/clickhouse.ts";
import { serverLogger } from "#app/telemetry/logger.ts";
import {
  type ClickHouseMigration,
  clickHouseMigrationsFrom,
  sharedClickHouseMigrations,
  sqlStatements,
} from "./clickhouse-sql";

type Params = Readonly<Record<string, string | undefined>>;

const JOURNAL = "default.everr_clickhouse_migrations";
const PARAMETER = /\{(\w+):\w+\}/g;

/** Every migration not yet applied, in file-name order across directories. */
export function pendingClickHouseMigrations(
  migrations: readonly ClickHouseMigration[],
  applied: ReadonlySet<string>,
): ClickHouseMigration[] {
  const sorted = [...migrations].sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const [i, { name }] of sorted.entries()) {
    if (name === sorted[i + 1]?.name) throw new Error(`Duplicate ClickHouse migration ${name}`);
  }
  return sorted.filter(({ name }) => !applied.has(name));
}

/** The values a statement's `{name:Type}` placeholders need. */
export function statementParams(
  migration: string,
  statement: string,
  params: Params,
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
 * Apply the shared files plus a product's own `productFiles` (an eager raw
 * glob) that the journal does not list. Statements must be safe to repeat: a
 * migration that fails partway runs again from its first statement. Run it
 * under the PostgreSQL migration lock so replicas apply it once.
 */
export async function migrateClickHouse(
  productFiles: Record<string, string>,
  productParams: Params = {},
): Promise<void> {
  const { CLICKHOUSE_MIGRATION_USERNAME: username, CLICKHOUSE_MIGRATION_PASSWORD: password } =
    clickhouseMigrationEnv;
  if (password === undefined) {
    serverLogger.info("clickhouse.migration.skipped", {
      "everr.clickhouse.migration.reason": "CLICKHOUSE_MIGRATION_PASSWORD is not set",
    });
    return;
  }
  const migrations = [...sharedClickHouseMigrations, ...clickHouseMigrationsFrom(productFiles)];
  const params: Params = {
    collector_rw_password: clickhouseMigrationEnv.CLICKHOUSE_COLLECTOR_PASSWORD,
    app_ro_password: env.CLICKHOUSE_PASSWORD,
    web_app_admin_password: env.CLICKHOUSE_ADMIN_PASSWORD,
    ...productParams,
  };

  const client = createClient({ url: env.CLICKHOUSE_URL, username, password });
  const run = <T>(operation: string, call: () => Promise<T>) =>
    instrumentClickhouseOperation({ client: "migration", operation }, call);
  try {
    await run("CREATE", () =>
      client.command({
        query: `CREATE TABLE IF NOT EXISTS ${JOURNAL} (
          name String,
          applied_at DateTime64(3) DEFAULT now64(3)
        ) ENGINE = MergeTree ORDER BY name`,
      }),
    );
    const applied = await run("SELECT", async () => {
      const rows = await client.query({
        query: `SELECT name FROM ${JOURNAL}`,
        format: "JSONEachRow",
      });
      return new Set((await rows.json<{ name: string }>()).map(({ name }) => name));
    });

    for (const migration of pendingClickHouseMigrations(migrations, applied)) {
      for (const statement of sqlStatements(migration.sql)) {
        await run("QUERY", () =>
          client.command({
            query: statement,
            query_params: statementParams(migration.name, statement, params),
          }),
        );
      }
      await run("INSERT", () =>
        client.insert({
          table: JOURNAL,
          values: [{ name: migration.name }],
          format: "JSONEachRow",
        }),
      );
      serverLogger.info("clickhouse.migration.applied", {
        "everr.clickhouse.migration.name": migration.name,
      });
    }
  } finally {
    await client.close();
  }
}
