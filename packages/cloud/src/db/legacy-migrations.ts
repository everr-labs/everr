import { readFileSync } from "node:fs";
import { join } from "node:path";
import type * as schema from "@everr/app/db/schema";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

type Database = NodePgDatabase<typeof schema>;

interface MigrationFolders {
  legacyMigrationsFolder: string;
  appMigrationsFolder: string;
  cloudMigrationsFolder: string;
}

const appBaseline = { tag: "0000_baseline", when: 1792019447326 };
const cloudBaseline = { tag: "0000_billing_baseline", when: 1792019436245 };

function baseline(folder: string, expected: { tag: string; when: number }) {
  const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
  const entry = journal.entries[0];
  if (entry?.tag !== expected.tag || entry?.when !== expected.when) {
    throw new Error(`Unexpected baseline in ${folder}; refusing legacy adoption.`);
  }
  return readMigrationFiles({ migrationsFolder: folder })[0];
}

async function hasMigrations(db: Database, table: string): Promise<boolean> {
  const exists = await db.execute<{ relation: string | null }>(
    sql`select to_regclass(${`drizzle.${table}`})::text as relation`,
  );
  if (!exists.rows[0]?.relation) return false;
  const result = await db.execute<{ present: boolean }>(
    sql`select exists(select 1 from ${sql.identifier("drizzle")}.${sql.identifier(table)}) as present`,
  );
  return result.rows[0]?.present;
}

/** Call under the startup migration lock, before either current history runs. */
export async function upgradeLegacyCloudDatabase(
  db: Database,
  folders: MigrationFolders,
): Promise<void> {
  if (!(await hasMigrations(db, "__drizzle_migrations"))) return;

  const app = baseline(folders.appMigrationsFolder, appBaseline);
  const applied = await db.execute<{ present: boolean }>(sql`
    select exists(
      select 1 from drizzle.__drizzle_migrations
      where hash = ${app.hash} and created_at = ${app.folderMillis}
    ) as present
  `);
  // This also covers a database initialized by the app before cloud is added.
  if (applied.rows[0]?.present) return;
  if (await hasMigrations(db, "__everr_cloud_migrations")) {
    throw new Error("Incomplete legacy migration adoption; refusing to skip a migration history.");
  }

  const cloud = baseline(folders.cloudMigrationsFolder, cloudBaseline);
  await migrate(db, { migrationsFolder: folders.legacyMigrationsFolder });

  // The legacy migrator commits separately. If startup stops here, rerunning it
  // is harmless; both baseline markers always commit together.
  await db.transaction(async (tx) => {
    for (const [table, migration] of [
      ["__drizzle_migrations", app],
      ["__everr_cloud_migrations", cloud],
    ] as const) {
      const identifier = sql`${sql.identifier("drizzle")}.${sql.identifier(table)}`;
      await tx.execute(sql`create table if not exists ${identifier} (
        id serial primary key,
        hash text not null,
        created_at bigint
      )`);
      await tx.execute(sql`insert into ${identifier} (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})`);
    }
  });
}
