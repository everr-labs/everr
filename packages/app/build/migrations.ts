import { copyFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { NitroModule } from "nitro/types";
import type { Plugin } from "vite-plus";

/** Ship executable migration histories without schema-generation snapshots. */
export function migrationAssets(
  histories: Record<string, string>,
): Plugin & { nitro: NitroModule } {
  return {
    name: "app-migration-assets",
    apply: "build",
    nitro: {
      setup(nitro) {
        nitro.hooks.hook("compiled", async () => {
          for (const [name, source] of Object.entries(histories)) {
            const destination = resolve(nitro.options.output.dir, "drizzle", name);
            await mkdir(resolve(destination, "meta"), { recursive: true });
            for (const file of await readdir(source)) {
              if (file.endsWith(".sql"))
                await copyFile(resolve(source, file), resolve(destination, file));
            }
            await copyFile(
              resolve(source, "meta/_journal.json"),
              resolve(destination, "meta/_journal.json"),
            );
          }
        });
      },
    },
  };
}
