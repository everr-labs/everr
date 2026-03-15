import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildUpdaterManifest,
  findReleaseArtifacts,
  getDesktopReleaseTarget,
} from "./copy-release-artifact";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "everr-release-artifacts-"));
  tempDirs.push(dir);
  return dir;
}

async function writeVersionedFile(filePath: string, contents: string, timestamp: number) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  const date = new Date(timestamp);
  await utimes(filePath, date, date);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("copy-release-artifact helpers", () => {
  it("returns the branded macOS arm64 release target names", () => {
    expect(getDesktopReleaseTarget("macos", "arm64")).toEqual({
      platform: "macos",
      arch: "arm64",
      updaterTarget: "darwin-aarch64",
      dmgName: "everr-macos-arm64.dmg",
      updaterArchiveName: "everr-macos-arm64.app.tar.gz",
      updaterSignatureName: "everr-macos-arm64.app.tar.gz.sig",
    });
  });

  it("builds a static updater manifest with an embedded signature", () => {
    const manifest = buildUpdaterManifest({
      version: "1.2.3",
      pubDate: "2026-03-14T17:00:00Z",
      downloadUrl: "https://everr.dev/everr-app/everr-macos-arm64.app.tar.gz",
      signature: "signed-data",
      updaterTarget: "darwin-aarch64",
    });

    expect(JSON.parse(manifest)).toEqual({
      version: "1.2.3",
      pub_date: "2026-03-14T17:00:00Z",
      platforms: {
        "darwin-aarch64": {
          url: "https://everr.dev/everr-app/everr-macos-arm64.app.tar.gz",
          signature: "signed-data",
        },
      },
    });
  });

  it("finds the newest dmg and matching updater archive/signature", async () => {
    const bundleDir = await makeTempDir();
    const oldTime = Date.UTC(2026, 2, 14, 15, 0, 0);
    const newTime = Date.UTC(2026, 2, 14, 16, 0, 0);

    await writeVersionedFile(path.join(bundleDir, "old.dmg"), "old dmg", oldTime);
    await writeVersionedFile(
      path.join(bundleDir, "nested", "latest.dmg"),
      "latest dmg",
      newTime,
    );
    await writeVersionedFile(
      path.join(bundleDir, "old.app.tar.gz"),
      "old archive",
      oldTime,
    );
    await writeVersionedFile(
      path.join(bundleDir, "old.app.tar.gz.sig"),
      "old signature",
      oldTime,
    );
    await writeVersionedFile(
      path.join(bundleDir, "nested", "latest.app.tar.gz"),
      "latest archive",
      newTime,
    );
    await writeVersionedFile(
      path.join(bundleDir, "nested", "latest.app.tar.gz.sig"),
      "latest signature",
      newTime,
    );

    await expect(findReleaseArtifacts(bundleDir)).resolves.toEqual({
      dmg: path.join(bundleDir, "nested", "latest.dmg"),
      updaterArchive: path.join(bundleDir, "nested", "latest.app.tar.gz"),
      updaterSignature: path.join(bundleDir, "nested", "latest.app.tar.gz.sig"),
    });
  });
});
