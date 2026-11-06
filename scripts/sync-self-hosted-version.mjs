#!/usr/bin/env node
// Runs after `changeset version`. Pins the self-hosted Compose stack to the
// image tags that the release workflow publishes for this @everr/app version.
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const composePath = path.join(repoRoot, "deploy/compose.yaml");
const { version } = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "packages/app/package.json"), "utf8"),
);

const compose = fs.readFileSync(composePath, "utf8");
const pattern = /\$\{EVERR_VERSION:-[^}]+\}/g;
const matches = compose.match(pattern) ?? [];
if (matches.length !== 3) {
  console.error(`Expected 3 EVERR_VERSION image tags in ${composePath}, found ${matches.length}.`);
  process.exit(1);
}

fs.writeFileSync(composePath, compose.replace(pattern, `\${EVERR_VERSION:-${version}}`));
console.log(`Pinned deploy/compose.yaml to ${version}`);
