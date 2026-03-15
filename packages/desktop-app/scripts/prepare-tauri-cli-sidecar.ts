import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { $ } from "zx";
import {
  packageDir,
  publishCliArtifact,
  resolveCliBuild,
  resolveTargetTriple,
} from "./build-support.ts";

const args = process.argv.slice(2);

if (args.length !== 1) {
  console.error("Usage: prepare-tauri-cli-sidecar.ts <debug|release>");
  process.exit(1);
}

const [mode] = args;
const targetTriple = await resolveTargetTriple();
const { buildArgs, builtBin } = resolveCliBuild(mode);
const sourceBin = builtBin;
const binariesDir = path.join(packageDir, "src-tauri", "binaries");
const destBin = path.join(binariesDir, `everr-${targetTriple}`);

console.log(`Building Everr CLI sidecar (${mode})...`);
await $`cargo build ${buildArgs}`;

await mkdir(binariesDir, { recursive: true });
await copyFile(sourceBin, destBin);
await chmod(destBin, 0o755);

if (mode === "release") {
  await publishCliArtifact(sourceBin);
}

console.log(`Prepared Tauri sidecar at ${destBin}`);
