import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { $ } from "zx";
import {
  publishCliArtifact,
  resolveCliBuild,
  repoDir,
  signBinaryIfNeeded,
} from "./build-support.ts";

const args = process.argv.slice(2);

if (args.length !== 1) {
  console.error("Usage: prepare-tauri-cli-sidecar.ts <debug|release>");
  process.exit(1);
}

const [mode] = args;
const { buildArgs, builtBin } = resolveCliBuild(mode);
const sourceBin = builtBin;
const resourceDir = path.join(repoDir, "target", "desktop-resources");
const destBin = path.join(resourceDir, "everr");

console.log(`Building bundled Everr CLI (${mode})...`);
await $`cargo build ${buildArgs}`;

await mkdir(resourceDir, { recursive: true });
await copyFile(sourceBin, destBin);
await chmod(destBin, 0o755);

if (mode === "release") {
  await signBinaryIfNeeded(destBin);
  await publishCliArtifact(sourceBin);
}

console.log(`Prepared bundled CLI resource at ${destBin}`);
