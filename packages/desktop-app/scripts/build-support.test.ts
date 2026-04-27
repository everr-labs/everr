import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHDB_LIB_ARCHIVE_SHA256,
  CHDB_LIB_ASSET_NAME,
  CHDB_RELEASE_VERSION,
  bumpDesktopAppVersion,
  bumpVersion,
  chdbReleaseAssetUrl,
  defaultDesktopVersionPaths,
  sha256File,
  type DesktopVersionPaths,
} from "./build-support";

const tempDirs: string[] = [];
const originalDesktopVersionPaths: DesktopVersionPaths = { ...defaultDesktopVersionPaths };

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "everr-build-support-"));
  tempDirs.push(dir);
  return dir;
}

async function writeDesktopVersionFiles(
  rootDir: string,
  version: string,
  overrides?: {
    packageJsonVersion?: string;
    tauriConfigVersion?: string;
    tauriCargoVersion?: string;
  },
) {
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

  if (overrides?.packageJsonVersion) {
    await writeFile(
      paths.packageJsonPath,
      `${JSON.stringify({ name: "@everr/desktop-app", version: overrides.packageJsonVersion }, null, 2)}\n`,
    );
  }

  if (overrides?.tauriConfigVersion) {
    await writeFile(
      paths.tauriConfigPath,
      `${JSON.stringify({ productName: "Everr", version: overrides.tauriConfigVersion }, null, 2)}\n`,
    );
  }

  if (overrides?.tauriCargoVersion) {
    await writeFile(
      paths.tauriCargoTomlPath,
      `[package]\nname = "everr-app"\nversion = "${overrides.tauriCargoVersion}"\nedition = "2021"\n`,
    );
  }

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
  it("bumps a patch version", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  it("updates the desktop app version across release files", async () => {
    const rootDir = await makeTempDir();
    const paths = await writeDesktopVersionFiles(rootDir, "0.1.0");
    Object.assign(defaultDesktopVersionPaths, paths);

    await expect(bumpDesktopAppVersion("patch")).resolves.toEqual({
      previousVersion: "0.1.0",
      nextVersion: "0.1.1",
    });

    await expect(readFile(paths.packageJsonPath, "utf8")).resolves.toContain('"version": "0.1.1"');
    await expect(readFile(paths.tauriConfigPath, "utf8")).resolves.toContain('"version": "0.1.1"');
    await expect(readFile(paths.tauriCargoTomlPath, "utf8")).resolves.toContain(
      'version = "0.1.1"',
    );
  });

  it("uses package.json as the source of truth when other versions differ", async () => {
    const rootDir = await makeTempDir();
    const paths = await writeDesktopVersionFiles(rootDir, "0.1.0", {
      packageJsonVersion: "2.4.9",
      tauriConfigVersion: "1.0.0",
      tauriCargoVersion: "0.1.1",
    });
    Object.assign(defaultDesktopVersionPaths, paths);

    await expect(bumpDesktopAppVersion("patch")).resolves.toEqual({
      previousVersion: "2.4.9",
      nextVersion: "2.4.10",
    });

    await expect(readFile(paths.packageJsonPath, "utf8")).resolves.toContain('"version": "2.4.10"');
    await expect(readFile(paths.tauriConfigPath, "utf8")).resolves.toContain('"version": "2.4.10"');
    await expect(readFile(paths.tauriCargoTomlPath, "utf8")).resolves.toContain(
      'version = "2.4.10"',
    );
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
