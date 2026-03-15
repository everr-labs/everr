import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bumpDesktopAppPatchVersion,
  bumpPatchVersion,
  type DesktopVersionPaths,
} from "./build-support";

const tempDirs: string[] = [];

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
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("build-support version helpers", () => {
  it("bumps a patch version", () => {
    expect(bumpPatchVersion("1.2.3")).toBe("1.2.4");
  });

  it("updates the desktop app version across release files", async () => {
    const rootDir = await makeTempDir();
    const paths = await writeDesktopVersionFiles(rootDir, "0.1.0");

    await expect(bumpDesktopAppPatchVersion(paths)).resolves.toEqual({
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

    await expect(bumpDesktopAppPatchVersion(paths)).resolves.toEqual({
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
