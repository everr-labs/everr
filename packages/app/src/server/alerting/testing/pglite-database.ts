import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

const GRAPHILE_WORKER_SCHEMA = "graphile_worker";

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

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = await PGlite.create();
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
    WHERE (schemaname = 'public' AND tablename LIKE 'alert%')
       OR schemaname = ${GRAPHILE_WORKER_SCHEMA}
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
