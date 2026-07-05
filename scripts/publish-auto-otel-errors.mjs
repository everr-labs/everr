#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageDir = path.join(repoRoot, "packages", "auto-otel-errors");
const packageJsonPath = path.join(packageDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageName = packageJson.name;
const packageVersion = packageJson.version;
const dryRun = process.argv.includes("--dry-run");

if (!packageName || !packageVersion) {
  console.error(`Missing name or version in ${packageJsonPath}`);
  process.exit(1);
}

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

function npmViewVersion() {
  return spawnSync("npm", ["view", `${packageName}@${packageVersion}`, "version"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isPublished() {
  const result = npmViewVersion();
  if (result.status === 0 && result.stdout.trim() === packageVersion) {
    return true;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0 && output.includes("E404")) {
    return false;
  }

  console.error(output.trim());
  process.exit(result.status ?? 1);
}

console.log(`Preparing ${packageName}@${packageVersion}`);

if (dryRun) {
  console.log("Dry run: skipping npm lookup, build, publish, and tagging.");
  process.exit(0);
}

if (isPublished()) {
  console.log(`${packageName}@${packageVersion} is already published.`);
} else {
  run("pnpm", ["--filter", packageName, "build"]);
  run("pnpm", ["--filter", packageName, "publish", "--access", "public", "--no-git-checks"]);
}

run("pnpm", ["run", "changeset:tag"]);
