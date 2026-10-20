// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createNitro } from "nitro/builder";
import { expect, it } from "vitest";
import { migrationAssets } from "./migrations";

it("packages SQL and journals for each history without generation snapshots", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "packaged-migrations-"));
  try {
    const histories: Record<string, string> = {};
    for (const name of [".", "cloud", "legacy"]) {
      const source = resolve(root, "source", name);
      await mkdir(resolve(source, "meta"), { recursive: true });
      await writeFile(resolve(source, "0000.sql"), `-- ${name} migration\n`);
      await writeFile(resolve(source, "meta/_journal.json"), '{"entries":[]}');
      await writeFile(resolve(source, "meta/0000_snapshot.json"), "{}");
      histories[name] = source;
    }
    const output = resolve(root, ".output");
    const nitro = await createNitro({
      rootDir: root,
      output: { dir: output },
      modules: [migrationAssets(histories).nitro],
    });
    try {
      await nitro.hooks.callHook("compiled", nitro);
    } finally {
      await nitro.close();
    }
    for (const name of Object.keys(histories)) {
      const folder = resolve(output, "drizzle", name);
      expect(await readFile(resolve(folder, "0000.sql"), "utf8")).toBe(
        `-- ${name} migration\n`,
      );
      expect(await readFile(resolve(folder, "meta/_journal.json"), "utf8")).toBe(
        '{"entries":[]}',
      );
      expect(await readdir(resolve(folder, "meta"))).toEqual(["_journal.json"]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
