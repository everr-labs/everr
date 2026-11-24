import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  changedClickHouseMigrationFiles,
  CLICKHOUSE_MIGRATION_DIRS,
  droppedClickHouseSeedFiles,
  isClickHouseMigrationPath,
  lateClickHouseSeedFiles,
} from "../src/db/clickhouse-statements.ts";

// Fails the pull request when a ClickHouse migration that already exists on
// the base branch changes or disappears. A comment edit is a change. New
// files pass. Startup repeats the check against the journal. It also fails
// when a seed is added to a migration the base branch already has: the
// seed would never run where that migration is applied.
const ref = process.argv[2];
if (!ref) {
  console.error("Usage: check-clickhouse-migrations.ts <git-ref>");
  process.exit(2);
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

const listed = git(["ls-tree", "-r", "--name-only", ref, "--", ...CLICKHOUSE_MIGRATION_DIRS])
  .split("\n")
  .filter(Boolean);
const base = new Map<string, string>();
for (const path of listed) {
  if (!isClickHouseMigrationPath(path)) continue;
  base.set(path, git(["show", `${ref}:${path}`]));
}

const head = new Map<string, string>();
for (const path of base.keys()) {
  const full = resolve(root, path);
  if (!existsSync(full)) continue;
  head.set(path, readFileSync(full, "utf8"));
}

const basePaths = new Set(listed);
const headPaths = new Set(
  CLICKHOUSE_MIGRATION_DIRS.flatMap((dir) =>
    existsSync(resolve(root, dir))
      ? readdirSync(resolve(root, dir)).map((name) => `${dir}/${name}`)
      : [],
  ),
);

const failures = [
  {
    paths: changedClickHouseMigrationFiles(base, head),
    title: "ClickHouse migrations changed after they were committed:",
    fix: "Applied migrations are immutable: restore them and put the change in a new file.",
  },
  {
    paths: lateClickHouseSeedFiles(basePaths, headPaths),
    title: "ClickHouse seeds added to migrations that are already committed:",
    fix: "A seed runs once, with its migration: put it next to a new migration file.",
  },
  {
    paths: droppedClickHouseSeedFiles(basePaths, headPaths),
    title: "ClickHouse seeds deleted from migrations that are already committed:",
    fix: "A new server applies the migration and needs its seed: restore the file.",
  },
].filter(({ paths }) => paths.length > 0);

for (const { paths, title, fix } of failures) {
  console.error(`${title}\n${paths.map((path) => `  ${path}`).join("\n")}\n${fix}`);
}

process.exit(failures.length > 0 ? 1 : 0);
