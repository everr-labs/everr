#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// The public npm packages this monorepo ships, in dependency order:
// @everr/otel-web consumes @everr/otel-errors/core, so the errors package
// must be on the registry first.
const PACKAGE_DIRS = ["packages/otel-errors", "packages/otel-web"];

const repoRoot = path.resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readManifest(packageDir) {
  const packageJsonPath = path.join(repoRoot, packageDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  if (!packageJson.name || !packageJson.version) {
    console.error(`Missing name or version in ${packageJsonPath}`);
    process.exit(1);
  }

  return { name: packageJson.name, version: packageJson.version };
}

function isPublished({ name, version }) {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status === 0 && result.stdout.trim() === version) {
    return true;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0 && output.includes("E404")) {
    return false;
  }

  console.error(output.trim());
  process.exit(result.status ?? 1);
}

for (const packageDir of PACKAGE_DIRS) {
  const manifest = readManifest(packageDir);
  console.log(`Preparing ${manifest.name}@${manifest.version}`);

  if (dryRun) {
    console.log("Dry run: skipping npm lookup, build, and publish.");
    continue;
  }

  if (isPublished(manifest)) {
    console.log(`${manifest.name}@${manifest.version} is already published.`);
    continue;
  }

  run("pnpm", ["--filter", manifest.name, "build"]);
  run("pnpm", [
    "--filter",
    manifest.name,
    "publish",
    "--access",
    "public",
    "--no-git-checks",
  ]);
}

if (dryRun) {
  console.log("Dry run: skipping tagging.");
} else {
  run("pnpm", ["run", "changeset:tag"]);
}
