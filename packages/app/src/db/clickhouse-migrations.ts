import { ClickHouseError } from "@clickhouse/client";
import { env } from "#app/env/index.ts";
import { clickhouseMigrationEnv } from "#app/env/clickhouse-migration.ts";
import { createClient } from "#app/lib/clickhouse-client.ts";
import { instrumentClickhouseOperation } from "#app/telemetry/clickhouse.ts";
import { serverLogger } from "#app/telemetry/logger.ts";
import {
  byMigrationName,
  type ClickHouseSeedContext,
  type ClickHouseSeedParams,
  type ClickHouseMigration,
  type ClickHouseMigrationTarget,
  clickHouseMigrationsFor,
  sqlStatements,
} from "./clickhouse-sql";
import { clickHouseMigrationHash } from "./clickhouse-statements.ts";

export { clickHouseMigrationHash } from "./clickhouse-statements.ts";

type Params = Readonly<Record<string, string | undefined>>;

const JOURNAL = "default.everr_clickhouse_migrations";
const PARAMETER = /\{(\w+):\w+\}/g;
const MIGRATION_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const QUERY_ID_SAFE = /[^0-9A-Za-z_-]/g;
const NOTHING_TO_KILL = "785";

/** A migration as this build bundles it, with the hash the journal records. */
export interface HashedClickHouseMigration extends ClickHouseMigration {
  readonly hash: string;
}

const queryIdPrefix = (name: string) => `everr-ch-${name.replace(QUERY_ID_SAFE, "_")}-`;
const seedQueryIdPrefix = (name: string) => `${queryIdPrefix(name)}seed-`;

/**
 * Stable id for one statement. A retry sends it again with
 * `replace_running_query`, which cancels the previous attempt if ClickHouse
 * is still running it after the client timed out.
 */
export function clickHouseMigrationQueryId(name: string, index: number): string {
  return `${queryIdPrefix(name)}${index}`;
}

/**
 * The files to run, in file-name order, given the journal's
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

/** How one migration reaches ClickHouse. */
export interface ClickHouseMigrationSteps {
  statement(this: void, statement: string, index: number): Promise<void>;
  stopSeedQueries(this: void): Promise<void>;
  readonly seed: ClickHouseSeedContext;
  journal(this: void): Promise<void>;
}

function migrationError(summary: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(`${summary}: ${reason}`, { cause });
}

/**
 * One migration: the stop of its seed's earlier queries, its statements, its
 * seed, then its journal row. The row comes last, so a migration whose seed
 * fails is still pending and the next start runs all of it again.
 */
export async function applyClickHouseMigration(
  migration: HashedClickHouseMigration,
  steps: ClickHouseMigrationSteps,
): Promise<void> {
  // A seed query from an earlier start can hold a lock that a statement needs.
  if (migration.seed) {
    await steps.stopSeedQueries().catch((cause: unknown) => {
      throw migrationError(
        `ClickHouse migration ${migration.name} could not stop its earlier seed queries`,
        cause,
      );
    });
  }
  for (const [index, statement] of sqlStatements(migration.sql).entries()) {
    await steps.statement(statement, index);
  }
  try {
    await migration.seed?.(steps.seed);
  } catch (cause) {
    throw migrationError(`The seed of ClickHouse migration ${migration.name} failed`, cause);
  }
  await steps.journal();
}

type MigrationClient = Pick<ReturnType<typeof createClient>, "command" | "query" | "insert">;

const instrumented = <T>(operation: string, call: () => Promise<T>) =>
  instrumentClickhouseOperation({ client: "migration", operation }, call);

export function clickHouseMigrationSteps(
  client: MigrationClient,
  migration: HashedClickHouseMigration,
  params: Params,
): ClickHouseMigrationSteps {
  let seedCall = 0;
  const seedQuery = (query: string, queryParams?: ClickHouseSeedParams) => ({
    query,
    query_id: `${seedQueryIdPrefix(migration.name)}${seedCall++}`,
    ...(queryParams && { query_params: queryParams }),
  });
  return {
    statement: async (statement, index) => {
      await instrumented("QUERY", () =>
        client.command({
          query: statement,
          query_id: clickHouseMigrationQueryId(migration.name, index),
          clickhouse_settings: { replace_running_query: 1 },
          query_params: statementParams(migration.name, statement, params),
        }),
      );
    },
    // A seed can make other calls on a retry, so a repeated query id does not
    // find its earlier queries the way it does for a statement.
    stopSeedQueries: async () => {
      await instrumented("QUERY", async () => {
        try {
          await client.command({
            query:
              "KILL QUERY WHERE startsWith(query_id, {prefix:String}) AND user = currentUser() SYNC",
            query_params: { prefix: seedQueryIdPrefix(migration.name) },
          });
        } catch (error) {
          // ClickHouse 26.11 and later fail a KILL QUERY that matches no query.
          if (!(error instanceof ClickHouseError && error.code === NOTHING_TO_KILL)) throw error;
        }
      });
    },
    seed: {
      query: <Row>(query: string, queryParams?: ClickHouseSeedParams) =>
        instrumented("SELECT", async () => {
          const rows = await client.query({
            ...seedQuery(query, queryParams),
            format: "JSONEachRow",
          });
          return rows.json<Row>();
        }),
      command: async (query, queryParams) => {
        await instrumented("QUERY", () => client.command(seedQuery(query, queryParams)));
      },
    },
    journal: async () => {
      await instrumented("INSERT", () =>
        client.insert({
          table: JOURNAL,
          values: [{ name: migration.name, hash: migration.hash }],
          format: "JSONEachRow",
        }),
      );
    },
  };
}

/**
 * Apply the files for `target` that the journal does not list: the untagged
 * files and the ones tagged for that product. The setup file takes the base
 * users' passwords from the environment; `productParams` are the parameters
 * the product's own files name. ClickHouse DDL is not transactional, so
 * statements and seeds must be safe to repeat: a migration that fails
 * partway runs again from its first statement. Run it under the PostgreSQL migration lock so
 * replicas apply it once.
 */
export async function migrateClickHouse(
  target: ClickHouseMigrationTarget,
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
  const migrations = clickHouseMigrationsFor(target);
  const params: Params = {
    collector_rw_password: clickhouseMigrationEnv.CLICKHOUSE_COLLECTOR_PASSWORD,
    app_ro_password: env.CLICKHOUSE_PASSWORD,
    app_admin_password: env.CLICKHOUSE_ADMIN_PASSWORD,
    ...productParams,
  };

  // A statement can outlast the client's 30 s default. A `request_timeout` in
  // CLICKHOUSE_URL still wins over the 10 minutes below. ClickHouse keeps
  // running a statement after the client gives up, so each statement repeats
  // its query id and the next start cancels that run before trying again.
  // The next start stops a seed's earlier queries before it sends that
  // migration's statements again.
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
      await applyClickHouseMigration(
        migration,
        clickHouseMigrationSteps(client, migration, params),
      );
      serverLogger.info("clickhouse.migration.applied", {
        "everr.clickhouse.migration.name": migration.name,
      });
    }
  } finally {
    await client.close();
  }
}
