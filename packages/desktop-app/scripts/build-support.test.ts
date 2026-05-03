import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHDB_LIB_ARCHIVE_SHA256,
  CHDB_LIB_ASSET_NAME,
  CHDB_RELEASE_VERSION,
  chdbReleaseAssetUrl,
  defaultDesktopVersionPaths,
  publishCliArtifact,
  readDesktopTauriConfigVersion,
  resolveDesktopReleaseIdentity,
  sha256File,
  type DesktopVersionPaths,
  writeDesktopReleaseTauriConfigOverride,
} from "./build-support";

const tempDirs: string[] = [];
const originalDesktopVersionPaths: DesktopVersionPaths = { ...defaultDesktopVersionPaths };

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "everr-build-support-"));
  tempDirs.push(dir);
  return dir;
}

async function writeDesktopVersionFiles(rootDir: string, version: string) {
  const paths: DesktopVersionPaths = {
    packageJsonPath: path.join(rootDir, "package.json"),
    tauriConfigPath: path.join(rootDir, "src-tauri", "tauri.conf.json"),
    tauriCargoTomlPath: path.join(rootDir, "src-tauri", "Cargo.toml"),
  };

  await mkdir(path.dirname(paths.tauriConfigPath), { recursive: true });
  await writeFile(
    paths.packageJsonPath,
    `${JSON.stringify({ name: "@everr/desktop-app", version }, null, 2)}\n`,
  );
  await writeFile(
    paths.tauriConfigPath,
    `${JSON.stringify({ productName: "Everr", version }, null, 2)}\n`,
  );
  await writeFile(
    paths.tauriCargoTomlPath,
    `[package]\nname = "everr-app"\nversion = "${version}"\nedition = "2021"\n`,
  );

  return paths;
}

afterEach(async () => {
  Object.assign(defaultDesktopVersionPaths, originalDesktopVersionPaths);
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("build-support version helpers", () => {
  it("derives CI release identity from GitHub Actions env vars", () => {
    expect(
      resolveDesktopReleaseIdentity({
        env: {
          GITHUB_SHA: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
          GITHUB_RUN_NUMBER: "1234",
        },
        fallbackVersion: "0.1.30",
        fallbackSha: "localsha",
      }),
    ).toEqual({
      platformVersion: "0.1.1264",
      releaseSha: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
      releaseShortSha: "82efe1c",
      source: "github-actions",
    });
  });

  it("uses local fallbacks outside GitHub Actions", () => {
    expect(
      resolveDesktopReleaseIdentity({
        env: {},
        fallbackVersion: "0.1.30",
        fallbackSha: "localsha123456",
      }),
    ).toEqual({
      platformVersion: "0.1.30",
      releaseSha: "localsha123456",
      releaseShortSha: "localsh",
      source: "local",
    });
  });

  it("uses pre-resolved release env without adding the GitHub run number again", () => {
    expect(
      resolveDesktopReleaseIdentity({
        env: {
          GITHUB_SHA: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
          GITHUB_RUN_NUMBER: "1234",
          EVERR_PLATFORM_VERSION: "0.1.1264",
          EVERR_RELEASE_SHA: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
          EVERR_RELEASE_SHORT_SHA: "82efe1c",
        },
        fallbackVersion: "0.1.30",
      }),
    ).toEqual({
      platformVersion: "0.1.1264",
      releaseSha: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
      releaseShortSha: "82efe1c",
      source: "github-actions",
    });
  });

  it("rejects invalid generated platform versions", () => {
    expect(() =>
      resolveDesktopReleaseIdentity({
        env: {
          GITHUB_SHA: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
          GITHUB_RUN_NUMBER: "not-a-number",
        },
        fallbackVersion: "0.1.30",
        fallbackSha: "localsha",
      }),
    ).toThrow(/GITHUB_RUN_NUMBER/);
  });

  it("writes a Tauri config override with the generated platform version", async () => {
    const rootDir = await makeTempDir();
    const overridePath = path.join(rootDir, "release-tauri.conf.json");

    await expect(
      writeDesktopReleaseTauriConfigOverride({
        outputPath: overridePath,
        platformVersion: "0.1.1264",
      }),
    ).resolves.toBe(overridePath);

    await expect(readFile(overridePath, "utf8")).resolves.toBe(
      `${JSON.stringify({ version: "0.1.1264" }, null, 2)}\n`,
    );
  });

  it("rejects raw SHAs as Tauri platform versions", async () => {
    const rootDir = await makeTempDir();

    await expect(
      writeDesktopReleaseTauriConfigOverride({
        outputPath: path.join(rootDir, "bad.conf.json"),
        platformVersion: "82efe1c",
      }),
    ).rejects.toThrow(/semantic version/);
  });

  it("reads the checked-in desktop Tauri config version", async () => {
    const rootDir = await makeTempDir();
    const paths = await writeDesktopVersionFiles(rootDir, "0.1.0");
    Object.assign(defaultDesktopVersionPaths, paths);

    await expect(readDesktopTauriConfigVersion()).resolves.toBe("0.1.0");
  });
});

describe("build-support chDB helpers", () => {
  it("pins the official macOS arm64 chDB release asset", () => {
    expect(CHDB_RELEASE_VERSION).toBe("v4.0.2");
    expect(CHDB_LIB_ASSET_NAME).toBe("macos-arm64-libchdb.tar.gz");
    expect(CHDB_LIB_ARCHIVE_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(chdbReleaseAssetUrl()).toBe(
      "https://github.com/chdb-io/chdb/releases/download/v4.0.2/macos-arm64-libchdb.tar.gz",
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
    await expect(access(path.join(outputDir, "everr.bin"))).rejects.toThrow();
  });
});
