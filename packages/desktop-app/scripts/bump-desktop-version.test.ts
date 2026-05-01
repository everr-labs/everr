import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDesktopVersionPaths, type DesktopVersionPaths } from "./build-support";
import {
  bumpDesktopVersion,
  parseDesktopVersionBumpArgs,
} from "./bump-desktop-version";

const tempDirs: string[] = [];
const originalDesktopVersionPaths: DesktopVersionPaths = { ...defaultDesktopVersionPaths };

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "everr-desktop-bump-"));
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

describe("bump-desktop-version command", () => {
  it("defaults to a patch bump across desktop release files", async () => {
    const rootDir = await makeTempDir();
    const paths = await writeDesktopVersionFiles(rootDir, "1.2.3");
    Object.assign(defaultDesktopVersionPaths, paths);

    await expect(bumpDesktopVersion([])).resolves.toEqual({
      increment: "patch",
      previousVersion: "1.2.3",
      nextVersion: "1.2.4",
    });

    await expect(readFile(paths.packageJsonPath, "utf8")).resolves.toContain('"version": "1.2.4"');
    await expect(readFile(paths.tauriConfigPath, "utf8")).resolves.toContain('"version": "1.2.4"');
    await expect(readFile(paths.tauriCargoTomlPath, "utf8")).resolves.toContain(
      'version = "1.2.4"',
    );
  });

  it("parses the optional bump size", () => {
    expect(parseDesktopVersionBumpArgs([])).toBe("patch");
    expect(parseDesktopVersionBumpArgs(["minor"])).toBe("minor");
    expect(parseDesktopVersionBumpArgs(["--major"])).toBe("major");
  });

  it("rejects more than one bump size", () => {
    expect(() => parseDesktopVersionBumpArgs(["patch", "minor"])).toThrow(
      "Choose only one desktop version bump",
    );
  });
});
