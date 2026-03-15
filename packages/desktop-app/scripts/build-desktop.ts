import path from "node:path";
import { $ } from "zx";
import {
  docsPublicDir,
  installCliBinary,
  loadBuildEnvFile,
} from "./build-support.ts";
import { copyReleaseArtifact } from "./copy-release-artifact.ts";

const args = process.argv.slice(2);
const tauriArgs: string[] = [];
let installCli = false;

for (const arg of args) {
  if (arg === "--install") {
    installCli = true;
    continue;
  }

  tauriArgs.push(arg);
}

loadBuildEnvFile();

await $`pnpm tauri build ${tauriArgs}`;
await copyReleaseArtifact();

if (installCli) {
  await installCliBinary(path.join(docsPublicDir, "everr"));
}
