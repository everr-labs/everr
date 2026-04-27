import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { $ } from "zx";
import {
  prepareChdbLibResource,
  repoDir,
  resolveTargetTriple,
  signBinaryIfNeeded,
} from "./build-support.ts";

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("Usage: prepare-tauri-collector-sidecar.ts <debug|release>");
  process.exit(1);
}
const [mode] = args;

await prepareChdbLibResource(mode);

// Build the local collector. The collector Makefile detects host GOOS/GOARCH.
console.log(`Building local OTel collector (${mode})...`);
await $`make -C ${path.join(repoDir, "collector")} build-local`;

// Determine the Rust target triple for the current host.
const triple = await resolveTargetTriple();

const builtBin = path.join(repoDir, "collector", "build-local", "everr-local-collector");
const sidecarDir = path.join(repoDir, "target", "desktop-sidecars");
const destBin = path.join(sidecarDir, `everr-local-collector-${triple}`);

await mkdir(sidecarDir, { recursive: true });
await copyFile(builtBin, destBin);
await chmod(destBin, 0o755);

if (mode === "release") {
  await signBinaryIfNeeded(destBin);
}

console.log(`Prepared collector sidecar at ${destBin}`);
