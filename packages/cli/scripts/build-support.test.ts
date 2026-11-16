import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { publishCliArtifact } from "./build-support";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "everr-build-support-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("build-support CLI artifact helpers", () => {
  it("publishes one CLI binary and its checksum", async () => {
    const rootDir = await makeTempDir();
    const sourceBin = path.join(rootDir, "built-everr");
    const outputDir = path.join(rootDir, "release");

    await writeFile(sourceBin, "cli bytes");

    await expect(publishCliArtifact(sourceBin, { outputDir })).resolves.toEqual({
      outputBin: path.join(outputDir, "everr"),
      outputSha: path.join(outputDir, "everr.sha256"),
    });

    await expect(readFile(path.join(outputDir, "everr"), "utf8")).resolves.toBe("cli bytes");
    await expect(readFile(path.join(outputDir, "everr.sha256"), "utf8")).resolves.toBe(
      "178893fed67c46f50c58cd77b698bb27649bee32019baa1e72b5142f9676e7a2  everr\n",
    );
  });
});
