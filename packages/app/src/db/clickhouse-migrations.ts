import { env } from "#app/env/index.ts";
import { clickhouseMigrationEnv } from "#app/env/clickhouse-migration.ts";
import { createClient } from "#app/lib/clickhouse-client.ts";
import { instrumentClickhouseOperation } from "#app/telemetry/clickhouse.ts";
import { serverLogger } from "#app/telemetry/logger.ts";
import {
  byMigrationName,
  type ClickHouseMigration,
  clickHouseMigrationsFrom,
  sharedClickHouseMigrations,
  sqlStatements,
} from "./clickhouse-sql";
import { clickHouseMigrationHash } from "./clickhouse-statements.ts";

export { clickHouseMigrationHash } from "./clickhouse-statements.ts";

type Params = Readonly<Record<string, string | undefined>>;

const JOURNAL = "default.everr_clickhouse_migrations";
const PARAMETER = /\{(\w+):\w+\}/g;
const MIGRATION_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const QUERY_ID_SAFE = /[^0-9A-Za-z_-]/g;

/** A migration as this build bundles it, with the hash the journal records. */
export interface HashedClickHouseMigration extends ClickHouseMigration {
  readonly hash: string;
}

/**
 * Stable id for one statement. A retry sends it again with
 * `replace_running_query`, which cancels the previous attempt if ClickHouse
 * is still running it after the client timed out.
 */
export function clickHouseMigrationQueryId(name: string, index: number): string {
  return `everr-ch-${name.replace(QUERY_ID_SAFE, "_")}-${index}`;
}

/**
 * The files to run, in file-name order across directories, given the journal's
 * hash per applied file. Applied files are immutable: throws, before anything
 * runs, when one changed.
 */
export function pendingClickHouseMigrations(
  migrations: readonly ClickHouseMigration[],
  applied: ReadonlyMap<string, string>,
): HashedClickHouseMigration[] {
  const sorted = [...migrations].sort(byMigrationName);
  const pending: HashedClickHouseMigration[] = [];
  const changed: string[] = [];
  for (const [i, migration] of sorted.entries()) {
    if (migration.name === sorted[i + 1]?.name) {
      throw new Error(`Duplicate ClickHouse migration ${migration.name}`);
    }
    const hashed = { ...migration, hash: clickHouseMigrationHash(migration.sql) };
    const recorded = applied.get(migration.name);
    if (recorded === undefined) pending.push(hashed);
    else if (recorded !== hashed.hash) changed.push(migration.name);
  }
  if (changed.length > 0) {
    throw new Error(
      `ClickHouse migrations changed after they were applied: ${changed.join(", ")}. ` +
        "Applied migrations are immutable: restore them and put the change in a new file.",
    );
  }
  return pending;
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
 * glob) that the journal does not list. The shared setup file takes the base
 * users' passwords from the environment; `productParams` are the parameters
 * the product's own files name. ClickHouse DDL is not transactional, so
 * statements must be safe to repeat: a migration that fails partway runs again
 * from its first statement. Run it under the PostgreSQL migration lock so
 * replicas apply it once.
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

  // A statement can outlast the client's 30 s default. A `request_timeout` in
  // CLICKHOUSE_URL still wins over the 10 minutes below. ClickHouse keeps
  // running a statement after the client gives up, so each statement repeats
  // its query id and the next start cancels that run before trying again.
  const client = createClient({
    url: env.CLICKHOUSE_URL,
    username,
    password,
    request_timeout: MIGRATION_REQUEST_TIMEOUT_MS,
    // Progress headers keep an idle connection open through a load balancer.
    clickhouse_settings: {
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: "30000",
    },
  });
  const instrumented = <T>(operation: string, call: () => Promise<T>) =>
    instrumentClickhouseOperation({ client: "migration", operation }, call);
  try {
    await instrumented("CREATE", () =>
      client.command({
        query: `CREATE TABLE IF NOT EXISTS ${JOURNAL} (
          name String,
          hash String,
          applied_at DateTime64(3) DEFAULT now64(3)
        ) ENGINE = MergeTree ORDER BY name`,
      }),
    );
    const applied = await instrumented("SELECT", async () => {
      const rows = await client.query({
        query: `SELECT name, argMax(hash, applied_at) AS hash FROM ${JOURNAL} GROUP BY name`,
        format: "JSONEachRow",
      });
      return new Map(
        (await rows.json<{ name: string; hash: string }>()).map(({ name, hash }) => [name, hash]),
      );
    });

    for (const migration of pendingClickHouseMigrations(migrations, applied)) {
      for (const [index, statement] of sqlStatements(migration.sql).entries()) {
        await instrumented("QUERY", () =>
          client.command({
            query: statement,
            query_id: clickHouseMigrationQueryId(migration.name, index),
            clickhouse_settings: { replace_running_query: 1 },
            query_params: statementParams(migration.name, statement, params),
          }),
        );
      }
      await instrumented("INSERT", () =>
        client.insert({
          table: JOURNAL,
          values: [{ name: migration.name, hash: migration.hash }],
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
