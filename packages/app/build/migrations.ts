import { copyFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

/** Ship executable migration histories without schema-generation snapshots. */
export async function stageMigrationHistories(
  outputDirectory: string,
  histories: Record<string, string>,
) {
  for (const [name, source] of Object.entries(histories)) {
    const destination = resolve(outputDirectory, "drizzle", name);
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
}
