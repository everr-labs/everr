import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

const GRAPHILE_WORKER_SCHEMA = "graphile_worker";
const CLOCK_SCHEMA = "test_clock";
const CLOCK_SETTING = "test.now";

export interface TestDatabase {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

function drizzleMigrationsDir(): string {
  // testing/ -> alerting/ -> server/ -> src/ -> packages/app/
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../drizzle");
}

function graphileWorkerSqlDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("graphile-worker/package.json")), "sql");
}

function sqlFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Extend the suite's faked clock into the database, so both engines date their
 * work on one timeline. Left alone, PGlite's real `now()` stamps every
 * `default now()` column and, above all, `add_job`'s `coalesce(run_at, now())`
 * months away from the instant a test pinned, and such a job never comes due.
 *
 * The shadow works because `now()` is a function and `pg_catalog` only wins by
 * default while the search path does not name it. `public` stays first so
 * unqualified DDL still creates its tables there.
 *
 * Call before any schema is applied: a column default binds to the function it
 * resolved to when the table was created.
 */
async function installFakeClock(client: PGlite): Promise<void> {
  await client.exec(`
    CREATE SCHEMA ${CLOCK_SCHEMA};
    CREATE FUNCTION ${CLOCK_SCHEMA}.now() RETURNS timestamptz
      LANGUAGE sql STABLE AS $$
        SELECT coalesce(
          current_setting('${CLOCK_SETTING}', true)::timestamptz,
          pg_catalog.now()
        )
      $$;
    SET search_path = public, ${CLOCK_SCHEMA}, pg_catalog;
  `);

  // Pulled before each statement rather than pushed by setNow/advance, so a
  // test moves both engines with one call. A transaction is stamped on the way
  // in, and the statements inside share that instant, the way `now()` behaves
  // for production code. The memo matters: without it every statement in the
  // suite pays a publish, which measures at about a second.
  const query = client.query.bind(client);
  let published: number | undefined;
  const publish = async () => {
    const now = Date.now();
    if (now === published) return;
    published = now;
    await query(`SELECT set_config($1, $2, false)`, [
      CLOCK_SETTING,
      new Date(now).toISOString(),
    ]);
  };

  client.query = (async (...args: Parameters<typeof query>) => {
    await publish();
    return query(...args);
  }) as typeof client.query;

  const transaction = client.transaction.bind(client);
  client.transaction = (async (...args: Parameters<typeof transaction>) => {
    await publish();
    return transaction(...args);
  }) as typeof client.transaction;
}

// Applies graphile-worker's schema objects only, not its migration bookkeeping
// (graphile_worker.migrations is populated by the library's own JS migrate(),
// not by these raw SQL files). Because of that, never point graphile-worker's
// own API (run, makeWorkerUtils, quickAddJob) at this database: each of those
// calls migrate() on connect, and it would try to reapply migrations over
// objects that already exist. The harness dispatches jobs itself instead.
async function applyGraphileWorkerSchema(client: PGlite): Promise<void> {
  await client.exec(`CREATE SCHEMA ${GRAPHILE_WORKER_SCHEMA};`);
  for (const file of sqlFilesIn(graphileWorkerSqlDir())) {
    const text = readFileSync(file, "utf8").replaceAll(
      ":GRAPHILE_WORKER_SCHEMA",
      GRAPHILE_WORKER_SCHEMA,
    );
    await client.exec(text);
  }
}

async function applyAppSchema(client: PGlite): Promise<void> {
  for (const file of sqlFilesIn(drizzleMigrationsDir())) {
    for (const statement of readFileSync(file, "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim().length === 0) continue;
      await client.exec(statement);
    }
  }
}

/**
 * Report a write's row count the way node-postgres does.
 *
 * PGlite answers a DELETE or UPDATE with `affectedRows`; node-postgres, which
 * production runs on, answers with `rowCount`. Code that counts what it
 * deleted reads `rowCount` (maintenance/cleanup.ts), and against the raw
 * PGlite result that is `undefined`, so every batch would report zero rows and
 * a loop that repeats while a batch was full would stop after one pass. The
 * count is the same number under both names: this fills in the name the
 * production driver uses rather than changing what the database did.
 */
type Counted = { affectedRows?: number; rowCount?: number };

function countRows<T>(result: T): T {
  const counted = result as Counted;
  if (counted.rowCount === undefined && counted.affectedRows !== undefined) {
    counted.rowCount = counted.affectedRows;
  }
  return result;
}

function withRowCount(client: PGlite): PGlite {
  // Wrapped on the client rather than on the drizzle instance, and on the
  // transaction handle as well as the connection: a transaction gets its own
  // executor, and the deletes that read the count all run inside one, so
  // patching `db.execute` alone would never reach them.
  const query = client.query.bind(client);
  client.query = (async (...args: Parameters<typeof query>) =>
    countRows(await query(...args))) as typeof client.query;

  const transaction = client.transaction.bind(client);
  client.transaction = (async (
    callback: (tx: { query: PGlite["query"] }) => Promise<unknown>,
  ) =>
    transaction(async (tx) => {
      const txQuery = tx.query.bind(tx);
      tx.query = (async (...args: Parameters<typeof txQuery>) =>
        countRows(await txQuery(...args))) as typeof tx.query;
      return callback(tx);
    })) as typeof client.transaction;
  return client;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = withRowCount(await PGlite.create());
  await installFakeClock(client);
  await applyGraphileWorkerSchema(client);
  await applyAppSchema(client);
  const db = drizzle(client, { schema });

  // Discovered rather than hand-listed, so a table added to the schema is
  // cleared without this file being updated. A stale row left behind is the
  // worst failure mode a shared fixture has: it makes one test's result
  // depend on which tests ran before it.
  const targets = await db.execute<{ target: string }>(sql`
    SELECT format('%I.%I', schemaname, tablename) AS target
    FROM pg_tables
    WHERE schemaname = 'public' OR schemaname = ${GRAPHILE_WORKER_SCHEMA}
  `);
  if (targets.rows.length === 0) {
    throw new Error(
      "createTestDatabase: schema application produced no tables to truncate",
    );
  }
  const truncateList = targets.rows.map((row) => row.target).join(", ");

  return {
    db,
    client,
    async truncate() {
      await db.execute(
        sql.raw(`TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`),
      );
    },
    async close() {
      await client.close();
    },
  };
}
