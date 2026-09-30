import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHDB_PLATFORM_ASSETS,
  CHDB_RELEASE_VERSION,
  chdbReleaseAssetUrl,
  resolveChdbAsset,
  publishCliArtifact,
  sha256File,
} from "./build-support";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "everr-build-support-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("build-support chDB helpers", () => {
  it("pins official chDB release assets per platform", () => {
    expect(CHDB_RELEASE_VERSION).toBe("v26.5.0");
    for (const [key, asset] of Object.entries(CHDB_PLATFORM_ASSETS)) {
      expect(asset.assetName, key).toMatch(/libchdb\.tar\.gz$/);
      expect(asset.sha256, key).toMatch(/^[a-f0-9]{64}$/);
    }

    expect(resolveChdbAsset("darwin", "arm64").assetName).toBe("macos-arm64-libchdb.tar.gz");
    expect(resolveChdbAsset("linux", "arm64").assetName).toBe("linux-aarch64-libchdb.tar.gz");
    expect(resolveChdbAsset("linux", "x64").assetName).toBe("linux-x86_64-libchdb.tar.gz");
    expect(() => resolveChdbAsset("win32", "x64")).toThrow(/No bundled chDB release asset/);

    expect(chdbReleaseAssetUrl("macos-arm64-libchdb.tar.gz")).toBe(
      "https://github.com/chdb-io/chdb-core/releases/download/v26.5.0/macos-arm64-libchdb.tar.gz",
    );
  });

  it("calculates sha256 for downloaded archives", async () => {
    const rootDir = await makeTempDir();
    const archivePath = path.join(rootDir, "archive.tar.gz");
    await writeFile(archivePath, "libchdb archive bytes");

    await expect(sha256File(archivePath)).resolves.toBe(
      "2f46dbf2c435259d53d08abc8757955b1503c9e13e713aa4d16154a93632bbb4",
    );
  });
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
