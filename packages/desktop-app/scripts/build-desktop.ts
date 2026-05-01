import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "zx";
import {
  bumpDesktopAppVersion,
  desktopReleaseDir,
  installCliBinary,
  loadBuildEnvFile,
  setDesktopAppVersion,
} from "./build-support.ts";
import { stageReleaseArtifacts } from "./copy-release-artifact.ts";

export async function buildDesktop(args = process.argv.slice(2)) {
  const tauriArgs: string[] = [];
  let installCli = false;
  let bumpReleaseVersion = false;
  let ciBuild = false;
  let exactVersion = process.env.EVERR_DESKTOP_RELEASE_VERSION?.trim() || undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--install") {
      installCli = true;
      continue;
    }

    if (arg === "--ci") {
      ciBuild = true;
      continue;
    }

    if (arg === "--release") {
      bumpReleaseVersion = true;
      continue;
    }

    if (arg === "--version") {
      exactVersion = args[index + 1];
      index += 1;
      if (!exactVersion) {
        throw new Error("--version requires a semantic version value.");
      }
      continue;
    }

    if (arg.startsWith("--version=")) {
      exactVersion = arg.slice("--version=".length);
      if (!exactVersion) {
        throw new Error("--version requires a semantic version value.");
      }
      continue;
    }

    if (arg === "--bundles" || arg.startsWith("--bundles=")) {
      throw new Error(
        "build:desktop always builds the app and dmg bundles. Use `pnpm tauri build` directly if you need custom bundle targets.",
      );
    }

    tauriArgs.push(arg);
  }

  loadBuildEnvFile();

  if (bumpReleaseVersion && exactVersion) {
    throw new Error("Use either --release or --version, not both.");
  }

  if (ciBuild && installCli) {
    throw new Error("--install is not supported for CI desktop builds.");
  }

  if (bumpReleaseVersion) {
    const { previousVersion, nextVersion } = await bumpDesktopAppVersion("patch");
    console.log(`Bumped desktop app version from ${previousVersion} to ${nextVersion}.`);
  }

  if (exactVersion) {
    const { previousVersion, nextVersion } = await setDesktopAppVersion(exactVersion);
    console.log(`Set desktop app version from ${previousVersion} to ${nextVersion}.`);
  }

  await rm(desktopReleaseDir, { recursive: true, force: true });

  // DMG packaging is more reliable in CI mode because Tauri skips Finder AppleScript setup.
  await $({
    env: {
      ...process.env,
      CI: process.env.CI || "true",
    },
  })`pnpm tauri build --bundles app,dmg ${tauriArgs}`;
  await stageReleaseArtifacts();

  if (installCli) {
    await installCliBinary(path.join(desktopReleaseDir, "everr"));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDesktop();
}
