import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "zx";
import {
  desktopReleaseDir,
  installCliBinary,
  loadBuildEnvFile,
  readDesktopTauriConfigVersion,
  repoDir,
  resolveDesktopReleaseIdentity,
  writeDesktopReleaseTauriConfigOverride,
} from "./build-support.ts";
import {
  notarizeReleaseDmgIfConfigured,
  stageReleaseArtifacts,
} from "./copy-release-artifact.ts";

export async function buildDesktop(args = process.argv.slice(2)) {
  const tauriArgs: string[] = [];
  let installCli = false;
  let ciBuild = false;

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
      throw new Error("Desktop release versions are derived from the CI commit SHA.");
    }

    if (arg === "--version" || arg.startsWith("--version=")) {
      throw new Error("Desktop release versions are derived from the CI commit SHA.");
    }

    if (arg === "--bundles" || arg.startsWith("--bundles=")) {
      throw new Error(
        "build:desktop always builds the app and dmg bundles. Use `pnpm tauri build` directly if you need custom bundle targets.",
      );
    }

    tauriArgs.push(arg);
  }

  loadBuildEnvFile();

  if (ciBuild && installCli) {
    throw new Error("--install is not supported for CI desktop builds.");
  }

  await rm(desktopReleaseDir, { recursive: true, force: true });

  const fallbackVersion = await readDesktopTauriConfigVersion();
  const gitShaResult = await $({ nothrow: true })`git -C ${repoDir} rev-parse HEAD`;
  const identity = resolveDesktopReleaseIdentity({
    fallbackVersion,
    fallbackSha: gitShaResult.exitCode === 0 ? gitShaResult.stdout.trim() : undefined,
  });
  Object.assign(process.env, {
    EVERR_PLATFORM_VERSION: identity.platformVersion,
    EVERR_RELEASE_SHA: identity.releaseSha,
    EVERR_RELEASE_SHORT_SHA: identity.releaseShortSha,
  });

  if (ciBuild) {
    const overridePath = await writeDesktopReleaseTauriConfigOverride({
      outputPath: path.join(repoDir, "target", "desktop-build", "tauri-release.conf.json"),
      platformVersion: identity.platformVersion,
    });
    tauriArgs.push("--config", overridePath);
  }

  // DMG packaging is more reliable in CI mode because Tauri skips Finder AppleScript setup.
  await $({
    env: {
      ...process.env,
      CI: process.env.CI || "true",
      EVERR_PLATFORM_VERSION: identity.platformVersion,
      EVERR_RELEASE_SHA: identity.releaseSha,
      EVERR_RELEASE_SHORT_SHA: identity.releaseShortSha,
    },
  })`pnpm tauri build --bundles app,dmg ${tauriArgs}`;
  await notarizeReleaseDmgIfConfigured();
  await stageReleaseArtifacts();

  if (installCli) {
    await installCliBinary(path.join(desktopReleaseDir, "everr"));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDesktop();
}
