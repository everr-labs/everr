// @vitest-environment node
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, it } from "vitest";
import { stageMigrationHistories } from "./migrations";

it("ships executable shared and additive histories without generation snapshots", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "packaged-migrations-"));
  const client = new PGlite();
  try {
    const histories: Record<string, string> = {};
    for (const name of [".", "cloud", "legacy"]) {
      const source = resolve(root, "source", name);
      await mkdir(resolve(source, "meta"), { recursive: true });
      const table = name === "." ? "shared" : name;
      await writeFile(
        resolve(source, "0000.sql"),
        `CREATE TABLE ${table} (id integer);`,
      );
      await writeFile(
        resolve(source, "meta/_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "postgresql",
          entries: [
            { idx: 0, version: "7", when: 1, tag: "0000", breakpoints: true },
          ],
        }),
      );
      await writeFile(resolve(source, "meta/0000_snapshot.json"), "{}");
      histories[name] = source;
    }
    const output = resolve(root, ".output");
    await stageMigrationHistories(output, histories);
    for (const name of Object.keys(histories)) {
      const folder = resolve(output, "drizzle", name);
      await migrate(drizzle(client), {
        migrationsFolder: folder,
        migrationsTable: name === "." ? "shared_history" : `${name}_history`,
      });
      await expect(
        access(resolve(folder, "meta/0000_snapshot.json")),
      ).rejects.toThrow();
    }
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "cloud",
      "legacy",
      "shared",
    ]);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
