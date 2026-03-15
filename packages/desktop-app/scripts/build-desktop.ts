import path from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "zx";
import {
  docsPublicDir,
  installCliBinary,
  loadBuildEnvFile,
} from "./build-support.ts";
import { copyReleaseArtifact } from "./copy-release-artifact.ts";

export async function buildDesktop(args = process.argv.slice(2)) {
  const tauriArgs: string[] = [];
  let installCli = false;

  for (const arg of args) {
    if (arg === "--install") {
      installCli = true;
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

  // DMG packaging is more reliable in CI mode because Tauri skips Finder AppleScript setup.
  await $({
    env: {
      ...process.env,
      CI: process.env.CI || "true",
    },
  })`pnpm tauri build --bundles app,dmg ${tauriArgs}`;
  await copyReleaseArtifact();

  if (installCli) {
    await installCliBinary(path.join(docsPublicDir, "everr"));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDesktop();
}
