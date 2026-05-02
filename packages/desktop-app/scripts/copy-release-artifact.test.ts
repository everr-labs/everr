import { mkdtemp, mkdir, readFile, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPublicArtifactUrl,
  buildReleaseMetadata,
  buildUpdaterManifest,
  findReleaseArtifacts,
  getDesktopReleaseTarget,
  resolveDmgNotarizationRequest,
  writeReleaseChecksums,
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
      version: "0.1.1264",
      releaseShortSha: "82efe1c",
      pubDate: "2026-03-14T17:00:00Z",
      downloadUrl: "https://everr.dev/everr-app/everr-macos-arm64.app.tar.gz",
      signature: "signed-data",
      updaterTarget: "darwin-aarch64",
    });

    expect(JSON.parse(manifest)).toEqual({
      version: "0.1.1264",
      notes: "Everr desktop release 82efe1c",
      pub_date: "2026-03-14T17:00:00Z",
      platforms: {
        "darwin-aarch64": {
          url: "https://everr.dev/everr-app/everr-macos-arm64.app.tar.gz",
          signature: "signed-data",
        },
      },
    });
  });

  it("builds public artifact URLs from the deploy base URL", () => {
    expect(
      buildPublicArtifactUrl({
        baseUrl: "https://everr.dev/everr-app/",
        assetName: "everr-macos-arm64.app.tar.gz",
      }),
    ).toBe("https://everr.dev/everr-app/everr-macos-arm64.app.tar.gz");
  });

  it("builds release metadata for the deploy artifact bundle", () => {
    const metadata = buildReleaseMetadata({
      platformVersion: "0.1.1264",
      releaseSha: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
      releaseShortSha: "82efe1c",
      publicBaseUrl: "https://everr.dev/everr-app",
      target: getDesktopReleaseTarget("macos", "arm64"),
      createdAt: "2026-03-14T17:00:00.000Z",
      files: [
        {
          path: "everr-app/latest.json",
          sha256: "a".repeat(64),
          size: 123,
        },
      ],
    });

    expect(JSON.parse(metadata)).toMatchObject({
      schema_version: 1,
      product: "Everr",
      version: "0.1.1264",
      platform_version: "0.1.1264",
      release_sha: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
      release_short_sha: "82efe1c",
      public_base_url: "https://everr.dev/everr-app",
      files: [
        {
          path: "everr-app/latest.json",
          sha256: "a".repeat(64),
          size: 123,
        },
      ],
    });
  });

  it("resolves the App Store Connect credentials needed to notarize the release DMG", () => {
    expect(
      resolveDmgNotarizationRequest({
        platform: "darwin",
        dmgPath: "/tmp/Everr.dmg",
        env: {
          APPLE_API_KEY: "KEY123",
          APPLE_API_KEY_PATH: "/tmp/AuthKey_KEY123.p8",
          APPLE_API_ISSUER: "issuer-uuid",
        },
      }),
    ).toEqual({
      dmgPath: "/tmp/Everr.dmg",
      keyId: "KEY123",
      keyPath: "/tmp/AuthKey_KEY123.p8",
      issuer: "issuer-uuid",
    });
  });

  it("skips DMG notarization on non-macOS hosts", () => {
    expect(
      resolveDmgNotarizationRequest({
        platform: "linux",
        dmgPath: "/tmp/Everr.dmg",
        env: {
          APPLE_API_KEY: "KEY123",
          APPLE_API_KEY_PATH: "/tmp/AuthKey_KEY123.p8",
          APPLE_API_ISSUER: "issuer-uuid",
        },
      }),
    ).toBeNull();
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

  it("writes sorted checksums for staged release files", async () => {
    const releaseDir = await makeTempDir();
    await writeFile(path.join(releaseDir, "b.txt"), "second");
    await mkdir(path.join(releaseDir, "nested"), { recursive: true });
    await writeFile(path.join(releaseDir, "nested", "a.txt"), "first");

    const checksumsPath = await writeReleaseChecksums(releaseDir);
    const checksums = await readFile(checksumsPath, "utf8");

    expect(checksums).toBe(
      [
        "16367aacb67a4a017c8da8ab95682ccb390863780f7114dda0a0e0c55644c7c4  b.txt",
        "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e  nested/a.txt",
        "",
      ].join("\n"),
    );
  });
});
