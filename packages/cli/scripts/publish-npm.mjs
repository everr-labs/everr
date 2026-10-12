import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platforms } from "../npm/everr.cjs";

function isPublished(result, version) {
  if (result.status === 0) return JSON.parse(result.stdout) === version;
  if (`${result.stdout}\n${result.stderr}`.includes("E404")) return false;
  throw new Error(
    `npm registry lookup failed: ${result.stderr || result.error?.message || result.stdout}`,
  );
}

export async function publishNpmPackages(
  root,
  { dryRun = false, run = spawnSync } = {},
) {
  const directories = [
    ...Object.values(platforms).map(({ name }) => name.split("/")[1]),
    "cli",
  ];
  for (const directory of directories) {
    const cwd = path.resolve(root, directory);
    const { name, version } = JSON.parse(
      await readFile(path.join(cwd, "package.json"), "utf8"),
    );
    if (!dryRun) {
      const result = run(
        "npm",
        ["view", `${name}@${version}`, "version", "--json"],
        { encoding: "utf8" },
      );
      if (isPublished(result, version)) {
        console.log(`${name}@${version} is already published.`);
        continue;
      }
    }
    const tag = version.includes("-") ? "next" : "latest";
    const result = run(
      "npm",
      [
        "publish",
        "--access",
        "public",
        "--tag",
        tag,
        ...(dryRun ? ["--dry-run"] : ["--provenance"]),
      ],
      { cwd, stdio: "inherit" },
    );
    if (result.status !== 0)
      throw new Error(
        `Publishing ${name}@${version} failed with status ${result.status}: ${result.error?.message ?? ""}`,
      );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [root, flag] = process.argv.slice(2);
  if (!root || (flag && flag !== "--dry-run") || process.argv.length > 4) {
    throw new Error("Usage: publish-npm.mjs <package-directory> [--dry-run]");
  }
  await publishNpmPackages(root, { dryRun: flag === "--dry-run" });
}
