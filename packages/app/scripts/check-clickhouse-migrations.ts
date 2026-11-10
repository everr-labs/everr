import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  changedClickHouseMigrationFiles,
  CLICKHOUSE_MIGRATION_DIRS,
  isClickHouseMigrationPath,
} from "../src/db/clickhouse-statements.ts";

// Fails the pull request when a ClickHouse migration that already exists on
// the base branch changes its statements or disappears. Comment-only edits
// pass. New files pass. Startup repeats the check against the journal.
const ref = process.argv[2];
if (!ref) {
  console.error("Usage: check-clickhouse-migrations.ts <git-ref>");
  process.exit(2);
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

const listed = git(["ls-tree", "-r", "--name-only", ref, "--", ...CLICKHOUSE_MIGRATION_DIRS]);
const base = new Map<string, string>();
for (const path of listed.split("\n")) {
  if (!isClickHouseMigrationPath(path)) continue;
  base.set(path, git(["show", `${ref}:${path}`]));
}

const head = new Map<string, string>();
for (const path of base.keys()) {
  const full = resolve(root, path);
  if (!existsSync(full)) continue;
  head.set(path, readFileSync(full, "utf8"));
}

const changed = changedClickHouseMigrationFiles(base, head);
if (changed.length === 0) process.exit(0);

console.error(
  `ClickHouse migrations changed after they were committed:\n${changed
    .map((path) => `  ${path}`)
    .join("\n")}\nApplied migrations are immutable: restore them and put the change in a new file.`,
);
process.exit(1);
